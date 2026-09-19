/** PREPARATION ONLY until explicit live opt-in and production v6/v2 are present.
 * Local preflight uses an injected transport and makes zero network requests.
 * Live: JUMZIP_RUN_V6_MICRO=LIVE + --execute, after Main authorizes usage.
 * This authorized three-reply partial cause-check can never declare original84 acceptance passed. */
import { readFile, writeFile, appendFile, readdir, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, relative } from 'node:path';
import { createOpenAICompatibleProvider, LLMError, type LLMProvider, type StructuredRequest } from '../../supabase/functions/_shared/llm/provider.ts';
import { generatePersonaReply, PERSONA_PROMPT_VERSION } from '../../supabase/functions/_shared/llm/reply.ts';
import { buildPersonaMessages } from '../../supabase/functions/_shared/persona/prompt.ts';
import { BENCHMARK_SCORE_KEYS } from '../../supabase/functions/_shared/persona/benchmark.ts';
import { extractToolRecommendation, INTENT_PROMPT_VERSION } from '../../supabase/functions/_shared/llm/intent.ts';
import { PRIVACY_CANARIES } from './saju-benchmark-corpus.ts';
import { V5_REPLY_CASES as ALL_REPLY_CASES, V5_INTENT_CASES as ALL_INTENT_CASES, V5_EXECUTION_ORDER as ORIGINAL_EXECUTION_ORDER, V5_FOCUSED_CORPUS_VERSION } from './v5-focused-corpus.mts';

const V5_EXECUTION_ORDER = ['v5-ab-swapped-contrast:SANI', '10-retry-same-draw:BOMI', 's03-correlated-boundary:ARANG'] as const;
const V5_REPLY_CASES = V5_EXECUTION_ORDER.map(id => { const item = ALL_REPLY_CASES.find(item => item.id === id); if (!item) throw Error('MICRO_SOURCE_CASE_MISSING'); return item; });
const V5_INTENT_CASES = ALL_INTENT_CASES.filter(() => false);
const partialScope = { selectedCount: 3, originalCount: ORIGINAL_EXECUTION_ORDER.length, executionOrder: V5_EXECUTION_ORDER,
  orderReason: 'The large A/B payload runs first so its unchanged conservative reserve fits the authorized350 cap.',
  unselectedIds: ORIGINAL_EXECUTION_ORDER.filter(id => !V5_EXECUTION_ORDER.includes(id as typeof V5_EXECUTION_ORDER[number])),
  inputExpectedRubricUnchanged: true, parentAuthorization: 'Main 2026-09-20 KST: micro3 only, hard350, account8.86k with150 lag allowance; full24 not authorized.' };
