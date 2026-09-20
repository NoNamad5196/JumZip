/** Serialize identity changes, including their final persisted-session writes.
 * Do not nest this gate or await it from an auth observer. It is deliberately
 * independent of the SDK's optional, incomplete legacy auth lock. */
export const AUTH_IDENTITY_LOCK_TIMEOUT_MS = 15_000;
export class AuthIdentityLockError extends Error {
  constructor(public readonly code: 'AUTH_LOCK_UNAVAILABLE' | 'AUTH_LOCK_TIMEOUT') {
    super(code === 'AUTH_LOCK_TIMEOUT'
      ? '다른 로그인 작업이 진행 중이에요. 잠시 후 다시 시도해 주세요.'
      : '로그인 상태를 안전하게 변경할 수 없어요. 지원되는 브라우저에서 다시 시도해 주세요.');
    this.name = 'AuthIdentityLockError';
  }
}

function lockName(projectUrl: string): string {
  try {
    const url = new URL(projectUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    return `jumzip:auth-identity:${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch { throw new AuthIdentityLockError('AUTH_LOCK_UNAVAILABLE'); }
}

// Node-only fixture coordination. This is not a cross-process or cross-tab lock.
const nodeQueues = new Map<string, Promise<void>>();
async function withNodeQueue<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const previous = nodeQueues.get(name) ?? Promise.resolve();
  let expired = false;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { expired = true; reject(new AuthIdentityLockError('AUTH_LOCK_TIMEOUT')); }, AUTH_IDENTITY_LOCK_TIMEOUT_MS);
  });
  const current = previous.then(async () => {
    if (expired) throw new AuthIdentityLockError('AUTH_LOCK_TIMEOUT');
    clearTimeout(timer);
    return operation();
  });
  const settled = current.then(() => {}, () => {});
  nodeQueues.set(name, settled);
  void settled.then(() => { if (nodeQueues.get(name) === settled) nodeQueues.delete(name); });
  return Promise.race([current, timeout]);
}

export async function withAuthIdentityLock<T>(projectUrl: string, operation: () => Promise<T>): Promise<T> {
  const name = lockName(projectUrl);
  if (typeof window === 'undefined') {
    if (typeof process !== 'undefined' && process.versions?.node) return withNodeQueue(name, operation);
    throw new AuthIdentityLockError('AUTH_LOCK_UNAVAILABLE');
  }
  const locks = globalThis.navigator?.locks;
  if (typeof locks?.request !== 'function') throw new AuthIdentityLockError('AUTH_LOCK_UNAVAILABLE');
  const controller = new AbortController();
  let acquired = false, expired = false;
  const timer = setTimeout(() => { expired = true; controller.abort(); }, AUTH_IDENTITY_LOCK_TIMEOUT_MS);
  try {
    return await locks.request(name, { mode: 'exclusive', signal: controller.signal }, async lock => {
      clearTimeout(timer);
      if (expired || controller.signal.aborted) throw new AuthIdentityLockError('AUTH_LOCK_TIMEOUT');
      if (!lock) throw new AuthIdentityLockError('AUTH_LOCK_UNAVAILABLE');
      acquired = true;
      return operation();
    });
  } catch (error) {
    // Preserve the operation's own error; never expose browser/provider details
    // for a failure to acquire the lock itself.
    if (acquired) throw error;
    throw new AuthIdentityLockError(expired ? 'AUTH_LOCK_TIMEOUT' : 'AUTH_LOCK_UNAVAILABLE');
  } finally { clearTimeout(timer); }
}
