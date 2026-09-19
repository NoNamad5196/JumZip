// Default is --plan. Hosted execution requires --run --expected-project-ref=<approved ref>
// and the caller's explicit --env-file=.env.server.local. Never prints credentials or fixtures.
import { createClient } from '@supabase/supabase-js';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chatRequestSchema, payloadHash } from '../../supabase/functions/_shared/validation/requests.ts';

const plan = {
  target: 'hosted', disposableAccounts: 1, maximumEdgeCalls: 2, modelCalls: 0,
  scenario: 'RPC-seeded successful Chat, owner consultation deletion, identical original SEND UUID submitted twice to the actual Chat Edge route.',
  authScope: 'Admin-created synthetic identity and generated magic-link verification; no public signup or CAPTCHA claim.',
  inferenceScope: 'Synthetic complete_execution seed is a persistence fixture, not an LLM response. Zero model calls follows the reviewed beginChat rejection before recommendation/generation/maintenance; remote provider usage is not directly metered.',
  cleanup: 'Immediate owner ledger, finally hard deletion, independent Auth404 and fifteen owned tables empty.',
};
if (!process.argv.includes('--run')) console.log(JSON.stringify(plan, null, 2));
else await live();

async function live() {
  const expected = process.argv.find(value => value.startsWith('--expected-project-ref='))?.slice(23);
  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY, secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!/^[a-z0-9]{20}$/.test(expected) || url !== `https://${expected}.supabase.co` || !anon || !secret) throw Error('HOSTED_TARGET_GUARD');
  // Main deployed this v4 stage with only three security orchestration overlays.
  // Hash the exact reviewed files; do not silently infer the deployed route from newer Persona source.
  const staged = 'supabase/.temp/edge-hotfix-v4-015/supabase/functions/_shared/';
  const route = readFileSync(`${staged}orchestration/execute.ts`, 'utf8');
  const validation = readFileSync(`${staged}validation/requests.ts`, 'utf8');
  if (validation.replaceAll('\r\n', '\n') !== readFileSync('supabase/functions/_shared/validation/requests.ts', 'utf8').replaceAll('\r\n', '\n')) throw Error('DEPLOYED_VALIDATION_DIFFERS');
  const chat = route.slice(route.indexOf('async function chat('), route.indexOf('async function tarot('));
  const ordered = ['await repo.beginChat(', 'const replay = replayResult(claim);', 'await repo.context(', 'dependencies.recommend?.(', 'await dependencies.generate(', 'dependencies.afterReply?.('].map(value => chat.indexOf(value));
  if (ordered.some((value, index) => value < 0 || index > 0 && value <= ordered[index - 1])) throw Error('REVIEWED_PREINFERENCE_ROUTE_CHANGED');
  const sourceProof = { reviewedStage: staged, executeSha256: hash(route), validationSha256: hash(validation), boundary: 'beginChat/replay precedes context, recommend, generate and afterReply', remoteProviderUsageMetered: false };

  let edgeCalls = 0, rpcCalls = 0, stage = 'SETUP', failure = null;
  const checks = [], responses = [], ids = new Set();
  const marker = 'JumZip deleted replay Edge smoke';
  const ledger = 'test-results/pending-deleted-replay-edge-cleanup.json';
  const tables = ['profiles', 'conversations', 'consultations', 'messages', 'tarot_draw_groups', 'tarot_draws', 'birth_profiles', 'saju_readings', 'saju_compatibility_readings', 'related_people', 'memories', 'memory_suppressions', 'request_executions', 'rate_limit_buckets', 'daily_draw_claims'];
  const safeFetch = (input, init) => {
    const destination = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (destination.origin !== url) throw Error('FOREIGN_DESTINATION_BLOCKED');
    if (destination.pathname === '/functions/v1/chat') {
      if (stage !== 'EDGE_REPLAY' || init?.method !== 'POST' || edgeCalls >= 2) throw Error('EDGE_BUDGET_OR_STAGE_GUARD');
      edgeCalls += 1;
    } else if (!/^\/(auth|rest)\/v1(?:\/|$)/.test(destination.pathname)) throw Error('UNAPPROVED_DESTINATION_BLOCKED');
    return fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) });
  };
  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: safeFetch } };
  const admin = createClient(url, secret, options);
  const check = (condition, name) => { checks.push({ name, passed: Boolean(condition) }); if (!condition) throw Error(name); console.log(`PASS ${name}`); };
  const writeLedger = () => { mkdirSync('test-results', { recursive: true }); writeFileSync(ledger, JSON.stringify({ target: url, marker, ids: [...ids] }, null, 2)); };
  const read = async query => { const result = await query; if (result.error) throw Error('SYNTHETIC_DATABASE_FAILURE'); return result.data; };
  const rpc = async (client, name, args) => { rpcCalls += 1; const result = await client.rpc(name, args); if (result.error) throw Error('SYNTHETIC_RPC_FAILURE'); return result.data; };
  async function cleanup(id) {
    const existing = await admin.auth.admin.getUserById(id);
    if (!existing.error) {
      if (existing.data.user?.user_metadata?.test_run !== marker || !/^jumzip-deleted-replay-[0-9a-f-]+@example\.com$/i.test(existing.data.user?.email ?? '')) return false;
      if ((await admin.auth.admin.deleteUser(id, false)).error) return false;
    } else if (existing.error.status !== 404) return false;
    const absent = await admin.auth.admin.getUserById(id);
    if (absent.data.user || absent.error?.status !== 404) return false;
    for (const table of tables) {
      const column = table === 'profiles' ? 'id' : 'user_id';
      const count = await admin.from(table).select(column, { head: true, count: 'exact' }).eq(column, id);
      if (count.error || count.count !== 0) return false;
    }
    ids.delete(id); writeLedger(); return true;
  }
  async function recordState(id) {
    const state = {};
    for (const table of ['conversations', 'consultations', 'messages', 'request_executions', 'rate_limit_buckets', 'memories']) {
      const rows = await read(admin.from(table).select('*').eq('user_id', id));
      state[table] = rows.map(stable).sort();
    }
    return hash(stable(state));
  }
  try {
    if (existsSync(ledger)) {
      const previous = JSON.parse(readFileSync(ledger, 'utf8'));
      if (previous.target !== url || previous.marker !== marker || !Array.isArray(previous.ids)) throw Error('CLEANUP_LEDGER_MISMATCH');
      for (const id of previous.ids) { if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw Error('CLEANUP_LEDGER_ID_INVALID'); ids.add(id); }
      for (const id of [...ids]) check(await cleanup(id), 'prior synthetic identity cleanup verified');
    }
    const email = `jumzip-deleted-replay-${randomUUID()}@example.com`;
    const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { test_run: marker } });
    if (created.error || !created.data.user) throw Error('SYNTHETIC_IDENTITY_FAILURE');
    const userId = created.data.user.id; ids.add(userId); writeLedger();
    const owner = createClient(url, anon, options);
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error || link.data.user?.id !== userId || !link.data.properties?.hashed_token) throw Error('SYNTHETIC_LINK_FAILURE');
    const session = await owner.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token });
    if (session.error || session.data.user?.id !== userId || !session.data.session) throw Error('SYNTHETIC_SESSION_FAILURE');
    await read(admin.from('profiles').update({ memory_enabled: false }).eq('id', userId));
    const conversation = await read(admin.from('conversations').insert({ user_id: userId, character_id: 'BOMI' }).select('id').single());
    const request = chatRequestSchema.parse({ schemaVersion: 1, requestId: randomUUID(), action: 'SEND', conversationId: conversation.id, consultationId: null, message: '삭제 경합 확인을 위한 가상 대화야.' });
    stage = 'RPC_SEED';
    const claim = await rpc(admin, 'begin_chat_request', { p_params: { user_id: userId, operation: 'chat.SEND', request_id: request.requestId, payload_hash: await payloadHash(request), conversation_id: request.conversationId, consultation_id: request.consultationId, message: request.message } });
    await rpc(admin, 'complete_execution', { p_execution_id: claim.executionId, p_assistant_content: '모델 응답이 아닌 RPC 저장 검사용 합성 문장', p_segments: ['모델 응답이 아닌 RPC 저장 검사용 합성 문장'], p_model_id: 'fixture-no-inference', p_prompt_version: 'fixture-no-inference', p_data: { executionStatus: 'SUCCEEDED' } });
    const success = await read(admin.from('request_executions').select('status,payload_hash').eq('id', claim.executionId).single());
    check(success.status === 'SUCCEEDED' && success.payload_hash === await payloadHash(request), 'owned RPC fixture is successful with the exact original request payload hash');
    const deleted = await rpc(owner, 'delete_history_with_memories', { p_kind: 'CONSULTATION', p_record_id: claim.consultationId, p_memory_ids: [] });
    const tombstone = await read(admin.from('request_executions').select('status,error,http_status,response_data').eq('id', claim.executionId).single());
    check(deleted.deleted && tombstone.status === 'FAILED' && tombstone.error?.code === 'NOT_FOUND' && tombstone.http_status === 404 && tombstone.response_data === null, 'deleted successful request has the authoritative NOT_FOUND tombstone before any Edge call');
    check((await read(admin.from('consultations').select('id').eq('id', claim.consultationId))).length === 0, 'original consultation is absent before inference entry');
    const baseline = await recordState(userId);
    stage = 'EDGE_REPLAY';
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await safeFetch(`${url}/functions/v1/chat`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: anon, authorization: `Bearer ${session.data.session.access_token}` }, body: JSON.stringify(request) });
      const body = await response.json();
      responses.push({ attempt, status: response.status, ok: body.ok, code: typeof body.error?.code === 'string' ? body.error.code : null, retryable: body.error?.retryable, requestIdMatches: body.meta?.requestId === request.requestId, schemaVersion: body.meta?.schemaVersion, hasData: Object.hasOwn(body, 'data') });
      check(response.status === 404 && body.ok === false && body.error?.code === 'NOT_FOUND' && body.error.retryable === false, `actual Edge replay ${attempt} returns HTTP404 NOT_FOUND and non-retryable error`);
      check(body.meta?.requestId === request.requestId && body.meta?.schemaVersion === 1 && !Object.hasOwn(body, 'data') && response.headers.get('cache-control') === 'no-store', `actual Edge replay ${attempt} preserves request envelope and returns no deleted result`);
      check(await recordState(userId) === baseline, `actual Edge replay ${attempt} creates no execution, message, rate charge or maintenance state`);
    }
  } catch (error) {
    failure = checks.findLast(item => !item.passed)?.name ?? (error instanceof Error && /^[A-Z_]{3,80}$/.test(error.message) ? error.message : 'SMOKE_TRANSPORT_OR_SETUP_FAILURE');
  } finally {
    for (const id of [...ids]) {
      let cleaned = false; try { cleaned = await cleanup(id); } catch { /* Recoverable ledger is retained. */ }
      checks.push({ name: 'synthetic Auth identity and fifteen owned tables independently absent', passed: cleaned });
      if (!cleaned) failure ??= 'DISPOSABLE_CLEANUP_PENDING';
    }
    const report = { at: new Date().toISOString(), ...plan, sourceProof, edgeCalls, rpcCalls, responses, checks, failedStage: failure ? stage : null, failure, pendingCleanupCount: ids.size, passed: !failure && checks.every(item => item.passed) };
    mkdirSync('docs/evidence', { recursive: true }); writeFileSync('docs/evidence/backend-deleted-replay-edge-hosted.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, checksPassed: checks.filter(item => item.passed).length, checksFailed: checks.filter(item => !item.passed).length, edgeCalls, rpcCalls, modelCalls: 0, pendingCleanupCount: ids.size, failure }));
    if (!report.passed) process.exitCode = 1;
  }
}
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function stable(value) { return JSON.stringify(value, function (_key, item) { return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item; }); }
