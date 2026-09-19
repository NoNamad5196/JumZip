// --plan is the default. Execution requires an explicit --target=local|hosted --run.
// Hosted execution additionally requires the private server env and an explicit expected project ref.
import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const target = process.argv.find(value => value.startsWith('--target='))?.slice(9);
const plan = { target: target ?? 'explicit target required for execution', disposableAccounts: 1, modelCalls: 0, edgeCalls: 0,
  scenarios: ['record-only consultation deletion clears summary and rejects stale mixed-batch memory writes while preserving existing independent memory',
    'completed Chat UUID replay returns NOT_FOUND after consultation deletion', 'pending and completed late complete/fail callbacks return NOT_FOUND with unchanged database state',
    'cross-conversation DAILY reuse at begin-time and save-time retains one draw and remains completable/replayable'],
  authScope: 'Privileged synthetic admin-created identity plus generated magic-link verification; not public signup/CAPTCHA evidence.',
  dataScope: 'Only synthetic fixtures. The synthetic complete_execution calls test persistence; no generated text is represented as a model response.',
  cleanup: 'Immediate target-bound ledger, finally deletion, Auth404 plus fifteen owned tables independently checked empty.' };
if (!process.argv.includes('--run')) console.log(JSON.stringify(plan, null, 2));
else await live();

