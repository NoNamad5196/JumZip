const prefix = 'jumzip-request-intent:';
type Intent = { requestId: string; consultationId?: unknown };
const pending = new Map<string, Intent>();
let clearRevision = 0;
const userRevisions = new Map<string, number>();
const uncertainCodes = new Set(['NETWORK_ERROR', 'INVALID_RESPONSE', 'SERVER_ERROR', 'REQUEST_IN_PROGRESS']);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function forget(key: string, requestId: string) { if (pending.get(key)?.requestId !== requestId) return; pending.delete(key); try { sessionStorage.removeItem(key); } catch { /* Memory still protects retries in this tab. */ } }
export function clearRequestIntents(userId?: string) {
  if (userId) userRevisions.set(userId, (userRevisions.get(userId) ?? 0) + 1);
  else { clearRevision += 1; userRevisions.clear(); }
  const scope = userId ? `${prefix}${userId}:` : prefix;
  for (const key of pending.keys()) if (key.startsWith(scope)) pending.delete(key);
  try { for (const key of Object.keys(sessionStorage)) if (key.startsWith(scope)) sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
}

/** Resume an uncertain transport outcome; confirmed outcomes release the next explicit request. */
export async function executeIntent<T>(userId: string, endpoint: string, body: Record<string, unknown>, send: (payload: Record<string, unknown>) => Promise<T>, semanticContext?: string | null): Promise<T> {
  const revision = clearRevision, userRevision = userRevisions.get(userId) ?? 0;
  // A restored server message may add a consultation ID after the original response was lost.
  // Match the user's intent without that routing change, then replay its original routing value.
  const identity = { ...body }; delete identity.requestId; delete identity.consultationId;
  // Only an explicit null opts into automatic consultation recovery. Omitted context
  // conservatively keeps supplied consultation IDs distinct for other callers.
  const context = semanticContext === undefined ? body.consultationId ?? null : semanticContext;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical({ context, payload: identity })));
  if (revision !== clearRevision || userRevision !== (userRevisions.get(userId) ?? 0)) throw Object.assign(new Error('화면이 바뀌었어요.'), { code: 'REQUEST_CANCELLED' });
  const fingerprint = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  const key = `${prefix}${userId}:${endpoint}:${fingerprint}`;
  let intent = pending.get(key);
  if (!intent) {
    try { const stored = JSON.parse(sessionStorage.getItem(key) || 'null') as Intent | null; if (stored && typeof stored.requestId === 'string') intent = stored; } catch { /* Ignore an unavailable or damaged entry. */ }
  }
  if (!intent) intent = { requestId: crypto.randomUUID(), ...('consultationId' in body ? { consultationId: body.consultationId } : {}) };
  pending.set(key, intent);
  try { sessionStorage.setItem(key, JSON.stringify(intent)); } catch { /* Retain the in-memory request if storage is disabled. */ }
  const payload = { ...body, ...('consultationId' in intent ? { consultationId: intent.consultationId } : {}), requestId: intent.requestId };
  try { const result = await send(payload); forget(key, intent.requestId); return result; }
  catch (error) { if (!uncertainCodes.has(String((error as { code?: string } | null)?.code))) forget(key, intent.requestId); throw error; }
}
