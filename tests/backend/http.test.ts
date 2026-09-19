import { describe, expect, it, vi } from 'vitest';
import { createHandler, type HttpDependencies } from '../../supabase/functions/_shared/http/handler.ts';
import { ApiFailure } from '../../supabase/functions/_shared/http/errors.ts';

const body = { schemaVersion: 1, requestId: '20000000-0000-4000-8000-000000000001', action: 'DELETE_ACCOUNT', confirmation: 'DELETE' };
const dependencies = (): HttpDependencies => ({ allowedOrigins: ['https://jumzip.example'], authenticate: vi.fn().mockResolvedValue({ id: 'server-user', isAnonymous: false }), execute: vi.fn().mockResolvedValue({ data: { deleted: true } }) });
const request = (input: unknown = body, headers: Record<string, string> = {}) => new Request('https://edge.example/account', { method: 'POST', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json', Origin: 'https://jumzip.example', ...headers }, body: JSON.stringify(input) });

describe('Edge HTTP and auth boundary', () => {
  it('preflights only configured exact origins without auth calls', async () => {
    const deps = dependencies(); const handler = createHandler('account', deps);
    const good = await handler(new Request('https://edge.example/account', { method: 'OPTIONS', headers: { Origin: 'https://jumzip.example' } }));
    expect(good.status).toBe(204); expect(good.headers.get('Access-Control-Allow-Origin')).toBe('https://jumzip.example');
    const bad = await handler(request(body, { Origin: 'https://jumzip.example.attacker.test' }));
    expect(bad.status).toBe(403); expect(bad.headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect(deps.authenticate).not.toHaveBeenCalled(); expect(deps.execute).not.toHaveBeenCalled();
  });
  it('checks Auth server for every request, including duplicated ids', async () => {
    const deps = dependencies(); const handler = createHandler('account', deps);
    await handler(request()); await handler(request());
    expect(deps.authenticate).toHaveBeenCalledTimes(2);
    expect(deps.execute).toHaveBeenCalledWith('account', body, { id: 'server-user', isAnonymous: false }, expect.any(Number));
  });
  it('rejects a deleted or expired user before any mutation', async () => {
    const deps = dependencies(); deps.authenticate = vi.fn().mockRejectedValue(new ApiFailure('AUTH_EXPIRED', 401, '만료'));
    const response = await createHandler('account', deps)(request());
    expect(response.status).toBe(401); expect(deps.execute).not.toHaveBeenCalled();
  });
  it('rejects account ownership override and exposes only field names', async () => {
    const deps = dependencies(); const response = await createHandler('account', deps)(request({ ...body, userId: 'sensitive-victim-id' }));
    expect(response.status).toBe(400); expect(await response.text()).not.toContain('sensitive-victim-id'); expect(deps.execute).not.toHaveBeenCalled();
  });
  it('requires explicit DELETE confirmation', async () => {
    const deps = dependencies(); const response = await createHandler('account', deps)(request({ ...body, confirmation: 'yes' }));
    expect(response.status).toBe(400); expect(deps.execute).not.toHaveBeenCalled();
  });
  it('redacts unexpected backend errors from the response', async () => {
    const deps = dependencies(); deps.execute = vi.fn().mockRejectedValue(new Error('private prompt + service-role-key + DOB'));
    const response = await createHandler('account', deps)(request()); const text = await response.text();
    expect(response.status).toBe(500); expect(text).toContain('INTERNAL_ERROR'); expect(text).not.toContain('private'); expect(text).not.toContain('DOB');
  });
  it('rejects oversized streaming bodies regardless of a forged Content-Length', async () => {
    const deps = dependencies(); const response = await createHandler('account', deps)(request({ ...body, extra: 'a'.repeat(40_000) }, { 'Content-Length': '5' }));
    expect(response.status).toBe(400); expect(deps.execute).not.toHaveBeenCalled();
  });
  it('rejects a body that never finishes without waiting for its cancellation hook', async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn(() => new Promise<void>(() => {})); const deps = dependencies();
      const stream = new ReadableStream<Uint8Array>({ cancel });
      const pending = createHandler('account', deps)(new Request('https://edge.example/account', { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit));
      await vi.advanceTimersByTimeAsync(5_001);
      expect((await pending).status).toBe(408); expect(cancel).toHaveBeenCalled(); expect(deps.execute).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
