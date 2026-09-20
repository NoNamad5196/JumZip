// Actual local Auth/Edge/Postgres integration with a separately started HTTP double.
// Default is a zero-network plan. Main owns functions serve switching/restoration.
import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { MODEL, CANDIDATE, TARGET, MESSAGES, SCENARIOS, PLAN, digest, pathsFor, sourceHashes } from './local-openai-contract-double.mjs';

const EVIDENCE = 'docs/evidence/backend-local-edge-contract-v9-smoke.json';
const TABLES = ['profiles', 'conversations', 'consultations', 'messages', 'tarot_draw_groups', 'tarot_draws', 'birth_profiles', 'saju_readings',
  'saju_compatibility_readings', 'related_people', 'memories', 'memory_suppressions', 'request_executions', 'rate_limit_buckets', 'daily_draw_claims'];
const runName = process.argv.find(value => value.startsWith('--run-name='))?.slice(11) ?? 'candidate-v9';
const safeCode = error => error instanceof Error && /^[A-Z0-9_]{3,100}$/.test(error.message) ? error.message : 'LOCAL_CONTRACT_SMOKE_FAILED';
const stable = value => JSON.stringify(value, function (_key, item) { return item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item; });
const hasInternalEvidence = value => /"(?:interpretationEvidence|keywordIndices|textEvidence)"/.test(JSON.stringify(value));

if (!process.argv.includes('--run') && !process.argv.includes('--cleanup-only')) {
  console.log(JSON.stringify({ ...PLAN, runName, executionOptIn: 'JUMZIP_RUN_LOCAL_EDGE_CONTRACT=LOCAL plus --run --serve-confirmed',
    serviceCoordination: 'Start the gated double first; Main checks its new private env, switches local functions serve, then explicitly confirms. No automatic service changes.',
    cleanupOnly: 'Same opt-in with --cleanup-only uses only marked local Auth/DB cleanup; no provider or Edge calls.', evidence: EVIDENCE }, null, 2));
} else if (process.env.JUMZIP_RUN_LOCAL_EDGE_CONTRACT !== 'LOCAL' || process.argv.includes('--run') && !process.argv.includes('--serve-confirmed')) {
  console.log(JSON.stringify({ status: 'NOT_RUN', code: 'EXPLICIT_LOCAL_AND_SERVE_CONFIRMATION_REQUIRED' })); process.exitCode = 1;
} else {
  try { await live(process.argv.includes('--cleanup-only')); }
  catch (error) { console.log(JSON.stringify({ status: 'FAIL', code: safeCode(error) })); process.exitCode = 1; }
}

