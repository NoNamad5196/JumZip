// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';

const http = vi.hoisted(() => ({ fetch: vi.fn(), urls: [] as URL[] }));
vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>();
  return { ...actual, createClient: (url: string, key: string) => actual.createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: http.fetch },
  }) };
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ownerA = id(9001), ownerB = id(9002), at = '2026-09-20T00:00:00.123456+00:00';
const memory = (n: number, owner = ownerA, createdAt = at) => ({ id: id(n), user_id: owner, created_at: createdAt,
  content: `합성 기억 ${n}`, scope: 'GLOBAL', character_id: null, category: 'PREFERENCE', subject: 'USER', disabled_at: null, importance: 1 });
const session = (owner: string, token = 'synthetic-only') => ({ user: { id: owner }, access_token: token } as Session);
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

/** Emulate server max_rows and evaluate the actual serialized keyset, not a
 * pre-arranged response sequence that would hide a missing cursor or owner filter. */
function page(url: URL, rows: ReturnType<typeof memory>[]) {
  const params = url.searchParams, owner = params.get('user_id')?.replace(/^eq\./, '');
  let result = rows.filter(row => !owner || row.user_id === owner);
  const cursor = params.get('or');
  if (cursor) {
    const found = /^\(created_at\.lt\."([^"]+)",and\(created_at\.eq\."\1",id\.lt\.([0-9a-f-]+)\)\)$/.exec(cursor);
    if (!found) throw Error('INVALID_SERIALIZED_MEMORY_CURSOR');
    result = result.filter(row => row.created_at < found[1] || row.created_at === found[1] && row.id < found[2]);
  }
  result.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  return result.slice(0, Math.min(1000, Number(params.get('limit') ?? 1000)));
}
beforeEach(() => {
  vi.resetModules(); vi.stubEnv('VITE_SUPABASE_URL', 'https://memory-pagination-fixture.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-fixture'); http.urls = []; http.fetch.mockReset();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('complete memory listing through the production service and Supabase query builder', () => {
  it('returns all1005 owned tied rows exactly once beyond max_rows and never includes foreign memories', async () => {
    const owned = Array.from({ length: 1005 }, (_, n) => memory(n + 1));
    const rows = [...owned, memory(2001, ownerB), memory(2002, ownerB), memory(2003, ownerB)];
    http.fetch.mockImplementation(async (input: string) => { const url = new URL(input); http.urls.push(url); return reply(page(url, rows)); });
    const { service } = await import('../../src/lib/service');
    vi.spyOn(service, 'getSession').mockResolvedValue(session(ownerA));
    const result = await service.listMemories();
    expect(result.map(row => row.id)).toEqual(owned.map(row => row.id).reverse());
    expect(new Set(result.map(row => row.id)).size).toBe(1005);
    expect(http.urls).toHaveLength(6);
    for (const url of http.urls) {
      expect(url.pathname).toBe('/rest/v1/memories'); expect(url.searchParams.get('user_id')).toBe(`eq.${ownerA}`);
      expect(url.searchParams.get('order')).toBe('created_at.desc,id.desc'); expect(url.searchParams.get('limit')).toBe('201');
    }
    expect(http.urls[1].searchParams.get('or')).toBe(`(created_at.lt."${at}",and(created_at.eq."${at}",id.lt.${id(806)}))`);
    expect(http.urls[5].searchParams.get('or')).toContain(`id.lt.${id(6)}`);
  });

  it('crosses timestamp groups while preserving microseconds and ID ordering', async () => {
    const newer = '2026-09-20T00:00:00.123457+00:00';
    const rows = Array.from({ length: 405 }, (_, n) => memory(n + 1, ownerA, n < 205 ? at : newer));
    http.fetch.mockImplementation(async (input: string) => { const url = new URL(input); http.urls.push(url); return reply(page(url, rows)); });
    const { service } = await import('../../src/lib/service'); vi.spyOn(service, 'getSession').mockResolvedValue(session(ownerA));
    const result = await service.listMemories();
    expect(result.map(row => row.id)).toEqual(rows.map(row => row.id).reverse());
    expect(http.urls).toHaveLength(3);
    expect(http.urls[1].searchParams.get('or')).toContain(`created_at.eq."${newer}"`);
    expect(http.urls[2].searchParams.get('or')).toContain(`created_at.eq."${at}"`);
  });

  it.each([0, 200])('terminates with %i rows without a phantom empty page', async count => {
    const rows = Array.from({ length: count }, (_, n) => memory(n + 1));
    http.fetch.mockImplementation(async (input: string) => reply(page(new URL(input), rows)));
    const { service } = await import('../../src/lib/service'); vi.spyOn(service, 'getSession').mockResolvedValue(session(ownerA));
    expect(await service.listMemories()).toHaveLength(count); expect(http.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([403, 500])('rejects the whole load instead of returning the first200 when page2 fails with %i', async status => {
    http.fetch.mockResolvedValueOnce(reply(Array.from({ length: 201 }, (_, n) => memory(300 - n))));
    http.fetch.mockResolvedValueOnce(reply({ code: 'XXFIXTURE', message: 'private upstream detail' }, status));
    const { service } = await import('../../src/lib/service'); vi.spyOn(service, 'getSession').mockResolvedValue(session(ownerA));
    await expect(service.listMemories()).rejects.toMatchObject({ code: 'XXFIXTURE' });
    expect(http.fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed page unavailable through the installed SDK503 retries and rejects without partial results', async () => {
    const retries: (string | null)[] = [];
    http.fetch.mockImplementation(async (input: string, init: RequestInit) => {
      const url = new URL(input); http.urls.push(url);
      if (http.urls.length === 1) return reply(Array.from({ length: 201 }, (_, n) => memory(300 - n)));
      retries.push(new Headers(init.headers).get('x-retry-count'));
      return new Response(JSON.stringify({ code: 'XXFIXTURE', message: 'persistent page failure' }), {
        status: 503, headers: { 'content-type': 'application/json', 'Retry-After': '0' },
      });
    });
    const { service } = await import('../../src/lib/service'); vi.spyOn(service, 'getSession').mockResolvedValue(session(ownerA));
    await expect(service.listMemories()).rejects.toMatchObject({ code: 'XXFIXTURE' });
    expect(retries).toEqual([null, '1', '2', '3']); expect(http.fetch).toHaveBeenCalledTimes(5);
    expect(new Set(http.urls.slice(1).map(url => url.href)).size).toBe(1);
  });

  it.each([ownerB, null])('rejects owner change/signout during page2 (%s), returning neither partial A nor mixed B', async nextOwner => {
    let current: Session | null = session(ownerA);
    http.fetch.mockImplementation(async (input: string) => {
      const url = new URL(input); http.urls.push(url);
      if (http.urls.length === 1) return reply(Array.from({ length: 201 }, (_, n) => memory(300 - n)));
      current = nextOwner ? session(nextOwner) : null;
      // New-token RLS would return no A rows; that must not be treated as successful completion.
      return reply([]);
    });
    const { service } = await import('../../src/lib/service'); vi.spyOn(service, 'getSession').mockImplementation(async () => current);
    await expect(service.listMemories()).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(http.urls).toHaveLength(2);
    expect(http.urls.every(url => url.searchParams.get('user_id') === `eq.${ownerA}`)).toBe(true);
  });

  it('checks the final short page too while accepting a refreshed token for the same UID', async () => {
    let current = session(ownerA);
    http.fetch.mockImplementationOnce(async () => { current = session(ownerA, 'refreshed'); return reply([memory(1)]); });
    const { service } = await import('../../src/lib/service'); vi.spyOn(service, 'getSession').mockImplementation(async () => current);
    expect(await service.listMemories()).toHaveLength(1);
    http.fetch.mockImplementationOnce(async () => { current = session(ownerB); return reply([memory(1)]); });
    await expect(service.listMemories()).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  });

  it('rejects before querying when no owner session exists', async () => {
    const { service } = await import('../../src/lib/service'); vi.spyOn(service, 'getSession').mockResolvedValue(null);
    await expect(service.listMemories()).rejects.toMatchObject({ code: 'UNAUTHORIZED' }); expect(http.fetch).not.toHaveBeenCalled();
  });
});
