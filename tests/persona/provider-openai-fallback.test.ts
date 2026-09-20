import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAICompatibleProvider, type OpenAICompatibleConfig, type LLMProvider, type FallbackReservationRequest } from '../../supabase/functions/_shared/llm/provider.ts';

import { generatePersonaReply } from '../../supabase/functions/_shared/llm/reply.ts';
const primaryUrl = 'https://api.cloudflare.com/client/v4/accounts/synthetic-account/ai/v1';
const secondaryUrl = 'https://api.openai.com/v1';
const fallback: NonNullable<OpenAICompatibleConfig['fallback']> = { baseUrl: secondaryUrl, apiKey: 'secondary-test-token', model: 'gpt-5.6-luna', reserve: async () => ({ settle: async () => {} }) };
const messages = [{ role: 'system' as const, content: 'Server rules.' }, { role: 'user' as const, content: '안녕. 원래 사용자 요청.' }];
const source = readFileSync('scripts/openai-fallback-release/provider.ts.txt', 'utf8');
// The deployed-v4 overlay has only a type-only relative import. Transpile it in
// memory; no test-generated files or remote modules are used.
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const legacy = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const factories: [string, (config: OpenAICompatibleConfig) => LLMProvider][] = [
  ['current candidate', createOpenAICompatibleProvider], ['new deployed-v4 Luna overlay', legacy.createOpenAICompatibleProvider],
];
const envelope = (content = '{"text":"안녕.","toolReferences":[]}', extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], ...extra }));
const settings = (fetchImpl: typeof fetch, overrides: Partial<OpenAICompatibleConfig> = {}): OpenAICompatibleConfig => ({ baseUrl: primaryUrl, apiKey: 'primary-test-token', model: '@cf/qwen/qwen3-30b-a3b-fp8', structuredFormat: 'json_object', fallback, fetchImpl, ...overrides });
const body = (fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, index: number) => JSON.parse(fetchMock.mock.calls[index]![1]!.body as string);
const validate = (value: unknown): string => {
  if (!value || typeof value !== 'object' || (value as { intent?: unknown }).intent !== 'ok') throw Error('PRIVATE_VALIDATOR_DETAIL');
  return 'ok';
};
afterEach(() => vi.useRealTimers());

