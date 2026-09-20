import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_IDENTITY_LOCK_TIMEOUT_MS, AuthIdentityLockError, withAuthIdentityLock } from '../../src/lib/auth-identity';

const project = 'https://identity-fixture.supabase.co';
const deferred = <T = void>() => { let resolve!: (value: T | PromiseLike<T>) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

/** A shared browser LockManager double: waiters from independent callers share
 * exclusion; abort only removes a waiter, never cancels/steals the holder. */
function installWebLocks() {
  const held = new Set<string>();
  const queue: { name: string; options: LockOptions; run: () => void }[] = [];
  const drain = () => {
    for (const item of [...queue]) if (!held.has(item.name)) {
      queue.splice(queue.indexOf(item), 1); held.add(item.name); item.run();
    }
  };
  const request = vi.fn((name: string, options: LockOptions, callback: (lock: Lock) => Promise<unknown>) => new Promise((resolve, reject) => {
    const abort = () => { const index = queue.indexOf(item); if (index >= 0) queue.splice(index, 1); reject(new DOMException('Synthetic lock wait aborted', 'AbortError')); };
    const item = { name, options, run: () => {
      options.signal?.removeEventListener('abort', abort);
      void Promise.resolve().then(() => callback({ name, mode: 'exclusive' })).then(resolve, reject).finally(() => { held.delete(name); drain(); });
    } };
    if (options.signal?.aborted) { abort(); return; }
    options.signal?.addEventListener('abort', abort, { once: true }); queue.push(item); drain();
  }));
  vi.stubGlobal('window', {}); vi.stubGlobal('navigator', { locks: { request } });
  return request;
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('browser identity lock acquisition and release', () => {
  it('fails closed without Web Locks and never runs the operation', async () => {
    vi.stubGlobal('window', {}); vi.stubGlobal('navigator', {}); const operation = vi.fn();
    await expect(withAuthIdentityLock(project, operation)).rejects.toMatchObject({ code: 'AUTH_LOCK_UNAVAILABLE' });
    expect(operation).not.toHaveBeenCalled();
  });
  it('hides acquisition failure details but preserves a typed public error', async () => {
    const operation = vi.fn(); vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { locks: { request: () => { throw Error('synthetic private browser detail'); } } });
    const error = await withAuthIdentityLock(project, operation).catch(error => error);
    expect(error).toBeInstanceOf(AuthIdentityLockError);
    if (!(error instanceof AuthIdentityLockError)) throw Error('EXPECTED_AUTH_LOCK_ERROR');
    expect(error.code).toBe('AUTH_LOCK_UNAVAILABLE');
    expect(error.message).not.toContain('private'); expect(operation).not.toHaveBeenCalled();
  });
  it('serializes equivalent project URLs and permits unrelated projects concurrently', async () => {
    const request = installWebLocks(), hold = deferred(), entered = deferred(), events: string[] = [];
    const first = withAuthIdentityLock(project + '/', async () => { events.push('first'); entered.resolve(); await hold.promise; events.push('released'); });
    await entered.promise;
    const second = withAuthIdentityLock(project, async () => { events.push('second'); });
    await withAuthIdentityLock('https://other-fixture.supabase.co', async () => { events.push('other'); });
    expect(events).toEqual(['first', 'other']); hold.resolve(); await Promise.all([first, second]);
    expect(events).toEqual(['first', 'other', 'released', 'second']);
    expect(request.mock.calls[0][0]).toBe(request.mock.calls[1][0]);
    for (const [, options] of request.mock.calls) { expect(options.mode).toBe('exclusive'); expect(options.signal).toBeInstanceOf(AbortSignal); expect(options).not.toHaveProperty('steal'); expect(options).not.toHaveProperty('ifAvailable'); }
  });
  it('times out only the waiter, never steals or times out the acquired operation', async () => {
    vi.useFakeTimers(); const request = installWebLocks(), hold = deferred(), entered = deferred(), waiting = vi.fn();
    const first = withAuthIdentityLock(project, async () => { entered.resolve(); await hold.promise; return 'held-result'; });
    await entered.promise;
    const second = withAuthIdentityLock(project, waiting); const rejection = expect(second).rejects.toMatchObject({ code: 'AUTH_LOCK_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(AUTH_IDENTITY_LOCK_TIMEOUT_MS + 1); await rejection;
    expect(waiting).not.toHaveBeenCalled(); expect(request.mock.calls[0][1].signal?.aborted).toBe(false);
    expect(request.mock.calls[1][1].signal?.aborted).toBe(true);
    hold.resolve(); await expect(first).resolves.toBe('held-result');
    await expect(withAuthIdentityLock(project, async () => 'next')).resolves.toBe('next');
    expect(waiting).not.toHaveBeenCalled();
  });
  it('releases the lock after a callback error without relabeling that error', async () => {
    installWebLocks(); const failure = Error('operation failure');
    await expect(withAuthIdentityLock(project, async () => { throw failure; })).rejects.toBe(failure);
    await expect(withAuthIdentityLock(project, async () => 42)).resolves.toBe(42);
  });
  it('does not execute a late granted callback after the acquisition deadline', async () => {
    vi.useFakeTimers(); const operation = vi.fn(); let grant!: () => Promise<unknown>;
    vi.stubGlobal('window', {}); vi.stubGlobal('navigator', { locks: { request: (name: string, _options: LockOptions, callback: (lock: Lock) => Promise<unknown>) => new Promise((resolve, reject) => { grant = () => callback({ name, mode: 'exclusive' }).then(resolve, reject); }) } });
    const pending = withAuthIdentityLock(project, operation); const rejected = expect(pending).rejects.toMatchObject({ code: 'AUTH_LOCK_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(AUTH_IDENTITY_LOCK_TIMEOUT_MS + 1); await grant(); await rejected;
    expect(operation).not.toHaveBeenCalled();
  });
  it.each(['not-a-url', 'file:///synthetic', 'https://private:secret@example.invalid', project + '?secret=not-real'])('rejects an unusable project lock identity without running work: %s', async url => {
    const operation = vi.fn(); await expect(withAuthIdentityLock(url, operation)).rejects.toMatchObject({ code: 'AUTH_LOCK_UNAVAILABLE' }); expect(operation).not.toHaveBeenCalled();
  });
});

describe('Node-only fixture queue (no cross-tab claim)', () => {
  it('does not mistake a windowless non-Node environment for the fixture fallback', async () => {
    vi.stubGlobal('window', undefined); const operation = vi.fn(), savedProcess = process;
    let pending: Promise<unknown>;
    try { vi.stubGlobal('process', undefined); pending = withAuthIdentityLock(project, operation); }
    finally { vi.stubGlobal('process', savedProcess); }
    await expect(pending).rejects.toMatchObject({ code: 'AUTH_LOCK_UNAVAILABLE' }); expect(operation).not.toHaveBeenCalled();
  });
  it('queues initialization before subsequent identity work and releases after failure', async () => {
    vi.stubGlobal('window', undefined); const ready = deferred(), entered = deferred(), events: string[] = [];
    const initialization = withAuthIdentityLock(project, async () => { entered.resolve(); await ready.promise; events.push('initialized'); });
    await entered.promise;
    const login = withAuthIdentityLock(project, async () => { events.push('login'); });
    expect(events).toEqual([]); ready.resolve(); await Promise.all([initialization, login]); expect(events).toEqual(['initialized', 'login']);
    const failure = Error('fixture failure'); await expect(withAuthIdentityLock(project, async () => { throw failure; })).rejects.toBe(failure);
    await expect(withAuthIdentityLock(project, async () => 'released')).resolves.toBe('released');
  });
  it('removes a timed-out wait without executing it or releasing an active holder', async () => {
    vi.stubGlobal('window', undefined); vi.useFakeTimers(); const hold = deferred(), entered = deferred(), work = vi.fn();
    const first = withAuthIdentityLock(project, async () => { entered.resolve(); await hold.promise; }); await entered.promise;
    const waiting = withAuthIdentityLock(project, work); const rejected = expect(waiting).rejects.toMatchObject({ code: 'AUTH_LOCK_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(AUTH_IDENTITY_LOCK_TIMEOUT_MS + 1); await rejected; expect(work).not.toHaveBeenCalled();
    hold.resolve(); await first; await expect(withAuthIdentityLock(project, async () => 'after')).resolves.toBe('after'); expect(work).not.toHaveBeenCalled();
  });
});