const execute = process.argv.includes('--execute');
if (process.argv.slice(2).some(arg => !['--execute', '--preflight'].includes(arg)) || execute && process.argv.includes('--preflight')) throw Error('V6_ARGUMENTS_INVALID');
if (execute && (process.env.JUMZIP_RUN_V6_MICRO !== 'LIVE' || String(PERSONA_PROMPT_VERSION) !== 'JumZipPersona-v6' || String(INTENT_PROMPT_VERSION) !== 'JumZipIntent-v2')) throw Error('V6_LIVE_AUTHORIZATION_AND_SOURCE_REQUIRED');
const mode = execute ? 'LIVE' : 'PREFLIGHT';
const model = '@cf/google/gemma-4-26b-a4b-it';
const rates = { inputNeuronsPerMillion: 9091, outputNeuronsPerMillion: 27273 };
const ceilingNeurons = 350, maximumAttempts = 6;
const output = resolve('tests/persona/benchmark-runs/v6-micro3'); await mkdir(output, { recursive: true });
const preflightName = `preflight-${PERSONA_PROMPT_VERSION}-${INTENT_PROMPT_VERSION}.json`;
const paths = { preflight: join(output, preflightName), rubric: join(output, 'review-template.json'), selection: join(output, 'selection.json'), result: join(output, 'results.json'), raw: join(output, 'provider-attempts.jsonl'), manifest: join(output, 'micro-manifest.json') };
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const cost = (input: number, completion: number) => (input * rates.inputNeuronsPerMillion + completion * rates.outputNeuronsPerMillion) / 1_000_000;
const endpoint = new URL(execute ? process.env.LLM_BASE_URL ?? '' : 'https://api.cloudflare.com/client/v4/accounts/preflight-only/ai/v1');
if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'api.cloudflare.com' || !/^\/client\/v4\/accounts\/[^/]+\/ai\/v1\/?$/.test(endpoint.pathname) || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) throw Error('V6_DESTINATION_NOT_APPROVED');
if (execute && !process.env.LLM_API_KEY) throw Error('V6_API_KEY_REQUIRED');
async function exists(path: string) { try { await access(path); return true; } catch { return false; } }
if (execute && await Promise.all([paths.result, paths.raw, paths.manifest].map(exists)).then(values => values.some(Boolean))) throw Error('V6_RUN_ARTIFACT_ALREADY_EXISTS');
async function sourceHashes() {
  const files: string[] = [];
  const walk = async (path: string) => { for (const entry of await readdir(path, { withFileTypes: true })) { const file = join(path, entry.name); if (entry.isDirectory()) await walk(file); else if (file.endsWith('.ts') && !file.replaceAll('\\', '/').endsWith('/persona/memory.ts')) files.push(file); } };
  for (const folder of ['domain', 'persona', 'llm']) await walk(resolve(`supabase/functions/_shared/${folder}`));
  files.push(resolve('tests/persona/v5-focused-corpus.mts'), resolve('tests/persona/v6-micro3-runner.mts'), resolve('tests/persona/saju-benchmark-corpus.ts'));
  return Object.fromEntries(await Promise.all(files.sort().map(async path => { const bytes = await readFile(path); return [relative(process.cwd(), path).replaceAll('\\', '/'), { raw: sha(bytes), canonicalLF: sha(bytes.toString('utf8').replace(/\r\n/g, '\n')) }]; })));
}
const before = await sourceHashes();
if (execute) {
  const preflight = JSON.parse(await readFile(paths.preflight, 'utf8'));
  if (preflight.networkRequests !== 0 || preflight.replyCount !== V5_REPLY_CASES.length || preflight.intentCount !== V5_INTENT_CASES.length || Object.keys(before).some(path => before[path].canonicalLF !== preflight.sourceHashes?.[path]?.canonicalLF)) throw Error('V6_FRESH_PREFLIGHT_REQUIRED');
}
const selection = { partialScope, corpusVersion: V5_FOCUSED_CORPUS_VERSION, synthetic: true, fullAcceptanceEligible: false, doesNotReplaceOriginal84: true,
  executionOrder: V5_EXECUTION_ORDER,
  reply: V5_REPLY_CASES.map(item => ({ id: item.id, origin: item.origin, inputSha256: sha(JSON.stringify(item.input)), reviewChecks: item.reviewChecks })),
  intent: V5_INTENT_CASES.map(item => ({ id: item.id, inputSha256: sha(JSON.stringify(item.input)), expected: item.expected, reviewChecks: item.reviewChecks })) };
