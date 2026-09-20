import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAICompatibleProvider, type OpenAICompatibleConfig, type LLMProvider } from '../../supabase/functions/_shared/llm/provider.ts';
import { generatePersonaReply } from '../../supabase/functions/_shared/llm/reply.ts';

const primaryUrl = 'https://api.cloudflare.com/client/v4/accounts/synthetic-account/ai/v1';
const secondaryUrl = 'https://generativelanguage.googleapis.com/v1beta/openai';
const fallback = { baseUrl: secondaryUrl, apiKey: 'secondary-test-token', model: 'gemini-3.5-flash' };
const messages = [{ role: 'system' as const, content: 'Server rules.' }, { role: 'user' as const, content: '안녕. 원래 사용자 요청.' }];
const source = readFileSync('scripts/gemini-fallback-release/provider.ts.txt', 'utf8');
// The deployed-v4 overlay has only a type-only relative import. Transpile it in
// memory; no test-generated files or remote modules are used.
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const legacy = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const factories: [string, (config: OpenAICompatibleConfig) => LLMProvider][] = [
  ['current candidate', createOpenAICompatibleProvider], ['exact deployed-v4 overlay', legacy.createOpenAICompatibleProvider],
];
const envelope = (content = '{"text":"안녕.","toolReferences":[]}', extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], ...extra }));
const settings = (fetchImpl: typeof fetch, overrides: Partial<OpenAICompatibleConfig> = {}): OpenAICompatibleConfig => ({ baseUrl: primaryUrl, apiKey: 'primary-test-token', model: '@cf/qwen/qwen3-30b-a3b-fp8', structuredFormat: 'json_object', fallback, fetchImpl, ...overrides });
const body = (fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, index: number) => JSON.parse(fetchMock.mock.calls[index]![1]!.body as string);
const validate = (value: unknown): string => {
  if (!value || typeof value !== 'object' || (value as { intent?: unknown }).intent !== 'ok') throw Error('PRIVATE_VALIDATOR_DETAIL');
  return 'ok';
};
afterEach(() => vi.useRealTimers());

describe.each(factories)('%s: quota-only Gemini fallback', (_name, create) => {
  it('keeps the primary serialized request unchanged and never sends to Gemini after success', async () => {
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
  it('hands off only after 429 and stays on Gemini for the one later repair', async () => {
    const cancelled = vi.fn(() => new Promise<void>(() => {}));
    const quota = new Response(new ReadableStream({ cancel: cancelled }), { status: 429 });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(quota).mockImplementation(async () => envelope());
    const provider = create(settings(fetchImpl));
    const result = await provider.generateChat(messages);
    const repaired = await provider.repairChat(messages, 'invalid', ['JSON_REQUIRED']);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(result.model).toBe('gemini-3.5-flash'); expect(repaired.model).toBe('gemini-3.5-flash');
    expect(fetchImpl.mock.calls.map(call => call[0])).toEqual([`${primaryUrl}/chat/completions`, `${secondaryUrl}/chat/completions`, `${secondaryUrl}/chat/completions`]);
    expect(fetchImpl.mock.calls[0]![1]!.signal).toBe(fetchImpl.mock.calls[1]![1]!.signal);
    expect(fetchImpl.mock.calls[2]![1]!.signal).not.toBe(fetchImpl.mock.calls[1]![1]!.signal);
    for (const index of [1, 2]) {
      expect(body(fetchImpl, index)).toMatchObject({ model: 'gemini-3.5-flash', reasoning_effort: 'low', max_tokens: 900, stream: false, response_format: { type: 'json_object' } });
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
    for (const index of [0, 1, 2]) expect(body(fetchImpl, index)).toMatchObject({ max_tokens: 350, response_format: { type: 'json_schema', json_schema: { name: 'test_contract', strict: true, schema } } });
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
    { baseUrl: 'http://generativelanguage.googleapis.com/v1beta/openai' },
    { baseUrl: 'https://generativelanguage.googleapis.com.evil.test/v1beta/openai' },
    { baseUrl: `${secondaryUrl}?key=private` }, { baseUrl: `${secondaryUrl}#private` },
    { baseUrl: 'https://user:private@generativelanguage.googleapis.com/v1beta/openai' },
    { baseUrl: `${secondaryUrl}/chat/completions` }, { model: 'other-model' },
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

it('current Chat safety-validation errors never activate Gemini', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => envelope('{"text":"나는 AI야"}'));
  await expect(generatePersonaReply(createOpenAICompatibleProvider(settings(fetchImpl)), { characterId: 'BOMI', currentMessage: '안녕' })).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(fetchImpl.mock.calls.every(call => call[0] === `${primaryUrl}/chat/completions`)).toBe(true);
});
it('Gemini drops the Cloudflare Gemma reasoning field while primary keeps it', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(envelope());
  await createOpenAICompatibleProvider(settings(fetchImpl, { model: '@cf/google/gemma-4-26b-a4b-it' })).generateChat(messages);
  expect(body(fetchImpl, 0)).toHaveProperty('chat_template_kwargs.enable_thinking', false);
  expect(body(fetchImpl, 1)).not.toHaveProperty('chat_template_kwargs');
  expect(body(fetchImpl, 1)).not.toHaveProperty('temperature');
});
it('the v4 overlay excludes all unaccepted contract, diagnostic and model changes', () => {
  expect(source).not.toMatch(/TEXT_ONLY|TAROT_EVIDENCE|safeLLMDiagnostic|diagnoseValidationError|cloudflareGemma|gemma-4/);
  expect(source).toContain("required: ['text', 'toolReferences']");
});
it('reversing only the declared fallback delta recovers the exact deployed v4 provider hash', () => {
  let original = source.replace("  /** Server-only, separate credential. Used solely after Cloudflare HTTP 429. */\n  fallback?: { baseUrl: string; apiKey: string; model: string };\n", '');
  const configStart = original.indexOf('  const cloudflareEndpoint =');
  const configEnd = original.indexOf('  const fetchImpl =', configStart);
  original = original.slice(0, configStart) + original.slice(configEnd);
  const start = original.indexOf('      let target = usingFallback');
  const end = original.indexOf('      if (!response.ok)', start);
  const deployedSend = `      const requestMessages = config.model === '@cf/qwen/qwen3-30b-a3b-fp8'
        ? [{ role: 'system' as const, content: '이 요청은 짧은 최종 JSON 응답만 필요하다. /no_think' }, ...formatMessages]
        : formatMessages;
      const response = await fetchImpl(url, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: \`Bearer \${config.apiKey}\` } : {}) },
        body: JSON.stringify({ model: config.model, messages: requestMessages, temperature, max_tokens: config.maxOutputTokens ?? 900, stream: false,
          response_format: config.structuredFormat === 'json_object' ? { type: 'json_object' } : { type: 'json_schema', json_schema: { name, strict: true, schema } } }),
      });
      if (controller.signal.aborted) { cancelWithoutWaiting(response.body); throw new LLMError('LLM_TIMEOUT'); }
`;
  original = (original.slice(0, start) + deployedSend + original.slice(end))
    .replace("model: typeof body.model === 'string' ? body.model : target?.model ?? config.model,", "model: typeof body.model === 'string' ? body.model : config.model,");
  expect(createHash('sha256').update(original).digest('hex')).toBe('fd79d8a6ef435a1aab0931a8a30db1faff0d5daa5acb8572a8872be1ade9d6d3');
});