describe.each(factories)('%s: quota-only OpenAI Luna fallback', (_name, create) => {
  it('keeps the primary serialized request unchanged and never sends to OpenAI Luna after success', async () => {
    const first = vi.fn<typeof fetch>().mockImplementation(async () => envelope());
    const baseline = vi.fn<typeof fetch>().mockImplementation(async () => envelope());
    const result = await create(settings(first)).generateChat(messages);
    await create(settings(baseline, { fallback: undefined })).generateChat(messages);
    expect(first).toHaveBeenCalledTimes(1);
    expect(first.mock.calls[0]![0]).toBe(`${primaryUrl}/chat/completions`);
    expect(first.mock.calls[0]![1]!.body).toBe(baseline.mock.calls[0]![1]!.body);
    expect(body(first, 0)).toMatchObject({ model: '@cf/qwen/qwen3-30b-a3b-fp8', temperature: 0.65, max_tokens: 900 });
    expect(result.model).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
  });
  it('hands off only after 429 and stays on OpenAI Luna for the one later repair', async () => {
    const cancelled = vi.fn(() => new Promise<void>(() => {}));
    const quota = new Response(new ReadableStream({ cancel: cancelled }), { status: 429 });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(quota).mockImplementation(async () => envelope());
    const provider = create(settings(fetchImpl));
    const result = await provider.generateChat(messages);
    const repaired = await provider.repairChat(messages, 'invalid', ['JSON_REQUIRED']);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(result.model).toBe('gpt-5.6-luna'); expect(repaired.model).toBe('gpt-5.6-luna');
    expect(fetchImpl.mock.calls.map(call => call[0])).toEqual([`${primaryUrl}/chat/completions`, `${secondaryUrl}/chat/completions`, `${secondaryUrl}/chat/completions`]);
    expect(fetchImpl.mock.calls[0]![1]!.signal).toBe(fetchImpl.mock.calls[1]![1]!.signal);
    expect(fetchImpl.mock.calls[2]![1]!.signal).not.toBe(fetchImpl.mock.calls[1]![1]!.signal);
    for (const index of [1, 2]) {
      expect(body(fetchImpl, index)).toMatchObject({ model: 'gpt-5.6-luna', reasoning_effort: 'none', max_completion_tokens: 900, store: false, service_tier: 'default', stream: false, response_format: { type: 'json_object' } });
      expect(body(fetchImpl, index)).not.toHaveProperty('temperature'); expect(body(fetchImpl, index)).not.toHaveProperty('chat_template_kwargs');
      expect(JSON.stringify(body(fetchImpl, index))).not.toContain('/no_think');
    }
    expect((fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>).Authorization).toBe('Bearer primary-test-token');
    for (const index of [1, 2]) expect((fetchImpl.mock.calls[index]![1]!.headers as Record<string, string>).Authorization).toBe('Bearer secondary-test-token');
    for (const call of fetchImpl.mock.calls) expect(call[1]!.redirect).toBe('error');
  });
  it('keeps the exact structured schema and output cap across initial429 and one repair (three HTTP total)', async () => {
    const schema = { type: 'object', required: ['intent'], properties: { intent: { type: 'string' } } };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(envelope('{"intent":false}')).mockResolvedValueOnce(envelope('{"intent":"ok"}'));
    const result = await create(settings(fetchImpl, { maxOutputTokens: 350, structuredFormat: 'json_schema' })).generateStructured({ messages, schema, name: 'test_contract', validate });
    expect(result).toBe('ok'); expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(body(fetchImpl, 0)).toHaveProperty('max_tokens', 350);
    for (const index of [1, 2]) expect(body(fetchImpl, index)).toHaveProperty('max_completion_tokens', 350);
    for (const index of [0, 1, 2]) expect(body(fetchImpl, index)).toMatchObject({ response_format: { type: 'json_schema', json_schema: { name: 'test_contract', strict: true, schema } } });
    expect(fetchImpl.mock.calls[2]![0]).toBe(`${secondaryUrl}/chat/completions`);
  });
  it('allows quota handoff during a structured repair without starting another repair cycle', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(envelope('{"intent":false}')).mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(envelope('{"intent":"ok"}'));
    expect(await create(settings(fetchImpl)).generateStructured({ messages, schema: {}, validate })).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[1]![1]!.signal).toBe(fetchImpl.mock.calls[2]![1]!.signal);
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${primaryUrl}/chat/completions`);
    expect(fetchImpl.mock.calls[1]![0]).toBe(`${primaryUrl}/chat/completions`);
  });
  it('stops after the secondary repair remains invalid; never calls a third transport', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 429 })).mockImplementation(async () => envelope('{"intent":false}'));
    await expect(create(settings(fetchImpl)).generateStructured({ messages, schema: {}, validate })).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('stops on secondary429 or auth failure and never exposes either key or upstream body', async () => {
    for (const status of [429, 401]) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('PRIVATE_PRIMARY', { status: 429 })).mockResolvedValueOnce(new Response('PRIVATE_SECONDARY primary-test-token secondary-test-token', { status }));
      const error = await create(settings(fetchImpl)).generateChat(messages).catch(error => error);
      expect(error.code).toBe(status === 429 ? 'LLM_RATE_LIMITED' : 'LLM_AUTH_FAILED');
      expect(String(error) + JSON.stringify(error)).not.toMatch(/PRIVATE|primary-test-token|secondary-test-token/);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    }
  });
  it.each([400, 401, 403, 408, 500, 503])('does not fallback on primary HTTP %i', async status => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('PRIVATE_UPSTREAM', { status }));
    await expect(create(settings(fetchImpl)).generateChat(messages)).rejects.toMatchObject({ code: status === 401 || status === 403 ? 'LLM_AUTH_FAILED' : 'LLM_UNAVAILABLE' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('does not fallback on network errors, envelope errors, incomplete output, or body cap', async () => {
    const examples = [new Error('PRIVATE_NETWORK'), new Response('not json'), envelope('response', { choices: [{ message: { content: 'truncated' }, finish_reason: 'length' }] }), new Response('x'.repeat(128001))];
    for (const example of examples) {
      const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => { if (example instanceof Error) throw example; return example; });
      await expect(create(settings(fetchImpl)).generateChat(messages)).rejects.toMatchObject({ code: example instanceof Error ? 'LLM_UNAVAILABLE' : 'LLM_INVALID_RESPONSE' });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });
  it('schema/parse validation failure stays on primary for the existing single repair', async () => {
    for (const output of ['not-json', '{"intent":false}']) {
      const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => envelope(output));
      await expect(create(settings(fetchImpl)).generateStructured({ messages, schema: {}, validate })).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(fetchImpl.mock.calls.every(call => call[0] === `${primaryUrl}/chat/completions`)).toBe(true);
    }
  });
  it('shares the initial deadline across a slow primary429 and a hanging secondary body', async () => {
    vi.useFakeTimers(); const cancelled = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementationOnce(async () => { await new Promise(resolve => setTimeout(resolve, 80)); return new Response('', { status: 429 }); }).mockResolvedValueOnce(new Response(new ReadableStream({ cancel: cancelled })));
    const promise = expect(create(settings(fetchImpl, { initialTimeoutMs: 100 })).generateChat(messages)).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(81); expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20); await promise;
    expect(fetchImpl.mock.calls[0]![1]!.signal).toBe(fetchImpl.mock.calls[1]![1]!.signal);
    expect(fetchImpl.mock.calls[1]![1]!.signal!.aborted).toBe(true); expect(cancelled).toHaveBeenCalledTimes(1);
  });
  it('does not start fallback when primary429 arrives after the existing timeout', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 120)); return new Response('', { status: 429 }); });
    const promise = expect(create(settings(fetchImpl, { initialTimeoutMs: 100 })).generateChat(messages)).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(121); await promise; expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([
    { baseUrl: 'http://api.openai.com/v1' },
    { baseUrl: 'https://api.openai.com.evil.test/v1' },
    { baseUrl: `${secondaryUrl}?key=private` }, { baseUrl: `${secondaryUrl}#private` },
    { baseUrl: 'https://user:private@api.openai.com/v1' },
    { baseUrl: `${secondaryUrl}/chat/completions` }, { model: 'other-model' },
    { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.5-flash' },
    { apiKey: '' }, { apiKey: '  ' }, { apiKey: 'primary-test-token' },
  ])('rejects an invalid secondary configuration before transport: %j', overrides => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(() => create(settings(fetchImpl, { fallback: { ...fallback, ...overrides } }))).toThrow('LLM_NOT_CONFIGURED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('limits fallback-enabled primary to the real Cloudflare account HTTPS endpoint', () => {
    const fetchImpl = vi.fn<typeof fetch>();
    for (const baseUrl of ['https://primary.example/v1', 'http://api.cloudflare.com/client/v4/accounts/id/ai/v1', 'https://api.cloudflare.com:444/client/v4/accounts/id/ai/v1']) expect(() => create(settings(fetchImpl, { baseUrl }))).toThrow('LLM_NOT_CONFIGURED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('primary remains usable without a fallback object or any secondary credential', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(envelope()).mockResolvedValueOnce(new Response('', { status: 429 }));
    const provider = create(settings(fetchImpl, { baseUrl: 'https://primary.example/v1', fallback: undefined }));
    await expect(provider.generateChat(messages)).resolves.toHaveProperty('content');
    await expect(provider.generateChat(messages)).rejects.toMatchObject({ code: 'LLM_RATE_LIMITED' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe.each(factories)('%s: mandatory paid-request budget boundary', (_name, create) => {
  it('reserves the exact UTF-8 serialized payload before each send, including repair, and settles each bounded usage', async () => {
    const events: string[] = [];
    const holds: FallbackReservationRequest[] = [];
    const settle = vi.fn(async () => { events.push('settle'); });
    const reserve = vi.fn(async (request: FallbackReservationRequest) => { events.push('reserve'); holds.push(request); return { settle }; });
    let calls = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      calls++; events.push(`fetch${calls}`);
      if (calls === 1) return new Response('', { status: 429 });
      expect(holds.at(-1)).toEqual({ model: 'gpt-5.6-luna', maxOutputTokens: 350, inputBytes: new TextEncoder().encode(init!.body as string).byteLength });
      expect((init!.body as string).length).toBeLessThan(holds.at(-1)!.inputBytes);
      return envelope(calls === 2 ? '{"intent":false}' : '{"intent":"ok"}', { usage: { prompt_tokens: 300, completion_tokens: 25 } });
    });
    await expect(create(settings(fetchImpl, { maxOutputTokens: 350, fallback: { ...fallback, reserve } })).generateStructured({ messages, schema: {}, validate })).resolves.toBe('ok');
    expect(events).toEqual(['fetch1', 'reserve', 'fetch2', 'settle', 'reserve', 'fetch3', 'settle']);
    expect(reserve).toHaveBeenCalledTimes(2); expect(settle.mock.calls).toEqual([[{ promptTokens: 300, completionTokens: 25 }], [{ promptTokens: 300, completionTokens: 25 }]]);
    expect(holds[1]!.inputBytes).toBeGreaterThan(holds[0]!.inputBytes);
  });
  it('neither reserves nor settles when primary succeeds', async () => {
    const settle = vi.fn(), reserve = vi.fn(async () => ({ settle }));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(envelope('ok', { usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    await create(settings(fetchImpl, { fallback: { ...fallback, reserve } })).generateChat(messages);
    expect(reserve).not.toHaveBeenCalled(); expect(settle).not.toHaveBeenCalled(); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('rejects missing/nonfunction reservation hooks and invalid output limits before transport', () => {
    const fetchImpl = vi.fn<typeof fetch>();
    for (const reserve of [undefined, null, 'reserve']) {
      expect(() => create(settings(fetchImpl, { fallback: { ...fallback, reserve } as unknown as NonNullable<OpenAICompatibleConfig['fallback']> }))).toThrow('LLM_NOT_CONFIGURED');
    }
    for (const maxOutputTokens of [0, -1, 0.5, NaN, Infinity]) expect(() => create(settings(fetchImpl, { maxOutputTokens }))).toThrow('LLM_NOT_CONFIGURED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('caps paid output at 900 while leaving the primary configured limit unchanged', async () => {
    const reserve = vi.fn(fallback.reserve);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(envelope());
    await create(settings(fetchImpl, { maxOutputTokens: 1600, fallback: { ...fallback, reserve } })).generateChat(messages);
    expect(body(fetchImpl, 0).max_tokens).toBe(1600); expect(body(fetchImpl, 1).max_completion_tokens).toBe(900);
    expect(body(fetchImpl, 1)).not.toHaveProperty('max_tokens');
    expect(reserve.mock.calls[0]![0]).toMatchObject({ maxOutputTokens: 900 });
  });
  it('accepts exactly 64000 serialized bytes and rejects 64001 before any paid reservation or send', async () => {
    const sample = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(envelope());
    await create(settings(sample)).generateChat([{ role: 'user', content: '' }]);
    const overhead = new TextEncoder().encode(sample.mock.calls[1]![1]!.body as string).byteLength;
    for (const bytes of [64_000, 64_001]) {
      const reserve = vi.fn(fallback.reserve);
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(envelope());
      const promise = create(settings(fetchImpl, { fallback: { ...fallback, reserve } })).generateChat([{ role: 'user', content: 'a'.repeat(bytes - overhead) }]);
      if (bytes === 64_000) {
        await expect(promise).resolves.toHaveProperty('content'); expect(reserve.mock.calls[0]![0]).toHaveProperty('inputBytes', bytes); expect(fetchImpl).toHaveBeenCalledTimes(2);
      } else {
        await expect(promise).rejects.toMatchObject({ code: 'LLM_BUDGET_EXCEEDED', retryable: false }); expect(reserve).not.toHaveBeenCalled(); expect(fetchImpl).toHaveBeenCalledTimes(1);
      }
    }
  });
  it('fails closed on denied or malformed holds, preserves only an exact budget code, and never echoes hook errors', async () => {
    const getter = { get code() { throw Error('PRIVATE_GETTER'); } };
    for (const [failure, expected] of [
      [{ code: 'LLM_BUDGET_EXCEEDED', message: 'PRIVATE_BUDGET secondary-test-token' }, 'LLM_BUDGET_EXCEEDED'],
      [new Error('PRIVATE_BUDGET LLM_BUDGET_EXCEEDED'), 'LLM_RATE_LIMITED'],
      [{ code: { toString: () => 'LLM_BUDGET_EXCEEDED' } }, 'LLM_RATE_LIMITED'],
      [getter, 'LLM_RATE_LIMITED'],
    ] as const) {
      const reserve = vi.fn(async () => { throw failure; });
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429 }));
      const error = await create(settings(fetchImpl, { fallback: { ...fallback, reserve } })).generateChat(messages).catch(error => error);
      expect(error.code).toBe(expected); expect(String(error) + JSON.stringify(error)).not.toMatch(/PRIVATE|secondary-test-token/); expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
    for (const result of [undefined, null, {}, { settle: 'not a function' }]) {
      const reserve = vi.fn(async () => result) as unknown as NonNullable<OpenAICompatibleConfig['fallback']>['reserve'];
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429 }));
      await expect(create(settings(fetchImpl, { fallback: { ...fallback, reserve } })).generateChat(messages)).rejects.toHaveProperty('code', 'LLM_RATE_LIMITED');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });
  it('keeps the full hold for missing, malformed, negative, fractional or out-of-bounds usage', async () => {
    const invalid = [undefined, null, [], {}, { prompt_tokens: '1', completion_tokens: 1 }, { prompt_tokens: -1, completion_tokens: 1 },
      { prompt_tokens: 1.5, completion_tokens: 1 }, { prompt_tokens: 1, completion_tokens: -1 }, { prompt_tokens: 1, completion_tokens: 1.5 },
      { prompt_tokens: 100_000, completion_tokens: 1 }, { prompt_tokens: 1, completion_tokens: 901 }];
    for (const usage of invalid) {
      const settle = vi.fn(async () => {});
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(envelope('answer', { usage }));
      const result = await create(settings(fetchImpl, { fallback: { ...fallback, reserve: async () => ({ settle }) } })).generateChat(messages);
      expect(result.content).toBe('answer'); expect(result.usage).toBeUndefined(); expect(settle).not.toHaveBeenCalled(); expect(fetchImpl).toHaveBeenCalledTimes(2);
    }
  });
  it('settles valid integer zero counts and retains the selected model when envelope model is absent', async () => {
    const settle = vi.fn(async () => {});
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(envelope('answer', { usage: { prompt_tokens: 0, completion_tokens: 0 } }));
    const result = await create(settings(fetchImpl, { fallback: { ...fallback, reserve: async () => ({ settle }) } })).generateChat(messages);
    expect(result).toMatchObject({ model: 'gpt-5.6-luna', usage: { promptTokens: 0, completionTokens: 0 } });
    expect(settle).toHaveBeenCalledExactlyOnceWith({ promptTokens: 0, completionTokens: 0 });
  });
  it('does not settle failed HTTP/envelope/body/incomplete responses', async () => {
    for (const secondary of [new Response('private', { status: 500 }), new Response('not-json'), new Response('a'.repeat(128001)), envelope('answer', { choices: [{ message: { content: 'answer' }, finish_reason: 'length' }], usage: { prompt_tokens: 1, completion_tokens: 1 } })]) {
      const settle = vi.fn(async () => {});
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(secondary);
      await expect(create(settings(fetchImpl, { fallback: { ...fallback, reserve: async () => ({ settle }) } })).generateChat(messages)).rejects.toHaveProperty('code');
      expect(settle).not.toHaveBeenCalled(); expect(fetchImpl).toHaveBeenCalledTimes(2);
    }
  });
  it('preserves a successful answer when settlement rejects, without refetching', async () => {
    const settle = vi.fn(async () => { throw Error('PRIVATE_SETTLEMENT'); });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(envelope('answer', { usage: { prompt_tokens: 10, completion_tokens: 3 } }));
    await expect(create(settings(fetchImpl, { fallback: { ...fallback, reserve: async () => ({ settle }) } })).generateChat(messages)).resolves.toHaveProperty('content', 'answer');
    expect(settle).toHaveBeenCalledTimes(1); expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('bounds a hanging reservation and prevents a late reservation from sending after timeout', async () => {
    vi.useFakeTimers(); let release!: (value: { settle: () => Promise<void> }) => void;
    const reserve = vi.fn(() => new Promise<{ settle: () => Promise<void> }>(resolve => { release = resolve; }));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429 }));
    const promise = expect(create(settings(fetchImpl, { initialTimeoutMs: 100, fallback: { ...fallback, reserve } })).generateChat(messages)).rejects.toHaveProperty('code', 'LLM_TIMEOUT');
    await vi.advanceTimersByTimeAsync(101); await promise;
    release({ settle: async () => {} }); await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(reserve).toHaveBeenCalledTimes(1);
  });
  it('uses the original deadline for primary429 + reserve and for a hanging settlement', async () => {
    vi.useFakeTimers();
    const reserve = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 30)); return { settle: async () => {} }; });
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 80)); return new Response('', { status: 429 }); });
    const promise = expect(create(settings(fetchImpl, { initialTimeoutMs: 100, fallback: { ...fallback, reserve } })).generateChat(messages)).rejects.toHaveProperty('code', 'LLM_TIMEOUT');
    await vi.advanceTimersByTimeAsync(111); await promise; expect(fetchImpl).toHaveBeenCalledTimes(1); expect(reserve).toHaveBeenCalledTimes(1);
    const settle = vi.fn(() => new Promise<void>(() => {}));
    const paid = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(envelope('answer', { usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    const timed = expect(create(settings(paid, { initialTimeoutMs: 100, fallback: { ...fallback, reserve: async () => ({ settle }) } })).generateChat(messages)).rejects.toHaveProperty('code', 'LLM_TIMEOUT');
    await vi.advanceTimersByTimeAsync(101); await timed; expect(paid).toHaveBeenCalledTimes(2); expect(settle).toHaveBeenCalledTimes(1);
  });
});

