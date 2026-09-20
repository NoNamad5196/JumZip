/** Bounded v4.1 synthetic dialogue probe. Default: plan only, no credentials/network.
 * Main must explicitly authorize every live invocation after checking account usage.
 * Stage provider/reply own request bodies and the single validation repair.
 */
import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildRelease } from './prepare-chat-reliability-release.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
export const GO = 'MAIN_APPROVED_FRESH_USAGE';
export const CAP = 500, MAX_HTTP = 8, MAX_OUTPUT = 900;
export const RATES = Object.freeze({ inputNeuronsPerMillion: 4625, outputNeuronsPerMillion: 30475 });
export const CASES = Object.freeze([
  ...['BOMI', 'SANI', 'ARANG'].map(characterId => ({ id: `greeting:${characterId}`, input: { characterId, currentMessage: '안녕. 오늘 처음 이야기하러 왔어.', toolResult: null }, reviewChecks: ['현재 캐릭터의 인사와 말투', '실행하지 않은 도구나 과거 기억을 꾸미지 않음'] })),
  { id: 'synthetic-recall:BOMI', input: { characterId: 'BOMI', currentMessage: '내가 오래 즐겨 온 취미가 무엇이었는지 기억하고 있으면 말해 줘.', toolResult: null,
    memories: [{ id: 'synthetic-paper-star', scope: 'GLOBAL', category: 'PREFERENCE', subject: 'USER', content: '종이별 접기를 오래 즐기고 있으며, 꾸준히 만드는 종이별을 가장 좋아함', importance: 5 }] }, reviewChecks: ['제공된 종이별 취미 기억에 답함', '없는 기억·출생정보·점술 실행을 만들지 않음'] },
]);
const sha = value => createHash('sha256').update(value).digest('hex');
export const cost = (input, output) => (input * RATES.inputNeuronsPerMillion + output * RATES.outputNeuronsPerMillion) / 1_000_000;
const within = (base, target) => { const path = relative(base, target); return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path); };
const fail = code => { throw Error(code); };
const cancel = stream => { try { void stream?.cancel().catch(() => {}); } catch { /* Never wait for cancellation. */ } };
const SAFE_ERROR_CODES = new Set(['LLM_NOT_CONFIGURED', 'LLM_TIMEOUT', 'LLM_UNAVAILABLE', 'LLM_AUTH_FAILED', 'LLM_RATE_LIMITED', 'LLM_INVALID_RESPONSE']);

export function plan() {
  return { mode: 'PLAN_ONLY', credentialsRead: false, actualHTTPAttempts: 0, model: MODEL, promptVersion: 'JumZipPersona-v4.1', intentVersion: 'JumZipIntent-v1',
    logicalCases: CASES.map(item => item.id), maximumLogicalCases: 4, maximumHTTPAttempts: MAX_HTTP, maxOutputTokens: MAX_OUTPUT, maximumRepairsPerReply: 1,
    initialTimeoutMs: 60_000, repairTimeoutMs: 30_000, ceilingNeurons: CAP, rates: RATES, reservation: 'SERIALIZED_UTF8_BYTES_AS_INPUT_TOKENS_PLUS_900_OUTPUT_TOKENS',
    noHostedAuthDbEdgeCalls: true, noTitleMemoryIntentCalls: true, liveAuthorized: false };
}

export function assertManifest(manifest, expected) {
  if (manifest?.status !== 'PREPARED_NOT_DEPLOYED' || manifest.promptVersion !== 'JumZipPersona-v4.1' || manifest.intentVersion !== 'JumZipIntent-v1'
    || manifest.model !== MODEL || manifest.baseVerifiedFiles !== 53 || manifest.files?.length !== 54 || new Set(manifest.files.map(item => item.path)).size !== 54
    || JSON.stringify(manifest.files) !== JSON.stringify(expected.files) || JSON.stringify(manifest.supportFiles) !== JSON.stringify(expected.supportFiles)
    || JSON.stringify(manifest.contracts) !== JSON.stringify(['DEFAULT', 'TEXT_ONLY_V1']) || JSON.stringify(manifest.changedFiles) !== JSON.stringify(expected.changedFiles)
    || manifest.baseFilesSha256 !== expected.baseFilesSha256 || manifest.baseManifestSha256 !== expected.baseManifestSha256) fail('STAGE_MANIFEST_MISMATCH');
}

