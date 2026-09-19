import type { CharacterId } from './config.ts';
export interface ContextMessage { id?: string; role: 'user' | 'assistant'; content: string; turnId?: string }
export interface ContextMemory {
  id: string; scope: 'GLOBAL' | 'CHARACTER'; characterId?: CharacterId | null;
  content: string; category?: string; subject?: string; importance?: number; updatedAt?: string;
  deletedAt?: string | null; disabled?: boolean; doNotRemember?: boolean;
}
export interface ContextInput {
  characterId: CharacterId; currentMessage: string; recentMessages?: readonly ContextMessage[];
  summary?: string; memories?: readonly ContextMemory[]; toolResult?: unknown;
  subject?: string; budgetChars?: number; currentMessageId?: string;
}
export interface BuiltContext {
  currentMessage: string; recentMessages: ContextMessage[]; summary: string;
  globalMemories: ContextMemory[]; characterMemories: ContextMemory[]; toolResult?: unknown;
  shouldUpdateSummary: boolean; exceedsBudget: boolean;
}

/** A turn begins with a user message and includes its subsequent assistant responses.
 * Existing histories without turn IDs are grouped by role, never mistaken for 16 messages.
 */
function recentTurns(messages: readonly ContextMessage[], count: number): ContextMessage[] {
  const turns: ContextMessage[][] = [];
  for (const message of messages) {
    const last = turns.at(-1);
    const sameExplicitTurn = message.turnId !== undefined && last?.[0]?.turnId === message.turnId;
    if (!last || (message.role === 'user' && !sameExplicitTurn)) turns.push([message]);
    else last.push(message);
  }
  return turns.slice(-count).flat();
}
const estimate = (value: unknown): number => value === undefined ? 0 : JSON.stringify(value).length;

export function buildContext(input: ContextInput): BuiltContext {
  const budget = input.budgetChars ?? 24_000;
  if (!Number.isFinite(budget) || budget < 1) throw new RangeError('CONTEXT_BUDGET_INVALID');
  const messages = (input.recentMessages ?? []).filter(m => m.role === 'user' || m.role === 'assistant').filter(m => !input.currentMessageId || m.id !== input.currentMessageId);
  const allTurnCount = messages.filter(m => m.role === 'user').length;
  const eligible = (input.memories ?? []).filter(m => !m.deletedAt && !m.disabled && !m.doNotRemember && (m.scope === 'GLOBAL' || (m.scope === 'CHARACTER' && m.characterId === input.characterId)));
  const ranked = [...eligible].sort((a, b) => {
    const relevance = (m: ContextMemory) => input.subject && m.subject === input.subject ? 1 : 0;
    return relevance(b) - relevance(a) || (b.importance ?? 0) - (a.importance ?? 0) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.id.localeCompare(b.id);
  });
  const result: BuiltContext = { currentMessage: input.currentMessage, recentMessages: recentTurns(messages, 16), summary: input.summary ?? '',
    globalMemories: ranked.filter(m => m.scope === 'GLOBAL').slice(0, 4), characterMemories: ranked.filter(m => m.scope === 'CHARACTER').slice(0, 2),
    toolResult: input.toolResult, shouldUpdateSummary: allTurnCount > 16, exceedsBudget: false };
  const size = () => estimate({ currentMessage: result.currentMessage, recentMessages: result.recentMessages, summary: result.summary, globalMemories: result.globalMemories, characterMemories: result.characterMemories, toolResult: result.toolResult });
  result.shouldUpdateSummary ||= size() > budget * 0.6;
  // Keep current question, authoritative tool result and core summary intact.
  while (size() > budget && result.recentMessages.length > 0) {
    result.recentMessages.shift();
    while (result.recentMessages[0]?.role === 'assistant') result.recentMessages.shift();
  }
  while (size() > budget && result.globalMemories.length + result.characterMemories.length > 0) {
    const remaining = [...result.globalMemories, ...result.characterMemories];
    const least = ranked.filter(m => remaining.some(r => r.id === m.id)).at(-1)!;
    result.globalMemories = result.globalMemories.filter(m => m.id !== least.id);
    result.characterMemories = result.characterMemories.filter(m => m.id !== least.id);
  }
  result.exceedsBudget = size() > budget;
  return result;
}

/** Summary failures preserve existing summary AND original messages; this pure helper deletes nothing. */
export async function refreshSummary(previous: string, messages: readonly ContextMessage[], summarize: (messages: readonly ContextMessage[]) => Promise<string>): Promise<{ summary: string; updated: boolean }> {
  try {
    const summary = (await summarize(messages)).trim();
    if (!summary) return { summary: previous, updated: false };
    return { summary, updated: true };
  } catch { return { summary: previous, updated: false }; }
}