if (!execute) {
  // Keep the v5 corpus and past evidence intact; v6 projections are recorded separately.
  await writeFile(paths.selection, JSON.stringify(selection, null, 2) + '\n');
  const existingRubric = await exists(paths.rubric) ? JSON.parse(await readFile(paths.rubric, 'utf8')) : null;
  if (existingRubric && (existingRubric.status !== 'UNREVIEWED' || existingRubric.reviewer !== null || existingRubric.reply.some((item: { scores: Record<string, unknown> }) => Object.values(item.scores).some(score => score !== null)))) throw Error('REVIEW_TEMPLATE_ALREADY_AUTHORED');
  await writeFile(paths.rubric, JSON.stringify({ schemaVersion: 1, corpusVersion: V5_FOCUSED_CORPUS_VERSION,
    status: 'UNREVIEWED', reviewer: null, reviewerKind: null, method: 'DIRECT_RESPONSE_REVIEW', reviewedAt: null, fullAcceptanceEligible: false,
    instructionsKo: '실제 응답 전체와 고정 입력을 직접 읽고 점수를 작성한다. 비어 있는 점수나 자동 체크를 품질 통과로 처리하지 않는다. AI 검토자는 AI라고 표시한다. 기존 원본84 검사를 이 작은 묶음으로 대체하지 않는다.',
    reply: V5_REPLY_CASES.map(item => ({ id: item.id, scores: Object.fromEntries(BENCHMARK_SCORE_KEYS.map(key => [key, null])), hardFails: null, evidenceKo: [], reviewedOutput: null, checks: item.reviewChecks })),
    intent: V5_INTENT_CASES.map(item => ({ id: item.id, classificationCorrect: null, explicitToolPriorityCorrect: null, noRawDataLeak: null, structuredValidationSucceeded: null, evidenceKo: [], reviewedStructuredOutput: null, reviewedRecommendation: null, expected: item.expected, checks: item.reviewChecks })) }, null, 2) + '\n');
}
const requests: { id: string; phase: string; sha256: string; bytes: number; maximumOutputTokens: number; conservativeReserveNeurons: number; canaryCount: 0 }[] = [];
const attempts: Record<string, unknown>[] = [], entries: Record<string, unknown>[] = [];
let activeId = '', phase: 'REPLY' | 'INTENT' = 'REPLY', accounted = 0, stopReason: string | null = null;
const cancel = (stream: { cancel(): Promise<unknown> } | null | undefined) => { try { void stream?.cancel().catch(() => {}); } catch { /* Best effort only. */ } };
async function boundedBody(response: Response, signal: AbortSignal | null | undefined): Promise<string> {
  const reader = response.body?.getReader(); if (!reader) throw Error('EMPTY_BODY');
  const decoder = new TextDecoder(); let total = 0, raw = '';
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([(async () => {
      while (true) { const { value, done } = await reader.read(); if (done) break; total += value.byteLength; if (total > 128_000) { cancel(reader); throw Error('BODY_CAP'); } raw += decoder.decode(value, { stream: true }); }
      return raw + decoder.decode();
    })(), new Promise<never>((_, reject) => {
      abort = () => { cancel(reader); reject(Error('BODY_ABORTED')); };
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    })]);
  } finally { if (abort) signal?.removeEventListener('abort', abort); }
}
const fetchImpl: typeof fetch = async (url, init) => {
  const destination = new URL(String(url));
  if (destination.origin !== endpoint.origin || destination.pathname !== endpoint.pathname.replace(/\/$/, '') + '/chat/completions' || destination.search || destination.hash) throw Error('V6_DESTINATION_CHANGED');
  const body = JSON.parse(String(init?.body)); body.chat_template_kwargs = { enable_thinking: false };
  const serialized = JSON.stringify(body);
  if (body.model !== model || ![900, 350].includes(body.max_tokens) || body.response_format?.type !== 'json_object') throw Error('V6_REQUEST_CONFIG_CHANGED');
  if (PRIVACY_CANARIES.some(value => serialized.includes(value)) || /birthProfile|PRIVATE_CITY_SENTINEL|"latitude"|"longitude"/.test(serialized)) throw Error('V6_PRIVACY_PREFLIGHT_FAILED');
  const bytes = Buffer.byteLength(serialized), reserve = cost(bytes, body.max_tokens);
  requests.push({ id: activeId, phase, sha256: sha(serialized), bytes, maximumOutputTokens: body.max_tokens, conservativeReserveNeurons: reserve, canaryCount: 0 });
  if (!execute) return new Response(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }), { status: 200 });
  if (stopReason || attempts.length >= maximumAttempts || accounted + reserve > ceilingNeurons) { stopReason ??= 'LOCAL_BUDGET_OR_ATTEMPT_CAP'; throw new LLMError('LLM_RATE_LIMITED', false); }
  // Charge reservation BEFORE I/O; repair cannot race an unaccounted first response.
  accounted += reserve;
  const attempt: Record<string, unknown> = { id: activeId, phase, requestSha256: sha(serialized), reserveNeurons: reserve, neurons: reserve, usageEstimated: true };
  attempts.push(attempt);
  const started = performance.now();
  try {
    const response = await fetch(url, { ...init, body: serialized }); attempt.status = response.status;
    if (!response.ok) {
      cancel(response.body); stopReason ??= response.status === 429 ? 'PROVIDER_QUOTA_OR_RATE_LIMIT' : 'PROVIDER_HTTP_ERROR';
      attempt.responseBodyOmitted = true; return new Response(null, { status: response.status });
    }
    const raw = await boundedBody(response, init?.signal);
    let captured: Record<string, unknown> | null = null;
    try { captured = JSON.parse(raw) as Record<string, unknown>; } catch { /* Preserve provider validation; omit invalid raw body in observations. */ }
    const usage = captured?.usage as { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined;
    const input = usage?.prompt_tokens, completion = usage?.completion_tokens;
    if (typeof input === 'number' && typeof completion === 'number' && Number.isFinite(input + completion) && input >= 0 && completion >= 0) {
      const actual = cost(input, completion); accounted += actual - reserve;
      Object.assign(attempt, { promptTokens: input, completionTokens: completion, neurons: actual, usageEstimated: false });
      if (actual > reserve || accounted > ceilingNeurons) stopReason ??= 'PROVIDER_USAGE_EXCEEDED_RESERVATION';
    }
    if (captured) attempt.response = captured; else attempt.responseCapture = 'NON_JSON_BODY_OMITTED';
    return new Response(raw, { status: response.status, headers: { 'Content-Type': 'application/json' } });
  } catch {
    stopReason ??= init?.signal?.aborted ? 'PROVIDER_TIMEOUT' : 'TRANSPORT_OR_CAPTURE_FAILED';
    attempt.responseBodyOmitted = true; throw new LLMError(init?.signal?.aborted ? 'LLM_TIMEOUT' : 'LLM_UNAVAILABLE');
  } finally {
    attempt.latencyMs = Math.round(performance.now() - started);
    await appendFile(paths.raw, JSON.stringify(attempt) + '\n');
  }
};
const provider = (intent: boolean) => createOpenAICompatibleProvider({ baseUrl: endpoint.href, apiKey: execute ? process.env.LLM_API_KEY : undefined,
  model, structuredFormat: 'json_object', maxOutputTokens: intent ? 350 : 900, initialTimeoutMs: intent ? 8000 : 60_000, repairTimeoutMs: intent ? 3000 : 30_000, fetchImpl });