async function live(cleanupOnly) {
  const paths = pathsFor(runName), before = sourceHashes();
  const marker = `JumZip local HTTP contract ${runName}`;
  if (!cleanupOnly && (existsSync(EVIDENCE) || existsSync(paths.reportFile))) throw Error('EVIDENCE_OVERWRITE_REFUSED');
  const localStatus = spawnSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'json'],
    { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (localStatus.status !== 0) throw Error('LOCAL_STATUS_UNAVAILABLE');
  const config = JSON.parse(localStatus.stdout); // Contains local keys; never log stdout or the object.
  if (config.API_URL !== TARGET || typeof config.ANON_KEY !== 'string' || typeof config.SERVICE_ROLE_KEY !== 'string') throw Error('LOCAL_TARGET_REQUIRED');
  const nativeFetch = globalThis.fetch;
  const counts = { authHTTP: 0, restHTTP: 0, edgeHTTP: 0, doubleControlHTTP: 0, blockedDestinations: 0, actualModelCalls: 0, externalRequests: 0 };
  let doubleConfig, doubleOrigin;
  if (!cleanupOnly) {
    doubleConfig = JSON.parse(readFileSync(paths.privateFile, 'utf8'));
    if (doubleConfig.runName !== runName || doubleConfig.model !== MODEL || !/^[a-f0-9]{64}$/.test(doubleConfig.key)
      || !Number.isInteger(doubleConfig.port) || doubleConfig.port < 1024 || doubleConfig.port > 65535) throw Error('DOUBLE_PRIVATE_CONFIG_INVALID');
    doubleOrigin = `http://127.0.0.1:${doubleConfig.port}`;
    const expectedEnv = [`LLM_BASE_URL=http://host.docker.internal:${doubleConfig.port}/v1`, `LLM_API_KEY=${doubleConfig.key}`, `LLM_MODEL=${MODEL}`,
      'LLM_STRUCTURED_FORMAT=json_object', 'TOOL_RECOMMENDATIONS_ENABLED=true', 'TITLE_GENERATION_ENABLED=false', 'MEMORY_MAINTENANCE_ENABLED=false',
      'ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173', ''].join('\n');
    if (readFileSync(paths.envFile, 'utf8').replaceAll('\r\n', '\n') !== expectedEnv || doubleConfig.sourceHash !== digest(before)) throw Error('DOUBLE_ENV_OR_SOURCE_CHANGED');
  }
  const guardedFetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.username || url.password || url.hash || !((url.origin === TARGET && /^\/(auth|rest|functions)\/v1(?:\/|$)/.test(url.pathname))
      || (!cleanupOnly && url.origin === doubleOrigin && ['/__control', '/__status'].includes(url.pathname)))) {
      counts.blockedDestinations++; throw Error('NONLOCAL_DESTINATION_BLOCKED');
    }
    if (cleanupOnly && url.pathname.startsWith('/functions/')) throw Error('CLEANUP_CANNOT_CALL_EDGE');
    if (url.origin === doubleOrigin) counts.doubleControlHTTP++;
    else if (url.pathname.startsWith('/auth/')) counts.authHTTP++;
    else if (url.pathname.startsWith('/rest/')) counts.restHTTP++;
    else { counts.edgeHTTP++; if (counts.edgeHTTP > 7) throw Error('EDGE_OPERATION_CAP'); }
    return nativeFetch(input, { ...init, redirect: 'error', signal: init?.signal ?? AbortSignal.timeout(20_000) });
  };
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: guardedFetch } };
  const admin = createClient(TARGET, config.SERVICE_ROLE_KEY, options), pending = new Set();
  const checks = [], observations = [], cleanup = [];
  let stage = 'SETUP', failure = null, completed = false, lastDoubleStatus = null;
  const check = (name, condition) => { checks.push({ name, passed: Boolean(condition) }); if (!condition) throw Error('LOCAL_CONTRACT_ASSERTION_FAILED'); };
  const ledger = () => { mkdirSync(paths.directory, { recursive: true }); writeFileSync(paths.ledgerFile, JSON.stringify({ target: TARGET, marker, ids: [...pending] }, null, 2) + '\n'); };
  const read = async query => { const value = await query; if (value.error || value.data === null) throw Error('LOCAL_DATABASE_QUERY_FAILED'); return value.data; };
  const mutate = async query => { if ((await query).error) throw Error('LOCAL_DATABASE_WRITE_FAILED'); };
  const control = async value => {
    const response = await guardedFetch(doubleOrigin + (value ? '/__control' : '/__status'), {
      method: value ? 'POST' : 'GET', headers: { Authorization: `Bearer ${doubleConfig.key}`, 'Content-Type': 'application/json' },
      ...(value ? { body: JSON.stringify(value) } : {}),
    });
    if (!response.ok) throw Error('DOUBLE_CONTROL_FAILED');
    return response.json();
  };
  async function cleanupUser(id) {
    const found = await admin.auth.admin.getUserById(id);
    if (!found.error) {
      if (found.data.user?.user_metadata?.test_run !== marker || found.data.user?.is_anonymous !== true) throw Error('CLEANUP_OWNERSHIP_GUARD');
      if ((await admin.auth.admin.deleteUser(id, false)).error) throw Error('CLEANUP_DELETE_FAILED');
    } else if (found.error.status !== 404) throw Error('CLEANUP_LOOKUP_FAILED');
    const absent = await admin.auth.admin.getUserById(id);
    if (absent.data.user || absent.error?.status !== 404) throw Error('CLEANUP_AUTH_REMAINS');
    for (const table of TABLES) {
      const column = table === 'profiles' ? 'id' : 'user_id';
      const rows = await admin.from(table).select(column, { head: true, count: 'exact' }).eq(column, id);
      if (rows.error || rows.count !== 0) throw Error('CLEANUP_ROWS_REMAIN');
    }
    pending.delete(id); ledger(); cleanup.push({ auth404: true, emptyOwnedTables: TABLES.length });
  }
  async function identity() {
    const client = createClient(TARGET, config.ANON_KEY, options);
    const result = await client.auth.signInAnonymously({ options: { data: { test_run: marker } } });
    if (result.error || !result.data.user || !result.data.session) throw Error('LOCAL_AUTH_CREATE_FAILED');
    const id = result.data.user.id; pending.add(id); ledger();
    const verified = await client.auth.getUser();
    check('local Auth getUser verifies the synthetic anonymous session', !verified.error && verified.data.user?.id === id && verified.data.user.is_anonymous);
    await mutate(client.from('profiles').update({ memory_enabled: false }).eq('id', id));
    return { id, client, token: result.data.session.access_token };
  }
  async function edge(endpoint, body, owner) {
    const response = await guardedFetch(`${TARGET}/functions/v1/${endpoint}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: config.ANON_KEY, Authorization: `Bearer ${owner.token}`, Origin: 'http://127.0.0.1:5173' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(100_000) });
    const envelope = await response.json();
    observations.push({ stage, endpoint, httpStatus: response.status, status: envelope.data?.executionStatus ?? null, code: envelope.error?.code ?? envelope.data?.partialError?.details?.reason ?? null });
    check(`${stage}: valid authenticated Edge envelope`, envelope.ok === true && envelope.meta?.requestId === body.requestId && envelope.meta.schemaVersion === 1
      && response.headers.get('cache-control') === 'no-store');
    check(`${stage}: public reply strips internal evidence`, !hasInternalEvidence(envelope));
    return { status: response.status, data: envelope.data };
  }
  async function phase(id, work) {
    stage = id; await control({ action: 'NEXT', stage: id });
    const result = await work();
    lastDoubleStatus = await control();
    check(`${id}: exact bounded provider request sequence`, lastDoubleStatus.stage === id && !lastDoubleStatus.failures.length
      && lastDoubleStatus.withinStage === SCENARIOS.find(item => item.id === id).outputs.length && lastDoubleStatus.sourceFrozen);
    return result;
  }
  async function storedAssistant(owner, id) {
    const row = await read(owner.client.from('messages').select('id,content,metadata,model_id,prompt_version').eq('id', id).eq('user_id', owner.id).single());
    check(`${stage}: DB provenance explicitly identifies HTTP double and candidate version`, row.model_id === MODEL && row.prompt_version === CANDIDATE.persona);
    check(`${stage}: persisted metadata strips internal evidence`, !hasInternalEvidence(row));
    return row;
  }
  globalThis.fetch = guardedFetch;
  try {
    if (existsSync(paths.ledgerFile)) {
      const old = JSON.parse(readFileSync(paths.ledgerFile, 'utf8'));
      if (old.target !== TARGET || old.marker !== marker || !Array.isArray(old.ids)
        || old.ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id))) throw Error('CLEANUP_LEDGER_MISMATCH');
      old.ids.forEach(id => pending.add(id)); for (const id of [...pending]) await cleanupUser(id);
    }
    if (cleanupOnly) { completed = true; return; }
    lastDoubleStatus = await control();
    check('fresh local double matches frozen candidate source and has no prior requests', lastDoubleStatus.kind === 'JUMZIP_SYNTHETIC_HTTP_DOUBLE'
      && lastDoubleStatus.model === MODEL && lastDoubleStatus.sourceHash === digest(before) && lastDoubleStatus.providerRequests === 0 && lastDoubleStatus.stage === null);
    const owner = await identity(), stranger = await identity();
    const conversation = await read(owner.client.from('conversations').insert({ user_id: owner.id, character_id: 'SANI', title: '합성 HTTP 계약 검사' }).select('id').single());
    check('stranger RLS cannot read the owned conversation', (await read(stranger.client.from('conversations').select('id').eq('id', conversation.id))).length === 0);
    const chatRequest = message => ({ schemaVersion: 1, requestId: randomUUID(), action: 'SEND', conversationId: conversation.id, consultationId: null, message });
    const none = await phase('CHAT_NONE', () => edge('chat', chatRequest(MESSAGES.CHAT_NONE), owner));
    check('valid NONE classification yields successful Chat with null recommendation', none.status === 201 && none.data.executionStatus === 'SUCCEEDED' && none.data.recommendation === null);
    const noneRow = await storedAssistant(owner, none.data.assistantMessage.id);
    check('normal NONE reload has null recommendation', noneRow.metadata.recommendation === null);
    const suggested = await phase('CHAT_RECOMMENDATION', () => edge('chat', chatRequest(MESSAGES.CHAT_RECOMMENDATION), owner));
    const recommended = suggested.data.recommendation?.recommendedTools;
    check('Intent explicit Tarot recommendation keeps missing choices and recent situation', suggested.status === 201 && suggested.data.executionStatus === 'SUCCEEDED'
      && recommended?.length === 1 && recommended[0].tool === 'TAROT' && recommended[0].mode === 'DECISION_3'
      && stable(recommended[0].missingSlots) === stable(['choices', 'recentSituation']));
    const recommendedRow = await storedAssistant(owner, suggested.data.assistantMessage.id);
    check('recommendation reload equals the actual Edge response', stable(recommendedRow.metadata.recommendation) === stable(suggested.data.recommendation));
    check('recommendation alone does not execute a draw', (await read(owner.client.from('tarot_draw_groups').select('id').eq('user_id', owner.id))).length === 0);
    const drawRequest = () => ({ schemaVersion: 1, requestId: randomUUID(), action: 'DRAW', conversationId: conversation.id, consultationId: null,
      question: '오늘 편안히 쉬기 위해 할 작은 행동은?', spreadType: 'ONE_CARD', mode: 'NORMAL', clientTimezone: 'Asia/Seoul' });
    const repaired = await phase('TAROT_REPAIR', () => edge('tarot', drawRequest(), owner));
    check('missing evidence is repaired exactly once and then succeeds', repaired.data.executionStatus === 'SUCCEEDED' && Boolean(repaired.data.interpretation?.messageId));
    await storedAssistant(owner, repaired.data.interpretation.messageId);
    const partial = await phase('TAROT_PARTIAL', () => edge('tarot', drawRequest(), owner));
    check('malformed initial plus one malformed repair leaves an explicit saved PARTIAL', partial.status === 200 && partial.data.executionStatus === 'PARTIAL'
      && partial.data.interpretation === null && partial.data.partialError?.code === 'TAROT_INTERPRETATION_FAILED'
      && partial.data.partialError?.details?.reason === 'LLM_INVALID_RESPONSE');
    const reloadCards = () => read(owner.client.from('tarot_draws').select('card_id,orientation,position_index').eq('draw_group_id', partial.data.drawGroupId).order('position_index'));
    const cardsBefore = await reloadCards();
    check('partial draw reload exactly matches public saved cards', cardsBefore.length === 1 && cardsBefore[0].card_id === partial.data.cards[0].cardId
      && cardsBefore[0].orientation === partial.data.cards[0].orientation && cardsBefore[0].position_index === partial.data.cards[0].positionIndex);
    check('partial draw has no fabricated assistant result', (await read(owner.client.from('messages').select('id').eq('consultation_id', partial.data.consultationId).eq('sender', 'ASSISTANT'))).length === 0);
    check('stranger cannot read partial draw cards', (await read(stranger.client.from('tarot_draws').select('id').eq('draw_group_id', partial.data.drawGroupId))).length === 0);
    const retryRequest = { schemaVersion: 1, requestId: randomUUID(), action: 'RETRY_INTERPRETATION', conversationId: conversation.id, drawGroupId: partial.data.drawGroupId };
    const retried = await phase('TAROT_RETRY', () => edge('tarot', retryRequest, owner));
    check('retry reuses stored cards and finishes the same draw', retried.data.executionStatus === 'SUCCEEDED' && retried.data.drawGroupId === partial.data.drawGroupId
      && stable(retried.data.cards) === stable(partial.data.cards) && stable(await reloadCards()) === stable(cardsBefore));
    const retryRow = await storedAssistant(owner, retried.data.interpretation.messageId);
    check('retry message reload retains canonical draw linkage', retryRow.metadata.tarot?.drawGroupId === partial.data.drawGroupId);
    const state = async () => ({ executions: await read(admin.from('request_executions').select('id,status,resource_id,updated_at').eq('user_id', owner.id).order('id')),
      rates: await read(admin.from('rate_limit_buckets').select('operation,count,updated_at').eq('user_id', owner.id).order('operation')),
      messages: await read(owner.client.from('messages').select('id').eq('user_id', owner.id).order('id')) });
    const beforeReplay = await state();
    const replay = await phase('RETRY_REPLAY', () => edge('tarot', retryRequest, owner));
    check('same UUID replays identical data with zero provider calls or persisted changes', stable(replay.data) === stable(retried.data) && stable(await state()) === stable(beforeReplay));
    check('only two real draw groups exist after retry and replay', (await read(owner.client.from('tarot_draw_groups').select('id').eq('user_id', owner.id))).length === 2);
    // The initial failure is an explicit fixture injection, not a real provider failure.
    // Pure calculation and RPC persistence remain real; only the subsequent retry traverses Edge.
    stage = 'SAJU_SEED';
    const { calculateFullSajuWithTiming } = await import('../../supabase/functions/_shared/domain/fortune-timing.ts');
    const asOf = '2026-09-20T00:00:00.000Z';
    const birth = { calendarType: 'SOLAR', leapMonth: false, birthDate: '1990-05-10', birthTime: '12:30', birthTimeUnknown: false, gender: 'MALE',
      location: { providerId: '1835848', name: 'Seoul', country: 'South Korea', latitude: 37.5665, longitude: 126.978, timezone: 'Asia/Seoul' } };
    const calculated = calculateFullSajuWithTiming(birth, new Date(asOf));
    const seededClaim = await read(admin.rpc('begin_saju_request', { p_params: { user_id: owner.id, operation: 'saju.CALCULATE', request_id: randomUUID(),
      payload_hash: digest('SYNTHETIC_YEAR_FLOW_PARTIAL_SEED'), conversation_id: conversation.id, consultation_id: null, target_type: 'SAJU', focus: 'YEAR_FLOW' } }));
    const seeded = await read(admin.rpc('save_saju_reading', { p_execution_id: seededClaim.executionId, p_result: calculated, p_birth_profile_snapshot: birth, p_profile_input: null }));
    await mutate(admin.rpc('fail_execution', { p_execution_id: seededClaim.executionId,
      p_error: { code: 'SAJU_INTERPRETATION_FAILED', message: '합성 PARTIAL 준비', retryable: true, details: { reason: 'INJECTED_TEST_FAILURE' } }, p_http_status: 200 }));
    const readSaju = () => read(admin.from('saju_readings').select('result_snapshot').eq('id', seeded.readingId).eq('user_id', owner.id).single());
    const sajuBefore = (await readSaju()).result_snapshot;
    const saju = await phase('SAJU_FOCUS_RETRY', () => edge('saju', { schemaVersion: 1, requestId: randomUUID(), action: 'RETRY_INTERPRETATION',
      conversationId: conversation.id, readingId: seeded.readingId }, owner));
    check('actual Saju Edge retry succeeds with stored YEAR_FLOW focus', saju.data.executionStatus === 'SUCCEEDED' && saju.data.readingId === seeded.readingId
      && lastDoubleStatus.attempts.at(-1)?.storedFocus === 'YEAR_FLOW');
    check('Saju Edge retry preserves the exact original result snapshot and asOf', stable((await readSaju()).result_snapshot) === stable(sajuBefore)
      && sajuBefore.timing?.asOf === asOf && saju.data.inlineResult?.currentFlow?.timing?.asOf === asOf);
    await storedAssistant(owner, saju.data.interpretation.messageId);
    const messages = await read(owner.client.from('messages').select('metadata').eq('user_id', owner.id));
    const executions = await read(admin.from('request_executions').select('response_data').eq('user_id', owner.id));
    check('all persisted messages and idempotent response caches omit internal evidence', !hasInternalEvidence(messages) && !hasInternalEvidence(executions));
    check('provider and Edge counts match the fixed plan without background work', lastDoubleStatus.providerRequests === 10 && counts.edgeHTTP === 7 && counts.blockedDestinations === 0);
    completed = true;
  } catch (error) { failure = { stage, code: safeCode(error) }; }
  finally {
    if (!cleanupOnly) {
      try { lastDoubleStatus = await control(); }
      catch { failure ??= { stage: 'FINAL_PROVIDER_STATE', code: 'DOUBLE_STATUS_UNAVAILABLE' }; }
    }
    for (const id of [...pending]) { try { await cleanupUser(id); } catch (error) { failure ??= { stage: 'CLEANUP', code: safeCode(error) }; } }
    globalThis.fetch = nativeFetch;
    const frozen = digest(sourceHashes()) === digest(before);
    const report = { status: completed && !failure && pending.size === 0 && frozen ? 'PASS' : 'FAIL', at: new Date().toISOString(), runName,
      scope: 'ACTUAL_LOCAL_AUTH_EDGE_DATABASE_WITH_SYNTHETIC_HTTP_PROVIDER', target: TARGET, model: MODEL, candidate: CANDIDATE,
      sourceHashes: before, sourceFrozen: frozen, actualModelCalls: completed ? 0 : null, externalRequests: 0, hostedDatabase: false, semanticQualityEvaluated: false,
      providerRoutingConfirmedByMain: !cleanupOnly, incompleteRunModelRouting: completed ? null : 'Failure does not independently prove all Edge provider routing; inspect stage and double counts.',
      checks, observations, counts, provider: lastDoubleStatus, cleanup, pendingCleanupCount: pending.size, failure,
      limitations: ['HTTP completions are explicit synthetic doubles, not model quality evidence.', 'Cloudflare-only provider options are covered by separate zero-network runtime tests.',
        'Title and memory maintenance are disabled in this dedicated temporary local env; their lifecycle is outside this test.',
        'Main must restore the original local functions serve env; this harness never changes services.'] };
    if (!cleanupOnly) {
      mkdirSync(paths.directory, { recursive: true }); mkdirSync('docs/evidence', { recursive: true });
      writeFileSync(paths.reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
      writeFileSync(EVIDENCE, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    }
    console.log(JSON.stringify({ status: report.status, cleanupOnly, checks: checks.length, passed: checks.filter(item => item.passed).length,
      providerHTTP: lastDoubleStatus?.providerRequests ?? 0, edgeHTTP: counts.edgeHTTP, modelCalls: completed ? 0 : null, pendingCleanupCount: pending.size, evidence: cleanupOnly ? null : EVIDENCE }));
    if (report.status !== 'PASS') process.exitCode = 1;
  }
}
