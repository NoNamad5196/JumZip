// Read-only preparation: node tests/backend/live-history-deletion-smoke.mjs --plan
// After migration 014 GO: node --env-file=.env.server.local tests/backend/live-history-deletion-smoke.mjs --run
import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const marker = 'JumZip history deletion smoke';
const plan = {
  purpose: 'Hosted migration014 history/memory selection RPC regression using disposable synthetic data only',
  authScope: 'Admin-created identities with magic-link verifyOtp sessions; not public signup or CAPTCHA evidence',
  modelRequests: 0, edgeRequests: 0, maximumRpcRequests: 24,
  cases: ['conversation-scoped previews for both history kinds', 'cross-owner previews and execution',
    'empty selection preserves independent memories', 'subset selection and duplicate IDs delete only selected memories atomically',
    'foreign/other-conversation/missing selections roll back all rows', 'identical and changed-selection replay cannot delete more memories',
    'anonymous database role and malformed selection rejection', 'verified Auth and application cascade cleanup'],
  evidenceScope: 'Real hosted RPCs and authenticated RLS. Service-role inserts create clearly labelled synthetic source rows; no generated replies, model calls, or public UI claims.',
};
if (!process.argv.includes('--run')) console.log(JSON.stringify(plan, null, 2));
else await run();

