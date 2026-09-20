import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAICompatibleProvider, LLMError } from '../../supabase/functions/_shared/llm/provider.ts';
import { generatePersonaReply } from '../../supabase/functions/_shared/llm/reply.ts';
import { validateChatOutput } from '../../supabase/functions/_shared/llm/validator.ts';
import { drawTarot, buildTarotInterpretationData } from '../../supabase/functions/_shared/domain/tarot.ts';

const completion = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], model: 'configured-model', usage: { prompt_tokens: 12, completion_tokens: 20 } }), { status: 200 });
const good = (text = '그건 좀 애매하다. 대화 분위기도 달라졌어?') => JSON.stringify({ text, toolReferences: [] });
afterEach(() => vi.useRealTimers());

describe('OpenAI-compatible provider', () => {
  it('rejects missing actual configuration instead of inventing a response', () => {
    expect(() => createOpenAICompatibleProvider({ baseUrl: '', model: '' })).toThrow('LLM_NOT_CONFIGURED');
  });
  it('sends full-response structured requests and carries model/prompt metadata', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion(good()));
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://inference.example/v1/', apiKey: 'test-private-key', model: 'selected-by-env', fetchImpl });
    const reply = await generatePersonaReply(provider, { characterId: 'SANI', currentMessage: '답장이 늦어.' });
    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://inference.example/v1/chat/completions');
    expect(body).toMatchObject({ model: 'selected-by-env', stream: false, response_format: { type: 'json_schema' } });
    expect(reply.content).toContain('애매'); expect(reply.metadata).toMatchObject({ model: 'configured-model', promptVersion: 'JumZipPersona-v11' });
    expect(reply.segments).toHaveLength(2); expect(reply.repaired).toBe(false);
  });
  it('repairs malformed content once and replays the original final user message', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(completion('not-json')).mockResolvedValueOnce(completion(good()));
    const provider = createOpenAICompatibleProvider({ baseUrl: 'http://localhost:8080/v1', model: 'local', fetchImpl });
    const result = await generatePersonaReply(provider, { characterId: 'SANI', currentMessage: 'hello' });
    expect(fetchImpl).toHaveBeenCalledTimes(2); expect(result.repaired).toBe(true);
    const repairBody = JSON.parse(fetchImpl.mock.calls[1]![1]!.body as string);
    expect(repairBody.messages.filter((m: { content: string }) => m.content === 'hello')).toHaveLength(2);
  });
  it('returns a structured failure after a failed repair; no canned assistant fallback', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => completion('invalid'));
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'model', fetchImpl });
    await expect(generatePersonaReply(provider, { characterId: 'BOMI', currentMessage: '안녕' })).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('uses an application timeout even if an injected fetch does not honor AbortSignal', async () => {
    vi.useFakeTimers();
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'model', initialTimeoutMs: 50, fetchImpl: vi.fn(() => new Promise<Response>(() => {})) });
    const promise = expect(provider.generateChat([{ role: 'user', content: 'hello' }])).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(51); await promise;
  });
  it('bounds aggregate UTF-8 bytes while streaming, even with a false Content-Length', async () => {
    const bytes = new TextEncoder().encode('한'.repeat(22_000)); // 66k bytes, only 22k characters.
    const cancelled = vi.fn(); let reads = 0;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) { reads++; controller.enqueue(bytes); }, cancel: cancelled,
    }, { highWaterMark: 0 }), { headers: { 'Content-Length': '1' } });
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'model', fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response) });
    await expect(provider.generateChat([])).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
    expect(reads).toBe(2); expect(cancelled).toHaveBeenCalledOnce();
  });
  it('rejects an oversized first chunk without waiting for an uncooperative cancel promise', async () => {
    const cancelled = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(128_001)); }, cancel: cancelled,
    }));
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'model', fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response) });
    await expect(provider.generateChat([])).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it('times out a hanging body, aborts fetch, and cancels the reader without awaiting cancel', async () => {
    vi.useFakeTimers(); const cancelled = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream<Uint8Array>({ cancel: cancelled }));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'model', initialTimeoutMs: 50, fetchImpl });
    const assertion = expect(provider.generateChat([])).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(51); await assertion;
    expect(cancelled).toHaveBeenCalledOnce(); expect(fetchImpl.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });
  it('decodes valid JSON with a multi-byte character split between response chunks', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ choices: [{ message: { content: good('한글 응답이야.') }, finish_reason: 'stop' }] }));
    const start = bytes.findIndex(byte => byte > 127);
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(bytes.slice(0, start + 1)); controller.enqueue(bytes.slice(start + 1)); controller.close();
    } }));
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'model', fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response) });
    expect((await provider.generateChat([])).content).toContain('한글');
  });
  it('does not expose the upstream response or secrets in errors', async () => {
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'model', apiKey: 'secret-key', fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response('raw private prompt secret-key', { status: 401 })) });
    try { await provider.generateChat([]); throw new Error('expected failure'); } catch (error) { expect(error).toBeInstanceOf(LLMError); expect((error as LLMError).code).toBe('LLM_AUTH_FAILED'); expect(String(error)).not.toContain('secret-key'); }
  });
  it('validates structured JSON with a single low-temperature repair', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(completion('{"intent":false}')).mockResolvedValueOnce(completion('{"intent":"small_talk"}'));
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'model', fetchImpl });
    const result = await provider.generateStructured({ messages: [{ role: 'user', content: '안녕' }], schema: { type: 'object' }, validate: value => { const v = value as { intent: unknown }; if (typeof v.intent !== 'string') throw new Error('invalid'); return v.intent; } });
    expect(result).toBe('small_talk'); expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('immutable tool validation', () => {
  const cards = drawTarot('ONE_CARD', () => 0);
  it('rejects changed card identity/orientation, added cards and unrequested calculations', () => {
    expect(validateChatOutput(JSON.stringify({ text: '카드를 보자.', toolReferences: [{ cardId: 1, orientation: 'UPRIGHT', positionIndex: 0 }], interpretationEvidence: [] }), { characterId: 'SANI', expectedCards: cards })).toMatchObject({ ok: false, issues: ['TOOL_RESULT_CHANGED'] });
    expect(validateChatOutput(JSON.stringify({ text: '카드를 보자.', toolReferences: [{ cardId: 0, orientation: 'REVERSED', positionIndex: 0 }] }), { characterId: 'SANI', expectedCards: cards }).ok).toBe(false);
    expect(validateChatOutput(JSON.stringify({ text: '안녕', toolReferences: [], saju: { score: 99 } }), { characterId: 'SANI' }).ok).toBe(false);
  });
  it('passes the same authoritative draw through one interpretation repair', async () => {
    const original = JSON.stringify(cards);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(completion(good('카드가 바뀌었어.'))).mockResolvedValueOnce(completion(JSON.stringify({ text: '광대는 새 출발의 가능성을 보여줘. 준비할 것부터 보자.', toolReferences: [{ cardId: 0, orientation: 'UPRIGHT', positionIndex: 0 }], interpretationEvidence: [{ positionIndex: 0, keywordIndices: [0, 2], textEvidence: '새 출발의 가능성' }] })));
    const reply = await generatePersonaReply(createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'model', fetchImpl }), { characterId: 'SANI', currentMessage: '이 카드 알려줘', toolResult: { cards: buildTarotInterpretationData(cards) } });
    expect(reply.repaired).toBe(true); expect(JSON.stringify(cards)).toBe(original); expect(reply.content).toContain('광대');
  });
});
