// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ fetch: vi.fn(), getSession: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { initialize: async () => ({ error: null }), getSession: mocked.getSession } }) }));
vi.mock('../../src/lib/auth-identity', () => ({ withAuthIdentityLock: async (_url: string, operation: () => Promise<unknown>) => operation() }));
beforeEach(() => {
  vi.resetModules(); vi.stubEnv('VITE_SUPABASE_URL', 'https://transport-fixture.supabase.co'); vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-fixture');
  mocked.getSession.mockResolvedValue({ data: { session: { access_token: 'synthetic-session', user: { id: 'synthetic-user' } } }, error: null });
  mocked.fetch.mockReset(); vi.stubGlobal('fetch', mocked.fetch);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const meta = { requestId: 'request-fixture', schemaVersion: 1, createdAt: '2026-09-20T00:00:00Z' };
describe('Edge transport boundaries', () => {
  it('normalizes a gateway-shaped 503 without exposing an internal TypeError or gateway message', async () => {
    mocked.fetch.mockResolvedValue(response({ code: 'BOOT_ERROR', message: 'worker failed' }, 503));
    const { service, ServiceError } = await import('../../src/lib/service');
    let failure: unknown; try { await service.execute('chat', { action: 'SEND' }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ServiceError);
    expect(failure).toMatchObject({ code: 'SERVER_ERROR', retryable: true });
    expect((failure as Error).message).not.toMatch(/worker failed|undefined|TypeError/);
  });
  it.each([null, [], { ok: true }, { ok: false, error: null, meta }, { ok: true, data: {}, meta: { ...meta, schemaVersion: 99 } }])('rejects a malformed success/status envelope: %j', async (body) => {
    mocked.fetch.mockResolvedValue(response(body));
    const { service } = await import('../../src/lib/service');
    await expect(service.execute('chat', { action: 'SEND' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE', retryable: true });
  });
  it('retains a valid backend failure and its persisted retry pointer', async () => {
    mocked.fetch.mockResolvedValue(response({ ok: false, error: { code: 'LLM_INVALID_RESPONSE', message: '다시 시도해 주세요.', retryable: true, details: { userMessageId: 'saved-user-message' } }, meta }, 502));
    const { service } = await import('../../src/lib/service');
    await expect(service.execute('chat', { action: 'SEND' })).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE', details: { userMessageId: 'saved-user-message' } });
  });
  it('uses the caller intention UUID for both attempts after a lost transport response', async () => {
    const supplied = '00000000-0000-4000-8000-000000000001';
    mocked.fetch.mockRejectedValueOnce(new TypeError('connection lost')).mockResolvedValueOnce(response({ ok: true, data: { saved: true }, meta: { ...meta, requestId: supplied } }));
    const { service } = await import('../../src/lib/service');
    const result = await service.execute('chat', { action: 'SEND', requestId: supplied });
    expect(result.ok).toBe(true); expect(mocked.fetch).toHaveBeenCalledTimes(2);
    expect(mocked.fetch.mock.calls.map((call) => JSON.parse(call[1].body).requestId)).toEqual([supplied, supplied]);
  });
});
