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
const blockedPerson = { id: '11111111-1111-4111-8111-111111111111', alias: '솔새' };
const allowedPerson = { id: '22222222-2222-4222-8222-222222222222', alias: '물새' };

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
  it('excludes a non-consenting person before extraction even without any prior memory or tombstone', async () => {
    const { provider, calls } = fixtureProvider({ candidates: [] });
    expect(await extractMemoryCandidates(provider, { ...input, messages: [{ role: 'user', content: '솔새는 오래 종이접기를 좋아했어.' }], blockedRelatedPeople: [blockedPerson], suppressions: [] })).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it('does not retain blocked-person details under USER even if the model invents that attribution', async () => {
    const { provider, calls } = fixtureProvider({ candidates: [{ ...memory, scope: 'GLOBAL', content: '솔새는 짧은 답변을 선호한다.' }] });
    expect(await extractMemoryCandidates(provider, { ...input, blockedRelatedPeople: [blockedPerson] })).toEqual([]);
    expect(calls[0]!.messages[1]!.content).not.toContain('솔새');
  });
  it('accepts three bounded grounded candidates and publishes matching provider limits', async () => {
    const evidence = '가'.repeat(160);
    const candidates = ['가', '나', '다'].map(value => ({ ...memory, content: value.repeat(160), evidence }));
    const { provider, calls } = fixtureProvider({ candidates });
    expect(await extractMemoryCandidates(provider, { ...input, messages: [{ role: 'user', content: evidence }] })).toHaveLength(3);
    expect(calls[0]!.schema).toMatchObject({ properties: { candidates: { maxItems: 3, items: { properties: { content: { maxLength: 160 }, evidence: { maxLength: 160 } } } } } });
  });
  it('rejects a fourth candidate instead of silently truncating the model result', async () => {
    const { provider } = fixtureProvider({ candidates: Array.from({ length: 4 }, () => memory) });
    await expect(extractMemoryCandidates(provider, input)).rejects.toThrow('MEMORY_FORMAT_INVALID');
  });
  it.each(['content', 'evidence'])('rejects %s longer than160 characters even when the source is grounded', async field => {
    const long = '가'.repeat(161);
    const { provider } = fixtureProvider({ candidates: [{ ...memory, [field]: long }] });
    await expect(extractMemoryCandidates(provider, { ...input, messages: [...input.messages, { role: 'user', content: long }] })).rejects.toThrow('MEMORY_FORMAT_INVALID');
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
  it('excludes a non-consenting related-person turn, its unnamed assistant echo and previous summary', async () => {
    const { provider, calls } = fixtureProvider({ summary: '사용자는 그림 연습을 하고 싶어 한다.' });
    await summarizeConversation(provider, { characterId: 'SANI', previousSummary: '솔새의 취미는 종이접기다.', blockedRelatedPeople: [blockedPerson], allowedRelatedPeople: [allowedPerson], suppressions: [], messages: [
      { role: 'user', content: '솔새는 오래 종이접기를 좋아했어.' },
      { role: 'assistant', content: '그 친구가 만드는 종이꽃을 보고 싶네.' },
      { role: 'user', content: '나는 그림 연습을 하고 싶어.' },
    ] });
    const payload = JSON.parse(calls[0]!.messages[1]!.content);
    expect(payload.previousSummary).toBe('');
    expect(payload.allowedRelatedPeople).toEqual([allowedPerson]);
    expect(payload.messages).toEqual([{ role: 'user', content: '나는 그림 연습을 하고 싶어.' }]);
    expect(calls[0]!.messages[1]!.content).not.toMatch(/솔새|종이꽃/);
  });
  it('fails closed when all turns concern a non-consenting person with zero extracted memories', async () => {
    const { provider, calls } = fixtureProvider({ summary: '솔새는 종이접기를 좋아한다.' });
    expect(await summarizeConversation(provider, { ...input, previousSummary: '', blockedRelatedPeople: [blockedPerson], suppressions: [], messages: [{ role: 'user', content: '솔새의 취미는 종이접기야.' }] })).toBe('');
    expect(calls).toHaveLength(0);
  });
  it('rejects a model summary that reintroduces a blocked alias from otherwise safe input', async () => {
    const { provider } = fixtureProvider({ summary: '솔새와 사용자가 그림을 좋아한다.' });
    await expect(summarizeConversation(provider, { ...input, previousSummary: '', blockedRelatedPeople: [blockedPerson] })).rejects.toThrow('SUMMARY_INVALID');
  });
  it('does not regenerate any summary after a durable related-person withdrawal suppression', async () => {
    const { provider, calls } = fixtureProvider({ summary: '과거 관련인의 취미' });
    expect(await summarizeConversation(provider, { ...input, previousSummary: '과거 관련인의 취미', suppressions: [{ scope: 'GLOBAL', subject: `RELATED_PERSON:${blockedPerson.id}` }] })).toBe('');
    expect(calls).toHaveLength(0);
  });
  it('excludes ambiguous aliases even when a different consenting person uses the same name', async () => {
    const { provider, calls } = fixtureProvider({ summary: '사용자는 짧은 답변을 선호한다.' });
    await summarizeConversation(provider, { ...input, previousSummary: '', blockedRelatedPeople: [blockedPerson], allowedRelatedPeople: [{ ...allowedPerson, alias: '솔새' }] });
    expect(JSON.parse(calls[0]!.messages[1]!.content).allowedRelatedPeople).toEqual([]);
  });
  it('keeps the1600-character contract while allowing a necessary summary above the short target', async () => {
    const summary = '사용자는 그림 연습을 오래 이어가고 싶어 한다. '.repeat(20);
    expect(summary.length).toBeGreaterThan(400);
    const { provider, calls } = fixtureProvider({ summary });
    expect(await summarizeConversation(provider, { ...input, previousSummary: '' })).toBe(summary.trim());
    expect(calls[0]!.schema).toMatchObject({ properties: { summary: { maxLength: 1600 } } });
    expect(calls[0]!.messages[0]!.content).toContain('200~400자');
  });
});
