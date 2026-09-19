// Default is a zero-network plan; --preflight verifies the staged tree offline.
// Actual execution additionally requires Main's post-reset GO and explicit markers.
import { createClient } from '@supabase/supabase-js';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROJECT = 'klhoarharlmliuynoezq';
const TARGET = `https://${PROJECT}.supabase.co`;
const STAGE_ROOT = 'supabase/.temp/edge-saju-focus-v4-GwYN70';
const MANIFEST = 'docs/evidence/edge-saju-focus-release.json';
const REPORT = 'docs/evidence/backend-hosted-saju-focus.json';
const LEDGER = 'test-results/pending-hosted-saju-focus-cleanup.json';
const MARKER = 'JumZip hosted Saju focus retry smoke';
const MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
const AS_OF = '2026-09-20T00:00:00.000Z';
const TABLES = ['profiles', 'conversations', 'consultations', 'messages', 'tarot_draw_groups', 'tarot_draws', 'birth_profiles', 'saju_readings', 'saju_compatibility_readings', 'related_people', 'memories', 'memory_suppressions', 'request_executions', 'rate_limit_buckets', 'daily_draw_claims'];
const EDGE_STAGES = ['EDGE_INVALID_FOCUS', 'EDGE_FOREIGN_READING', 'EDGE_VALID_RETRY', 'EDGE_VALID_REPLAY'];
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const plan = {
  target: TARGET, maximumMarkedAccounts: 2, maximumEdgeRequests: 4, maximumLogicalInferenceOperations: 1,
  maximumSeedRpcRequests: 9,
  sourceEnforcedProviderHttpMaximum: 2, actualProviderHttpCount: 'UNKNOWN_NOT_OBSERVABLE_FROM_EDGE_CLIENT',
  expectedModel: MODEL, expectedPromptVersion: 'JumZipPersona-v4', expectedIntentVersion: 'JumZipIntent-v1',
  initialCalculation: 'Synthetic fixture: actual pure engine plus begin/save/fail RPCs; no initial Edge CALCULATE or model request.',
  fixtures: ['owned YEAR_FLOW partial', 'owned invalid-focus partial row', 'second marked owner partial row'],
  sequence: EDGE_STAGES,
  quota: '3 RPC-seeded calculations; invalid retry and valid retry charge owner A, foreign begin rolls back, identical UUID replay adds no charge. Expected totals A4/B1.',
  modelLimit: 'One valid retry only. Reviewed source permits one primary and at most one repair; no direct provider instrumentation or retry-on-failure.',
  zeroModelBoundaryEvidence: '422/404 plus reviewed pre-generation source order, not independent remote provider metering.',
  cleanup: 'Immediate marked-user ID ledger; finally verify Auth404 and zero rows across fifteen owned tables.',
  evidencePolicy: 'Refuse execution when the report already exists; create the final PASS or FAIL report exclusively without overwriting prior evidence.',
  rawResponsePolicy: 'Responses stay in process memory; only safe status, hashes, lengths and persisted model/version metadata enter the report.',
  limitations: ['No public signup/CAPTCHA test.', 'No semantic Persona quality or independent astronomical acceptance claim.', 'Synthetic location seed is not a provider-resolution test.'],
  runRequirements: ['Main post-reset live GO', '--run', `--expected-project-ref=${PROJECT}`, 'JUMZIP_RUN_HOSTED_SAJU_FOCUS=LIVE_AFTER_RESET', 'deployed v4/v1 release manifest', 'Node --experimental-transform-types --env-file=.env.server.local'],
};
const hash = value => createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
});
const safeError = error => typeof error?.code === 'string' && /^[A-Z_]{3,80}$/.test(error.code) ? error.code
  : error instanceof Error && /^[A-Z0-9_]{3,100}$/.test(error.message) ? error.message : 'HOSTED_SMOKE_FAILURE';
const moduleUrl = path => pathToFileURL(resolve(STAGE_ROOT, 'supabase/functions', path)).href;

