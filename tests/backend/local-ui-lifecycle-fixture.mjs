import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const API_URL = 'http://127.0.0.1:54321';
const MARKER = 'JumZip local authenticated UI lifecycle';
const LEDGER = 'test-results/pending-local-ui-lifecycle-cleanup.json';
const TABLES = ['profiles', 'conversations', 'consultations', 'messages', 'tarot_draw_groups', 'tarot_draws', 'birth_profiles', 'saju_readings', 'saju_compatibility_readings', 'related_people', 'memories', 'memory_suppressions', 'request_executions', 'rate_limit_buckets', 'daily_draw_claims'];
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/** Only local synthetic identities. Sessions remain in callback memory, never in a
 * file/report; no admin client/key is returned to a browser or callback. Browser
 * callers must separately block model/Edge destinations and disable token traces. */
export async function withLocalUILifecycleFixture(run) {
  if (typeof run !== 'function') throw Error('FIXTURE_CALLBACK_REQUIRED');
  const runId = randomUUID();
  const status = spawnSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'json'], { encoding: 'utf8', windowsHide: true });
  if (status.status !== 0) throw Error('LOCAL_STATUS_UNAVAILABLE');
  let config;
  try { config = JSON.parse(status.stdout); } catch { throw Error('LOCAL_STATUS_INVALID'); }
  if (config.API_URL !== API_URL || !config.ANON_KEY || !config.SERVICE_ROLE_KEY) throw Error('LOCAL_TARGET_REQUIRED');
  const counts = { authRequests: 0, restRequests: 0, blockedDestinations: 0 };
  const localFetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== API_URL || !/^\/(auth|rest)\/v1(?:\/|$)/.test(url.pathname)) {
      counts.blockedDestinations += 1; throw Error('NONLOCAL_OR_EDGE_REQUEST_BLOCKED');
    }
    counts[url.pathname.startsWith('/auth/') ? 'authRequests' : 'restRequests'] += 1;
    return fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) });
  };
  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localFetch } };
  const admin = createClient(API_URL, config.SERVICE_ROLE_KEY, options);
  const pending = new Set();
  const cleanup = [];
  const ledger = () => { mkdirSync('test-results', { recursive: true }); writeFileSync(LEDGER, JSON.stringify({ target: API_URL, marker: MARKER, ids: [...pending] }, null, 2)); };
  const read = async query => { const result = await query; if (result.error) throw Error('LOCAL_FIXTURE_DATABASE_FAILED'); return result.data; };
  async function remove(id) {
    const found = await admin.auth.admin.getUserById(id);
    if (!found.error) {
      if (found.data.user?.user_metadata?.test_run !== MARKER || !/^jumzip-local-ui-[0-9a-f-]+@example\.com$/i.test(found.data.user?.email ?? '')) throw Error('CLEANUP_OWNERSHIP_GUARD');
      if ((await admin.auth.admin.deleteUser(id, false)).error) throw Error('LOCAL_FIXTURE_CLEANUP_FAILED');
    } else if (found.error.status !== 404) throw Error('LOCAL_FIXTURE_AUTH_LOOKUP_FAILED');
    const absent = await admin.auth.admin.getUserById(id);
    if (absent.data.user || absent.error?.status !== 404) throw Error('LOCAL_FIXTURE_AUTH_REMAINS');
    for (const table of TABLES) {
      const column = table === 'profiles' ? 'id' : 'user_id';
      const rows = await admin.from(table).select(column, { head: true, count: 'exact' }).eq(column, id);
      if (rows.error || rows.count !== 0) throw Error('LOCAL_FIXTURE_ROWS_REMAIN');
    }
    pending.delete(id); ledger(); cleanup.push({ authAbsent: true, emptyOwnedTables: TABLES.length });
  }
  async function identity(label) {
    const email = `jumzip-local-ui-${randomUUID()}@example.com`;
    const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { test_run: MARKER } });
    if (created.error || !created.data.user) throw Error('LOCAL_FIXTURE_IDENTITY_FAILED');
    const id = created.data.user.id; pending.add(id); ledger();
    await read(admin.from('profiles').update({ display_name: `검증${label}`, preferred_character: 'ARANG', memory_enabled: true }).eq('id', id));
    const client = createClient(API_URL, config.ANON_KEY, options);
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error || link.data.user?.id !== id || !link.data.properties?.hashed_token) throw Error('LOCAL_FIXTURE_LINK_FAILED');
    const verified = await client.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token });
    if (verified.error || verified.data.user?.id !== id || !verified.data.session) throw Error('LOCAL_FIXTURE_SESSION_FAILED');
    return { id, session: verified.data.session };
  }
  let result;
  let completed = false;
  let failure;
  let cleanupFailed = false;
  try {
    if (existsSync(LEDGER)) {
      const old = JSON.parse(readFileSync(LEDGER, 'utf8'));
      if (old.target !== API_URL || old.marker !== MARKER || !Array.isArray(old.ids) || old.ids.some(id => !UUID.test(id))) throw Error('CLEANUP_LEDGER_MISMATCH');
      old.ids.forEach(id => pending.add(id));
      for (const id of [...pending]) await remove(id);
    }
    const ownerA = await identity('가'), ownerB = await identity('나');
    const conversation = title => read(admin.from('conversations').insert({ user_id: ownerA.id, character_id: 'ARANG', title, title_custom: true }).select('id').single());
    const main = await conversation('실제 로컬 DB 상담 보존 확인');
    const disposable = await conversation('실제 로컬 DB 대화 삭제 확인');
    const consultation = async (conversationId, title) => {
      const row = await read(admin.from('consultations').insert({ user_id: ownerA.id, conversation_id: conversationId, character_id: 'ARANG', fortune_type: 'CHAT', title }).select('id').single());
      await read(admin.from('messages').insert({ user_id: ownerA.id, conversation_id: conversationId, consultation_id: row.id, sender: 'USER', content: `${title}: 합성 사용자 기록이며 모델 응답이 아닙니다.` }));
      return row.id;
    };
    const recordOnly = await consultation(main.id, '기록만 삭제할 상담');
    const selected = await consultation(main.id, '기억을 선택해 삭제할 상담');
    const sibling = await consultation(main.id, '남겨둘 형제 상담');
    const child = await consultation(disposable.id, '대화와 함께 삭제할 상담');
    const memory = async (conversationId, content) => (await read(admin.from('memories').insert({ user_id: ownerA.id, source_conversation_id: conversationId, scope: 'GLOBAL', subject: 'USER', category: 'PREFERENCE', content }).select('id').single())).id;
    const keep = await memory(main.id, '소나무 산책이라는 합성 취향은 보존합니다.');
    const removeSelected = await memory(main.id, '별빛 도예라는 합성 취향은 선택 삭제합니다.');
    const keepIndependent = await memory(disposable.id, '해솔 그림이라는 독립 합성 기억은 보존합니다.');
    const removeWithConversation = await memory(disposable.id, '달빛 공예라는 합성 기억은 대화와 함께 선택 삭제합니다.');
    const ids = { ownerA: ownerA.id, ownerB: ownerB.id, conversation: main.id, disposableConversation: disposable.id, recordOnly, selected, sibling, child,
      memories: { keep, removeSelected, keepIndependent, removeWithConversation } };
    const inspectOwner = async label => {
      const id = label === 'A' ? ownerA.id : label === 'B' ? ownerB.id : null;
      if (!id) throw Error('UNKNOWN_FIXTURE_OWNER');
      const state = {};
      for (const table of ['conversations', 'consultations', 'messages', 'memories']) state[table] = await read(admin.from(table).select(table === 'memories' ? 'id,content,source_conversation_id' : 'id').eq('user_id', id).order('id'));
      return state;
    };
    result = await run({ apiUrl: API_URL, anonKey: config.ANON_KEY, sessions: { A: ownerA.session, B: ownerB.session }, ids, inspectOwner });
    completed = true;
  } catch (error) {
    failure = error;
  } finally {
    for (const id of [...pending]) { try { await remove(id); } catch { cleanupFailed = true; } }
    const report = { runId, at: new Date().toISOString(), scope: 'LOCAL_SYNTHETIC_UI_FIXTURE_SETUP_AND_CLEANUP', callbackCompleted: completed, counts, cleanup, pendingCleanupCount: pending.size,
      credentialsPersisted: false, publicSignupTested: false, fixtureModelRequests: 0, browserModelRequests: 'Caller must record its separate network guard.' };
    mkdirSync('test-results/local-ui-lifecycle-runs', { recursive: true });
    writeFileSync(`test-results/local-ui-lifecycle-runs/${runId}.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    writeFileSync('test-results/local-ui-lifecycle-fixture-report.json', JSON.stringify(report, null, 2) + '\n');
  }
  if (cleanupFailed || pending.size) throw Error('LOCAL_UI_FIXTURE_CLEANUP_INCOMPLETE');
  if (failure) throw failure;
  return result;
}