it('current Chat safety failures stay on CF and never activate paid fallback', async () => {
  const reserve = vi.fn(fallback.reserve);
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => envelope('{"text":"나는 AI야"}'));
  await expect(generatePersonaReply(createOpenAICompatibleProvider(settings(fetchImpl, { fallback: { ...fallback, reserve } })), { characterId: 'BOMI', currentMessage: '안녕' })).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
  expect(fetchImpl).toHaveBeenCalledTimes(2); expect(reserve).not.toHaveBeenCalled();
  expect(fetchImpl.mock.calls.every(call => call[0] === `${primaryUrl}/chat/completions`)).toBe(true);
});
it('OpenAI omits Cloudflare Gemma options, temperature, and max_tokens', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(envelope());
  await createOpenAICompatibleProvider(settings(fetchImpl, { model: '@cf/google/gemma-4-26b-a4b-it' })).generateChat(messages);
  expect(body(fetchImpl, 0)).toHaveProperty('chat_template_kwargs.enable_thinking', false);
  for (const key of ['chat_template_kwargs', 'temperature', 'max_tokens']) expect(body(fetchImpl, 1)).not.toHaveProperty(key);
});
it('the new v4 overlay excludes unaccepted contracts, diagnostics, model, and repair changes', () => {
  expect(source).not.toMatch(/TEXT_ONLY|TAROT_EVIDENCE|safeLLMDiagnostic|diagnoseValidationError|cloudflareGemma|gemma-4|gemini-3/);
  expect(source).toContain("required: ['text', 'toolReferences']");
  const historical = readFileSync('scripts/gemini-fallback-release/provider.ts.txt', 'utf8');
  expect(source.slice(source.indexOf('  const repairMessages ='))).toBe(historical.slice(historical.indexOf('  const repairMessages =')));
});
it('the v4 overlay differs from the preserved Gemini base only in declared fallback/budget transport regions', () => {
  const historical = readFileSync('scripts/gemini-fallback-release/provider.ts.txt', 'utf8');
  const strip = (text: string) => {
    let normalized = text.replace(" | 'LLM_BUDGET_EXCEEDED'", '')
      .replace(/export interface FallbackReservationRequest[^\n]*\nexport interface FallbackUsage[^\n]*\nexport interface FallbackReservation[^\n]*\n/, '')
      .replace(/ {2}fallback\?:[^\n]*\n/, '  // DECLARED_FALLBACK_CONFIG\n');
    const helpers = normalized.indexOf('const MAX_FALLBACK_INPUT_BYTES');
    if (helpers >= 0) normalized = normalized.slice(0, helpers) + normalized.slice(normalized.indexOf('function cancelWithoutWaiting', helpers));
    const config = normalized.indexOf('  const cloudflareEndpoint =');
    normalized = normalized.slice(0, config) + '  // DECLARED_FALLBACK_CONFIG_VALIDATION\n' + normalized.slice(normalized.indexOf('  const fetchImpl =', config));
    const transport = normalized.indexOf('      let target = usingFallback');
    normalized = normalized.slice(0, transport) + '      // DECLARED_FALLBACK_TRANSPORT\n' + normalized.slice(normalized.indexOf('      if (!response.ok)', transport));
    const settlement = normalized.indexOf('      // Bill only bounded numeric usage');
    if (settlement >= 0) normalized = normalized.slice(0, settlement) + normalized.slice(normalized.indexOf('      return { content: choice.message.content,', settlement));
    normalized = normalized.replace(/ {8}\.\.\.\(settlement \?[^\n]*\n/, '        // DECLARED_USAGE_PROJECTION\n')
      .replace(/ {8}\.\.\.\(typeof body\.usage\?[^\n]*\n/, '        // DECLARED_USAGE_PROJECTION\n');
    return normalized;
  };
  expect(strip(source)).toBe(strip(historical));
});