export async function verifyStage(stageArgument) {
  if (typeof stageArgument !== 'string' || !stageArgument) fail('STAGE_REQUIRED');
  const parent = resolve(ROOT, 'supabase/.temp'), stage = resolve(ROOT, stageArgument);
  if (dirname(stage) !== parent || !/^chat-reliability-v4-1-[A-Za-z0-9_-]+$/.test(stage.slice(parent.length + 1))) fail('UNSAFE_STAGE_PATH');
  if ((await lstat(stage)).isSymbolicLink() || !within(await realpath(parent), await realpath(stage))) fail('UNSAFE_STAGE_PATH');
  const manifestBytes = await readFile(join(stage, 'release-manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const { report: expected } = buildRelease();
  assertManifest(manifest, expected);
  const offlineBytes = await readFile(join(stage, 'offline-verification.json'));
  const offline = JSON.parse(offlineBytes.toString('utf8'));
  if (offline.status !== 'OFFLINE_CHECKS_PASSED' || offline.stagedTypecheckPassed !== true || offline.verifiedFiles !== 54 || offline.sourceFrozen !== true || offline.networkRequests !== 0 || offline.modelRequests !== 0) fail('STAGE_OFFLINE_CHECKS_REQUIRED');
  const files = [];
  const walk = async directory => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isSymbolicLink() || !within(stage, await realpath(path))) fail('UNSAFE_STAGE_ENTRY');
      if (item.isDirectory()) await walk(path);
      else if (item.isFile()) files.push(relative(stage, path).replaceAll('\\', '/'));
      else fail('UNSAFE_STAGE_ENTRY');
    }
  };
  await walk(stage);
  if (JSON.stringify(files.sort()) !== JSON.stringify([...manifest.files.map(item => item.path), 'release-manifest.json', 'offline-verification.json'].sort())) fail('STAGE_FILE_SET_MISMATCH');
  for (const item of manifest.files) {
    const path = resolve(stage, item.path);
    if (!within(stage, path)) fail('UNSAFE_STAGE_ENTRY');
    const bytes = await readFile(path);
    if (bytes.length !== item.bytes || sha(bytes) !== item.sha256) fail('STAGE_FILE_HASH_MISMATCH');
  }
  return { stage, manifest, manifestSha256: sha(manifestBytes), offlineVerificationSha256: sha(offlineBytes) };
}

export function checkedEndpoint(baseUrl, expectedAccountId) {
  if (typeof expectedAccountId !== 'string' || !/^[a-f0-9]{32}$/.test(expectedAccountId)) fail('ACCOUNT_CONFIGURATION_INVALID');
  let url; try { url = new URL(baseUrl); } catch { fail('ACCOUNT_CONFIGURATION_INVALID'); }
  const path = `/client/v4/accounts/${expectedAccountId}/ai/v1`;
  if (url.origin !== 'https://api.cloudflare.com' || ![path, path + '/'].includes(url.pathname) || url.search || url.hash || url.username || url.password) fail('ACCOUNT_CONFIGURATION_INVALID');
  return url.origin + path + '/chat/completions';
}

export async function boundedBody(response, signal, cap) {
  const reader = response.body?.getReader(); if (!reader) return Buffer.alloc(0);
  let total = 0; const chunks = []; let abort;
  try {
    return await Promise.race([(async () => {
      while (true) { const { done, value } = await reader.read(); if (signal?.aborted) throw Error('BODY_ABORTED'); if (done) break; total += value.byteLength; if (total > cap) { cancel(reader); throw Error('BODY_CAP'); } chunks.push(value); }
      return Buffer.concat(chunks, total);
    })(), new Promise((_, reject) => { abort = () => { cancel(reader); reject(Error('BODY_ABORTED')); }; if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true }); })]);
  } finally { if (abort) signal?.removeEventListener('abort', abort); }
}

