const prefix = 'jumzip-draft:';
export const draftKey = (userId: string | undefined, characterId: string, conversationId: string | null) => `${prefix}${userId || 'visitor'}:${characterId}:${conversationId || 'new'}`;
export function readDraft(key: string) { try { return sessionStorage.getItem(key) || ''; } catch { return ''; } }
export function saveDraft(key: string, value: string) { try { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key); } catch { /* A disabled storage area must not prevent a conversation. */ } }
export function clearDrafts(userId?: string) {
  try { for (const key of Object.keys(sessionStorage)) if (key.startsWith(userId ? `${prefix}${userId}:` : prefix)) sessionStorage.removeItem(key); } catch { /* The in-memory draft is cleared when the session changes. */ }
}
