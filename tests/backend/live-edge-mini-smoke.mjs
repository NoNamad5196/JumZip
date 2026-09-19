// node --env-file=.env.server.local tests/backend/live-edge-mini-smoke.mjs
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const plan = { maximumUserRequests: 4, operations: ['Chat SEND', 'identical request replay', 'ONE_CARD DRAW', 'same-draw RETRY_INTERPRETATION'],
  model: '@cf/qwen/qwen3-30b-a3b-fp8', reservedNeurons: 400, measuredNeurons: null,
  costScope: 'Reservation is an estimate, not a measured cap: Edge does not normally expose provider usage. At most6 reply attempts at900 tokens plus2 intent attempts at350 tokens (6100 output tokens total), with input costs included in the400-neuron reservation.',
  hiddenWork: 'Owner memory is explicitly OFF. Conversation title is manually fixed before SEND. The first Chat consultation has only2 eligible messages and Tarot uses a separate consultation. Tarot actions do not schedule afterReply. This prevents delayed title maintenance becoming eligible after the later draws.',
  authScope: 'Two disposable synthetic accounts via admin-generated magic-link verification; no public signup or CAPTCHA assertion.' };
if (process.argv.includes('--plan')) console.log(JSON.stringify(plan, null, 2));
else await live();

async function live() {
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: secret } = process.env;
  if (!url || !anon || !secret) throw new Error('Private integration environment is required.');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, secret, options), ids = new Set(), checks = [], observations = [];
  const ledger = 'test-results/pending-edge-mini-cleanup.json';
  let userRequests = 0, stage = 'SETUP', outcome = 'FAILED';
  const writeLedger = () => { mkdirSync('test-results', { recursive: true }); writeFileSync(ledger, JSON.stringify({ at: new Date().toISOString(), ids: [...ids] }, null, 2)); };
  const assert = (condition, name) => { checks.push({ name, passed: Boolean(condition) }); if (!condition) throw new Error(name); console.log(`PASS ${name}`); };
  const read = async query => { const result = await query; if (result.error) throw new Error('TEST_DATABASE_FAILURE'); return result.data; };
  const stable = value => JSON.stringify(value, function (_key, item) { return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item; });
  async function count(table, userId, client = admin) {
    const result = await client.from(table).select('id', { head: true, count: 'exact' }).eq('user_id', userId);
    if (result.error) throw new Error('TEST_COUNT_FAILURE'); return result.count;
  }
  async function cleanup(id) {
    const found = await admin.auth.admin.getUserById(id);
    if (!found.error) {
      if (found.data.user?.user_metadata?.test_run !== 'JumZip Edge mini smoke' || !/^jumzip-edge-mini-[0-9a-f-]+@example\.com$/i.test(found.data.user?.email ?? '')) return false;
      if ((await admin.auth.admin.deleteUser(id, false)).error) return false;
    } else if (found.error.status !== 404) return false;
    const absent = await admin.auth.admin.getUserById(id);
    if (absent.data.user || absent.error?.status !== 404) return false;
    for (const table of ['profiles', 'messages', 'conversations', 'consultations', 'tarot_draw_groups', 'tarot_draws', 'memories', 'memory_suppressions', 'related_people', 'request_executions']) {
      const key = table === 'profiles' ? 'id' : 'user_id';
      const rows = await admin.from(table).select(key, { head: true, count: 'exact' }).eq(key, id);
      if (rows.error || rows.count) return false;
    }
    ids.delete(id); writeLedger(); return true;
  }
  async function identity() {
    const email = `jumzip-edge-mini-${randomUUID()}@example.com`;
    const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { test_run: 'JumZip Edge mini smoke' } });
    if (created.error || !created.data.user) throw new Error('Disposable identity failed.');
    const id = created.data.user.id; ids.add(id); writeLedger();
    const client = createClient(url, anon, options);
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error || link.data.user?.id !== id || !link.data.properties?.hashed_token) throw new Error('Disposable link failed.');
    const signed = await client.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token });
    if (signed.error || !signed.data.session || signed.data.user?.id !== id) throw new Error('Disposable verification failed.');
    return { id, client, token: signed.data.session.access_token };
  }
  async function request(owner, endpoint, input) {
    userRequests += 1; if (userRequests > 4) throw new Error('USER_REQUEST_LIMIT');
    const started = Date.now();
    const response = await fetch(`${url}/functions/v1/${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${owner.token}`, apikey: anon, 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' },
      body: JSON.stringify(input), signal: AbortSignal.timeout(105_000) });
    const result = await response.json();
    const exposedUsage = [result.usage, result.data?.usage, result.data?.assistantMessage?.metadata?.usage, result.data?.interpretation?.metadata?.usage]
      .filter(value => value && typeof value === 'object').map(value => Object.fromEntries(Object.entries(value).filter(([key, item]) => ['neurons', 'promptTokens', 'completionTokens', 'prompt_tokens', 'completion_tokens'].includes(key) && typeof item === 'number' && Number.isFinite(item))));
    observations.push({ stage, httpStatus: response.status, latencyMs: Date.now() - started, executionStatus: result.data?.executionStatus ?? 'FAILED', code: result.data?.partialError?.details?.reason ?? result.error?.code ?? null, exposedUsage });
    return result;
  }
  try {
    if (existsSync(ledger)) {
      for (const id of JSON.parse(readFileSync(ledger, 'utf8')).ids ?? []) {
        if (typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid cleanup ledger.'); ids.add(id);
      }
      for (const id of [...ids]) assert(await cleanup(id), 'prior Edge-mini disposable account cleanup');
    }
    const owner = await identity(), stranger = await identity();
    await read(owner.client.from('profiles').update({ memory_enabled: false }).eq('id', owner.id));
    await read(owner.client.from('related_people').insert({ user_id: owner.id, display_name: '솔새', memory_opt_in: false }));
    const conv = await read(owner.client.from('conversations').insert({ user_id: owner.id, character_id: 'BOMI' }).select('id').single());
    const manual = await read(owner.client.from('conversations').update({ title: '합성 회귀 확인' }).eq('id', conv.id).select('title_custom').single());
    assert(manual.title_custom, 'manual conversation title prevents delayed background title generation');
    const chatBody = { schemaVersion: 1, requestId: randomUUID(), action: 'SEND', conversationId: conv.id, consultationId: null, message: '오늘은 짧게 안부만 나누고 싶어. 차분하게 쉬는 시간을 보내고 있어.' };
    stage = 'CHAT_SEND'; const chat = await request(owner, 'chat', chatBody);
    assert(chat.ok && chat.data?.executionStatus === 'SUCCEEDED' && chat.data.assistantMessage?.id, 'latest deployed Chat produces a durable real response');
    const chatRow = await read(owner.client.from('messages').select('sender,reply_to_message_id,model_id,prompt_version').eq('id', chat.data.assistantMessage.id).single());
    assert(chatRow.sender === 'ASSISTANT' && chatRow.reply_to_message_id === chat.data.userMessage.id, 'Chat provenance links the persisted original user message');
    assert(chatRow.model_id === plan.model && chatRow.prompt_version === 'JumZipPersona-v4', 'Chat uses the configured Qwen model and Persona-v4');
    const before = { messages: await count('messages', owner.id), executions: await count('request_executions', owner.id) };
    stage = 'CHAT_REPLAY'; const replay = await request(owner, 'chat', chatBody);
    assert(replay.ok && stable(replay.data) === stable(chat.data), 'identical request UUID returns the same canonical Chat data and assistant ID');
    assert(before.messages === await count('messages', owner.id) && before.executions === await count('request_executions', owner.id), 'replay adds no message or execution; cached branch returns before inference');
    assert((await read(stranger.client.from('messages').select('id').eq('id', chat.data.assistantMessage.id))).length === 0, 'another authenticated owner cannot read the Chat message through RLS');
    const chatConsultation = await read(owner.client.from('consultations').select('title_generated_at').eq('id', chat.data.consultationId).single());
    const chatSources = await read(owner.client.from('messages').select('id').eq('consultation_id', chat.data.consultationId).in('sender', ['USER', 'ASSISTANT']));
    assert(chatSources.length === 2 && !chatConsultation.title_generated_at, 'first Chat consultation remains below the three-message AI-title threshold');

    stage = 'TAROT_DRAW'; const draw = await request(owner, 'tarot', { schemaVersion: 1, requestId: randomUUID(), action: 'DRAW', conversationId: conv.id, consultationId: null,
      spreadType: 'ONE_CARD', question: '편안하게 쉬는 시간을 위해 오늘 내가 해 볼 작은 행동은?', mode: 'NORMAL', clientTimezone: 'Asia/Seoul' });
    assert(draw.ok && draw.data?.executionStatus === 'SUCCEEDED' && draw.data.interpretation?.messageId, 'latest deployed Tarot persists a real completed interpretation');
    assert(draw.data.consultationId !== chat.data.consultationId, 'Tarot uses a separate consultation from the delayed Chat-title target');
    const first = await read(owner.client.from('messages').select('content,model_id,prompt_version,metadata').eq('id', draw.data.interpretation.messageId).single());
    assert(first.content === draw.data.interpretation.content && first.model_id === plan.model && first.prompt_version === 'JumZipPersona-v4' && first.metadata.tarot?.drawGroupId === draw.data.drawGroupId, 'Tarot reload preserves content, provenance and draw linkage');
    const cards = await read(owner.client.from('tarot_draws').select('card_id,orientation,position_index').eq('draw_group_id', draw.data.drawGroupId).order('position_index'));
    assert(cards.length === 1 && cards[0].card_id === draw.data.cards[0].cardId && cards[0].orientation === draw.data.cards[0].orientation && cards[0].position_index === draw.data.cards[0].positionIndex, 'authoritative card, orientation and position survive reload');
    assert((await read(stranger.client.from('tarot_draws').select('id').eq('draw_group_id', draw.data.drawGroupId))).length === 0, 'another authenticated owner cannot read the draw through RLS');
    stage = 'TAROT_RETRY'; const retry = await request(owner, 'tarot', { schemaVersion: 1, requestId: randomUUID(), action: 'RETRY_INTERPRETATION', conversationId: conv.id, drawGroupId: draw.data.drawGroupId });
    assert(retry.ok && retry.data?.executionStatus === 'SUCCEEDED' && retry.data.interpretation?.messageId !== draw.data.interpretation.messageId, 'explicit Tarot retry creates a new durable interpretation');
    assert(retry.data.drawGroupId === draw.data.drawGroupId && stable(retry.data.cards) === stable(draw.data.cards) && await count('tarot_draw_groups', owner.id) === 1, 'retry keeps the same draw group and immutable cards');
    const final = await read(owner.client.from('messages').select('model_id,prompt_version,metadata').eq('id', retry.data.interpretation.messageId).single());
    assert(final.model_id === plan.model && final.prompt_version === 'JumZipPersona-v4' && final.metadata.tarot?.drawGroupId === draw.data.drawGroupId, 'retry provenance and persisted snapshot identify the same authoritative draw');
    const executions = await read(admin.from('request_executions').select('status').eq('user_id', owner.id));
    assert(executions.length === 3 && executions.every(row => row.status === 'SUCCEEDED'), 'exactly three authoritative executions finish successfully');
    const state = await read(owner.client.from('conversations').select('summary,last_extracted_message_id,title_custom,title_generated_at').eq('id', conv.id).single());
    assert(!state.summary && !state.last_extracted_message_id && state.title_custom && !state.title_generated_at, 'memory OFF and manual-title safeguards remain in force after all operations');
    outcome = 'SUCCEEDED';
  } catch (error) {
    process.exitCode = 1;
    const failedCheck = checks.findLast(check => !check.passed)?.name ?? null;
    observations.push({ stage, outcome: 'FAILED', failedCheck, reason: error?.name === 'TimeoutError' ? 'EDGE_TIMEOUT' : failedCheck ? 'ASSERTION_FAILED' : 'TRANSPORT_OR_SETUP_FAILED' });
    console.error(`FAIL ${stage}`);
  } finally {
    for (const id of [...ids]) {
      let clean = false; try { clean = await cleanup(id); } catch { /* Ledger retained. */ }
      checks.push({ name: 'verified disposable Edge-mini identity and rows cleanup', passed: clean });
      if (!clean) { process.exitCode = 1; outcome = 'FAILED'; }
    }
    const report = { at: new Date().toISOString(), ...plan, overallOutcome: outcome, userRequests, checks, observations, pendingCleanupCount: ids.size };
    mkdirSync('test-results', { recursive: true }); mkdirSync('docs/evidence', { recursive: true });
    writeFileSync('test-results/edge-mini-smoke.json', JSON.stringify(report, null, 2));
    writeFileSync('docs/evidence/backend-edge-mini-smoke.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ overallOutcome: outcome, checksPassed: checks.filter(check => check.passed).length, checksFailed: checks.filter(check => !check.passed).length, userRequests, pendingCleanupCount: ids.size }));
  }
}
