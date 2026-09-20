import type { Message } from '../lib/service';

export type Delivery = 'sending' | 'unknown' | 'failed' | 'stored' | 'complete';
export type ChatTurn = {
  localId: string;
  content: string;
  createdAt: string;
  conversationId: string | null;
  consultationId: string | null;
  requestId?: string;
  responseRequestId?: string;
  userMessageId?: string;
  delivery: Delivery;
  assistant?: { id: string; content: string; createdAt: string; requestId: string; recommendation?: unknown };
};
export type TimelineMessage = Message & { turnId?: string; delivery?: Delivery };

/** Identity comes from the server or the request, never from repeated message text. */
export function mergeChatTimeline(saved: readonly Message[], turns: readonly ChatTurn[]): TimelineMessage[] {
  const rows: TimelineMessage[] = saved.map(message => ({ ...message }));
  const merge = (local: TimelineMessage) => {
    const index = rows.findIndex(message => message.id === local.id ||
      (local.request_id && message.request_id === local.request_id && message.sender === local.sender));
    if (index < 0) rows.push(local);
    else rows[index] = { ...local, ...rows[index], turnId: local.turnId, delivery: local.delivery };
  };
  for (const turn of turns) {
    const common = { conversation_id: turn.conversationId ?? '', consultation_id: turn.consultationId, type: 'CHAT', metadata: {}, reply_to_message_id: null };
    merge({ ...common, id: turn.userMessageId ?? turn.localId, sender: 'USER', content: turn.content,
      request_id: turn.requestId ?? null, created_at: turn.createdAt, turnId: turn.localId, delivery: turn.delivery });
    if (turn.assistant) merge({ ...common, id: turn.assistant.id, sender: 'ASSISTANT', content: turn.assistant.content,
      request_id: turn.assistant.requestId, created_at: turn.assistant.createdAt,
      reply_to_message_id: turn.userMessageId ?? null, metadata: { recommendation: turn.assistant.recommendation } });
  }
  // Preserve server pagination order; local messages follow their creation order. A
  // local answer belongs immediately after its user when a refetch already has that user.
  for (const turn of turns) {
    if (!turn.assistant || saved.some(message => message.id === turn.assistant!.id)) continue;
    const answerIndex = rows.findIndex(message => message.id === turn.assistant!.id);
    const userIndex = rows.findIndex(message => message.turnId === turn.localId && message.sender === 'USER');
    if (answerIndex > userIndex + 1 && userIndex >= 0) rows.splice(userIndex + 1, 0, ...rows.splice(answerIndex, 1));
  }
  return rows;
}
