// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ fetch: vi.fn(), getSession: vi.fn(), signOut: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { initialize: async () => ({ error: null }), getSession: mocked.getSession, signOut: mocked.signOut } }) }));
// This suite isolates owner/envelope guards; actual SDK concurrency is tested separately.
vi.mock('../../src/lib/auth-identity', () => ({ withAuthIdentityLock: async (_url: string, operation: () => Promise<unknown>) => operation() }));
const session = (id: string, token = `synthetic-${id}`) => ({ data: { session: { access_token: token, user: { id } } }, error: null });
const success = (deleted: unknown = true) => new Response(JSON.stringify({ ok: true, data: { deleted }, meta: { requestId: 'synthetic-request', schemaVersion: 1, createdAt: '2026-09-20T00:00:00Z' } }), { status: 200 });
const body = { action: 'DELETE_ACCOUNT', confirmation: 'DELETE' };
beforeEach(() => {
  vi.resetModules(); vi.stubEnv('VITE_SUPABASE_URL', 'https://owner-fixture.supabase.co'); vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-fixture');
  mocked.getSession.mockReset().mockResolvedValue(session('account-a'));
  mocked.fetch.mockReset(); mocked.signOut.mockReset().mockResolvedValue({ error: null }); vi.stubGlobal('fetch', mocked.fetch);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('account deletion owner binding', () => {
  it('requires an explicit owner from the confirmation UI before making any deletion request', async () => {
    const { service } = await import('../../src/lib/service');
    await expect(service.execute('account', body)).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(mocked.fetch).not.toHaveBeenCalled(); expect(mocked.signOut).not.toHaveBeenCalled();
  });
  it('rejects a confirmation from A when the SDK session has changed to B', async () => {
    mocked.getSession.mockResolvedValue(session('account-b'));
    const { service } = await import('../../src/lib/service');
    await expect(service.execute('account', body, { expectedUserId: 'account-a' })).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(mocked.fetch).not.toHaveBeenCalled(); expect(mocked.signOut).not.toHaveBeenCalled();
  });
  it('also refuses stale profile preferences and logout confirmations before touching the new account', async () => {
    mocked.getSession.mockResolvedValue(session('account-b'));
    const { service } = await import('../../src/lib/service');
    await expect(service.updateProfile({ memory_enabled: false }, 'account-a')).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    await expect(service.signOut('account-a')).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    await expect(service.linkEmail('synthetic@example.test', 'account-a')).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    await expect(service.linkOAuth('google', 'account-a')).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(mocked.fetch).not.toHaveBeenCalled(); expect(mocked.signOut).not.toHaveBeenCalled();
  });
  it('does not copy the old account birth/person inputs or create a conversation under a changed UID', async () => {
    mocked.getSession.mockResolvedValue(session('account-b'));
    const { service } = await import('../../src/lib/service');
    await expect(service.saveBirthProfile({ calendarType: 'SOLAR', leapMonth: false, birthDate: '2000-01-01', birthTimeUnknown: true,
      location: { name: 'Synthetic city', latitude: 0, longitude: 0, timezone: 'UTC' } }, undefined, undefined, 'account-a')).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    await expect(service.saveRelatedPerson({ display_name: 'Synthetic old-account alias' }, undefined, 'account-a')).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    await expect(service.createConversation('SANI', 'account-a')).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(mocked.fetch).not.toHaveBeenCalled();
  });
  it.each(['chat', 'tarot', 'saju', 'compatibility'] as const)('guards %s payload ownership at the SDK await boundary', async endpoint => {
    mocked.getSession.mockResolvedValue(session('account-b'));
    const { service } = await import('../../src/lib/service');
    await expect(service.execute(endpoint, { action: 'SYNTHETIC' }, { expectedUserId: 'account-a' })).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(mocked.fetch).not.toHaveBeenCalled();
  });
  it('uses A authentication and only signs out the still-active deleted A locally', async () => {
    mocked.fetch.mockResolvedValue(success());
    const { service } = await import('../../src/lib/service');
    expect((await service.execute('account', body, { expectedUserId: 'account-a' })).ok).toBe(true);
    expect(mocked.fetch).toHaveBeenCalledTimes(1);
    expect(mocked.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer synthetic-account-a');
    expect(JSON.parse(mocked.fetch.mock.calls[0][1].body)).not.toHaveProperty('expectedUserId');
    expect(mocked.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
  });
  it('does not sign out B after a delayed successful A deletion response', async () => {
    let finish!: (value: Response) => void;
    mocked.fetch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { service } = await import('../../src/lib/service');
    const pending = service.execute('account', body, { expectedUserId: 'account-a' });
    await vi.waitFor(() => expect(mocked.fetch).toHaveBeenCalledTimes(1));
    mocked.getSession.mockResolvedValue(session('account-b')); finish(success());
    await expect(pending).resolves.toMatchObject({ ok: true, data: { deleted: true } });
    expect(mocked.signOut).not.toHaveBeenCalled();
  });
  it('preserves a refreshed token for the same UID until a confirmed deletion signs it out', async () => {
    mocked.getSession.mockResolvedValueOnce(session('account-a')).mockResolvedValueOnce(session('account-a', 'synthetic-refreshed-a'));
    mocked.fetch.mockResolvedValue(success());
    const { service } = await import('../../src/lib/service');
    await service.execute('account', body, { expectedUserId: 'account-a' });
    expect(mocked.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
  });
  it.each([false, null, 'true'])('does not clear a session without an actual deleted=true result: %s', async deleted => {
    mocked.fetch.mockResolvedValue(success(deleted));
    const { service } = await import('../../src/lib/service');
    await service.execute('account', body, { expectedUserId: 'account-a' });
    expect(mocked.signOut).not.toHaveBeenCalled();
  });
  it('does not automatically retry an uncertain account deletion or sign anyone out', async () => {
    mocked.fetch.mockRejectedValue(new TypeError('synthetic network loss'));
    const { service } = await import('../../src/lib/service');
    await expect(service.execute('account', body, { expectedUserId: 'account-a' })).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: false });
    expect(mocked.fetch).toHaveBeenCalledTimes(1); expect(mocked.signOut).not.toHaveBeenCalled();
  });
});
