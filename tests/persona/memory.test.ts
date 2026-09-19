import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider, StructuredRequest } from '../../supabase/functions/_shared/llm/provider.ts';
import { extractMemoryCandidates, summarizeConversation } from '../../supabase/functions/_shared/persona/memory.ts';

function fixtureProvider(value: unknown) {
  const calls: StructuredRequest<unknown>[] = [];
  const provider: LLMProvider = {
    generateChat: vi.fn(), repairChat: vi.fn(),
    async generateStructured<T>(request: StructuredRequest<T>): Promise<T> { calls.push(request as StructuredRequest<unknown>); return request.validate(value); },
  };
  return { provider, calls };
}
const memory = { scope: 'CHARACTER', category: 'PREFERENCE', subject: 'USER', content: '짧은 답변을 선호한다.', importance: 3, sensitivity: 'NORMAL', evidence: '짧게 답해주는 게 좋아' };
const input = { characterId: 'SANI' as const, messages: [{ role: 'user' as const, content: '나는 짧게 답해주는 게 좋아' }] };

describe('memory extraction boundary', () => {
  it('extracts only fresh user evidence and attaches the current character server-side', async () => {
    const { provider, calls } = fixtureProvider({ candidates: [memory, memory] });
    const result = await extractMemoryCandidates(provider, { ...input, messages: [...input.messages, { role: 'assistant', content: '사용자는 고양이를 좋아한다.' }] });
    expect(result).toEqual([{ scope: 'CHARACTER', characterId: 'SANI', category: 'PREFERENCE', subject: 'USER', content: memory.content, importance: 3, sensitivity: 'NORMAL' }]);
    expect(calls[0]!.messages[1]!.content).not.toContain('고양이');
    expect(calls[0]!.messages[1]!.content).not.toContain('previousSummary');
  });
  it('suppresses an explicit opt-out before calling any provider', async () => {
    const { provider, calls } = fixtureProvider({ candidates: [memory] });
    expect(await extractMemoryCandidates(provider, { ...input, messages: [...input.messages, { role: 'user', content: '이건 기억하지 마.' }] })).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it('excludes sensitive input and rejects a sensitive output even when evidence is safe', async () => {
    const { provider, calls } = fixtureProvider({ candidates: [{ ...memory, content: '서울에서 태어났다.' }] });
    expect(await extractMemoryCandidates(provider, { ...input, messages: [...input.messages, { role: 'user', content: '생일은 1990-05-15이고 계좌는 12345678이야.' }] })).toEqual([]);
    expect(calls[0]!.messages[1]!.content).not.toContain('12345678');
  });
  it('rejects invented subjects, unsupported categories, private sensitivity and ungrounded evidence', async () => {
    for (const change of [{ subject: 'RELATED_PERSON:unknown' }, { category: 'MEDICAL' }, { sensitivity: 'HIGH' }, { evidence: '고양이를 좋아한다' }, { importance: 9 }, { account: 'foo' }]) {
      const { provider } = fixtureProvider({ candidates: [{ ...memory, ...change }] });
      await expect(extractMemoryCandidates(provider, input)).rejects.toThrow('MEMORY_FORMAT_INVALID');
    }
  });
  it('respects global and same-character deletion suppressions', async () => {
    const { provider } = fixtureProvider({ candidates: [memory] });
    expect(await extractMemoryCandidates(provider, { ...input, suppressions: [{ scope: 'GLOBAL', subject: 'USER' }] })).toEqual([]);
    expect(await extractMemoryCandidates(provider, { ...input, suppressions: [{ scope: 'CHARACTER', characterId: 'SANI', subject: 'USER' }] })).toEqual([]);
    expect(await extractMemoryCandidates(provider, { ...input, suppressions: [{ scope: 'CHARACTER', characterId: 'ARANG', subject: 'USER' }] })).toHaveLength(1);
  });
});

describe('conversation summaries', () => {
  it('includes prior summary only for summarization and constrains validated output', async () => {
    const { provider, calls } = fixtureProvider({ summary: '진로 방향을 고민하며 다음에 장단점을 비교하기로 했다.' });
    expect(await summarizeConversation(provider, { ...input, previousSummary: '진로를 고민 중이다.' })).toContain('장단점');
    expect(calls[0]!.messages[1]!.content).toContain('previousSummary');
  });
  it('does not replace a summary with an invalid or sensitive result', async () => {
    const { provider } = fixtureProvider({ summary: '사용자의 생일은 1990-05-15다.' });
    await expect(summarizeConversation(provider, { ...input, previousSummary: '기존 요약' })).rejects.toThrow('SUMMARY_INVALID');
  });
  it('excludes the assistant response to a private turn, even without an opt-out phrase in the response', async () => {
    const { provider, calls } = fixtureProvider({ summary: '앞으로 그림 연습을 하고 싶어 한다.' });
    await summarizeConversation(provider, { characterId: 'SANI', previousSummary: '', messages: [
      { role: 'user', content: '이건 기억하지 마. 다은이랑 크게 싸웠어.' },
      { role: 'assistant', content: '다은이랑 크게 싸웠구나. 마음이 복잡하겠어.' },
      { role: 'user', content: '그림 연습을 하고 싶어.' },
      { role: 'assistant', content: '어떤 그림을 그려보고 싶어?' },
    ] });
    expect(calls[0]!.messages[1]!.content).not.toContain('다은');
    expect(calls[0]!.messages[1]!.content).toContain('그림');
  });
});
