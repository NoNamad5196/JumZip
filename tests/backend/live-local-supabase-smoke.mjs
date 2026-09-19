// Explicit opt-in local-only Auth/RLS/Edge/llama.cpp integration. Never loads hosted env.
import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const plan = { target: 'http://127.0.0.1:54321', model: 'jumzip-local-smoke', maximumInferenceOperations: 3,
  scope: 'Local anonymous Auth, RLS, all five Edge auth boundaries, actual Chat/replay/Tarot/retry and cascade cleanup. Tiny-model output quality is reported separately from infrastructure.',
  optionalModelWork: 'Intent, title and memory are disabled only in the ignored local Edge env; production source and hosted settings remain unchanged.' };
if (!process.argv.includes('--run')) console.log(JSON.stringify(plan, null, 2));
else await live();

async function live() {
  const status = spawnSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'json'], { encoding: 'utf8', windowsHide: true });
  if (status.status !== 0) throw Error('LOCAL_STATUS_FAILED');
  const config = JSON.parse(status.stdout);
  if (config.API_URL !== plan.target || !config.ANON_KEY || !config.SERVICE_ROLE_KEY) throw Error('LOCAL_TARGET_GUARD');
  const url = plan.target;
  const guardedFetch = (input, init) => {
    const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (target.origin !== url || !/^\/(auth|rest|functions)\/v1(?:\/|$)/.test(target.pathname)) throw Error('NONLOCAL_DESTINATION_BLOCKED');
    return fetch(input, init);
  };
  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: guardedFetch } };
  const admin = createClient(url, config.SERVICE_ROLE_KEY, options);
  const ledger = 'test-results/pending-local-supabase-cleanup.json';
  const marker = 'JumZip local Supabase smoke';
  const ids = new Set(), checks = [], observations = [];
  let stage = 'SETUP', inferenceOperations = 0, failure = null;
  const check = (name, passed, kind = 'infrastructure') => { checks.push({ name, passed: Boolean(passed), kind }); console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`); return Boolean(passed); };
  const required = (condition, name) => { if (!check(name, condition)) throw Error(name); };
  const writeLedger = () => { mkdirSync('test-results', { recursive: true }); writeFileSync(ledger, JSON.stringify({ target: url, marker, ids: [...ids] }, null, 2)); };
  const read = async query => { const result = await query; if (result.error) throw Error('LOCAL_DATABASE_QUERY_FAILED'); return result.data; };
  const stable = value => JSON.stringify(value, function (_key, item) { return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item; });
  const tables = ['profiles', 'conversations', 'consultations', 'messages', 'tarot_draw_groups', 'tarot_draws', 'birth_profiles', 'saju_readings', 'saju_compatibility_readings', 'related_people', 'memories', 'memory_suppressions', 'request_executions', 'rate_limit_buckets', 'daily_draw_claims'];
  async function cleanup(id) {
    const found = await admin.auth.admin.getUserById(id);
    if (!found.error) {
      if (found.data.user?.user_metadata?.test_run !== marker || !found.data.user?.is_anonymous) return false;
      if ((await admin.auth.admin.deleteUser(id, false)).error) return false;
    } else if (found.error.status !== 404) return false;
    const absent = await admin.auth.admin.getUserById(id);
    if (absent.data.user || absent.error?.status !== 404) return false;
    for (const table of tables) {
      const key = table === 'profiles' ? 'id' : 'user_id';
      const rows = await admin.from(table).select(key, { head: true, count: 'exact' }).eq(key, id);
      if (rows.error || rows.count !== 0) return false;
    }
    ids.delete(id); writeLedger(); return true;
  }
  async function identity() {
    const client = createClient(url, config.ANON_KEY, options);
    const result = await client.auth.signInAnonymously({ options: { data: { test_run: marker } } });
    if (result.error || !result.data.user || !result.data.session) throw Error('LOCAL_ANONYMOUS_AUTH_FAILED');
    const id = result.data.user.id; ids.add(id); writeLedger();
    required(result.data.user.is_anonymous, 'public local anonymous sign-in returns an anonymous identity');
    const verified = await client.auth.getUser();
    required(!verified.error && verified.data.user?.id === id, 'local Auth server verifies the newly issued session');
    return { id, client, token: result.data.session.access_token };
  }
  async function edge(endpoint, input, owner, extra = {}) {
    const started = performance.now();
    const response = await guardedFetch(`${url}/functions/v1/${endpoint}`, { method: extra.method ?? 'POST', headers: {
      'Content-Type': 'application/json', apikey: config.ANON_KEY, Origin: extra.origin ?? 'http://127.0.0.1:5173',
      ...(owner ? { Authorization: `Bearer ${owner.token}` } : {}),
      ...(extra.method === 'OPTIONS' ? { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,apikey,content-type' } : {}),
    }, ...(extra.method === 'OPTIONS' ? {} : { body: JSON.stringify(input) }), signal: AbortSignal.timeout(105_000) });
    const body = await response.json().catch(() => ({}));
    observations.push({ stage, endpoint, status: response.status, elapsedMs: Math.round(performance.now() - started), executionStatus: body.data?.executionStatus ?? null,
      code: body.error?.code ?? body.data?.partialError?.details?.reason ?? null });
    return { body, status: response.status, headers: response.headers };
  }
  async function inference(endpoint, input, owner) {
    if (++inferenceOperations > plan.maximumInferenceOperations) throw Error('LOCAL_INFERENCE_OPERATION_CAP');
    return edge(endpoint, input, owner);
  }
  try {
    if (existsSync(ledger)) {
      const previous = JSON.parse(readFileSync(ledger, 'utf8'));
      if (previous.target !== url || previous.marker !== marker || !Array.isArray(previous.ids)) throw Error('LOCAL_LEDGER_TARGET_MISMATCH');
      for (const id of previous.ids) { if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw Error('LOCAL_LEDGER_ID_INVALID'); ids.add(id); }
      for (const id of [...ids]) required(await cleanup(id), 'previous local synthetic identity cleanup verified');
    }
    const owner = await identity(), stranger = await identity();
    await read(owner.client.from('profiles').update({ memory_enabled: false }).eq('id', owner.id));
    const conversation = await read(owner.client.from('conversations').insert({ user_id: owner.id, character_id: 'BOMI' }).select('id').single());
    required((await read(owner.client.from('conversations').select('id').eq('id', conversation.id))).length === 1, 'authenticated owner can create and read its local conversation');
    check('another authenticated identity cannot read the conversation', (await read(stranger.client.from('conversations').select('id').eq('id', conversation.id))).length === 0);
    check('another authenticated identity cannot update the conversation', (await read(stranger.client.from('conversations').update({ title: '외부 변경' }).eq('id', conversation.id).select('id'))).length === 0);
    const visitor = createClient(url, config.ANON_KEY, options);
    const publicRows = await visitor.from('conversations').select('id');
    check('no-session public REST request cannot read user conversations', Boolean(publicRows.error) || publicRows.data.length === 0);
    stage = 'AUTH_BOUNDARIES';
    for (const endpoint of ['chat', 'tarot', 'saju', 'compatibility', 'account']) {
      const result = await edge(endpoint, {}, null);
      check(`${endpoint} rejects missing bearer before executing`, result.status === 401 && result.body.error?.code === 'AUTH_REQUIRED');
    }
    const invalid = await edge('chat', {}, { token: 'not-a-real-jwt' });
    check('Auth getUser rejects invalid JWT', invalid.status === 401 && invalid.body.error?.code === 'AUTH_EXPIRED');
    const allowed = await edge('chat', {}, null, { method: 'OPTIONS' });
    // Local Supabase Kong may terminate preflight with 200 and wildcard CORS.
    // The actual authenticated POST still reaches the application's strict origin check.
    check('configured local CORS preflight permits the required browser request', [200, 204].includes(allowed.status)
      && ['*', 'http://127.0.0.1:5173'].includes(allowed.headers.get('Access-Control-Allow-Origin'))
      && allowed.headers.get('Access-Control-Allow-Methods')?.includes('POST'));
    const denied = await edge('chat', {}, owner, { origin: 'https://untrusted.invalid' });
    check('unconfigured CORS origin is rejected', denied.status === 403 && denied.body.error?.code === 'FORBIDDEN');
    const validation = await edge('chat', {}, owner);
    check('authenticated invalid action is rejected before persistence', validation.status === 400 && validation.body.error?.code === 'VALIDATION_ERROR');

    const promptVersion = readFileSync('supabase/functions/_shared/llm/reply.ts', 'utf8').match(/PERSONA_PROMPT_VERSION\s*=\s*'([^']+)'/)?.[1];
    required(Boolean(promptVersion), 'current source prompt version is available for provenance comparison');
    const chatBody = { schemaVersion: 1, requestId: randomUUID(), action: 'SEND', conversationId: conversation.id, consultationId: null, message: '안녕, 오늘은 집에서 차분하게 쉬고 있어. 짧게 인사해 줘.' };
    stage = 'CHAT'; const chat = await inference('chat', chatBody, owner);
    check('native model produces an accepted Chat response', chat.body.ok && chat.body.data?.executionStatus === 'SUCCEEDED', 'model_response');
    const userMessageId = chat.body.data?.userMessage?.id ?? chat.body.error?.details?.userMessageId;
    required(Boolean(userMessageId), 'Chat original user message survives success or inference failure');
    if (chat.body.data?.assistantMessage?.id) {
      const message = await read(owner.client.from('messages').select('model_id,prompt_version,reply_to_message_id').eq('id', chat.body.data.assistantMessage.id).single());
      check('persisted Chat provenance identifies native model and source prompt', message.model_id === plan.model && message.prompt_version === promptVersion && message.reply_to_message_id === userMessageId);
    }
    const before = await read(admin.from('request_executions').select('id').eq('user_id', owner.id));
    stage = 'CHAT_REPLAY'; const replay = await edge('chat', chatBody, owner);
    check('same request replays the canonical success or failure without a new execution',
      stable(replay.body.data ?? replay.body.error) === stable(chat.body.data ?? chat.body.error) && (await read(admin.from('request_executions').select('id').eq('user_id', owner.id))).length === before.length);

    stage = 'TAROT_DRAW'; const draw = await inference('tarot', { schemaVersion: 1, requestId: randomUUID(), action: 'DRAW', conversationId: conversation.id, consultationId: null,
      question: '오늘 편안하게 쉬기 위해 내가 할 작은 행동은?', spreadType: 'ONE_CARD', mode: 'NORMAL', clientTimezone: 'Asia/Seoul' }, owner);
    required(draw.body.ok && draw.body.data?.drawGroupId && draw.body.data.cards.length === 1, 'local Tarot always persists its authoritative draw before interpretation');
    check('native model produces an accepted Tarot interpretation', draw.body.data.executionStatus === 'SUCCEEDED' && draw.body.data.interpretation?.messageId, 'model_response');
    const rows = await read(owner.client.from('tarot_draws').select('card_id,orientation,position_index').eq('draw_group_id', draw.body.data.drawGroupId));
    const card = draw.body.data.cards[0];
    check('Tarot reload matches authoritative card identity orientation and position', rows.length === 1 && rows[0].card_id === card.cardId && rows[0].orientation === card.orientation && rows[0].position_index === card.positionIndex);
    check('cross-owner draw remains hidden by local RLS', (await read(stranger.client.from('tarot_draws').select('id').eq('draw_group_id', draw.body.data.drawGroupId))).length === 0);
    stage = 'TAROT_RETRY'; const retry = await inference('tarot', { schemaVersion: 1, requestId: randomUUID(), action: 'RETRY_INTERPRETATION', conversationId: conversation.id, drawGroupId: draw.body.data.drawGroupId }, owner);
    check('explicit retry preserves the existing draw and never redraws', retry.body.ok && retry.body.data.drawGroupId === draw.body.data.drawGroupId && stable(retry.body.data.cards) === stable(draw.body.data.cards)
      && (await read(owner.client.from('tarot_draw_groups').select('id').eq('user_id', owner.id))).length === 1);
    check('native model produces an accepted retry interpretation', retry.body.data?.executionStatus === 'SUCCEEDED' && retry.body.data.interpretation?.messageId, 'model_response');
    if (retry.body.data?.interpretation?.messageId) {
      const message = await read(owner.client.from('messages').select('model_id,prompt_version,metadata').eq('id', retry.body.data.interpretation.messageId).single());
      check('retry reload retains native model prompt and draw provenance', message.model_id === plan.model && message.prompt_version === promptVersion && message.metadata.tarot?.drawGroupId === draw.body.data.drawGroupId);
    }
    stage = 'ACCOUNT_DELETE';
    const deleted = await edge('account', { schemaVersion: 1, requestId: randomUUID(), action: 'DELETE_ACCOUNT', confirmation: 'DELETE' }, owner);
    check('actual local account Edge action succeeds after persisted Chat and Tarot', deleted.body.ok && deleted.body.data?.deleted);
    const revoked = await edge('chat', chatBody, owner);
    check('deleted account token is rejected through fresh Auth getUser', revoked.status === 401 && revoked.body.error?.code === 'AUTH_EXPIRED');
  } catch (error) {
    failure = error instanceof Error && /^[A-Z_]{3,80}$/.test(error.message) ? error.message : 'LOCAL_SMOKE_STEP_FAILED';
    observations.push({ stage, failure });
  } finally {
    for (const id of [...ids]) {
      let cleaned = false; try { cleaned = await cleanup(id); } catch { /* Retain ledger until independently verified. */ }
      check('local synthetic identity and all fifteen owned tables independently absent', cleaned);
    }
    const report = { startedStackAt: '2026-09-20 local session', completedAt: new Date().toISOString(), ...plan, inferenceOperations,
      providerSourceSha256: createHash('sha256').update(readFileSync('supabase/functions/_shared/llm/provider.ts')).digest('hex'),
      checks, observations, failure, pendingCleanupCount: ids.size,
      infrastructurePassed: !failure && checks.filter(item => item.kind === 'infrastructure').every(item => item.passed),
      modelResponsesPassed: checks.filter(item => item.kind === 'model_response').length === 3 && checks.filter(item => item.kind === 'model_response').every(item => item.passed) };
    mkdirSync('docs/evidence', { recursive: true }); writeFileSync('docs/evidence/backend-local-supabase-smoke.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ infrastructurePassed: report.infrastructurePassed, modelResponsesPassed: report.modelResponsesPassed, checksPassed: checks.filter(item => item.passed).length, checksFailed: checks.filter(item => !item.passed).length, inferenceOperations, failure, pendingCleanupCount: ids.size }));
    if (!report.infrastructurePassed || !report.modelResponsesPassed) process.exitCode = 1;
  }
}
