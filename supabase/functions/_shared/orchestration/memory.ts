import type { SupabaseClient } from '@supabase/supabase-js';
import type { CharacterId } from '../contracts/index.ts';
import type { ContextMessage } from '../persona/context.ts';
import type { LLMProvider } from '../llm/provider.ts';
import { extractMemoryCandidates, summarizeConversation, type MemoryCandidate, type MemoryExtractionInput, type MemorySummaryInput } from '../persona/memory.ts';
import { hasMemoryOptOut } from './privacy.ts';

/** Shared by production maintenance and the real-provider integration harness. */
export const MEMORY_PROVIDER_LIMITS = Object.freeze({ initialTimeoutMs: 8_000, repairTimeoutMs: 3_000, maxOutputTokens: 900 });

export interface MemoryState {
  memoryEnabled: boolean; revision: number; summary: string; lastExtractedAt: string | null;
  lastExtractedMessageId: string | null; summaryCursorAt: string | null;
  suppressions: { scope: 'GLOBAL' | 'CHARACTER'; characterId?: CharacterId | null; subject: string }[];
  allowedRelatedPeople?: { id: string; alias: string }[];
  blockedRelatedPeople?: { id: string; alias: string }[];
}
export type MemoryMessage = ContextMessage & { id: string; createdAt: string };
export interface MemoryStore {
  state(userId: string, conversationId: string): Promise<MemoryState>;
  newMessages(userId: string, conversationId: string, state: MemoryState): Promise<MemoryMessage[]>;
  summaryMessages(userId: string, conversationId: string, state: MemoryState, through: MemoryMessage): Promise<MemoryMessage[]>;
  apply(input: { userId: string; conversationId: string; expectedRevision: number; throughMessageId: string; candidates: MemoryCandidate[]; summary: string | null }): Promise<unknown>;
}
export interface MemoryMaintenance {
  store: MemoryStore;
  extract(input: MemoryExtractionInput): Promise<MemoryCandidate[]>;
  summarize(input: MemorySummaryInput): Promise<string>;
}

/** This is best-effort maintenance. Failure never deletes messages or overwrites the previous summary. */
export async function maintainMemory(dependencies: MemoryMaintenance, userId: string, conversationId: string, characterId: CharacterId): Promise<void> {
  const state = await dependencies.store.state(userId, conversationId);
  if (!state.memoryEnabled) return;
  const messages = await dependencies.store.newMessages(userId, conversationId, state);
  const through = messages.at(-1);
  if (!through) return;
  const privateTurn = messages.some(message => hasMemoryOptOut(message.content));
  // Extraction receives only new raw USER messages; old summaries never feed the extractor.
  const consent = { allowedRelatedPeople: state.allowedRelatedPeople ?? [], blockedRelatedPeople: state.blockedRelatedPeople ?? [], suppressions: state.suppressions };
  const candidates = privateTurn ? [] : await dependencies.extract({ characterId, messages, ...consent });
  let summary: string | null = null;
  if (!privateTurn && state.suppressions.length === 0) {
    const raw = await dependencies.store.summaryMessages(userId, conversationId, state, through);
    if (raw.filter(message => message.role === 'user').length > 16 || raw.reduce((sum, message) => sum + message.content.length, state.summary.length) > 14_400) {
      try { summary = await dependencies.summarize({ characterId, messages: raw, previousSummary: state.summary, ...consent }); }
      catch { summary = null; }
    }
  }
  // The RPC rechecks the privacy revision, profile opt-out and tombstones at commit time.
  await dependencies.store.apply({ userId, conversationId, expectedRevision: state.revision, throughMessageId: through.id, candidates, summary });
}

export function createMemoryStore(client: SupabaseClient): MemoryStore {
  const rows = (data: { id: string; sender: string; content: string; created_at: string }[] | null): MemoryMessage[] =>
    (data ?? []).filter(row => row.sender === 'USER' || row.sender === 'ASSISTANT').map(row => ({ id: row.id, role: row.sender.toLowerCase() as 'user' | 'assistant', content: row.content, createdAt: row.created_at }));
  return {
    async state(userId, conversationId) {
      const { data, error } = await client.rpc('memory_context_state', { p_user_id: userId, p_conversation_id: conversationId });
      if (error || !data) throw new Error('MEMORY_STATE_UNAVAILABLE');
      const state = data as MemoryState;
      return { ...state, summary: state.summary ?? '', suppressions: state.suppressions ?? [], allowedRelatedPeople: state.allowedRelatedPeople ?? [], blockedRelatedPeople: state.blockedRelatedPeople ?? [] };
    },
    async newMessages(userId, conversationId, state) {
      let query = client.from('messages').select('id,sender,content,created_at').eq('user_id', userId).eq('conversation_id', conversationId).eq('sender', 'USER').order('created_at', { ascending: true }).order('id', { ascending: true }).limit(8);
      if (state.lastExtractedAt) {
        query = state.lastExtractedMessageId
          ? query.or(`created_at.gt.${state.lastExtractedAt},and(created_at.eq.${state.lastExtractedAt},id.gt.${state.lastExtractedMessageId})`)
          : query.gt('created_at', state.lastExtractedAt);
      }
      const { data, error } = await query;
      if (error) throw new Error('MEMORY_SOURCE_UNAVAILABLE');
      return rows(data).filter(message => message.id !== state.lastExtractedMessageId);
    },
    async summaryMessages(userId, conversationId, state, through) {
      let query = client.from('messages').select('id,sender,content,created_at').eq('user_id', userId).eq('conversation_id', conversationId)
        .in('sender', ['USER', 'ASSISTANT']).lte('created_at', through.createdAt).order('created_at', { ascending: true }).limit(200);
      if (state.summaryCursorAt) query = query.gt('created_at', state.summaryCursorAt);
      const { data, error } = await query;
      if (error) throw new Error('SUMMARY_SOURCE_UNAVAILABLE');
      return rows(data);
    },
    async apply(input) {
      const { data, error } = await client.rpc('apply_memory_update', { p_user_id: input.userId, p_conversation_id: input.conversationId,
        p_expected_revision: input.expectedRevision, p_through_message_id: input.throughMessageId, p_candidates: input.candidates, p_summary: input.summary });
      if (error) throw new Error('MEMORY_WRITE_UNAVAILABLE');
      return data;
    },
  };
}
export function createMemoryMaintenance(client: SupabaseClient, provider: LLMProvider): MemoryMaintenance {
  return { store: createMemoryStore(client), extract: input => extractMemoryCandidates(provider, input), summarize: input => summarizeConversation(provider, input) };
}
