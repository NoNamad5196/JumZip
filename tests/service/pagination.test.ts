// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ fetch: vi.fn(), urls: [] as URL[] }));
vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>();
  return { ...actual, createClient: (url: string, key: string) => actual.createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: http.fetch },
  }) };
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-20T00:00:00.123456+00:00';
const row = (n: number) => ({ id: id(n), created_at: at, content: `message ${n}` });
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://pagination-fixture.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-fixture');
  http.urls = []; http.fetch.mockReset();
  http.fetch.mockImplementation(async (input: string) => { http.urls.push(new URL(input)); return reply([]); });
});
afterEach(() => vi.unstubAllEnvs());

describe('history continuation through the real Supabase query builder', () => {
  it('loads every deletion candidate with stable microsecond cursors and the same owner-scoped RPC arguments', async () => {
    let upper = 205;
    const bodies: unknown[] = [];
    http.fetch.mockImplementation(async (input: string, init: RequestInit) => {
      http.urls.push(new URL(input)); bodies.push(JSON.parse(String(init.body)));
      const rows = Array.from({ length: Math.min(201, upper) }, (_, i) => row(upper - i));
      upper -= Math.min(200, upper); return reply(rows);
    });
    const { service } = await import('../../src/lib/service');
    const memories = await service.getDeletionMemories('CONSULTATION', id(30));
    expect(memories).toHaveLength(205);
    expect(new Set(memories.map(memory => memory.id)).size).toBe(205);
    expect(bodies).toEqual(Array(2).fill({ p_kind: 'CONSULTATION', p_record_id: id(30) }));
    expect(http.urls.every(url => url.pathname.endsWith('/rpc/history_deletion_memories'))).toBe(true);
    expect(http.urls[1].searchParams.get('or')).toContain(`created_at.eq."${at}"`);
    expect(http.urls[1].searchParams.get('or')).toContain(`id.lt.${id(6)}`);
  });
  it('rejects a partial deletion preview if a later page fails', async () => {
    http.fetch.mockResolvedValueOnce(reply(Array.from({ length: 201 }, (_, i) => row(201 - i))));
    http.fetch.mockResolvedValueOnce(reply({ code: '42501', message: 'denied' }, 403));
    const { service } = await import('../../src/lib/service');
    await expect(service.getDeletionMemories('CONVERSATION', id(30))).rejects.toMatchObject({ code: '42501' });
  });
  it('sends one atomic deletion request with only explicit memory IDs and defaults to preserving memories', async () => {
    const bodies: unknown[] = [];
    http.fetch.mockImplementation(async (input: string, init: RequestInit) => {
      http.urls.push(new URL(input)); bodies.push(JSON.parse(String(init.body)));
      return reply({ deleted: true, memoriesDeleted: 0 });
    });
    const { service } = await import('../../src/lib/service');
    await service.deleteReading(id(30), { memoryIds: [id(1)] });
    await service.deleteConversation(id(40));
    expect(bodies).toEqual([
      { p_kind: 'CONSULTATION', p_record_id: id(30), p_memory_ids: [id(1)] },
      { p_kind: 'CONVERSATION', p_record_id: id(40), p_memory_ids: [] },
    ]);
    expect(http.urls.every(url => url.pathname.endsWith('/rpc/delete_history_with_memories'))).toBe(true);
  });
  it('keeps microseconds and an ID tie-break while displaying each older message page chronologically', async () => {
    http.fetch.mockImplementationOnce(async (input: string) => { http.urls.push(new URL(input)); return reply([row(4), row(3), row(2)]); });
    const { service } = await import('../../src/lib/service');
    const first = await service.listMessagesPage(id(10), null, 2);
    expect(first.items.map((item) => item.id)).toEqual([id(3), id(4)]);
    expect(first.nextCursor).toEqual({ createdAt: at, id: id(3) });
    await service.listMessagesPage(id(10), first.nextCursor, 2);
    const params = http.urls[1].searchParams;
    expect(params.get('conversation_id')).toBe(`eq.${id(10)}`);
    expect(params.get('order')).toBe('created_at.desc,id.desc');
    expect(params.get('or')).toBe(`(created_at.lt."${at}",and(created_at.eq."${at}",id.lt.${id(3)}))`);
    expect(params.get('limit')).toBe('3');
  });
  it('continues into and through conversations without a last message', async () => {
    const { service } = await import('../../src/lib/service');
    await service.listConversationsPage({ lastMessageAt: at, id: id(20) });
    expect(http.urls[0].searchParams.get('or')).toContain('last_message_at.is.null');
    expect(http.urls[0].searchParams.get('order')).toBe('last_message_at.desc.nullslast,id.desc');
    await service.listConversationsPage({ lastMessageAt: null, id: id(10) });
    expect(http.urls[1].searchParams.get('last_message_at')).toBe('is.null');
    expect(http.urls[1].searchParams.get('id')).toBe(`lt.${id(10)}`);
    expect(http.urls[1].searchParams.has('or')).toBe(false);
  });
  it('combines literal search and type with the cursor instead of searching only the loaded page', async () => {
    const { service } = await import('../../src/lib/service');
    await service.listReadingsPage({ cursor: { createdAt: at, id: id(5) }, fortuneType: 'TAROT', search: 'A,B (100%)_".*\\' });
    const params = http.urls[0].searchParams;
    expect(params.get('fortune_type')).toBe('eq.TAROT');
    expect(params.getAll('or')).toHaveLength(1);
    const filter = params.get('or')!;
    expect(filter.startsWith('(and(or(created_at.lt.')).toBe(true);
    expect(filter).toContain('or(title.imatch."');
    expect(filter).toContain('result_summary.imatch."');
    expect(filter).toContain('A,B ');
    expect(filter).toContain('\\"');
    expect(filter).toContain('\\\\(');
    expect(filter).toContain('\\\\.\\\\*');
  });
  it('loads every consultation message beyond the former 1,000-row cutoff for detail/export', async () => {
    let upper = 1005;
    http.fetch.mockImplementation(async (input: string) => {
      const url = new URL(input); http.urls.push(url);
      const rows = Array.from({ length: Math.min(201, upper) }, (_, i) => row(upper - i));
      upper -= Math.min(200, upper);
      return reply(rows);
    });
    const { service } = await import('../../src/lib/service');
    const messages = await service.listConsultationMessages(id(30));
    expect(messages).toHaveLength(1005);
    expect(new Set(messages.map((message) => message.id)).size).toBe(1005);
    expect(messages[0].id).toBe(id(1)); expect(messages.at(-1)!.id).toBe(id(1005));
    expect(http.urls).toHaveLength(6);
    expect(http.urls.every((url) => url.searchParams.get('consultation_id') === `eq.${id(30)}`)).toBe(true);
  });
  it('does not return a successful truncated export if a later page fails', async () => {
    http.fetch.mockResolvedValueOnce(reply(Array.from({ length: 201 }, (_, i) => row(201 - i))));
    http.fetch.mockResolvedValueOnce(reply({ code: '42501', message: 'denied' }, 403));
    const { service } = await import('../../src/lib/service');
    await expect(service.listConsultationMessages(id(30))).rejects.toMatchObject({ code: '42501' });
  });
  it('rejects malformed cursor filters before sending a request and caps page size below the server row limit', async () => {
    const { service } = await import('../../src/lib/service');
    await expect(service.listMessagesPage(id(10), { createdAt: at, id: 'x),id.neq.x' })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(service.listMessagesPage(id(10), { createdAt: 'bad', id: id(2) })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    expect(http.fetch).not.toHaveBeenCalled();
    const page = await service.listReadingsPage({ pageSize: 5000 });
    expect(http.urls[0].searchParams.get('limit')).toBe('201');
    expect(page).toEqual({ items: [], nextCursor: null });
  });
});