export function createTransport({ endpoint, state, getCaseId, fetchImpl = fetch }) {
  return async (url, init) => {
    if (String(url) !== endpoint || state.stopReason) fail('LOCAL_TRANSPORT_BLOCKED');
    const serialized = String(init?.body), body = JSON.parse(serialized), id = getCaseId();
    const prior = state.attempts.filter(item => item.id === id).length;
    if (!CASES.some(item => item.id === id) || prior >= 2 || body.model !== MODEL || body.max_tokens !== MAX_OUTPUT || body.stream !== false
      || body.response_format?.type !== 'json_object' || body.temperature !== (prior ? 0.15 : 0.65)) { state.stopReason = 'REQUEST_CONTRACT_CHANGED'; fail('LOCAL_TRANSPORT_BLOCKED'); }
    const reserve = cost(Buffer.byteLength(serialized), MAX_OUTPUT);
    if (state.attempts.length >= MAX_HTTP || state.neuronsAccounted + reserve > CAP) {
      state.stopReason = 'LOCAL_BUDGET_OR_ATTEMPT_CAP'; state.notSent.push({ id, stage: prior ? 'REPAIR' : 'INITIAL', reserveNeurons: reserve }); fail('LOCAL_TRANSPORT_BLOCKED');
    }
    state.neuronsAccounted += reserve;
    const attempt = { id, stage: prior ? 'REPAIR' : 'INITIAL', requestSha256: sha(serialized), requestBytes: Buffer.byteLength(serialized), reserveNeurons: reserve, neurons: reserve, usageEstimated: true };
    state.attempts.push(attempt);
    const start = performance.now();
    try {
      // Redirect rejection is transport protection; the stage-authored body is byte-identical.
      const response = await fetchImpl(url, { ...init, redirect: 'error' });
      if (init?.signal?.aborted) { cancel(response.body); state.stopReason = 'PROVIDER_TIMEOUT'; fail('BODY_ABORTED'); }
      attempt.httpStatus = response.status;
      const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      attempt.contentType = ['application/json', 'text/plain', 'text/html'].includes(mime) ? mime : 'OTHER_OR_MISSING';
      if (!response.ok) {
        state.stopReason = response.status === 429 ? 'PROVIDER_RATE_LIMITED' : [401, 403].includes(response.status) ? 'PROVIDER_AUTH_FAILED' : 'PROVIDER_HTTP_ERROR';
        // Read at most4KiB for numeric error codes only; never persist body/message.
        try {
          const bytes = await boundedBody(response, init?.signal, 4096), parsed = JSON.parse(bytes.toString('utf8'));
          const codes = [parsed?.error?.code, ...(Array.isArray(parsed?.errors) ? parsed.errors.map(item => item?.code) : [])];
          attempt.cloudflareCodes = [...new Set(codes.filter(code => code === 3036 || code === 3040))].sort();
        } catch { attempt.errorBodyDiagnosis = 'UNAVAILABLE'; }
        attempt.responseBodyOmitted = true;
        return new Response(null, { status: response.status });
      }
      const bytes = await boundedBody(response, init?.signal, 128_000);
      let parsed; try { parsed = JSON.parse(bytes.toString('utf8')); } catch { /* Stage provider diagnoses its envelope. */ }
      const input = parsed?.usage?.prompt_tokens, output = parsed?.usage?.completion_tokens;
      if (typeof input === 'number' && typeof output === 'number' && Number.isFinite(input + output) && input >= 0 && output >= 0) {
        const actual = cost(input, output); state.neuronsAccounted += actual - reserve;
        Object.assign(attempt, { promptTokens: input, completionTokens: output, neurons: actual, usageEstimated: false });
        if (actual > reserve || state.neuronsAccounted > CAP) state.stopReason = 'PROVIDER_USAGE_EXCEEDED_RESERVATION';
      }
      // Save neither the raw envelope nor reasoning. Only the stage-validated final
      // synthetic reply is recorded by the caller for direct semantic review.
      attempt.responseBodyOmitted = true;
      return new Response(bytes, { status: response.status, headers: { 'Content-Type': 'application/json' } });
    } catch {
      state.stopReason ??= init?.signal?.aborted ? 'PROVIDER_TIMEOUT' : 'TRANSPORT_OR_CAPTURE_FAILED';
      attempt.responseBodyOmitted = true;
      throw Error('SAFE_TRANSPORT_FAILURE');
    } finally { attempt.latencyMs = Math.round(performance.now() - start); }
  };
}