async function run() {
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: secret } = process.env;
  if (!url || !anon || !secret) throw new Error('Private integration environment is required.');
  const origin = new URL(url).origin;
  const ledger = 'test-results/pending-history-deletion-cleanup.json';
  const ids = new Set(), checks = [], observations = [];
  let stage = 'SETUP', outcome = 'FAILED', rpcRequests = 0, transportRequests = 0;
  const boundedFetch = async (input, init) => {
    const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    // This harness can only reach Supabase Auth/PostgREST. It cannot invoke an
    // Edge Function or any model endpoint, even if a later helper is miswired.
    if (target.origin !== origin || !/^\/(?:auth|rest)\/v1(?:\/|$)/.test(target.pathname)) throw new Error('OUT_OF_SCOPE_NETWORK');
    transportRequests += 1;
    const timeout = AbortSignal.timeout(30_000);
    return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  };
  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: boundedFetch } };
  const admin = createClient(url, secret, options);
  const stable = value => JSON.stringify(value, function (_key, item) {
    return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
  });
  const writeLedger = () => {
    mkdirSync('test-results', { recursive: true });
    writeFileSync(ledger, JSON.stringify({ at: new Date().toISOString(), marker, ids: [...ids] }, null, 2));
  };
  const assert = (condition, name) => {
    checks.push({ name, passed: Boolean(condition) });
    if (!condition) throw new Error('CHECK_FAILED');
    console.log(`PASS ${name}`);
  };
  const read = async query => { const result = await query; if (result.error) throw new Error('TEST_DATABASE_FAILURE'); return result.data; };
  async function rpc(client, name, params) {
    if (++rpcRequests > plan.maximumRpcRequests) throw new Error('RPC_REQUEST_LIMIT');
    const start = Date.now();
    const result = await client.rpc(name, params);
    observations.push({ stage, rpc: name, httpStatus: result.status, latencyMs: Date.now() - start,
      code: result.error ? ['MEMORY_SELECTION_CHANGED', 'VALIDATION_ERROR', 'UNAUTHORIZED'].includes(result.error.message) ? result.error.message : result.error.code === '42501' ? 'PERMISSION_DENIED' : 'UNEXPECTED_RPC_ERROR' : null });
    return result;
  }
  const params = (kind, id, memoryIds = []) => ({ p_kind: kind, p_record_id: id, p_memory_ids: memoryIds });
  const remove = (client, kind, id, memoryIds = []) => rpc(client, 'delete_history_with_memories', params(kind, id, memoryIds));
  async function preview(client, kind, id) {
    const result = await rpc(client, 'history_deletion_memories', { p_kind: kind, p_record_id: id });
    if (result.error || !Array.isArray(result.data)) throw new Error('PREVIEW_RPC_FAILED');
    return result.data.map(row => row.id).sort();
  }
  const present = async (table, id) => (await read(admin.from(table).select('id').eq('id', id))).length === 1;
  async function stateDigest() {
    // Values are synthetic and remain in memory. Only the equality result is
    // reported, not source rows, UUIDs, Auth objects or this state hash.
    const state = [];
    for (const table of ['profiles', 'conversations', 'consultations', 'messages', 'memories', 'memory_suppressions']) {
      const key = table === 'profiles' ? 'id' : 'user_id';
      const rows = await read(admin.from(table).select('*').in(key, [...ids]));
      state.push({ table, rows: rows.map(stable).sort() });
    }
    return createHash('sha256').update(stable(state)).digest('hex');
  }
  async function cleanup(id) {
    const existing = await admin.auth.admin.getUserById(id);
    if (!existing.error) {
      if (existing.data.user?.user_metadata?.test_run !== marker || !/^jumzip-history-delete-[0-9a-f-]+@example\.com$/i.test(existing.data.user?.email ?? '')) return false;
      if ((await admin.auth.admin.deleteUser(id, false)).error) return false;
    } else if (existing.error.status !== 404) return false;
    const absent = await admin.auth.admin.getUserById(id);
    if (absent.data.user || absent.error?.status !== 404) return false;
    for (const table of ['profiles', 'messages', 'conversations', 'consultations', 'tarot_draw_groups', 'tarot_draws', 'saju_readings', 'saju_compatibility_readings', 'birth_profiles', 'memories', 'memory_suppressions', 'related_people', 'request_executions', 'rate_limit_buckets']) {
      const key = table === 'profiles' ? 'id' : 'user_id';
      const result = await admin.from(table).select(key, { count: 'exact', head: true }).eq(key, id);
      if (result.error || result.count !== 0) return false;
    }
    ids.delete(id); writeLedger(); return true;
  }
  async function identity() {
    const email = `jumzip-history-delete-${randomUUID()}@example.com`;
    const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { test_run: marker } });
    if (created.error || !created.data.user) throw new Error('DISPOSABLE_CREATE_FAILED');
    const id = created.data.user.id; ids.add(id); writeLedger();
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error || link.data.user?.id !== id || !link.data.properties?.hashed_token) throw new Error('DISPOSABLE_LINK_FAILED');
    const client = createClient(url, anon, options);
    const signed = await client.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token });
    if (signed.error || signed.data.user?.id !== id || !signed.data.session) throw new Error('DISPOSABLE_SESSION_FAILED');
    return { id, client };
  }
  async function fixture(userId, label) {
    const conversation = await read(admin.from('conversations').insert({ user_id: userId, character_id: 'BOMI', title: `합성 ${label}` }).select('id').single());
    const consultations = await read(admin.from('consultations').insert([0, 1].map(index => ({ user_id: userId, conversation_id: conversation.id, character_id: 'BOMI', fortune_type: 'CHAT', question: `합성 ${label} ${index}` }))).select('id'));
    const messages = await read(admin.from('messages').insert(consultations.map((consultation, index) => ({ user_id: userId, conversation_id: conversation.id, consultation_id: consultation.id, sender: 'USER', content: `합성 테스트 원문 ${label} ${index}` }))).select('id,consultation_id'));
    const memories = await read(admin.from('memories').insert([0, 1].map(index => ({ user_id: userId, scope: 'GLOBAL', category: 'PREFERENCE', subject: 'USER', content: `합성 기억 ${label} ${index}`, source_conversation_id: conversation.id }))).select('id'));
    return { conversationId: conversation.id, consultations, messages, memoryIds: memories.map(row => row.id) };
  }
  try {
    if (existsSync(ledger)) {
      const previous = JSON.parse(readFileSync(ledger, 'utf8'));
      if (previous.marker !== marker || !Array.isArray(previous.ids) || previous.ids.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))) throw new Error('INVALID_CLEANUP_LEDGER');
      for (const id of previous.ids) ids.add(id);
      for (const id of [...ids]) assert(await cleanup(id), 'prior disposable history identity and rows cleaned');
    }
    const owner = await identity(), stranger = await identity();
    const recordOnly = await fixture(owner.id, '기억 보존'), selected = await fixture(owner.id, '선택 삭제'), unrelated = await fixture(owner.id, '다른 대화'), foreign = await fixture(stranger.id, '교차 소유권');
    stage = 'PREVIEW';
    assert(stable(await preview(owner.client, 'CONVERSATION', selected.conversationId)) === stable([...selected.memoryIds].sort()), 'conversation preview returns exactly its two memories');
    for (const consultation of selected.consultations) assert(stable(await preview(owner.client, 'CONSULTATION', consultation.id)) === stable([...selected.memoryIds].sort()), 'consultation preview honestly uses the common conversation provenance');
    assert((await preview(stranger.client, 'CONVERSATION', selected.conversationId)).length === 0, 'another owner cannot preview a foreign conversation');
    assert((await preview(stranger.client, 'CONSULTATION', selected.consultations[0].id)).length === 0, 'another owner cannot preview a foreign consultation');

    stage = 'RECORD_ONLY';
    const preserve = await remove(owner.client, 'CONVERSATION', recordOnly.conversationId);
    assert(!preserve.error && preserve.data?.deleted === true && preserve.data.memoriesDeleted === 0, 'empty selection deletes the conversation without deleting memories');
    assert(!await present('conversations', recordOnly.conversationId) && (await read(admin.from('messages').select('id').eq('conversation_id', recordOnly.conversationId))).length === 0 && (await read(admin.from('consultations').select('id').eq('conversation_id', recordOnly.conversationId))).length === 0, 'record-only deletion cascades conversation history');
    const orphaned = await read(owner.client.from('memories').select('id,source_conversation_id').in('id', recordOnly.memoryIds));
    assert(orphaned.length === 2 && orphaned.every(row => row.source_conversation_id === null), 'both unselected independent memories remain owner-readable with cleared provenance');

    stage = 'INVALID_SELECTION';
    for (const [label, invalid] of [['foreign owner', foreign.memoryIds[0]], ['other conversation', unrelated.memoryIds[0]], ['missing row', randomUUID()]]) {
      const before = await stateDigest();
      const rejected = await remove(owner.client, 'CONVERSATION', selected.conversationId, [selected.memoryIds[0], invalid]);
      assert(rejected.error?.message === 'MEMORY_SELECTION_CHANGED' && rejected.error.code === 'P0001', `${label} selection returns the defined selection conflict`);
      assert(await stateDigest() === before, `${label} selection rolls back all history, memory and consent state`);
    }

    stage = 'OWNERSHIP';
    for (const [label, id] of [['foreign record', foreign.conversationId], ['missing record', randomUUID()]]) {
      const before = await stateDigest();
      const denied = await remove(owner.client, 'CONVERSATION', id, [selected.memoryIds[0]]);
      assert(!denied.error && denied.data?.deleted === false && denied.data.memoriesDeleted === 0 && await stateDigest() === before, `${label} cannot authorize deletion of an otherwise owned memory`);
    }

    stage = 'SUBSET_DELETE';
    const deletedConsultation = selected.consultations[0].id;
    const subset = await remove(owner.client, 'CONSULTATION', deletedConsultation, [selected.memoryIds[0], selected.memoryIds[0]]);
    assert(!subset.error && subset.data?.deleted === true && subset.data.memoriesDeleted === 1, 'subset deletion deduplicates IDs and deletes exactly one chosen memory');
    assert(!await present('consultations', deletedConsultation) && !await present('memories', selected.memoryIds[0]) && (await read(admin.from('messages').select('id').eq('consultation_id', deletedConsultation))).length === 0, 'selected memory and consultation history are both removed');
    assert(await present('conversations', selected.conversationId) && await present('consultations', selected.consultations[1].id) && await present('memories', selected.memoryIds[1]) && await present('memories', unrelated.memoryIds[0]) && await present('memories', foreign.memoryIds[0]), 'sibling consultation, unselected memory and unrelated owners remain');
    assert((await read(owner.client.from('messages').select('id').eq('consultation_id', selected.consultations[1].id))).length === 1, 'the sibling consultation original message survives');

    stage = 'LOST_SUCCESS_REPLAY';
    for (const [label, selectedIds] of [['identical', [selected.memoryIds[0], selected.memoryIds[0]]], ['changed remaining-memory', [selected.memoryIds[1]]]]) {
      const before = await stateDigest();
      const replay = await remove(owner.client, 'CONSULTATION', deletedConsultation, selectedIds);
      assert(!replay.error && replay.data?.deleted === false && replay.data.memoriesDeleted === 0 && await stateDigest() === before, `${label} replay cannot remove any additional memory`);
    }

    stage = 'BOUNDARIES';
    for (const [label, body] of [['invalid kind', params('UNKNOWN', unrelated.conversationId)], ['too many selected IDs', params('CONVERSATION', unrelated.conversationId, Array(1001).fill(unrelated.memoryIds[0]))], ['null selected ID', params('CONVERSATION', unrelated.conversationId, [null])]]) {
      const before = await stateDigest();
      const invalid = await rpc(owner.client, 'delete_history_with_memories', body);
      assert(invalid.error?.message === 'VALIDATION_ERROR' && await stateDigest() === before, `${label} is rejected without mutation`);
    }
    const anonymous = createClient(url, anon, options);
    const denied = await remove(anonymous, 'CONVERSATION', unrelated.conversationId);
    assert(denied.error?.code === '42501' && await present('conversations', unrelated.conversationId), 'anonymous database role cannot execute the deletion RPC');
    outcome = 'SUCCEEDED';
  } catch (error) {
    process.exitCode = 1;
    observations.push({ stage, failure: error?.name === 'TimeoutError' ? 'NETWORK_TIMEOUT' : checks.some(check => !check.passed) ? 'ASSERTION_FAILED' : 'SETUP_OR_TRANSPORT_FAILED' });
    console.error(`FAIL ${stage}`);
  } finally {
    for (const id of [...ids]) {
      let clean = false; try { clean = await cleanup(id); } catch { /* Keep the ledger for recovery. */ }
      checks.push({ name: 'disposable Auth identity and all owned application tables independently verified absent', passed: clean });
      if (!clean) { process.exitCode = 1; outcome = 'FAILED'; }
    }
    const report = { at: new Date().toISOString(), ...plan, overallOutcome: outcome, rpcRequests, transportRequests, checks, observations, pendingCleanupCount: ids.size };
    mkdirSync('test-results', { recursive: true }); mkdirSync('docs/evidence', { recursive: true });
    writeFileSync('test-results/history-deletion-smoke.json', JSON.stringify(report, null, 2));
    writeFileSync('docs/evidence/backend-history-deletion-smoke.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ overallOutcome: outcome, checksPassed: checks.filter(check => check.passed).length, checksFailed: checks.filter(check => !check.passed).length, rpcRequests, modelRequests: 0, edgeRequests: 0, pendingCleanupCount: ids.size }));
  }
}
