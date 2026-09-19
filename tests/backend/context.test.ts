import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createRepository, parseRelationshipStage, type ClaimedRequest } from '../../supabase/functions/_shared/persistence/repository.ts';

const claim: ClaimedRequest = { executionId: 'execution', conversationId: 'conversation', consultationId: 'consultation', characterId: 'SANI' };
function fixture(memoryEnabled = true) {
  type Result = { data: unknown; error: null | { message: string } };
  const results: Record<string, Result[]> = {
    profiles: [{ data: { memory_enabled: memoryEnabled }, error: null }],
    conversations: [{ data: { summary: '기존 요약' }, error: null }],
    memory_context_state: [{ data: { blockedRelatedPeople: [] }, error: null }],
    messages: [{ data: [{ created_at: '2026-09-20T00:00:00Z' }], error: null },
      { data: [{ id: 'message', sender: 'USER', content: '이 카드에 대해 더 이야기해 줘' }], error: null },
      { data: [{ metadata: { tarot: { drawGroupId: 'stored-draw', spreadType: 'ONE_CARD', cards: [{ cardId: 0, orientation: 'UPRIGHT', positionIndex: 0, positionKey: 'CORE_MESSAGE' }] } } }], error: null }],
    memories: [{ data: [{ id: 'global', scope: 'GLOBAL', content: '공통 목표', importance: 5 }], error: null },
      { data: [{ id: 'character', scope: 'CHARACTER', character_id: 'SANI', content: '산이와 나눈 목표', importance: 1 }], error: null }],
  };
  const queries: { table: string; filters: [string, unknown][]; limit?: number }[] = [];
  const from = vi.fn((table: string) => {
    const captured: typeof queries[number] = { table, filters: [] }; queries.push(captured);
    const result = results[table]!.shift()!;
    const builder = { select: (_fields: string) => builder, eq: (field: string, value: unknown) => { captured.filters.push([field, value]); return builder; },
      is: (_field: string, _value: unknown) => builder, order: (_field: string, _options: unknown) => builder,
      limit: (value: number) => { captured.limit = value; return builder; }, gte: (_field: string, _value: unknown) => builder,
      in: (_field: string, _value: unknown) => builder, single: () => builder,
      then: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve) };
    return builder;
  });
  const rpc = vi.fn(async () => results.memory_context_state![0]!);
  return { repo: createRepository({ from, rpc } as unknown as SupabaseClient), queries, results, rpc };
}
describe('persisted context selection', () => {
  it('restores ascending order from the bounded latest-message query', async () => {
    const { repo, results } = fixture(); results.messages![1]!.data = [
      { id: 'latest', sender: 'USER', content: '다음 이야기' }, { id: 'reply', sender: 'ASSISTANT', content: '답변' }, { id: 'first', sender: 'USER', content: '처음 이야기' },
    ];
    expect((await repo.context('owner', claim)).recentMessages.map(message => message.id)).toEqual(['first', 'reply', 'latest']);
  });
  it('uses only the four persisted relationship stages and ignores invented affection values', async () => {
    const { repo, results } = fixture(); results.conversations![0]!.data = { summary: '', relationship_state: { stage: 'FAMILIAR', completedTurns: 12 } };
    expect((await repo.context('owner', claim)).relationshipState).toBe('FAMILIAR');
    for (const invalid of [null, 'CLOSE', { stage: 'LOVER', affection: 100 }, { stage: 10 }]) expect(parseRelationshipStage(invalid)).toBe('FIRST_MEETING');
  });
  it('reserves four global and two matching character memories so global ranking cannot crowd out character context', async () => {
    const { repo, queries } = fixture(); const context = await repo.context('owner', claim);
    expect(context.memories.map(memory => memory.id)).toEqual(['global', 'character']);
    const memories = queries.filter(query => query.table === 'memories');
    expect(memories[0]).toMatchObject({ limit: 4, filters: [['user_id', 'owner'], ['scope', 'GLOBAL']] });
    expect(memories[1]).toMatchObject({ limit: 2, filters: [['user_id', 'owner'], ['scope', 'CHARACTER'], ['character_id', 'SANI']] });
  });
  it('omits both memory rows and stale summary immediately when profile memory is disabled', async () => {
    const { repo, queries } = fixture(false); const context = await repo.context('owner', claim);
    expect(context.summary).toBe(''); expect(context.memories).toEqual([]);
    expect(queries.some(query => query.table === 'memories')).toBe(false);
    expect(context.recentMessages).toHaveLength(1);
  });
  it('passes immutable saved tarot facts to follow-up chat scoped to the same owner, conversation and consultation', async () => {
    const { repo, queries } = fixture(); const context = await repo.context('owner', claim);
    expect(context.toolResult).toMatchObject({ drawGroupId: 'stored-draw', cards: [{ cardId: 0, orientation: 'UPRIGHT' }] });
    expect(queries.filter(query => query.table === 'messages').at(-1)?.filters).toEqual([['user_id', 'owner'], ['conversation_id', 'conversation'], ['consultation_id', 'consultation']]);
  });
  it('excludes known blocked aliases even in USER memories while retaining raw current conversation', async () => {
    const { repo, results, rpc } = fixture();
    results.memory_context_state![0]!.data = { blockedRelatedPeople: [{ id: 'blocked', alias: '솔새' }] };
    results.conversations![0]!.data = { summary: '솔새와 종이접기 이야기를 나눴다.' };
    results.messages![1]!.data = [{ id: 'current', sender: 'USER', content: '지금 솔새와 나눈 이야기를 듣고 싶어.' }];
    results.memories![0]!.data = [
      { id: 'misattributed', scope: 'GLOBAL', subject: 'USER', content: '솔새의 취미는 종이접기다.' },
      { id: 'subject', scope: 'GLOBAL', subject: 'RELATED_PERSON:blocked', content: '그 사람의 취미는 그림이다.' },
      { id: 'safe', scope: 'GLOBAL', subject: 'USER', content: '사용자는 짧은 답을 선호한다.' },
    ];
    const context = await repo.context('owner', claim);
    expect(context.summary).toBe(''); expect(context.memories.map(memory => memory.id)).toEqual(['safe', 'character']);
    expect(context.recentMessages).toEqual([{ id: 'current', role: 'user', content: '지금 솔새와 나눈 이야기를 듣고 싶어.' }]);
    expect(rpc).toHaveBeenCalledWith('memory_context_state', { p_user_id: 'owner', p_conversation_id: 'conversation' });
  });
  it('fails closed if current related-person consent cannot be read', async () => {
    const { repo, results } = fixture(); results.memory_context_state![0]!.error = { message: 'unavailable' };
    await expect(repo.context('owner', claim)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
  it('fails closed on an outdated privacy RPC lacking the complete blocked-person list', async () => {
    const { repo, results } = fixture(); results.memory_context_state![0]!.data = {};
    await expect(repo.context('owner', claim)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
