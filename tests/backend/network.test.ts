import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoundedFetch } from '../../supabase/functions/_shared/http/network.ts';
import { authenticateCurrentUser } from '../../supabase/functions/_shared/http/runtime.ts';
import { inferenceTimeouts } from '../../supabase/functions/_shared/orchestration/execute.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

afterEach(() => vi.useRealTimers());
describe('bounded authoritative network calls', () => {
  it('preserves response status/body for Supabase error handling and bounds streamed bytes independently of Content-Length', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"message":"expired"}', { status: 401, headers: { 'Content-Type': 'application/json' } }));
    const response = await createBoundedFetch({ fetchImpl: fetcher })('https://auth.example/user');
    expect(response.status).toBe(401); expect(await response.json()).toEqual({ message: 'expired' });
    fetcher.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(6)); controller.enqueue(new Uint8Array(6)); controller.close(); } }), { headers: { 'Content-Length': '1' } }));
    await expect(createBoundedFetch({ fetchImpl: fetcher, maxBytes: 10 })('https://auth.example/user')).rejects.toThrow('NETWORK_RESPONSE_TOO_LARGE');
  });
  it('times out a response body even after headers arrive and does not wait for an uncooperative cancel callback', async () => {
    vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => {}));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const outcome = createBoundedFetch({ fetchImpl: fetcher, timeoutMs: 50 })('https://auth.example/user').catch(error => error);
    await vi.advanceTimersByTimeAsync(51);
    expect((await outcome).message).toBe('NETWORK_TIMEOUT'); expect(cancel).toHaveBeenCalled();
  });
  it('aborts the upstream request when headers never arrive', async () => {
    vi.useFakeTimers(); const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Promise<Response>(() => {}));
    const outcome = createBoundedFetch({ fetchImpl: fetcher, timeoutMs: 50 })('https://auth.example/user').catch(error => error);
    await vi.advanceTimersByTimeAsync(51);
    expect((await outcome).message).toBe('NETWORK_TIMEOUT'); expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });
  it('sanitizes unexpected transport errors before an SDK could log them', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('secret header, raw birth record, private URL'));
    await expect(createBoundedFetch({ fetchImpl: fetcher })('https://auth.example/user')).rejects.toThrow('NETWORK_UNAVAILABLE');
    const forged = new Error('NETWORK_TIMEOUT', { cause: 'private auth details' });
    fetcher.mockRejectedValue(forged);
    const error = await createBoundedFetch({ fetchImpl: fetcher })('https://auth.example/user').catch(value => value);
    expect(error.message).toBe('NETWORK_TIMEOUT'); expect(error).not.toBe(forged); expect(error.cause).toBeUndefined();
  });
});
describe('auth server verification and inference budget', () => {
  it('passes the actual token to getUser on every request and exposes only authoritative identity', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'verified-owner', is_anonymous: true, email: 'private@example.test' } }, error: null });
    const client = { auth: { getUser } } as unknown as SupabaseClient;
    expect(await authenticateCurrentUser(client, 'provided-jwt')).toEqual({ id: 'verified-owner', isAnonymous: true });
    await authenticateCurrentUser(client, 'provided-jwt'); expect(getUser).toHaveBeenCalledTimes(2); expect(getUser).toHaveBeenCalledWith('provided-jwt');
  });
  it('distinguishes an unavailable auth service from an expired/deleted account', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: { name: 'AuthApiError', status: 401, message: 'deleted account detail' } });
    const client = { auth: { getUser } } as unknown as SupabaseClient;
    await expect(authenticateCurrentUser(client, 'token')).rejects.toMatchObject({ code: 'AUTH_EXPIRED', status: 401 });
    for (const status of [0, 429, 503]) {
      getUser.mockResolvedValue({ data: { user: null }, error: { name: 'AuthApiError', status, message: 'private server detail' } });
      await expect(authenticateCurrentUser(client, 'token')).rejects.toMatchObject({ code: 'INTERNAL_ERROR', status: 503, retryable: true });
    }
  });
  it('reduces inference time after slower prior steps while reserving the final persistence budget', () => {
    expect(inferenceTimeouts(100_000, 0)).toEqual({ initialTimeoutMs: 60_000, repairTimeoutMs: 30_000 });
    const later = inferenceTimeouts(100_000, 40_000);
    expect(later.initialTimeoutMs + later.repairTimeoutMs).toBe(50_000);
    expect(() => inferenceTimeouts(100_000, 90_000)).toThrow();
  });
});