function verifySource(requireDeployment) {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  if (manifest.promptVersion !== 'JumZipPersona-v4' || manifest.intentVersion !== 'JumZipIntent-v1' || manifest.model !== MODEL
    || manifest.overlayCommit !== 'ec118014549cb40d02f582ed73ce092e40a20c4a'
    || requireDeployment && !String(manifest.status).startsWith('DEPLOYED')) throw Error('REVIEWED_RELEASE_GUARD');
  const files = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(join(directory, entry.name)) : [relative(STAGE_ROOT, join(directory, entry.name)).replaceAll('\\', '/')]);
  // Deployment adds these two CLI bookkeeping files outside the function source tree.
  // Do not read their content or permit arbitrary new files in the staged release.
  const cliBookkeeping = new Set(['supabase/.temp/cli-latest', 'supabase/.temp/linked-project.json']);
  const actualFiles = files(join(STAGE_ROOT, 'supabase'));
  if (stable(actualFiles.filter(path => !cliBookkeeping.has(path)).sort()) !== stable(manifest.files.map(file => file.path).sort())) throw Error('STAGED_TREE_MISMATCH');
  for (const file of manifest.files) if (hash(readFileSync(join(STAGE_ROOT, file.path))) !== file.sha256) throw Error('STAGED_SOURCE_HASH_MISMATCH');
  const source = path => readFileSync(join(STAGE_ROOT, 'supabase/functions/_shared', path), 'utf8');
  const saju = source('orchestration/saju.ts'), reply = source('llm/reply.ts');
  const ordered = ['if (claim.replay)', 'await dependencies.readings.readFocus(', 'saved = claim.resource;', 'await dependencies.executions.context(', 'await dependencies.generate('].map(part => saju.indexOf(part));
  if (ordered.some((position, index) => position < 0 || index > 0 && position <= ordered[index - 1])
    || (reply.match(/provider\.generateChat\(/g) ?? []).length !== 1 || (reply.match(/provider\.repairChat\(/g) ?? []).length !== 1) throw Error('PREINFERENCE_OR_SINGLE_REPAIR_PROOF_CHANGED');
  return { manifest: MANIFEST, manifestSha256: hash(readFileSync(MANIFEST)), stage: STAGE_ROOT, status: manifest.status,
    files: manifest.files.length, excludedCliBookkeepingPaths: actualFiles.filter(path => cliBookkeeping.has(path)),
    sourceSetSha256: hash(stable(manifest.files.map(file => [file.path, file.sha256]))),
    stagedSajuSha256: hash(saju), stagedProviderSha256: hash(source('llm/provider.ts')), stagedReplySha256: hash(reply),
    boundary: 'replay return → owned focus query → saved assignment → context → generator; one primary plus at most one repair',
    remoteProviderMetering: false };
}

const argumentsList = process.argv.slice(2);
const argumentModes = argumentsList.filter(value => ['--run', '--plan', '--preflight'].includes(value));
const projectArguments = argumentsList.filter(value => value.startsWith('--expected-project-ref='));
const invalidArguments = argumentsList.some(value => !['--run', '--plan', '--preflight'].includes(value) && !/^--expected-project-ref=[a-z0-9]{20}$/.test(value))
  || argumentModes.length > 1 || projectArguments.length > 1 || projectArguments.length > 0 && !argumentsList.includes('--run');
if (invalidArguments) {
  console.log(JSON.stringify({ status: 'NOT_RUN', code: 'UNEXPECTED_OR_CONFLICTING_ARGUMENTS' })); process.exitCode = 1;
} else if (!process.argv.includes('--run')) {
  try { console.log(JSON.stringify({ ...plan, ...(process.argv.includes('--preflight') ? { offlineSourceProof: verifySource(false) } : {}) }, null, 2)); }
  catch (error) { console.log(JSON.stringify({ status: 'NOT_RUN', code: safeError(error) })); process.exitCode = 1; }
} else {
  try { await live(); }
  catch (error) { console.log(JSON.stringify({ status: 'FAILED', code: safeError(error), report: REPORT })); process.exitCode = 1; }
}

async function live() {
  const expected = process.argv.find(value => value.startsWith('--expected-project-ref='))?.slice(23);
  if (process.env.JUMZIP_RUN_HOSTED_SAJU_FOCUS !== 'LIVE_AFTER_RESET' || expected !== PROJECT) throw Error('EXPLICIT_POST_RESET_GO_REQUIRED');
  if (existsSync(REPORT)) throw Error('EXISTING_REPORT_PRESERVED');
  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY, secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url !== TARGET || !anon || !secret) throw Error('EXACT_HOSTED_PROJECT_GUARD');
  const sourceProof = verifySource(true);
  const { calculateFullSajuWithTiming } = await import(moduleUrl('_shared/domain/fortune-timing.ts'));
  const { sajuRequestSchema, payloadHash } = await import(moduleUrl('_shared/validation/requests.ts'));
  const { createBoundedFetch } = await import(moduleUrl('_shared/http/network.ts'));
  const nativeFetch = globalThis.fetch;
  const ordinaryFetch = createBoundedFetch({ fetchImpl: nativeFetch, timeoutMs: 20_000 });
  const edgeFetch = createBoundedFetch({ fetchImpl: nativeFetch, timeoutMs: 105_000 });
  const counts = { auth: 0, rest: 0, seedRpc: 0, edge: 0, directProvider: 0, blockedDestinations: 0, logicalInferenceRetries: 0 };
  let stage = 'SETUP', registeredEdgeHash = null, failure = null;
  const usedEdgeStages = new Set(), ids = new Set(), checks = [], observations = [], cleanup = [];
  const guardedFetch = (input, init) => {
    const destination = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (destination.origin !== TARGET || destination.username || destination.password) { counts.blockedDestinations++; throw Error('FOREIGN_DESTINATION_BLOCKED'); }
    let selected = ordinaryFetch;
    if (destination.pathname === '/functions/v1/saju') {
      if (!EDGE_STAGES.includes(stage) || usedEdgeStages.has(stage) || init?.method !== 'POST' || counts.edge >= 4
        || typeof init.body !== 'string' || hash(init.body) !== registeredEdgeHash) throw Error('EDGE_SCOPE_OR_BUDGET_GUARD');
      usedEdgeStages.add(stage); counts.edge++; selected = edgeFetch;
      if (stage === 'EDGE_VALID_RETRY' && ++counts.logicalInferenceRetries > 1) throw Error('LOGICAL_INFERENCE_BUDGET_GUARD');
    } else if (/^\/auth\/v1(?:\/|$)/.test(destination.pathname)) counts.auth++;
    else if (/^\/rest\/v1(?:\/|$)/.test(destination.pathname)) counts.rest++;
    else { counts.blockedDestinations++; throw Error('UNAPPROVED_DESTINATION_BLOCKED'); }
    return selected(input, { ...init, redirect: 'error' });
  };
  globalThis.fetch = guardedFetch;
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: guardedFetch } };
  const admin = createClient(TARGET, secret, options);
  const check = (condition, name) => { checks.push({ name, passed: Boolean(condition) }); if (!condition) throw Error('HOSTED_ASSERTION_FAILED'); };
  const ledger = () => { mkdirSync('test-results', { recursive: true }); writeFileSync(LEDGER, JSON.stringify({ target: TARGET, marker: MARKER, ids: [...ids] }, null, 2) + '\n'); };
  const read = async query => { const result = await query; if (result.error || result.data === null) throw Error('SYNTHETIC_QUERY_FAILED'); return result.data; };
  const mutate = async query => { if ((await query).error) throw Error('SYNTHETIC_WRITE_FAILED'); };
  const rpc = async (name, parameters) => {
    if (counts.seedRpc >= plan.maximumSeedRpcRequests) throw Error('SEED_RPC_BUDGET_GUARD');
    counts.seedRpc++;
    const result = await admin.rpc(name, parameters); if (result.error) throw Error('SYNTHETIC_RPC_FAILED'); return result.data;
  };

  async function remove(id) {
    const found = await admin.auth.admin.getUserById(id);
    if (!found.error) {
      if (found.data.user?.user_metadata?.test_run !== MARKER || !/^jumzip-hosted-focus-[0-9a-f-]+@example\.com$/i.test(found.data.user?.email ?? '')) throw Error('CLEANUP_OWNERSHIP_GUARD');
      if ((await admin.auth.admin.deleteUser(id, false)).error) throw Error('CLEANUP_AUTH_DELETE_FAILED');
    } else if (found.error.status !== 404) throw Error('CLEANUP_AUTH_LOOKUP_FAILED');
    const absent = await admin.auth.admin.getUserById(id);
    if (absent.data.user || absent.error?.status !== 404) throw Error('CLEANUP_AUTH_REMAINS');
    for (const table of TABLES) {
      const column = table === 'profiles' ? 'id' : 'user_id';
      const result = await admin.from(table).select(column, { head: true, count: 'exact' }).eq(column, id);
      if (result.error || result.count !== 0) throw Error('CLEANUP_OWNED_ROWS_REMAIN');
    }
    ids.delete(id); ledger(); cleanup.push({ authAbsent: true, emptyOwnedTables: TABLES.length });
  }
  async function identity() {
    if (ids.size >= 2) throw Error('MARKED_IDENTITY_CAP');
    const email = `jumzip-hosted-focus-${randomUUID()}@example.com`;
    const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { test_run: MARKER } });
    if (created.error || !created.data.user) throw Error('SYNTHETIC_AUTH_CREATE_FAILED');
    const id = created.data.user.id; ids.add(id); ledger();
    await mutate(admin.from('profiles').update({ memory_enabled: false }).eq('id', id));
    const client = createClient(TARGET, anon, options);
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error || link.data.user?.id !== id || !link.data.properties?.hashed_token) throw Error('SYNTHETIC_AUTH_LINK_FAILED');
    const session = await client.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token });
    if (session.error || session.data.user?.id !== id || !session.data.session) throw Error('SYNTHETIC_AUTH_SESSION_FAILED');
    const conversation = await read(admin.from('conversations').insert({ user_id: id, character_id: 'SANI', title: '합성 focus 재시도 검증' }).select('id').single());
    return { id, token: session.data.session.access_token, conversationId: conversation.id };
  }
  async function seed(owner, focus) {
    const input = { calendarType: 'SOLAR', leapMonth: false, birthDate: '1990-05-10', birthTime: '12:30', birthTimeUnknown: false, gender: 'MALE',
      location: { providerId: '1835848', name: 'Seoul', country: 'South Korea', latitude: 37.5665, longitude: 126.978, timezone: 'Asia/Seoul' } };
    const request = sajuRequestSchema.parse({ schemaVersion: 1, action: 'CALCULATE', requestId: randomUUID(), conversationId: owner.conversationId,
      consultationId: null, subject: { input, saveProfile: false }, focus });
    const calculated = calculateFullSajuWithTiming(input, new Date(AS_OF));
    const claim = await rpc('begin_saju_request', { p_params: { user_id: owner.id, operation: 'saju.CALCULATE', request_id: request.requestId,
      payload_hash: await payloadHash(request), conversation_id: owner.conversationId, consultation_id: null, target_type: 'SAJU', focus } });
    const saved = await rpc('save_saju_reading', { p_execution_id: claim.executionId, p_result: calculated, p_birth_profile_snapshot: input, p_profile_input: null });
    await rpc('fail_execution', { p_execution_id: claim.executionId, p_error: { code: 'SAJU_INTERPRETATION_FAILED', message: '모델을 호출하지 않은 합성 PARTIAL seed', retryable: true,
      details: { readingId: saved.readingId, reason: 'SYNTHETIC_SEED_NO_LLM' } }, p_http_status: 200 });
    check(saved.executionStatus === 'PARTIAL' && saved.interpretation === null, `${focus}: actual RPC seed is PARTIAL without interpretation`);
    return { readingId: saved.readingId, consultationId: saved.consultationId, resultHash: hash(stable(calculated)) };
  }
  const reading = (owner, fixture) => read(admin.from('saju_readings').select('result_snapshot').eq('id', fixture.readingId).eq('user_id', owner.id).eq('consultation_id', fixture.consultationId).single());
  async function state(owner) {
    const result = {};
    for (const table of ['saju_readings', 'messages', 'request_executions', 'rate_limit_buckets']) {
      result[table] = (await read(admin.from(table).select('*').eq('user_id', owner.id))).map(stable).sort();
    }
    return hash(stable(result));
  }
  async function edge(owner, fixture, requestId = randomUUID()) {
    const request = sajuRequestSchema.parse({ schemaVersion: 1, action: 'RETRY_INTERPRETATION', requestId, conversationId: owner.conversationId, readingId: fixture.readingId });
    const body = JSON.stringify(request); registeredEdgeHash = hash(body);
    const started = performance.now();
    const response = await guardedFetch(`${TARGET}/functions/v1/saju`, { method: 'POST', headers: { authorization: `Bearer ${owner.token}`, apikey: anon,
      'content-type': 'application/json', Origin: 'https://jumzip.pages.dev' }, body });
    const result = await response.json();
    observations.push({ stage, status: response.status, ok: result.ok === true, executionStatus: result.data?.executionStatus ?? null,
      errorCode: typeof result.error?.code === 'string' && /^[A-Z_]{3,80}$/.test(result.error.code) ? result.error.code : null,
      elapsedWallMs: Math.round(performance.now() - started), requestIdMatches: result.meta?.requestId === requestId,
      dataHash: result.data ? hash(stable(result.data)) : null, responseContentRecorded: false });
    if (response.status === 429) throw Error('RATE_LIMITED_STOP');
    return { response, result, requestId };
  }

  try {
    if (existsSync(LEDGER)) {
      const old = JSON.parse(readFileSync(LEDGER, 'utf8'));
      if (old.target !== TARGET || old.marker !== MARKER || !Array.isArray(old.ids) || old.ids.length > 2 || old.ids.some(id => typeof id !== 'string' || !UUID.test(id))) throw Error('CLEANUP_LEDGER_MISMATCH');
      old.ids.forEach(id => ids.add(id)); for (const id of [...ids]) await remove(id);
    }
    const owner = await identity(), foreign = await identity();
    stage = 'RPC_SEED';
    const valid = await seed(owner, 'YEAR_FLOW'), invalid = await seed(owner, 'GENERAL'), foreignRow = await seed(foreign, 'YEAR_FLOW');
    await mutate(admin.from('consultations').update({ question: 'year_flow' }).eq('id', invalid.consultationId).eq('user_id', owner.id));
    const badOwned = await read(admin.from('consultations').select('question').eq('id', invalid.consultationId).eq('user_id', owner.id).eq('conversation_id', owner.conversationId).single());
    check(badOwned.question === 'year_flow', 'invalid focus is an actual owned row, not a fabricated UUID');
    const before = (await reading(owner, valid)).result_snapshot;
    check(before.timing?.asOf === AS_OF && hash(stable(before)) === valid.resultHash, 'valid actual DB seed matches the real pure-engine result and fixed asOf');

    stage = 'EDGE_INVALID_FOCUS'; const bad = await edge(owner, invalid);
    check(bad.response.status === 422 && bad.result.ok === false && bad.result.error?.code === 'SAJU_INPUT_INCOMPLETE' && !Object.hasOwn(bad.result, 'data'), 'owned corrupt focus returns typed422 before generation by reviewed route');
    check((await read(admin.from('messages').select('id').eq('user_id', owner.id).eq('consultation_id', invalid.consultationId).eq('sender', 'ASSISTANT'))).length === 0, 'invalid focus produced no assistant row');
    stage = 'EDGE_FOREIGN_READING'; const ownerState = await state(owner), foreignState = await state(foreign);
    const denied = await edge(owner, foreignRow);
    check(denied.response.status === 404 && denied.result.ok === false && denied.result.error?.code === 'NOT_FOUND' && !Object.hasOwn(denied.result, 'data'), 'real foreign reading returns404 with no derived data');
    check(await state(owner) === ownerState && await state(foreign) === foreignState, 'foreign rejection leaves both owners persistence and quota unchanged');

    stage = 'EDGE_VALID_RETRY'; const success = await edge(owner, valid);
    check(success.response.status === 200 && success.result.ok === true && success.result.data?.executionStatus === 'SUCCEEDED', 'actual single YEAR_FLOW retry succeeds');
    check(success.result.data.readingId === valid.readingId && success.result.data.consultationId === valid.consultationId, 'retry retains the original reading and consultation');
    const after = (await reading(owner, valid)).result_snapshot;
    check(hash(stable(after)) === hash(stable(before)) && after.timing?.asOf === AS_OF, 'actual Edge retry preserves the immutable calculation and asOf');
    const focusRow = await read(admin.from('consultations').select('question').eq('id', valid.consultationId).eq('user_id', owner.id).single());
    check(focusRow.question === 'YEAR_FLOW', 'actual stored original focus remains YEAR_FLOW after retry');
    const answers = await read(admin.from('messages').select('id,model_id,prompt_version,content').eq('user_id', owner.id).eq('consultation_id', valid.consultationId).eq('sender', 'ASSISTANT'));
    check(answers.length === 1 && answers[0].model_id === MODEL && answers[0].prompt_version === 'JumZipPersona-v4', 'durable actual reply confirms configured Qwen and Persona-v4');
    observations.push({ stage: 'PERSISTED_MODEL_METADATA', model: answers[0].model_id, promptVersion: answers[0].prompt_version,
      contentSha256: hash(answers[0].content), contentCharacters: answers[0].content.length, providerHttpCount: 'UNKNOWN', semanticQualityReviewed: false });
    const beforeReplay = await state(owner);
    stage = 'EDGE_VALID_REPLAY'; const replay = await edge(owner, valid, success.requestId);
    check(replay.response.status === 200 && replay.result.ok === true && stable(replay.result.data) === stable(success.result.data), 'same UUID returns identical persisted response data');
    check(await state(owner) === beforeReplay, 'same UUID leaves messages, readings, executions and quota byte-canonically unchanged');
    for (const [label, actor, expectedQuota] of [['A', owner, 4], ['B', foreign, 1]]) {
      const buckets = await read(admin.from('rate_limit_buckets').select('count').eq('user_id', actor.id).eq('operation', 'SAJU'));
      check(buckets.reduce((sum, row) => sum + Number(row.count), 0) === expectedQuota, `owner ${label}: expected real SAJU quota with no replay recharge`);
    }
    check(verifySource(true).sourceSetSha256 === sourceProof.sourceSetSha256 && counts.blockedDestinations === 0, 'frozen reviewed source and exact network target remain unchanged');
  } catch (error) { failure = checks.findLast(check => !check.passed)?.name ?? safeError(error); }
  finally {
    for (const id of [...ids]) { try { await remove(id); } catch { failure ??= 'SYNTHETIC_CLEANUP_PENDING'; } }
    globalThis.fetch = nativeFetch;
    const report = { at: new Date().toISOString(), status: !failure && ids.size === 0 ? 'PASS' : 'FAIL', ...plan, sourceProof, checks, observations, counts,
      providerRequests: { sourceEnforcedMaximum: 2, actual: 'UNKNOWN_NOT_OBSERVABLE_FROM_EDGE_CLIENT' },
      replayEvidence: { observed: 'Response equality and unchanged durable messages/readings/executions/quota when corresponding checks pass.', sourceGuarantee: 'Replay branch returns before focus/context/generation.', directlyMeteredProviderCalls: false },
      initialCalculateWasSyntheticRpcSeed: true, rawResponsesSaved: false, rawIdentityOrCredentialSavedInReport: false,
      cleanup, pendingCleanupCount: ids.size, failedStage: failure ? stage : null, failure };
    mkdirSync('docs/evidence', { recursive: true }); writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ status: report.status, passed: checks.filter(check => check.passed).length, failed: checks.filter(check => !check.passed).length,
      edgeRequests: counts.edge, seedRpc: counts.seedRpc, logicalInferenceRetries: counts.logicalInferenceRetries, actualProviderHttpCount: 'UNKNOWN',
      cleanupVerified: cleanup.length, pendingCleanupCount: ids.size, report: REPORT, failure }));
    if (failure || ids.size) process.exitCode = 1;
  }
}
