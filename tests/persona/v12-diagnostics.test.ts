import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAICompatibleProvider, LLMError, safeLLMDiagnostic } from '../../supabase/functions/_shared/llm/provider.ts';
import { generatePersonaReply } from '../../supabase/functions/_shared/llm/reply.ts';
import { ApiFailure, partialFailureDetails, safeFailure } from '../../supabase/functions/_shared/http/errors.ts';

const secret = 'PRIVATE_BODY_PROMPT_KEY_7b41';
const messages = [{ role: 'user' as const, content: secret }];
const completion = (content: unknown, finishReason: unknown = 'stop') => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }] }));
const provider = (fetchImpl: typeof fetch) => createOpenAICompatibleProvider({ baseUrl: 'https://synthetic.example/v1', apiKey: secret, model: 'synthetic', initialTimeoutMs: 20, repairTimeoutMs: 10, fetchImpl });
const diagnosticFailure = async (operation: Promise<unknown>) => {
  try { await operation; throw Error('EXPECTED_FAILURE'); } catch (error) {
    expect(error).toBeInstanceOf(LLMError);
    const output = safeFailure(error).toJSON();
    expect(JSON.stringify(output)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
    return output;
  }
};
afterEach(() => vi.useRealTimers());

describe('v12 body-free, bounded failure diagnostics', () => {
  it.each([
    [429, 'LLM_RATE_LIMITED', 'HTTP_RATE_LIMITED'], [401, 'LLM_AUTH_FAILED', 'HTTP_AUTH_FAILED'], [500, 'LLM_UNAVAILABLE', 'HTTP_UNAVAILABLE'],
  ])('reports transport HTTP %i without reading its body', async (status, reason, issue) => {
    const cancelled = vi.fn(); const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ cancel: cancelled }), { status: Number(status) }));
    const error = await diagnosticFailure(provider(fetchImpl).generateChat(messages));
    expect(error.details).toMatchObject({ reason, kind: 'TRANSPORT', issues: [issue], attempts: 1, finishReason: null });
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(cancelled).toHaveBeenCalledOnce();
    if (status === 429) { expect(error.message).toContain('요청을 제한'); expect(error.message).not.toMatch(/할당량|초기화|내일|quota|reset/i); }
  });
  it('reports network errors without raw exception details', async () => {
    const error = await diagnosticFailure(provider(vi.fn().mockRejectedValue(Error(secret))).generateChat(messages));
    expect(error.details).toMatchObject({ reason: 'LLM_UNAVAILABLE', kind: 'TRANSPORT', issues: ['NETWORK_ERROR'] });
  });
  it.each([
    [() => new Response(null), 'RESPONSE_BODY_MISSING', null],
    [() => new Response(secret), 'RESPONSE_ENVELOPE_JSON_INVALID', null],
    [() => new Response('[]'), 'RESPONSE_ENVELOPE_INVALID', null],
    [() => completion(null, 'stop'), 'RESPONSE_CONTENT_MISSING', 'stop'],
    [() => completion(secret, 'length'), 'RESPONSE_INCOMPLETE', 'length'],
    [() => completion(null, secret), 'RESPONSE_CONTENT_MISSING', 'OTHER'],
  ] as const)('distinguishes envelope failure %s', async (response, issue, finishReason) => {
    const error = await diagnosticFailure(provider(vi.fn().mockResolvedValue(response())).generateChat(messages));
    expect(error.details).toMatchObject({ reason: 'LLM_INVALID_RESPONSE', kind: 'ENVELOPE', issues: [issue], attempts: 1, finishReason });
  });
  it('reports body cap as an envelope error and cancels without raw partial text', async () => {
    const cancelled = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(secret.repeat(8000))); }, cancel: cancelled });
    const error = await diagnosticFailure(provider(vi.fn().mockResolvedValue(new Response(stream))).generateChat(messages));
    expect(error.details).toMatchObject({ kind: 'ENVELOPE', issues: ['RESPONSE_BODY_TOO_LARGE'] }); expect(cancelled).toHaveBeenCalledOnce();
  });
  it.each(['TRANSPORT', 'ENVELOPE'])('keeps timeout distinct at %s stage', async kind => {
    vi.useFakeTimers();
    const fetchImpl = kind === 'TRANSPORT' ? vi.fn(() => new Promise<Response>(() => {})) : vi.fn().mockResolvedValue(new Response(new ReadableStream()));
    const result = diagnosticFailure(provider(fetchImpl).generateChat(messages));
    await vi.advanceTimersByTimeAsync(21);
    expect((await result).details).toMatchObject({ reason: 'LLM_TIMEOUT', kind, issues: ['REQUEST_TIMEOUT'], attempts: 1 });
  });
  it.each([
    ['not JSON', 'PARSE', 'JSON_REQUIRED'], [JSON.stringify({ text: '나는 AI야.' }), 'VALIDATION', 'PERSONA_BREAK'],
  ])('reports final chat parse/validation failure after exactly one repair', async (content, kind, issue) => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => completion(content));
    const error = await diagnosticFailure(generatePersonaReply(provider(fetchImpl), { characterId: 'SANI', currentMessage: secret }));
    expect(error.details).toMatchObject({ kind, issues: [issue], attempts: 2, finishReason: 'stop' }); expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('preserves repair transport failure and its second-attempt count instead of calling it malformed JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(completion('bad')).mockResolvedValueOnce(new Response(secret, { status: 429 }));
    const error = await diagnosticFailure(generatePersonaReply(provider(fetchImpl), { characterId: 'SANI', currentMessage: secret }));
    expect(error.details).toMatchObject({ reason: 'LLM_RATE_LIMITED', kind: 'TRANSPORT', attempts: 2 }); expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each([false, true])('distinguishes structured parse vs validation failure without echoing validator errors (%s)', async validJson => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => completion(validJson ? '{}' : secret));
    const error = await diagnosticFailure(provider(fetchImpl).generateStructured({ messages, schema: {}, validate: () => { throw Error(secret); } }));
    expect(error.details).toMatchObject({ kind: validJson ? 'VALIDATION' : 'PARSE', issues: [validJson ? 'STRUCTURED_VALIDATION_FAILED' : 'JSON_REQUIRED'], attempts: 2 });
  });
  it('projects allowlisted diagnostics at construction and at the boundary, dropping forged fields', () => {
    const injected = { stage: 'VALIDATION', issues: ['PERSONA_BREAK', secret, 'PERSONA_BREAK'], attempts: 2, finishReason: secret, body: secret, messages, apiKey: secret };
    const expected = { stage: 'VALIDATION', issues: ['PERSONA_BREAK'], attempts: 2, finishReason: 'OTHER' };
    expect(new LLMError('LLM_INVALID_RESPONSE', true, injected).diagnostic).toEqual(expected);
    const forged = { code: 'LLM_INVALID_RESPONSE', message: secret, diagnostic: injected, raw: secret };
    expect(safeFailure(forged).details).toEqual({ reason: 'LLM_INVALID_RESPONSE', kind: 'VALIDATION', issues: ['PERSONA_BREAK'], attempts: 2, finishReason: 'OTHER' });
    expect(JSON.stringify(safeFailure(forged).toJSON())).not.toContain(secret);
    for (const bad of [{ ...injected, attempts: 999 }, { ...injected, stage: secret }, { ...injected, stage: { toString: () => 'VALIDATION', secret } }]) expect(safeLLMDiagnostic(bad)).toBeUndefined();
  });
  it('preserves actual provider throttling through PARTIAL wrapping without spreading arbitrary details', () => {
    const failure = safeFailure(new LLMError('LLM_RATE_LIMITED', true, { stage: 'TRANSPORT', issues: ['HTTP_RATE_LIMITED'], attempts: 2, finishReason: null }));
    expect(failure.code).toBe('LLM_UNAVAILABLE');
    expect(partialFailureDetails(failure)).toEqual({ reason: 'LLM_RATE_LIMITED', kind: 'TRANSPORT', issues: ['HTTP_RATE_LIMITED'], attempts: 2, finishReason: null });
    const forged = new ApiFailure('LLM_INVALID_RESPONSE', 502, secret, true, { reason: secret, kind: 'VALIDATION', issues: [secret, 'PERSONA_BREAK'], attempts: 2, finishReason: secret, body: secret });
    expect(partialFailureDetails(forged)).toEqual({ reason: 'LLM_INVALID_RESPONSE', kind: 'VALIDATION', issues: ['PERSONA_BREAK'], attempts: 2, finishReason: 'OTHER' });
    expect(partialFailureDetails(new ApiFailure('NOT_FOUND', 404, secret, false, { reason: secret, body: secret }))).toEqual({ reason: 'NOT_FOUND' });
  });
});
