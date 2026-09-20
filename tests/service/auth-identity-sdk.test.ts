import { createClient, processLock } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { withAuthIdentityLock } from '../../src/lib/auth-identity';

// Installed production SDK, synthetic HTTP transport only. No auth credentials,
// real Auth service, browser session, persistence or model request is used.
const project = 'https://auth-gate-sdk-fixture.invalid';
const userA = '00000000-0000-4000-8000-000000000001', userB = '00000000-0000-4000-8000-000000000002';
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (id: string, revision = 0) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated', revision })}.c3ludGhldGlj`;
const user = (id: string) => ({ id, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
const session = (id: string, revision = 0) => ({ access_token: jwt(id, revision), refresh_token: `synthetic-${id}-${revision}`, token_type: 'bearer', expires_in: 3600, user: user(id) });

function fixture(legacyLock = false) {
  const started = deferred(), finish = deferred();
  let otpUser = userB, otpRevision = 0, otpRequests = 0, logoutRequests = 0;
  const client = createClient(project, 'public-synthetic-only', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, ...(legacyLock ? { lock: processLock } : {}) },
    global: { fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/user')) {
        const token = new Headers(init?.headers).get('Authorization')!.slice(7);
        return Response.json(user(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub));
      }
      if (path.endsWith('/logout')) { logoutRequests++; started.resolve(); await finish.promise; return new Response(null, { status: 204 }); }
      if (path.endsWith('/verify')) { otpRequests++; return Response.json(session(otpUser, otpRevision)); }
      throw Error('UNEXPECTED_SYNTHETIC_AUTH_ROUTE');
    } },
  });
  const otp = () => client.auth.verifyOtp({ email: 'synthetic@example.invalid', token: '123456', type: 'email' });
  const guardedLogout = (expectedUid: string) => withAuthIdentityLock(project, async () => {
    const { data } = await client.auth.getSession();
    if (data.session?.user.id !== expectedUid) return false;
    const { error } = await client.auth.signOut({ scope: 'local' }); if (error) throw error;
    return true;
  });
  return { client, started, finish, otp, guardedLogout,
    asUser: (id: string, revision = 0) => { otpUser = id; otpRevision = revision; },
    counts: () => ({ otpRequests, logoutRequests }) };
}

describe('identity gate around installed auth SDK behavior', () => {
  it.each([false, true])('reproduces lost B without the app gate, including optional legacy lock=%s', async legacyLock => {
    const test = fixture(legacyLock); await test.client.auth.setSession(session(userA));
    const logout = test.client.auth.signOut({ scope: 'local' }); await test.started.promise;
    try {
      const b = await test.otp(); expect(b.data.session?.user.id).toBe(userB);
    } finally { test.finish.resolve(); }
    await logout; expect((await test.client.auth.getSession()).data.session).toBeNull();
    expect(test.counts()).toEqual({ otpRequests: 1, logoutRequests: 1 });
  });

  it('waits to verify B until A logout finishes and preserves the final B session', async () => {
    const test = fixture(); await withAuthIdentityLock(project, () => test.client.auth.setSession(session(userA)));
    const logout = test.guardedLogout(userA); await test.started.promise;
    const login = withAuthIdentityLock(project, test.otp);
    // Allow unrelated work to run while the project gate remains held.
    await withAuthIdentityLock('https://unrelated-fixture.invalid', async () => {});
    expect(test.counts().otpRequests).toBe(0);
    test.finish.resolve(); expect(await logout).toBe(true); expect((await login).data.session?.user.id).toBe(userB);
    expect((await test.client.auth.getSession()).data.session?.user.id).toBe(userB);
    expect(test.counts()).toEqual({ otpRequests: 1, logoutRequests: 1 });
  });

  it('skips A cleanup when B won the gate first, without sending a logout for B', async () => {
    const test = fixture(); await test.client.auth.setSession(session(userA));
    await withAuthIdentityLock(project, test.otp);
    expect(await test.guardedLogout(userA)).toBe(false);
    expect((await test.client.auth.getSession()).data.session?.user.id).toBe(userB);
    expect(test.counts()).toEqual({ otpRequests: 1, logoutRequests: 0 });
  });

  it('permits a changed token for the same UID and still performs its confirmed cleanup', async () => {
    const test = fixture(); await test.client.auth.setSession(session(userA)); test.asUser(userA, 1);
    await withAuthIdentityLock(project, test.otp);
    const current = (await test.client.auth.getSession()).data.session;
    expect(current?.user.id).toBe(userA);
    expect(JSON.parse(Buffer.from(current!.access_token.split('.')[1], 'base64url').toString()).revision).toBe(1);
    const logout = test.guardedLogout(userA); await test.started.promise; test.finish.resolve();
    expect(await logout).toBe(true); expect((await test.client.auth.getSession()).data.session).toBeNull();
  });
});
