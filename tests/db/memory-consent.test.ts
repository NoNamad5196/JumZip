import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const owner = '30000000-0000-4000-8000-000000000001';
let db: PGlite;
let conversation: string;
async function scalar<T = unknown>(sql: string, values: unknown[] = []): Promise<T> {
  const result = await db.query<Record<string, T>>(sql, values);
  return Object.values(result.rows[0]!)[0]!;
}
async function state() {
  return scalar<{ memoryEnabled: boolean; revision: number; summary: string | null; summaryCursorAt: string | null; lastExtractedAt: string | null;
    lastExtractedMessageId: string | null; suppressions: { scope: string; subject: string }[]; allowedRelatedPeople: { id: string; alias: string }[]; blockedRelatedPeople: { id: string; alias: string }[] }>(
    'select memory_context_state($1,$2)', [owner, conversation]);
}
const person = (consent: boolean) => scalar<string>('insert into related_people(user_id,display_name,memory_opt_in) values($1,$2,$3) returning id', [owner, '솔새', consent]);
// Synthetic test sources have explicit wide timestamp separation from consent changes.
const message = (age: 'old' | 'fresh') => scalar<string>(`insert into messages(user_id,conversation_id,sender,content,created_at) values($1,$2,'USER','합성 기억 원문',now()+interval '${age === 'old' ? '-1 hour' : '1 second'}') returning id`, [owner, conversation]);
const candidate = (subject: string) => ({ scope: 'GLOBAL', category: 'PREFERENCE', subject, content: '종이접기를 좋아한다.', importance: 3, sensitivity: 'NORMAL' });
const apply = (revision: number, through: string, subject: string) => scalar<{ applied: boolean; inserted?: number; reason?: string }>(
  'select apply_memory_update($1,$2,$3,$4,$5,$6)', [owner, conversation, revision, through, [candidate(subject)], '다시 들어오면 안 되는 이전 요약']);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users(id uuid primary key,is_anonymous boolean default true,created_at timestamptz default now());
    create table auth.identities(user_id uuid references auth.users(id) on delete cascade,provider text);
    create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    grant usage on schema public,auth to anon,authenticated,service_role;`);
  for (const file of readdirSync(new URL('../../supabase/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
}, 30_000);
beforeEach(async () => {
  await db.exec('reset role; truncate auth.users cascade;');
  await db.query('insert into auth.users(id) values($1)', [owner]);
  conversation = await scalar<string>("insert into conversations(user_id,character_id) values($1,'BOMI') returning id", [owner]);
});
afterAll(async () => { await db?.close(); });

describe('forward-only memory consent persistence', () => {
  it('sets matching extraction and summary floors on OFF and ON, excluding disabled-period source', async () => {
    const old = await message('old');
    await db.query('update conversations set summary=$1 where id=$2', ['과거 요약', conversation]);
    await db.query('update profiles set memory_enabled=false where id=$1', [owner]);
    const off = await state();
    expect(off).toMatchObject({ memoryEnabled: false, summary: null, lastExtractedMessageId: null });
    expect(off.summaryCursorAt).toBeTruthy(); expect(off.summaryCursorAt).toBe(off.lastExtractedAt);
    const disabled = await scalar<string>("insert into messages(user_id,conversation_id,sender,content) values($1,$2,'USER','기억을 꺼둔 동안의 원문') returning id", [owner, conversation]);
    await db.query('update profiles set memory_enabled=true where id=$1', [owner]);
    const on = await state();
    expect(on.revision).toBeGreaterThan(off.revision);
    expect(on.summaryCursorAt).toBe(on.lastExtractedAt); expect(on.summary).toBeNull();
    const fresh = await message('fresh');
    const eligible = (await db.query<{ id: string }>('select id from messages where conversation_id=$1 and created_at>$2', [conversation, on.summaryCursorAt])).rows.map(row => row.id);
    expect(eligible).toEqual([fresh]); expect(eligible).not.toContain(old); expect(eligible).not.toContain(disabled);
    expect((await apply(off.revision, fresh, 'USER')).reason).toBe('CONTEXT_CHANGED');
    expect((await apply(on.revision, old, 'USER')).reason).toBe('ALREADY_PROCESSED');
  });
  it('records withdrawal without any extracted memory, rejects stale work and prevents summary revival', async () => {
    const related = await person(true);
    const before = await state();
    expect(await scalar('select count(*)::int from memories')).toBe(0);
    await db.query('update related_people set memory_opt_in=false where id=$1', [related]);
    const after = await state();
    expect(after.suppressions).toContainEqual({ scope: 'GLOBAL', characterId: null, subject: `RELATED_PERSON:${related}` });
    expect(after.blockedRelatedPeople).toEqual([{ id: related, alias: '솔새' }]); expect(after.allowedRelatedPeople).toEqual([]);
    expect(after.summaryCursorAt).toBe(after.lastExtractedAt); expect(after.summaryCursorAt).toBeTruthy();
    const fresh = await message('fresh');
    expect((await apply(before.revision, fresh, `RELATED_PERSON:${related}`)).reason).toBe('CONTEXT_CHANGED');
    expect((await apply(after.revision, fresh, `RELATED_PERSON:${related}`)).inserted).toBe(0);
    expect((await state()).summary).toBeNull(); expect(await scalar('select count(*)::int from memories')).toBe(0);
  });
  it('invalidates old alias snapshots and advances both floors without creating a withdrawal', async () => {
    const related = await person(true), before = await state();
    await db.query('update conversations set summary=$1 where id=$2', ['솔새와의 이전 이야기', conversation]);
    await db.query('update related_people set display_name=$1 where id=$2', ['물새', related]);
    const after = await state();
    expect(after.allowedRelatedPeople).toEqual([{ id: related, alias: '물새' }]); expect(after.summary).toBeNull();
    expect(after.summaryCursorAt).toBe(after.lastExtractedAt); expect(after.suppressions).toEqual([]);
    expect((await apply(before.revision, await message('fresh'), `RELATED_PERSON:${related}`)).reason).toBe('CONTEXT_CHANGED');
  });
  it('invalidates existing summaries on initially blocked person creation without blocking future opt-in', async () => {
    await db.query('update conversations set summary=$1 where id=$2', ['솔새가 포함된 기존 요약', conversation]);
    const before = await state(), related = await person(false), created = await state();
    expect(created.revision).toBeGreaterThan(before.revision); expect(created.summary).toBeNull();
    expect(created.blockedRelatedPeople).toEqual([{ id: related, alias: '솔새' }]); expect(created.suppressions).toEqual([]);
    expect(created.summaryCursorAt).toBe(created.lastExtractedAt); expect(created.summaryCursorAt).toBeTruthy();
    await db.query('update related_people set memory_opt_in=true where id=$1', [related]);
    const enabled = await state();
    expect(enabled.revision).toBeGreaterThan(created.revision); expect(enabled.suppressions).toEqual([]);
    expect(enabled.blockedRelatedPeople).toEqual([]);
    expect((await apply(enabled.revision, await message('fresh'), `RELATED_PERSON:${related}`)).inserted).toBe(1);
  });
  it('deleting a zero-memory related person leaves a content-free suppression', async () => {
    const related = await person(false);
    await db.query('delete from related_people where id=$1', [related]);
    const after = await state();
    expect(after.suppressions).toHaveLength(1); expect(after.suppressions[0]!.subject).toBe(`RELATED_PERSON:${related}`);
    expect(await scalar('select count(*)::int from memories')).toBe(0);
    expect(after.blockedRelatedPeople).toEqual([]); expect(after.summaryCursorAt).toBeTruthy();
  });
  it.each(['DELETE', 'RENAME', 'ENABLE'] as const)('retires only old blocked-alias derived rows on %s, preserving unrelated USER memory and raw chat', async operation => {
    const related = await person(false);
    await db.query('update related_people set display_name=$1 where id=$2', ['ＳＯＬ', related]);
    const matched = await scalar<string>("insert into memories(user_id,scope,category,subject,content) values($1,'GLOBAL','PREFERENCE','USER',$2) returning id", [owner, 'sol 취미는 종이접기다.']);
    const untouched = await scalar<string>("insert into memories(user_id,scope,category,subject,content) values($1,'GLOBAL','PREFERENCE','USER',$2) returning id", [owner, '사용자는 짧은 답을 선호한다.']);
    const raw = await scalar<string>("insert into messages(user_id,conversation_id,sender,content) values($1,$2,'USER',$3) returning id", [owner, conversation, 'sol과 나눈 원래 대화는 보존한다.']);
    if (operation === 'DELETE') await db.query('delete from related_people where id=$1', [related]);
    else if (operation === 'RENAME') await db.query('update related_people set display_name=$1 where id=$2', ['다른 별칭', related]);
    else await db.query('update related_people set memory_opt_in=true where id=$1', [related]);
    const retained = (await db.query<{ id: string }>('select id from memories where user_id=$1', [owner])).rows.map(row => row.id);
    expect(retained).not.toContain(matched); expect(retained).toContain(untouched);
    expect(await scalar('select content from messages where id=$1', [raw])).toBe('sol과 나눈 원래 대화는 보존한다.');
    expect((await state()).suppressions.some(suppression => suppression.scope === 'GLOBAL' && suppression.subject === 'USER')).toBe(true);
  });
  it('account cascade never recreates a withdrawal tombstone after Auth deletion', async () => {
    await person(false); await person(true);
    await db.query('delete from auth.users where id=$1', [owner]);
    for (const table of ['related_people', 'memories', 'memory_suppressions', 'conversations']) expect(await scalar(`select count(*)::int from ${table}`)).toBe(0);
    expect(await scalar('select count(*)::int from profiles')).toBe(0);
  });
});
