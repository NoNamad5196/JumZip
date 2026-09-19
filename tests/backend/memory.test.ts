import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createMemoryStore, maintainMemory, type MemoryMaintenance, type MemoryMessage, type MemoryState } from '../../supabase/functions/_shared/orchestration/memory.ts';
import type { MemoryCandidate } from '../../supabase/functions/_shared/persona/memory.ts';

const state: MemoryState = { memoryEnabled: true, revision: 3, summary: '이전 대화 요약', lastExtractedAt: null, lastExtractedMessageId: null, summaryCursorAt: null, suppressions: [] };
const fresh: MemoryMessage = { id: 'new-user-message', role: 'user', content: '나는 매일 그림을 연습하고 싶어', createdAt: '2026-09-20T00:00:00Z' };
const candidate: MemoryCandidate = { scope: 'GLOBAL', category: 'GOAL', subject: 'USER', content: '매일 그림을 연습하는 목표가 있다', importance: 3, sensitivity: 'NORMAL' };
function fixture() {
  const dependencies: MemoryMaintenance = {
    store: { state: vi.fn().mockResolvedValue({ ...state }), newMessages: vi.fn().mockResolvedValue([fresh]),
      summaryMessages: vi.fn().mockResolvedValue([fresh]), apply: vi.fn().mockResolvedValue({ applied: true }) },
    extract: vi.fn().mockResolvedValue([candidate]), summarize: vi.fn().mockResolvedValue('새 압축 요약'),
  };
  return dependencies;
}
describe('memory lifecycle privacy and fault isolation', () => {
  it('does no extraction or writes when the user has disabled memory', async () => {
    const deps = fixture(); vi.mocked(deps.store.state).mockResolvedValue({ ...state, memoryEnabled: false });
    await maintainMemory(deps, 'owner', 'conversation', 'SANI');
    expect(deps.store.newMessages).not.toHaveBeenCalled(); expect(deps.extract).not.toHaveBeenCalled(); expect(deps.store.apply).not.toHaveBeenCalled();
  });
  it('extracts only fresh raw messages, never the previous summary, and commits against the captured revision', async () => {
    const deps = fixture(); await maintainMemory(deps, 'owner', 'conversation', 'SANI');
    expect(deps.extract).toHaveBeenCalledWith({ characterId: 'SANI', messages: [fresh], allowedRelatedPeople: [], suppressions: [] });
    expect(deps.store.apply).toHaveBeenCalledWith({ userId: 'owner', conversationId: 'conversation', expectedRevision: 3, throughMessageId: fresh.id, candidates: [candidate], summary: null });
    expect(deps.summarize).not.toHaveBeenCalled();
  });
  it('advances the cursor without LLM extraction or summary for an explicit do-not-remember turn', async () => {
    const deps = fixture(); vi.mocked(deps.store.newMessages).mockResolvedValue([{ ...fresh, content: '이 얘기는 기억하지 마. 그림 연습을 하고 있어.' }]);
    await maintainMemory(deps, 'owner', 'conversation', 'SANI');
    expect(deps.extract).not.toHaveBeenCalled(); expect(deps.store.summaryMessages).not.toHaveBeenCalled();
    expect(deps.store.apply).toHaveBeenCalledWith(expect.objectContaining({ candidates: [], summary: null, throughMessageId: fresh.id }));
  });
  it('preserves the previous summary when summarization fails', async () => {
    const deps = fixture(); vi.mocked(deps.store.summaryMessages).mockResolvedValue(Array.from({ length: 17 }, (_, index) => ({ ...fresh, id: `message-${index}` })));
    vi.mocked(deps.summarize).mockRejectedValue(new Error('provider unavailable'));
    await maintainMemory(deps, 'owner', 'conversation', 'SANI');
    expect(deps.summarize).toHaveBeenCalledWith(expect.objectContaining({ previousSummary: state.summary }));
    expect(deps.store.apply).toHaveBeenCalledWith(expect.objectContaining({ candidates: [candidate], summary: null }));
  });
  it('passes suppression tombstones and permitted people to extraction without rebuilding a deleted summary', async () => {
    const deps = fixture(); const suppressions = [{ scope: 'GLOBAL' as const, subject: 'USER' }]; const people = [{ id: 'permitted-person', alias: '친구' }];
    vi.mocked(deps.store.state).mockResolvedValue({ ...state, summary: '', suppressions, allowedRelatedPeople: people });
    await maintainMemory(deps, 'owner', 'conversation', 'SANI');
    expect(deps.extract).toHaveBeenCalledWith(expect.objectContaining({ suppressions, allowedRelatedPeople: people }));
    expect(deps.store.summaryMessages).not.toHaveBeenCalled(); expect(deps.summarize).not.toHaveBeenCalled();
  });
  it('leaves the cursor untouched on extraction failure so a later run can retry', async () => {
    const deps = fixture(); vi.mocked(deps.extract).mockRejectedValue(new Error('provider unavailable'));
    await expect(maintainMemory(deps, 'owner', 'conversation', 'SANI')).rejects.toThrow('provider unavailable');
    expect(deps.store.apply).not.toHaveBeenCalled();
  });
  it('accepts an atomic privacy-revision rejection without retrying a stale candidate', async () => {
    const deps = fixture(); vi.mocked(deps.store.apply).mockResolvedValue({ applied: false, reason: 'CONTEXT_CHANGED' });
    await maintainMemory(deps, 'owner', 'conversation', 'SANI');
    expect(deps.store.apply).toHaveBeenCalledTimes(1); expect(deps.extract).toHaveBeenCalledTimes(1);
  });
  it('normalizes null database summary and optional arrays before use', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...state, summary: null, suppressions: null, allowedRelatedPeople: null }, error: null });
    const store = createMemoryStore({ rpc } as unknown as SupabaseClient);
    expect(await store.state('owner', 'conversation')).toMatchObject({ summary: '', suppressions: [], allowedRelatedPeople: [] });
  });
  it('reads at most the extractor batch size using a stable timestamp-and-id cursor', async () => {
    const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), or: vi.fn(), gt: vi.fn(), then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) };
    for (const method of [query.select, query.eq, query.order, query.limit, query.or, query.gt]) method.mockReturnValue(query);
    const store = createMemoryStore({ from: vi.fn().mockReturnValue(query) } as unknown as SupabaseClient);
    await store.newMessages('owner', 'conversation', { ...state, lastExtractedAt: fresh.createdAt, lastExtractedMessageId: fresh.id });
    expect(query.limit).toHaveBeenCalledWith(8);
    expect(query.or).toHaveBeenCalledWith(`created_at.gt.${fresh.createdAt},and(created_at.eq.${fresh.createdAt},id.gt.${fresh.id})`);
  });
});