async function assertAbsent(path) { try { await access(path); fail('REPORT_ALREADY_EXISTS'); } catch (error) { if (error?.code !== 'ENOENT') fail('REPORT_ALREADY_EXISTS'); } }

export async function main(args = process.argv.slice(2), env = process.env) {
  const allowed = args.every(arg => arg === '--execute' || arg.startsWith('--stage=') || arg.startsWith('--expected-account-id='));
  if (!allowed || args.filter(arg => arg === '--execute').length > 1 || args.filter(arg => arg.startsWith('--stage=')).length > 1 || args.filter(arg => arg.startsWith('--expected-account-id=')).length > 1) fail('ARGUMENTS_INVALID');
  const stageArgument = args.find(arg => arg.startsWith('--stage='))?.slice(8);
  if (!args.includes('--execute')) {
    if (!stageArgument) return plan();
    const verified = await verifyStage(stageArgument);
    return { ...plan(), stageVerified: true, verifiedFileCount: verified.manifest.files.length, manifestSha256: verified.manifestSha256, offlineVerificationSha256: verified.offlineVerificationSha256 };
  }
  if (env.JUMZIP_CHAT_RELIABILITY_LIVE_GO !== GO) fail('MAIN_FRESH_USAGE_GO_REQUIRED');
  const before = await verifyStage(stageArgument);
  if (env.LLM_MODEL !== MODEL || typeof env.LLM_API_KEY !== 'string' || !env.LLM_API_KEY.trim() || /[\r\n]/.test(env.LLM_API_KEY)) fail('MODEL_CONFIGURATION_INVALID');
  const endpoint = checkedEndpoint(env.LLM_BASE_URL, args.find(arg => arg.startsWith('--expected-account-id='))?.slice('--expected-account-id='.length));
  const directory = join(ROOT, 'test-results/chat-reliability-live', `v4-1-${randomUUID()}`);
  const resultPath = join(directory, 'result.json'), startPath = join(directory, 'run-start.json');
  await assertAbsent(startPath); await assertAbsent(resultPath); await mkdir(directory, { recursive: true });
  const scriptHash = sha((await readFile(fileURLToPath(import.meta.url), 'utf8')).replaceAll('\r\n', '\n'));
  const start = { ...plan(), mode: 'LIVE_APPROVED', liveAuthorized: true, credentialsRead: true, startedAt: new Date().toISOString(), scriptSha256: scriptHash,
    stageManifestSha256: before.manifestSha256, offlineVerificationSha256: before.offlineVerificationSha256, stageFiles: before.manifest.files, cases: CASES, casesSha256: sha(JSON.stringify(CASES)) };
  await writeFile(startPath, JSON.stringify(start, null, 2) + '\n', { flag: 'wx' });
  const state = { attempts: [], neuronsAccounted: 0, stopReason: null, notSent: [] }, entries = [];
  let activeId = CASES[0].id, frozen, finalResult;
  try {
    const moduleAt = suffix => pathToFileURL(join(before.stage, 'supabase/functions/_shared', suffix)).href;
    const [{ createOpenAICompatibleProvider }, { generatePersonaReply, PERSONA_PROMPT_VERSION }, { safeFailure }] = await Promise.all([
      import(moduleAt('llm/provider.ts')), import(moduleAt('llm/reply.ts')), import(moduleAt('http/errors.ts')),
    ]);
    if (PERSONA_PROMPT_VERSION !== 'JumZipPersona-v4.1') fail('STAGE_VERSION_CHANGED');
    const provider = createOpenAICompatibleProvider({ baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: MODEL, maxOutputTokens: MAX_OUTPUT, structuredFormat: 'json_object', initialTimeoutMs: 60_000, repairTimeoutMs: 30_000,
      fetchImpl: createTransport({ endpoint, state, getCaseId: () => activeId }) });
    for (const item of CASES) {
      if (state.stopReason) break;
      activeId = item.id;
      const entry = { id: item.id, response: null, error: null, reviewChecks: item.reviewChecks };
      try {
        const reply = await generatePersonaReply(provider, item.input);
        // Only validated synthetic prose is review evidence. Never include arbitrary
        // provider model metadata; an unexpected literal credential is suppressed.
        if (JSON.stringify(reply).includes(env.LLM_API_KEY)) { state.stopReason = 'SECRET_ECHO_SUPPRESSED'; fail('UNSAFE_REPLY'); }
        entry.response = { content: reply.content, segments: reply.segments, repaired: reply.repaired, promptVersion: reply.metadata.promptVersion };
      } catch (error) {
        const safe = safeFailure(error).toJSON();
        // The provider deadline can reject before a slow fetch wrapper settles.
        // Stop here too, so that race cannot advance to the next logical case.
        const reason = safe.details?.reason ?? safe.code;
        if (['LLM_TIMEOUT', 'LLM_UNAVAILABLE', 'LLM_AUTH_FAILED', 'LLM_RATE_LIMITED'].includes(reason)) state.stopReason ??= reason === 'LLM_TIMEOUT' ? 'PROVIDER_TIMEOUT' : reason === 'LLM_AUTH_FAILED' ? 'PROVIDER_AUTH_FAILED' : reason === 'LLM_RATE_LIMITED' ? 'PROVIDER_RATE_LIMITED' : 'TRANSPORT_OR_CAPTURE_FAILED';
        entry.error = { code: SAFE_ERROR_CODES.has(safe.code) ? safe.code : 'PROBE_EXECUTION_FAILED', details: safe.details ?? null };
      }
      entry.actualHTTPAttempts = state.attempts.filter(attempt => attempt.id === item.id).length;
      entry.status = state.stopReason ? 'INTERRUPTED' : entry.response ? 'VALID_UNREVIEWED' : 'INVALID';
      if (!entry.actualHTTPAttempts) state.stopReason ??= 'LOCAL_REJECTION_BEFORE_SEND';
      entries.push(entry);
    }
  } catch { state.stopReason ??= 'LOCAL_SETUP_OR_RUN_FAILURE'; }
  finally {
    try {
      const after = await verifyStage(stageArgument);
      frozen = after.manifestSha256 === before.manifestSha256 && after.offlineVerificationSha256 === before.offlineVerificationSha256 && scriptHash === sha((await readFile(fileURLToPath(import.meta.url), 'utf8')).replaceAll('\r\n', '\n'));
    } catch { frozen = false; }
    if (!frozen) state.stopReason ??= 'SOURCE_CHANGED';
    const pendingIds = CASES.filter(item => !entries.some(entry => entry.id === item.id && entry.status !== 'INTERRUPTED')).map(item => item.id);
    const result = { ...start, completedAt: new Date().toISOString(), sourceFrozen: frozen, entries, attempts: state.attempts, notSentRequests: state.notSent,
      actualHTTPAttempts: state.attempts.length, neuronsAccounted: state.neuronsAccounted, stopReason: state.stopReason, pendingIds,
      completed: entries.length === 4 && !state.stopReason, rawErrorBodiesPersisted: false, credentialsPersisted: false, sourceAccountUsageNotQueried: true,
      assessment: 'REQUIRES_DIRECT_SYNTHETIC_ANSWER_REVIEW_NOT_GENERAL_QUALITY_CERTIFICATION' };
    await writeFile(resultPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ report: relative(ROOT, resultPath).replaceAll('\\', '/'), completed: result.completed, sourceFrozen: frozen, actualHTTPAttempts: state.attempts.length, neuronsAccounted: state.neuronsAccounted, stopReason: state.stopReason, pendingCount: pendingIds.length }));
    if (!result.completed) process.exitCode = 1;
    finalResult = result;
  }
  return finalResult;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(result => { if (result.mode === 'PLAN_ONLY') console.log(JSON.stringify(result)); }).catch(() => { console.error(JSON.stringify({ status: 'NOT_STARTED_OR_NOT_RECORDED', reason: 'PROBE_GUARD_OR_LOCAL_FAILURE', rawErrorOmitted: true })); process.exitCode = 1; });
}