async function live() {
  if (!['local', 'hosted'].includes(target)) throw Error('EXPLICIT_TARGET_REQUIRED');
  let url, anon, secret;
  if (target === 'local') {
    const status = spawnSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'json'], { encoding: 'utf8', windowsHide: true });
    if (status.status !== 0) throw Error('LOCAL_STATUS_FAILED');
    const values = JSON.parse(status.stdout);
    if (values.API_URL !== 'http://127.0.0.1:54321') throw Error('LOCAL_TARGET_GUARD');
    url = values.API_URL; anon = values.ANON_KEY; secret = values.SERVICE_ROLE_KEY;
  } else {
    url = process.env.SUPABASE_URL; anon = process.env.SUPABASE_ANON_KEY; secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const linked = process.argv.find(value => value.startsWith('--expected-project-ref='))?.slice(23);
    if (!/^[a-z0-9]{20}$/.test(linked) || url !== `https://${linked}.supabase.co`) throw Error('HOSTED_TARGET_GUARD');
  }
  if (!url || !anon || !secret) throw Error('PRIVATE_CONFIGURATION_REQUIRED');
  const safeFetch = (input, init) => {
    const destination = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (destination.origin !== url || !/^\/(auth|rest)\/v1(?:\/|$)/.test(destination.pathname)) throw Error('EDGE_MODEL_OR_OTHER_DESTINATION_BLOCKED');
    return fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) });
  };
  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: safeFetch } };
  const admin = createClient(url, secret, options), ids = new Set(), checks = [], observations = [];
  const marker = 'JumZip deletion guard smoke';
  const ledger = `test-results/pending-deletion-guards-${target}-cleanup.json`;
  const tables = ['profiles', 'conversations', 'consultations', 'messages', 'tarot_draw_groups', 'tarot_draws', 'birth_profiles', 'saju_readings', 'saju_compatibility_readings', 'related_people', 'memories', 'memory_suppressions', 'request_executions', 'rate_limit_buckets', 'daily_draw_claims'];
  let stage = 'SETUP', failure = null, rpcCalls = 0;
  const check = (condition, name) => { checks.push({ name, passed: Boolean(condition) }); if (!condition) throw Error(name); console.log(`PASS ${name}`); };
  const writeLedger = () => { mkdirSync('test-results', { recursive: true }); writeFileSync(ledger, JSON.stringify({ target: url, marker, ids: [...ids] }, null, 2)); };
  const read = async query => { const result = await query; if (result.error) throw Error('SYNTHETIC_DATABASE_SETUP_FAILED'); return result.data; };
  const rpc = async (client, name, args) => { rpcCalls += 1; const result = await client.rpc(name, args); if (result.error) throw Error('RPC_UNEXPECTED_FAILURE'); return result.data; };
  const deniedRpc = async (name, args, label) => {
    rpcCalls += 1; const result = await admin.rpc(name, args);
    check(result.error?.code === 'P0001' && result.error.message === 'NOT_FOUND', label);
  };
  const stable = value => JSON.stringify(value, function (_key, item) { return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item; });
  async function stateHash(id) {
    const state = {};
    for (const table of ['profiles', 'conversations', 'consultations', 'messages', 'request_executions', 'memories']) {
      state[table] = await read(admin.from(table).select('*').eq(table === 'profiles' ? 'id' : 'user_id', id).order('id'));
    }
    return createHash('sha256').update(stable(state)).digest('hex');
  }
  async function cleanup(id) {
    const found = await admin.auth.admin.getUserById(id);
    if (!found.error) {
      if (found.data.user?.user_metadata?.test_run !== marker || !/^jumzip-deletion-guards-[0-9a-f-]+@example\.com$/i.test(found.data.user?.email ?? '')) return false;
      if ((await admin.auth.admin.deleteUser(id, false)).error) return false;
    } else if (found.error.status !== 404) return false;
    const absent = await admin.auth.admin.getUserById(id);
    if (absent.data.user || absent.error?.status !== 404) return false;
    for (const table of tables) {
      const column = table === 'profiles' ? 'id' : 'user_id';
      const rows = await admin.from(table).select(column, { head: true, count: 'exact' }).eq(column, id);
      if (rows.error || rows.count !== 0) return false;
    }
    ids.delete(id); writeLedger(); return true;
  }
  async function identity() {
    const email = `jumzip-deletion-guards-${randomUUID()}@example.com`;
    const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { test_run: marker } });
    if (created.error || !created.data.user) throw Error('SYNTHETIC_IDENTITY_FAILED');
    const id = created.data.user.id; ids.add(id); writeLedger();
    const client = createClient(url, anon, options);
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error || link.data.user?.id !== id || !link.data.properties?.hashed_token) throw Error('SYNTHETIC_LINK_FAILED');
    const verified = await client.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token });
    if (verified.error || verified.data.user?.id !== id || !verified.data.session) throw Error('SYNTHETIC_SESSION_FAILED');
    return { id, client };
  }
  try {
    if (existsSync(ledger)) {
      const previous = JSON.parse(readFileSync(ledger, 'utf8'));
      if (previous.target !== url || previous.marker !== marker || !Array.isArray(previous.ids)) throw Error('CLEANUP_LEDGER_TARGET_MISMATCH');
      for (const id of previous.ids) { if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw Error('CLEANUP_LEDGER_ID_INVALID'); ids.add(id); }
      for (const id of [...ids]) check(await cleanup(id), 'previous disposable identity and rows cleanup verified');
    }
    const owner = await identity();
    const makeConversation = async character => read(owner.client.from('conversations').insert({ user_id: owner.id, character_id: character }).select('id').single());
    const conversation = await makeConversation('BOMI');
    const makeConsultation = async () => read(admin.from('consultations').insert({ user_id: owner.id, conversation_id: conversation.id, character_id: 'BOMI', fortune_type: 'CHAT' }).select('id').single());
    const remove = id => rpc(owner.client, 'delete_history_with_memories', { p_kind: 'CONSULTATION', p_record_id: id, p_memory_ids: [] });
    stage = 'MIXED_BATCH';
    const removed = await makeConsultation(), retained = await makeConsultation();
    await read(admin.from('messages').insert({ user_id: owner.id, conversation_id: conversation.id, consultation_id: removed.id, sender: 'USER', content: '은방울이라는 가상의 취미를 좋아해.' }));
    const through = await read(admin.from('messages').insert({ user_id: owner.id, conversation_id: conversation.id, consultation_id: retained.id, sender: 'USER', content: '이제 다른 이야기를 하자.' }).select('id').single());
    const memory = await read(admin.from('memories').insert({ user_id: owner.id, scope: 'GLOBAL', subject: 'USER', category: 'PREFERENCE', content: '유지할 독립 합성 기억', source_conversation_id: conversation.id }).select('id').single());
    await read(admin.from('conversations').update({ summary: '삭제될 상담의 합성 요약' }).eq('id', conversation.id));
    const before = await rpc(admin, 'memory_context_state', { p_user_id: owner.id, p_conversation_id: conversation.id });
    const deleted = await remove(removed.id);
    check(deleted.deleted && deleted.memoriesDeleted === 0, 'record-only consultation deletion preserves explicit empty memory selection');
    const after = await rpc(admin, 'memory_context_state', { p_user_id: owner.id, p_conversation_id: conversation.id });
    check(after.summary === null && after.revision > before.revision && after.summaryCursorAt && after.lastExtractedAt, 'deletion clears derived summary and advances privacy revision and both source floors');
    const applied = await rpc(admin, 'apply_memory_update', { p_user_id: owner.id, p_conversation_id: conversation.id, p_expected_revision: before.revision, p_through_message_id: through.id,
      p_candidates: [{ scope: 'GLOBAL', subject: 'USER', category: 'PREFERENCE', content: '삭제된 상담에서 얻은 은방울 취미', importance: 3, sensitivity: 'NORMAL' }], p_summary: '삭제 내용이 담긴 늦은 합성 요약' });
    check(applied.applied === false && applied.reason === 'CONTEXT_CHANGED', 'stale mixed batch cannot publish through a surviving consultation message');
    const memories = await read(owner.client.from('memories').select('id').eq('source_conversation_id', conversation.id));
    check(memories.length === 1 && memories[0].id === memory.id, 'existing unselected independent memory remains and no stale candidate is inserted');
    check((await read(owner.client.from('messages').select('id').eq('id', through.id))).length === 1, 'unrelated surviving consultation message remains');

    for (const status of ['PENDING', 'SUCCEEDED']) {
      stage = `LATE_${status}`;
      const params = { user_id: owner.id, operation: 'chat.SEND', request_id: randomUUID(), payload_hash: randomUUID(), conversation_id: conversation.id, consultation_id: null, message: '삭제 경쟁 검증용 합성 입력' };
      const claim = await rpc(admin, 'begin_chat_request', { p_params: params });
      const completeArgs = { p_execution_id: claim.executionId, p_assistant_content: 'RPC 검증용 합성 답변', p_segments: ['RPC 검증용 합성 답변'], p_model_id: 'fixture-no-inference', p_prompt_version: 'fixture-no-inference', p_data: {} };
      if (status === 'SUCCEEDED') await rpc(admin, 'complete_execution', completeArgs);
      check((await remove(claim.consultationId)).deleted, `${status} consultation is deleted before late callback checks`);
      const baseline = await stateHash(owner.id);
      await deniedRpc('begin_chat_request', { p_params: params }, `${status} original request UUID replay returns typed NOT_FOUND`);
      await deniedRpc('complete_execution', completeArgs, `${status} late completion returns NOT_FOUND`);
      await deniedRpc('fail_execution', { p_execution_id: claim.executionId, p_error: { code: 'LLM_TIMEOUT', message: '합성 늦은 오류', retryable: true }, p_http_status: 504 }, `${status} late failure returns NOT_FOUND`);
      check(await stateHash(owner.id) === baseline, `${status} replay and callbacks leave all authoritative record state unchanged`);
    }

    for (const [index, path] of ['EXISTING_DRAW', 'RACING_SAVE'].entries()) {
      stage = `DAILY_${path}`;
      const firstConversation = await makeConversation('BOMI'), secondConversation = await makeConversation('SANI');
      const date = new Date(Date.now() - index * 86_400_000).toISOString().slice(0, 10);
      const parameters = id => ({ user_id: owner.id, operation: 'tarot.DRAW', request_id: randomUUID(), payload_hash: randomUUID(), conversation_id: id, consultation_id: null, question: '합성 오늘의 카드', spread_type: 'ONE_CARD', mode: 'DAILY', local_date: date });
      const first = await rpc(admin, 'begin_fortune_request', { p_params: parameters(firstConversation.id) });
      const secondParams = parameters(secondConversation.id);
      let second = path === 'RACING_SAVE' ? await rpc(admin, 'begin_fortune_request', { p_params: secondParams }) : null;
      const save = (executionId, cardId) => rpc(admin, 'save_tarot_draw', { p_execution_id: executionId, p_cards: [{ cardId, orientation: 'UPRIGHT', positionIndex: 0, positionKey: 'PRESENT' }], p_spread_type: 'ONE_CARD', p_mode: 'DAILY', p_local_date: date, p_question: '합성 오늘의 카드', p_source_draw_group_id: null });
      const original = await save(first.executionId, 17);
      second ??= await rpc(admin, 'begin_fortune_request', { p_params: secondParams });
      const reused = path === 'RACING_SAVE' ? await save(second.executionId, 0) : second.resource;
      const completed = await rpc(admin, 'complete_execution', { p_execution_id: second.executionId, p_assistant_content: null, p_segments: [], p_model_id: null, p_prompt_version: null, p_data: reused });
      check(completed.drawGroupId === original.drawGroupId && completed.conversationId === firstConversation.id && stable(completed.cards) === stable(original.cards), `${path} DAILY completion retains the original authoritative parent and cards`);
      const replayed = await rpc(admin, 'begin_fortune_request', { p_params: secondParams });
      check(replayed.replay?.data.drawGroupId === original.drawGroupId && stable(replayed.replay.data.cards) === stable(original.cards), `${path} DAILY original UUID replays the canonical draw`);
      const groups = await read(owner.client.from('tarot_draw_groups').select('id').eq('local_date', date));
      const cards = await read(owner.client.from('tarot_draws').select('id').eq('draw_group_id', original.drawGroupId));
      check(groups.length === 1 && cards.length === 1, `${path} DAILY race never creates an additional draw or card`);
    }
  } catch (error) {
    failure = checks.findLast(row => !row.passed)?.name ?? (error instanceof Error && /^[A-Z_]{3,80}$/.test(error.message) ? error.message : 'SMOKE_TRANSPORT_OR_SETUP_FAILED');
    observations.push({ stage, failure });
  } finally {
    for (const id of [...ids]) {
      let cleaned = false; try { cleaned = await cleanup(id); } catch { /* Ledger remains recoverable. */ }
      checks.push({ name: 'synthetic identity plus fifteen owned tables independently absent', passed: cleaned });
      if (!cleaned) failure ??= 'DISPOSABLE_CLEANUP_PENDING';
    }
    const report = { at: new Date().toISOString(), ...plan, rpcCalls, checks, observations, failure, pendingCleanupCount: ids.size, passed: !failure && checks.every(row => row.passed) };
    mkdirSync('docs/evidence', { recursive: true }); writeFileSync(`docs/evidence/backend-deletion-guards-${target}.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, checksPassed: checks.filter(row => row.passed).length, checksFailed: checks.filter(row => !row.passed).length, rpcCalls, modelCalls: 0, edgeCalls: 0, pendingCleanupCount: ids.size, failure }));
    if (!report.passed) process.exitCode = 1;
  }
}
