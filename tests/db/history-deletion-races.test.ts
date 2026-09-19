import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const owner = '50000000-0000-4000-8000-000000000001';
let db: PGlite;
let conversation: string;
async function scalar<T = unknown>(sql: string, values: unknown[] = []): Promise<T> {
  const result = await db.query<Record<string, T>>(sql, values);
  return Object.values(result.rows[0]!)[0]!;
}
async function rpc<T = unknown>(name: string, values: unknown[]) {
  return scalar<T>(`select public.${name}(${values.map((_, index) => `$${index + 1}`).join(',')})`, values);
}
async function deleteConsultation(id: string) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.exec('set role authenticated');
  try { return await rpc('delete_history_with_memories', ['CONSULTATION', id, []]); }
  finally { await db.exec('reset role'); }
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users(id uuid primary key,is_anonymous boolean default true,created_at timestamptz default now());
    create table auth.identities(user_id uuid references auth.users(id) on delete cascade,provider text);
    create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    grant usage on schema public,auth to anon,authenticated,service_role;`);
  // Audit-only switch preserves the pre-fix reproduction without changing the
  // expected behavior. Normal test runs always apply the full migration chain.
  const baseline014 = process.env.JUMZIP_HISTORY_BASELINE_014 === '1';
  for (const file of readdirSync(new URL('../../supabase/migrations/', import.meta.url)).filter(name => name.endsWith('.sql') && (!baseline014 || name.slice(0, 12) <= '202609190014')).sort()) {
    await db.exec(readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
}, 30_000);
beforeEach(async () => {
  await db.exec("reset role; select set_config('request.jwt.claim.sub','',false); truncate auth.users cascade;");
  await db.query('insert into auth.users(id) values($1)', [owner]);
  conversation = await scalar<string>("insert into conversations(user_id,character_id) values($1,'BOMI') returning id", [owner]);
});
afterAll(async () => { await db?.close(); });

describe('consultation deletion invalidates derived work and old request replays', () => {
  it('clears the derived summary and rejects a stale mixed-consultation extraction while preserving unselected independent memories', async () => {
    const makeConsultation = () => scalar<string>("insert into consultations(user_id,conversation_id,character_id,fortune_type) values($1,$2,'BOMI','CHAT') returning id", [owner, conversation]);
    const removed = await makeConsultation(), retained = await makeConsultation();
    await db.query("insert into messages(user_id,conversation_id,consultation_id,sender,content) values($1,$2,$3,'USER','은방울이라는 가상의 취미를 좋아해.')", [owner, conversation, removed]);
    // The extraction batch was read before deletion, but its terminal message
    // belongs to a different consultation that remains. Checking only that
    // terminal message exists cannot establish that every source still exists.
    const through = await scalar<string>("insert into messages(user_id,conversation_id,consultation_id,sender,content) values($1,$2,$3,'USER','오늘은 다른 이야기를 하자.') returning id", [owner, conversation, retained]);
    const independent = await scalar<string>("insert into memories(user_id,scope,category,subject,content,source_conversation_id) values($1,'GLOBAL','PREFERENCE','USER','사용자가 선택하지 않은 기존 기억',$2) returning id", [owner, conversation]);
    await db.query("update conversations set summary='삭제할 상담의 은방울 취미 이야기' where id=$1", [conversation]);
    const before = await rpc<{ revision: number }>('memory_context_state', [owner, conversation]);

    expect(await deleteConsultation(removed)).toEqual({ deleted: true, memoriesDeleted: 0 });
    expect.soft(await scalar('select summary from conversations where id=$1', [conversation])).toBeNull();
    expect(await scalar<number>('select count(*)::int from messages where id=$1', [through])).toBe(1);
    const staleCandidate = { scope: 'GLOBAL', subject: 'USER', category: 'PREFERENCE', content: '은방울이라는 가상의 취미를 좋아한다.', importance: 3, sensitivity: 'NORMAL' };
    const applied = await rpc('apply_memory_update', [owner, conversation, before.revision, through, [staleCandidate], '삭제된 은방울 취미를 담은 늦은 요약']);
    expect.soft(applied).toEqual({ applied: false, reason: 'CONTEXT_CHANGED' });
    expect.soft(await scalar('select summary from conversations where id=$1', [conversation])).toBeNull();
    expect.soft(await scalar<number>('select count(*)::int from memories where content=$1', [staleCandidate.content])).toBe(0);
    expect(await scalar<string>('select content from memories where id=$1', [independent])).toBe('사용자가 선택하지 않은 기존 기억');
  });

  it('returns typed NOT_FOUND when replaying a successful Chat UUID after its consultation was deleted', async () => {
    const params = { user_id: owner, operation: 'chat.SEND', request_id: crypto.randomUUID(), payload_hash: crypto.randomUUID(),
      conversation_id: conversation, message: '삭제할 상담의 합성 메시지', consultation_id: null };
    const begun = await rpc<{ executionId: string; consultationId: string }>('begin_chat_request', [params]);
    await rpc('complete_execution', [begun.executionId, '합성 답변', ['합성 답변'], 'test-model', 'test-prompt', {}]);
    expect(await deleteConsultation(begun.consultationId)).toEqual({ deleted: true, memoriesDeleted: 0 });
    expect(await scalar<number>('select count(*)::int from conversations where id=$1', [conversation])).toBe(1);
    // NOT_FOUND already maps to the canonical 404 API failure. Either a SQL
    // rejection or an explicit cached error is valid; success with null is not.
    const replay = async () => {
      const result = await rpc<{ replay?: { error?: { code: string } } }>('begin_chat_request', [params]);
      if (result.replay?.error) throw new Error(result.replay.error.code);
      return result;
    };
    await expect(replay()).rejects.toThrow('NOT_FOUND');
    expect(await scalar<number>('select count(*)::int from messages where conversation_id=$1', [conversation])).toBe(0);
  });

  it.each([
    ['PENDING', 'complete_execution'], ['PENDING', 'fail_execution'],
    ['SUCCEEDED', 'complete_execution'], ['SUCCEEDED', 'fail_execution'],
  ] as const)('rejects late %s %s with NOT_FOUND and does not mutate the deleted record state', async (initialStatus, operation) => {
    const params = { user_id: owner, operation: 'chat.SEND', request_id: crypto.randomUUID(), payload_hash: crypto.randomUUID(),
      conversation_id: conversation, message: '진행 중 삭제를 검증하는 합성 입력', consultation_id: null };
    const begun = await rpc<{ executionId: string; consultationId: string }>('begin_chat_request', [params]);
    if (initialStatus === 'SUCCEEDED') await rpc('complete_execution', [begun.executionId, '원래 합성 답변', ['원래 합성 답변'], 'test-model', 'test-prompt', {}]);
    expect(await deleteConsultation(begun.consultationId)).toEqual({ deleted: true, memoriesDeleted: 0 });
    const snapshot = () => scalar(`select jsonb_build_object(
      'executions',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from request_executions e),
      'messages',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]') from messages m),
      'consultations',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from consultations c),
      'conversations',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from conversations c),
      'profiles',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from profiles p),
      'memories',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]') from memories m))`);
    const before = await snapshot();
    let errorMessage: string | null = null;
    try {
      if (operation === 'complete_execution') await rpc(operation, [begun.executionId, '삭제 후 도착한 합성 답변', ['삭제 후 도착한 합성 답변'], 'test-model', 'test-prompt', {}]);
      else await rpc(operation, [begun.executionId, { code: 'LLM_TIMEOUT', message: '늦은 합성 실패', retryable: true }, 504]);
    } catch (error) { errorMessage = error instanceof Error ? error.message : null; }
    expect.soft(errorMessage).toBe('NOT_FOUND');
    expect(await snapshot()).toEqual(before);
  });

  it.each(['EXISTING_DRAW', 'RACING_SAVE'] as const)('keeps cross-conversation DAILY %s reuse completable and replayable under strict parent guards', async reusePath => {
    const otherConversation = await scalar<string>("insert into conversations(user_id,character_id) values($1,'SANI') returning id", [owner]);
    const daily = (conversationId: string) => ({ user_id: owner, operation: 'tarot.DRAW', request_id: crypto.randomUUID(), payload_hash: crypto.randomUUID(),
      conversation_id: conversationId, consultation_id: null, question: '합성 오늘의 카드', spread_type: 'ONE_CARD', mode: 'DAILY', local_date: '2026-09-20' });
    type Snapshot = { drawGroupId: string; consultationId: string; conversationId: string; cards: unknown[] };
    type Claim = { executionId: string; consultationId: string; resource?: Snapshot; replay?: { data: Snapshot } };
    const first = await rpc<Claim>('begin_fortune_request', [daily(conversation)]);
    const secondParams = daily(otherConversation);
    let second: Claim | undefined;
    if (reusePath === 'RACING_SAVE') second = await rpc<Claim>('begin_fortune_request', [secondParams]);
    const cards = [{ cardId: 17, orientation: 'UPRIGHT', positionIndex: 0, positionKey: 'PRESENT' }];
    const original = await rpc<Snapshot>('save_tarot_draw', [first.executionId, cards, 'ONE_CARD', 'DAILY', '2026-09-20', '합성 오늘의 카드', null]);
    if (!second) second = await rpc<Claim>('begin_fortune_request', [secondParams]);
    const reused = reusePath === 'RACING_SAVE'
      ? await rpc<Snapshot>('save_tarot_draw', [second.executionId, [{ ...cards[0], cardId: 0 }], 'ONE_CARD', 'DAILY', '2026-09-20', '합성 오늘의 카드', null])
      : second.resource!;
    expect(reused.drawGroupId).toBe(original.drawGroupId);
    const finished = await rpc<Snapshot>('complete_execution', [second.executionId, null, [], null, null, reused]);
    expect(finished.drawGroupId).toBe(original.drawGroupId);
    expect(finished.conversationId).toBe(conversation);
    expect(finished.cards).toEqual(original.cards);
    expect(await scalar('select conversation_id from request_executions where id=$1', [second.executionId])).toBe(conversation);
    const replayed = await rpc<Claim>('begin_fortune_request', [secondParams]);
    expect(replayed.replay?.data.drawGroupId).toBe(original.drawGroupId);
    expect(replayed.replay?.data.cards).toEqual(original.cards);
    expect(await scalar<number>('select count(*)::int from tarot_draw_groups where user_id=$1', [owner])).toBe(1);
    expect(await scalar<number>('select count(*)::int from tarot_draws where user_id=$1', [owner])).toBe(1);
  });

  it('applies the deletion boundary to a direct authenticated table DELETE as well as the selection RPC', async () => {
    const consultation = await scalar<string>("insert into consultations(user_id,conversation_id,character_id,fortune_type) values($1,$2,'BOMI','CHAT') returning id", [owner, conversation]);
    await db.query("update conversations set summary='직접 삭제할 상담의 요약' where id=$1", [conversation]);
    const before = await rpc<{ revision: number }>('memory_context_state', [owner, conversation]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec('set role authenticated');
    try { await db.query('delete from consultations where id=$1', [consultation]); }
    finally { await db.exec('reset role'); }
    const after = await rpc<{ revision: number; summary: string | null; summaryCursorAt: string | null; lastExtractedAt: string | null }>('memory_context_state', [owner, conversation]);
    expect.soft(after.revision).toBeGreaterThan(before.revision);
    expect.soft(after.summary).toBeNull();
    expect.soft(after.summaryCursorAt).not.toBeNull();
    expect(after.lastExtractedAt).not.toBeNull();
  });

  it.skipIf(process.env.JUMZIP_HISTORY_BASELINE_014 === '1')('backfills legacy orphan caches and their summary without deleting retained independent memories', async () => {
    const migration015 = readFileSync(new URL('../../supabase/migrations/202609190015_deleted_consultation_guards.sql', import.meta.url), 'utf8');
    try {
      // Restore only the previous deletion trigger implementation to generate
      // the actual pre-015 orphan shape, then apply the forward migration.
      await db.exec(readFileSync(new URL('../../supabase/migrations/202609190011_account_cascade.sql', import.meta.url), 'utf8'));
      const params = { user_id: owner, operation: 'chat.SEND', request_id: crypto.randomUUID(), payload_hash: crypto.randomUUID(), conversation_id: conversation, message: '이전 버전의 합성 상담' };
      const begun = await rpc<{ executionId: string; consultationId: string }>('begin_chat_request', [params]);
      await rpc('complete_execution', [begun.executionId, '이전 답변', ['이전 답변'], 'test-model', 'test-prompt', {}]);
      const memory = await scalar<string>("insert into memories(user_id,scope,category,subject,content,source_conversation_id) values($1,'GLOBAL','PREFERENCE','USER','보존할 독립 기억',$2) returning id", [owner, conversation]);
      await db.query("update conversations set summary='이전 버전에서 남은 삭제 상담 요약' where id=$1", [conversation]);
      await deleteConsultation(begun.consultationId);
      expect(await scalar('select status from request_executions where id=$1', [begun.executionId])).toBe('SUCCEEDED');
      expect(await scalar('select summary from conversations where id=$1', [conversation])).toBe('이전 버전에서 남은 삭제 상담 요약');
      const before = await rpc<{ revision: number }>('memory_context_state', [owner, conversation]);
      await db.exec(migration015);
      const after = await rpc<{ revision: number; summary: string | null }>('memory_context_state', [owner, conversation]);
      expect(after.revision).toBeGreaterThan(before.revision);
      expect(after.summary).toBeNull();
      const result = await db.query<{ status: string; http_status: number; error: { code: string; retryable: boolean }; response_data: unknown }>('select status,http_status,error,response_data from request_executions where id=$1', [begun.executionId]);
      expect(result.rows[0]).toMatchObject({ status: 'FAILED', http_status: 404, error: { code: 'NOT_FOUND', retryable: false }, response_data: null });
      expect(await scalar('select content from memories where id=$1', [memory])).toBe('보존할 독립 기억');
    } finally { await db.exec(migration015); }
  });
});
