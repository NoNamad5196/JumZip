// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getSession: vi.fn(), signInWithOAuth: vi.fn(), linkIdentity: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth }) }));
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://auth-fixture.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-fixture');
  auth.getSession.mockReset().mockResolvedValue({ data: { session: null }, error: null });
  auth.signInWithOAuth.mockReset().mockResolvedValue({ error: null });
  auth.linkIdentity.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe('OAuth identity continuity', () => {
  it('blocks replacing an anonymous identity with a fresh OAuth sign-in', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'guest', is_anonymous: true } } }, error: null });
    const { service } = await import('../../src/lib/service');
    await expect(service.signInWithOAuth('google')).rejects.toMatchObject({ code: 'LINK_REQUIRED' });
    expect(auth.signInWithOAuth).not.toHaveBeenCalled();
  });
  it('links the existing identity with a same-origin callback and no extra provider scopes', async () => {
    const { service } = await import('../../src/lib/service');
    await service.linkOAuth('google');
    expect(auth.linkIdentity).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: `${location.origin}/auth` } });
    expect(auth.signInWithOAuth).not.toHaveBeenCalled();
  });
  it('allows a new OAuth sign-in only when the current session is not anonymous', async () => {
    const { service } = await import('../../src/lib/service');
    await service.signInWithOAuth('google');
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: `${location.origin}/auth` } });
  });
});
