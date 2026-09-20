import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompleteParams } from '../../supabase/functions/_shared/persistence/repository.ts';
import { createExecutor } from '../../supabase/functions/_shared/orchestration/execute.ts';
import { createOpenAICompatibleProvider } from '../../supabase/functions/_shared/llm/provider.ts';

const state = vi.hoisted(() => ({
  id: '00000000-0000-4000-8000-000000000001',
  cards: [{ cardId: 0, orientation: 'UPRIGHT', positionIndex: 0, positionKey: 'CORE_MESSAGE' }],
}));
// Only persistence is synthetic. The actual runtime environment mapping, Persona
// generation, provider request construction and initial/repair path all execute.
vi.mock('../../supabase/functions/_shared/persistence/repository.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../../supabase/functions/_shared/persistence/repository.ts')>(),
  createRepository: () => ({
    beginChat: async () => ({ executionId: state.id, conversationId: state.id, consultationId: state.id, characterId: 'SANI', userMessage: { id: state.id, content: '같은 카드로 다시 설명해 줘.', createdAt: '2026-09-20T00:00:00Z' } }),
    context: async () => ({ recentMessages: [], summary: '', memories: [], toolResult: { cards: state.cards } }),
    complete: async (params: CompleteParams) => params.data,
    fail: vi.fn(async () => undefined),
  }),
}));
const endpoint = 'https://api.cloudflare.com/client/v4/accounts/synthetic-test-account/ai/v1';
const gemma = '@cf/google/gemma-4-26b-a4b-it';
const qwen = '@cf/qwen/qwen3-30b-a3b-fp8';
const completion = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }));
afterEach(() => vi.unstubAllGlobals());

describe('Cloudflare Gemma provider and production runtime request parity (zero network)', () => {
  it.each(['true', 'false', undefined])('wires the secondary provider only through the explicit server switch (%s)', async enabled => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(completion({ text: '새 출발을 생각해 보자.', toolReferences: [{ cardId: 0, orientation: 'UPRIGHT', positionIndex: 0 }], interpretationEvidence: [{ positionIndex: 0, keywordIndices: [0], textEvidence: '새 출발' }] }));
    vi.stubGlobal('fetch', fetchImpl);
    const env: Record<string, string | undefined> = { LLM_BASE_URL: endpoint, LLM_MODEL: qwen, LLM_API_KEY: 'synthetic-primary-key', LLM_STRUCTURED_FORMAT: 'json_object',
      LLM_FALLBACK_ENABLED: enabled, LLM_FALLBACK_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai', LLM_FALLBACK_MODEL: 'gemini-3.5-flash', LLM_FALLBACK_API_KEY: 'synthetic-secondary-key',
      TOOL_RECOMMENDATIONS_ENABLED: 'false', MEMORY_MAINTENANCE_ENABLED: 'false', TITLE_GENERATION_ENABLED: 'false' };
    const execute = createExecutor({} as SupabaseClient, name => env[name]);
    const operation = execute('chat', { schemaVersion: 1, action: 'SEND', requestId: state.id, conversationId: state.id, consultationId: null, message: '같은 카드로 다시 설명해 줘.' }, { id: state.id, isAnonymous: false });
    if (enabled === 'true') {
      expect((await operation).status).toBe(201); expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(fetchImpl.mock.calls[1]![0]).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
      expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]!.body)).model).toBe('gemini-3.5-flash');
    } else {
      await expect(operation).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE', details: { reason: 'LLM_RATE_LIMITED' } });
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });
  it.each([gemma, qwen])('uses the environment-selected model through actual runtime initial and repair: %s', async model => {
    const toolReferences = [{ cardId: 0, orientation: 'UPRIGHT', positionIndex: 0 }];
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(completion({ text: '새 출발을 생각해 보자.', toolReferences }))
      .mockResolvedValueOnce(completion({ text: '새 출발을 생각해 보자.', toolReferences, interpretationEvidence: [{ positionIndex: 0, keywordIndices: [0], textEvidence: '새 출발' }] }));
    vi.stubGlobal('fetch', fetchImpl);
    const env: Record<string, string> = { LLM_BASE_URL: endpoint, LLM_MODEL: model, LLM_STRUCTURED_FORMAT: 'json_object',
      TOOL_RECOMMENDATIONS_ENABLED: 'false', MEMORY_MAINTENANCE_ENABLED: 'false', TITLE_GENERATION_ENABLED: 'false' };
    const execute = createExecutor({} as SupabaseClient, name => env[name]);
    const result = await execute('chat', { schemaVersion: 1, action: 'SEND', requestId: state.id, conversationId: state.id, consultationId: null, message: '같은 카드로 다시 설명해 줘.' }, { id: state.id, isAnonymous: false });
    expect(result.status).toBe(201); expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain('interpretationEvidence');
    for (const call of fetchImpl.mock.calls) {
      expect(call[0]).toBe(endpoint + '/chat/completions');
      const body = JSON.parse(String(call[1]!.body));
      expect(body).toMatchObject({ model, max_tokens: 900, stream: false, response_format: { type: 'json_object' } });
      expect(body.messages.some((item: { content: string }) => item.content.includes('"interpretationEvidence"'))).toBe(true);
      if (model === gemma) expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
      else { expect(body).not.toHaveProperty('chat_template_kwargs'); expect(body.messages[0].content).toContain('/no_think'); }
    }
  });
  it.each([endpoint, endpoint + '/', endpoint + '/chat/completions', endpoint + '/chat/completions/'])('covers the accepted account API base forms without a benchmark wrapper: %s', async baseUrl => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion({ text: '안녕.', toolReferences: [] }));
    await createOpenAICompatibleProvider({ baseUrl, model: gemma, fetchImpl }).generateChat([]);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body)).chat_template_kwargs).toEqual({ enable_thinking: false });
  });
  it.each([
    ['https://inference.example/v1', gemma],
    ['https://api.cloudflare.com.evil.example/client/v4/accounts/test/ai/v1', gemma],
    ['http://api.cloudflare.com/client/v4/accounts/test/ai/v1', gemma],
    ['https://api.cloudflare.com:8443/client/v4/accounts/test/ai/v1', gemma],
    ['https://api.cloudflare.com/other/v1', gemma],
    [endpoint, '@cf/google/another-model'],
    [endpoint, qwen],
  ])('does not add Gemma-specific fields to another endpoint/model: %s %s', async (baseUrl, model) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion({ text: '안녕.', toolReferences: [] }));
    await createOpenAICompatibleProvider({ baseUrl, model, fetchImpl }).generateChat([]);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).not.toHaveProperty('chat_template_kwargs');
  });
  it('uses the same exact option for structured generation and repair while preserving its350-token cap', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(completion({ ok: false })).mockResolvedValueOnce(completion({ ok: true }));
    const provider = createOpenAICompatibleProvider({ baseUrl: endpoint, model: gemma, maxOutputTokens: 350, initialTimeoutMs: 8000, repairTimeoutMs: 3000, fetchImpl });
    await provider.generateStructured({ messages: [{ role: 'user', content: '입력의 ok 상태를 분류해 줘.' }], schema: { type: 'object' }, validate: value => { if ((value as { ok: boolean }).ok !== true) throw Error('INVALID'); return true; } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const call of fetchImpl.mock.calls) expect(JSON.parse(String(call[1]!.body))).toMatchObject({ chat_template_kwargs: { enable_thinking: false }, max_tokens: 350, temperature: 0.1 });
  });
});