const replyProvider = provider(false), intentProvider = provider(true);
const startedAt = new Date().toISOString(); let completed = false;
try {
  for (const id of V5_EXECUTION_ORDER) {
    const replyItem = V5_REPLY_CASES.find(item => item.id === id);
    if (replyItem) {
    const item = replyItem; phase = 'REPLY'; activeId = item.id; const started = performance.now();
    if (!execute) { await replyProvider.generateChat(buildPersonaMessages(item.input)); continue; }
    let response = null, errorCode = null;
    try { response = await generatePersonaReply(replyProvider, item.input); } catch (error) { errorCode = error instanceof LLMError ? error.code : 'FOCUSED_REPLY_FAILED'; }
    entries.push({ id: item.id, phase, origin: item.origin, response, errorCode, latencyMs: Math.round(performance.now() - started), review: null });
    await writeFile(paths.result, JSON.stringify({ scope: 'MICRO3_PARTIAL_NOT_ACCEPTANCE', entries, neuronsAccounted: accounted }, null, 2));
    console.log(`${phase} ${item.id} ${errorCode ?? 'generated'} neurons=${accounted.toFixed(2)}`); if (stopReason) break;
    continue;
    }
    const item = V5_INTENT_CASES.find(item => item.id === id)!;
    phase = 'INTENT'; activeId = item.id; const started = performance.now(); let structuredOutput: unknown = null, validationSucceeded = false, errorCode: string | null = null;
    const observed: LLMProvider = { ...intentProvider, async generateStructured<T>(input: StructuredRequest<T>): Promise<T> {
      // Preflight captures the exact provider schema/messages without classifying.
      if (!execute) return intentProvider.generateStructured({ ...input, validate: () => ({} as T) });
      try { const value = await intentProvider.generateStructured(input); structuredOutput = value; validationSucceeded = true; return value; }
      catch (error) { errorCode = error instanceof LLMError ? error.code : 'FOCUSED_INTENT_FAILED'; throw error; }
    } };
    const recommendation = await extractToolRecommendation(observed, item.input);
    if (!execute) continue;
    const actual = recommendation?.recommendedTools[0];
    const matchedExpected = validationSucceeded && (item.expected.recommendation === 'NONE' ? !actual : actual?.tool === item.expected.recommendation && item.expected.modes.includes(actual.mode));
    entries.push({ id: item.id, phase, recommendation, structuredOutput, validationSucceeded, errorCode, matchedExpected, latencyMs: Math.round(performance.now() - started), review: null });
    await writeFile(paths.result, JSON.stringify({ scope: 'MICRO3_PARTIAL_NOT_ACCEPTANCE', entries, neuronsAccounted: accounted }, null, 2));
    console.log(`${phase} ${item.id} ${errorCode ?? 'classified'} neurons=${accounted.toFixed(2)}`); if (stopReason) break;
  }
  completed = execute ? entries.length === V5_REPLY_CASES.length + V5_INTENT_CASES.length && !stopReason : requests.length === V5_REPLY_CASES.length + V5_INTENT_CASES.length;
} finally {
  const after = await sourceHashes(); const changedSources = Object.keys(before).filter(path => before[path].canonicalLF !== after[path]?.canonicalLF);
  if (!execute) {
    const previousDirectory = 'tests/persona/model-comparison-runs/gemma4-v4-full84/';
    const oldRequests = JSON.parse(await readFile(previousDirectory + 'preflight.json', 'utf8')).requests as { id: string; bytes: number }[];
    const oldAttempts = JSON.parse(await readFile(previousDirectory + 'benchmark-baseline-manifest.json', 'utf8')).attempts as { entryId: string; promptTokens: number; completionTokens: number }[];
    const sample = oldRequests.map(request => { const attempt = oldAttempts.find(item => item.entryId === request.id); return attempt ? { ratio: attempt.promptTokens / request.bytes, output: attempt.completionTokens } : null; }).filter(item => item !== null);
    const ratioMean = sample.reduce((sum, item) => sum + item.ratio, 0) / sample.length;
    const ratioMax = Math.max(...sample.map(item => item.ratio)), completionMean = sample.reduce((sum, item) => sum + item.output, 0) / sample.length;
    const estimated = requests.reduce((sum, item) => sum + cost(item.bytes * ratioMean, item.phase === 'REPLY' ? completionMean : 350), 0);
    const estimateAtMaxRatio = requests.reduce((sum, item) => sum + cost(item.bytes * ratioMax, item.phase === 'REPLY' ? completionMean : 350), 0);
    const result = { partialScope, schemaVersion: 1, mode, startedAt, completedAt: new Date().toISOString(), model, corpusVersion: V5_FOCUSED_CORPUS_VERSION,
      promptVersion: PERSONA_PROMPT_VERSION, intentPromptVersion: INTENT_PROMPT_VERSION, requiredLiveVersions: ['JumZipPersona-v6', 'JumZipIntent-v2'],
      preparationUsesOldSource: String(PERSONA_PROMPT_VERSION) !== 'JumZipPersona-v6' || String(INTENT_PROMPT_VERSION) !== 'JumZipIntent-v2',
      networkRequests: 0, replyCount: V5_REPLY_CASES.length, intentCount: V5_INTENT_CASES.length, requests, sourceHashes: before, sourceFrozen: !changedSources.length, changedSources,
      destinationOrigin: endpoint.origin, pathTemplate: '/client/v4/accounts/[configured-account]/ai/v1/chat/completions', rates, ceilingNeurons, maximumAttempts,
      thinking: { enable_thinking: false }, accountBudgetStatus: 'MICRO3_MAIN_GO_350_ONLY',
      inheritedV5PlanningContext: { maintenanceCompletedNeurons: 47.48, maintenanceReservationReleased: true, edge: 400, reserve: 500, source: 'Historical v5 authorization only; not a current balance or permission for v6. The harness does not read account usage.' },
      forecast: { source: previousDirectory + 'benchmark-baseline-manifest.json', priorReplySamples: sample.length, ratioMean, ratioMax, completionMean,
        estimatedInitialRequestsNeurons: estimated, estimatedInitialRequestsUsingPriorMaxRatio: estimateAtMaxRatio,
        assumptions: ['Input tokenization forecast uses previous reply model observations, not a bound', 'This forecast uses previous reply input ratios and all350 output tokens for intent; preparation-audit.json separately estimates using v5 same-entry measurements', 'Repairs add usage; each request retains byte-as-token reservation', 'Production v6 prompt/schema changes require a fresh zero-network preflight', '350 is a hard stop, not a guarantee every entry fits; report pending IDs if stopped'],
        sumOfAllInitialConservativeReservations: requests.reduce((sum, item) => sum + item.conservativeReserveNeurons, 0), largestSingleReserve: Math.max(...requests.map(item => item.conservativeReserveNeurons)) },
      completed, fullAcceptanceEligible: false, pricingSource: 'https://developers.cloudflare.com/workers-ai/platform/pricing/', modelOptionsSource: 'https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/' };
    await writeFile(paths.preflight, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ mode, networkRequests: 0, completed, requestCount: requests.length, currentVersions: [PERSONA_PROMPT_VERSION, INTENT_PROMPT_VERSION], estimatedInitialRequestsNeurons: estimated, estimateAtMaxRatio, ceilingNeurons, sourceFrozen: !changedSources.length }));
  } else {
    await writeFile(paths.manifest, JSON.stringify({ partialScope, schemaVersion: 1, mode, startedAt, completedAt: new Date().toISOString(), completed, stopReason, model,
      promptVersion: PERSONA_PROMPT_VERSION, intentPromptVersion: INTENT_PROMPT_VERSION, corpusVersion: V5_FOCUSED_CORPUS_VERSION, sourceHashes: before, afterSourceHashes: after,
      sourceFrozen: !changedSources.length, changedSources, sourceFreezeScope: 'reply+intent+domain+corpus; background persona/memory.ts excluded',
      rates, ceilingNeurons, maximumAttempts, neuronsAccounted: accounted, attempts: attempts.map(({ response: _response, ...metadata }) => metadata),
      requests, thinking: { enable_thinking: false }, outputTokens: { reply: 900, intent: 350 }, initialTimeoutMs: { reply: 60_000, intent: 8000 }, repairTimeoutMs: { reply: 30_000, intent: 3000 },
      fullAcceptanceEligible: false, pendingIds: [...V5_REPLY_CASES, ...V5_INTENT_CASES].filter(item => !entries.some(entry => entry.id === item.id)).map(item => item.id),
      assessment: 'NEEDS_DIRECT_REVIEW_NOT_ORIGINAL84_ACCEPTANCE' }, null, 2) + '\n');
    console.log(JSON.stringify({ mode, completed, stopReason, entryCount: entries.length, attempts: attempts.length, neuronsAccounted: accounted, sourceFrozen: !changedSources.length }));
  }
  if (!completed || changedSources.length) process.exitCode = 1;
}


