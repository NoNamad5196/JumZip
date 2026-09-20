/** Synthetic Intent-only evaluation. Default: credential-free, zero-network preflight.
 * Live requires --live AND JUMZIP_INTENT_V5_LIVE_GO=1 after explicit Main approval. */
import { appendFile, mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, join } from 'node:path';
import { INTENT_V5_CASES, INTENT_V5_CORPUS_VERSION } from './intent-v5-corpus.ts';
import { INTENT_PROMPT_VERSION, extractToolRecommendation, type Recommendation } from '../../supabase/functions/_shared/llm/intent.ts';
import { createOpenAICompatibleProvider, LLMError, type LLMProvider, type StructuredRequest } from '../../supabase/functions/_shared/llm/provider.ts';

const execute = process.argv.includes('--live');
if (execute && process.env.JUMZIP_INTENT_V5_LIVE_GO !== '1') throw Error('INTENT_V5_EXPLICIT_LIVE_GO_REQUIRED');
if (String(INTENT_PROMPT_VERSION) !== 'JumZipIntent-v5') throw Error('INTENT_V5_SOURCE_VERSION_REQUIRED');
const runName = process.argv.find(value => value.startsWith('--run-name='))?.slice(11) ?? 'initial28';
if (!/^[a-z][a-z0-9-]{0,47}$/.test(runName)) throw Error('INVALID_RUN_NAME');
const root = resolve('tests/persona/benchmark-runs/intent-v5'), directory = resolve(root, runName);
if (!directory.startsWith(root + '/') && !directory.startsWith(root + '\\')) throw Error('OUTPUT_PATH_GUARD');
const paths = Object.fromEntries(['preflight', 'selection', 'review-template', 'live-started', 'results', 'manifest'].map(name => [name, join(directory, name + '.json')])) as Record<string, string>;
const rawPath = join(directory, 'provider-attempts.jsonl');
const model = '@cf/google/gemma-4-26b-a4b-it', ceilingNeurons = 800, maximumAttempts = 56;
const rates = { inputNeuronsPerMillion: 9091, outputNeuronsPerMillion: 27273 };
const cost = (input: number, output: number) => (input * rates.inputNeuronsPerMillion + output * rates.outputNeuronsPerMillion) / 1_000_000;
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const endpoint = new URL(execute ? process.env.LLM_BASE_URL ?? '' : 'https://api.cloudflare.com/client/v4/accounts/synthetic-preflight-only/ai/v1');
if (endpoint.origin !== 'https://api.cloudflare.com' || !/^\/client\/v4\/accounts\/[^/]+\/ai\/v1\/?$/.test(endpoint.pathname) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw Error('EXACT_CLOUDFLARE_ACCOUNT_API_REQUIRED');
const key = execute ? process.env.LLM_API_KEY : undefined;
if (execute && !key) throw Error('INTENT_V5_PRIVATE_KEY_REQUIRED');
const exists = async (path: string) => { try { await access(path); return true; } catch { return false; } };
async function sourceHashes() {
  const files: string[] = [];
  const walk = async (folder: string) => { for (const entry of await readdir(folder, { withFileTypes: true })) { const path = join(folder, entry.name); if (entry.isDirectory()) await walk(path); else if (path.endsWith('.ts') && !path.replaceAll('\\', '/').endsWith('/persona/memory.ts')) files.push(path); } };
  for (const folder of ['domain', 'persona', 'llm']) await walk(resolve('supabase/functions/_shared/' + folder));
  files.push(...['intent-v5-corpus.ts', 'intent-v5-runner.mts', 'intent-v4-corpus.ts', 'intent-v3-corpus.ts', 'v5-focused-corpus.mts', 'saju-benchmark-corpus.ts', 'benchmark-runs/v5-focused/results.json', 'benchmark-runs/intent-v4/initial26-final800-reviewed/selection.json', 'benchmark-runs/intent-v4/initial26-final800-reviewed/manifest.json', 'benchmark-runs/intent-v4/initial26-final800-reviewed/provider-attempts.jsonl'].map(file => resolve('tests/persona', file)));
  return Object.fromEntries(await Promise.all(files.sort().map(async file => [relative(process.cwd(), file).replaceAll('\\', '/'), sha((await readFile(file, 'utf8')).replaceAll('\r\n', '\n'))])));
}
const before = await sourceHashes();
const selection = { version: INTENT_V5_CORPUS_VERSION, synthetic: true, source: 'Engineering §11/11.1; unchanged original26 inputs/expectations plus2 pre-frozen v5 semantic safety contrasts',
  cases: INTENT_V5_CASES.map(({ mockClassification: _mock, ...item }) => ({ ...item, inputSha256: sha(JSON.stringify(item.input)) })) };
const selectionSha256 = sha(JSON.stringify(selection));
await mkdir(directory, { recursive: true });
if (execute) {
  if ((await Promise.all([paths['live-started']!, paths.results!, paths.manifest!, rawPath].map(exists))).some(Boolean)) throw Error('LIVE_ARTIFACT_OVERWRITE_REFUSED');
  const prior = JSON.parse(await readFile(paths.preflight!, 'utf8'));
  if (prior.networkRequests !== 0 || prior.selectionSha256 !== selectionSha256 || !prior.sourceFrozen || JSON.stringify(prior.sourceHashes) !== JSON.stringify(before)) throw Error('FRESH_PREFLIGHT_REQUIRED');
  await writeFile(paths['live-started']!, JSON.stringify({ at: new Date().toISOString(), selectionSha256, ceilingNeurons, maximumAttempts }), { flag: 'wx' });
} else {
  if ((await Promise.all([paths.preflight!, paths.selection!, paths['review-template']!, paths['live-started']!, paths.results!, paths.manifest!, rawPath].map(exists))).some(Boolean)) throw Error('EXISTING_RUN_ARTIFACT_REFUSED_USE_NEW_RUN_NAME');
  await writeFile(paths.selection!, JSON.stringify(selection, null, 2) + '\n', { flag: 'wx' });
  await writeFile(paths['review-template']!, JSON.stringify({ status: 'UNREVIEWED', reviewer: null, reviewerKind: null, version: INTENT_V5_CORPUS_VERSION,
    instructions: 'Read all synthetic inputs and actual raw/validated outputs. Structural source validity is not proof of alternative meaning or alias identity. Record exact evidence; do not change original expectations.',
    cases: INTENT_V5_CASES.map(item => ({ id: item.id, purposeCorrect: null, toolPriorityCorrect: null, slotSemanticsCorrect: null, recentSituationCorrect: null, periodCorrect: null, evidenceSourceCorrect: null, normalNoneVsFailureCorrect: null, notes: [] })) }, null, 2) + '\n', { flag: 'wx' });
}

const requests: Record<string, unknown>[] = [], attempts: Record<string, unknown>[] = [], entries: Record<string, unknown>[] = [];
let activeId = '', accounted = 0, stopReason: string | null = null;
const cancel = (stream: { cancel(): Promise<unknown> } | null | undefined) => { try { void stream?.cancel().catch(() => {}); } catch { /* No blocking cleanup. */ } };
async function boundedBody(response: Response, signal: AbortSignal | null | undefined) {
  const reader = response.body?.getReader(); if (!reader) throw Error('EMPTY_BODY');
  const decoder = new TextDecoder(); let size = 0, raw = '', abort: (() => void) | undefined;
  try {
    return await Promise.race([(async () => {
      while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 128_000) { cancel(reader); throw Error('RESPONSE_TOO_LARGE'); } raw += decoder.decode(chunk.value, { stream: true }); }
      return raw + decoder.decode();
    })(), new Promise<never>((_, reject) => { abort = () => { cancel(reader); reject(Error('RESPONSE_ABORTED')); }; if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true }); })]);
  } finally { if (abort) signal?.removeEventListener('abort', abort); }
}
const fetchImpl: typeof fetch = async (url, init) => {
  const destination = new URL(String(url));
  if (destination.origin !== endpoint.origin || destination.pathname !== endpoint.pathname.replace(/\/$/, '') + '/chat/completions' || destination.search || destination.hash) throw Error('DESTINATION_CHANGED');
  const serialized = String(init?.body), body = JSON.parse(serialized);
  if (body.model !== model || body.max_tokens !== 350 || body.temperature !== 0.1 || body.stream !== false || body.response_format?.type !== 'json_object' || JSON.stringify(body.chat_template_kwargs) !== JSON.stringify({ enable_thinking: false })) throw Error('EXACT_PROVIDER_CONTRACT_REQUIRED');
  // Assert the real provider body; never inject or alter model options in this wrapper.
  const reserve = cost(Buffer.byteLength(serialized), 350), requestSha256 = sha(serialized);
  requests.push({ id: activeId, requestSha256, utf8Bytes: Buffer.byteLength(serialized), maxOutputTokens: 350, reserveNeurons: reserve });
  if (!execute) return new Response(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }));
  if (stopReason || attempts.length >= maximumAttempts || accounted + reserve > ceilingNeurons) { stopReason ??= 'LOCAL_BUDGET_OR_ATTEMPT_CAP'; throw new LLMError('LLM_RATE_LIMITED', false); }
  accounted += reserve;
  const attempt: Record<string, unknown> = { id: activeId, attempt: attempts.filter(item => item.id === activeId).length + 1, requestSha256, reserveNeurons: reserve, neurons: reserve, usageEstimated: true };
  attempts.push(attempt); const started = performance.now();
  try {
    const response = await fetch(url, init); attempt.status = response.status;
    if (!response.ok) { cancel(response.body); stopReason ??= response.status === 429 ? 'PROVIDER_QUOTA_OR_RATE_LIMIT' : 'PROVIDER_HTTP_ERROR'; attempt.responseBodyOmitted = true; return new Response(null, { status: response.status }); }
    const raw = await boundedBody(response, init?.signal);
    // Preserve synthetic 2xx output, including malformed JSON; redact any literal
    // credential if an anomalous upstream response echoes it. Headers are never saved.
    const safeRaw = key ? raw.replaceAll(key, '[CREDENTIAL_REDACTED]') : raw;
    attempt.syntheticResponseText = safeRaw;
    let captured: { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } | null = null;
    try { captured = JSON.parse(raw); } catch { /* Provider validation gets the unchanged body. */ }
    const input = captured?.usage?.prompt_tokens, output = captured?.usage?.completion_tokens;
    if (typeof input === 'number' && typeof output === 'number' && Number.isFinite(input + output) && input >= 0 && output >= 0) {
      const actual = cost(input, output); accounted += actual - reserve;
      Object.assign(attempt, { promptTokens: input, completionTokens: output, neurons: actual, usageEstimated: false });
      if (actual > reserve || accounted > ceilingNeurons) stopReason ??= 'USAGE_EXCEEDED_RESERVATION';
    }
    return new Response(raw, { status: response.status, headers: { 'Content-Type': 'application/json' } });
  } catch {
    stopReason ??= init?.signal?.aborted ? 'PROVIDER_TIMEOUT' : 'TRANSPORT_OR_CAPTURE_FAILURE';
    attempt.responseBodyOmitted = true; throw new LLMError(init?.signal?.aborted ? 'LLM_TIMEOUT' : 'LLM_UNAVAILABLE');
  } finally { attempt.latencyMs = Math.round(performance.now() - started); await appendFile(rawPath, JSON.stringify(attempt) + '\n'); }
};
const provider = createOpenAICompatibleProvider({ baseUrl: endpoint.href, apiKey: key, model, structuredFormat: 'json_object', initialTimeoutMs: 8_000, repairTimeoutMs: 3_000, maxOutputTokens: 350, fetchImpl });
const startedAt = new Date().toISOString(); let completed = false;
try {
  for (const item of INTENT_V5_CASES) {
    activeId = item.id; let structuredOutput: Record<string, unknown> | null = null, validationSucceeded = false, errorCode: string | null = null;
    const observed: LLMProvider = { ...provider, async generateStructured<T>(request: StructuredRequest<T>) {
      if (!execute) return provider.generateStructured({ ...request, validate: () => ({} as T) });
      try { const result = await provider.generateStructured(request); structuredOutput = result as Record<string, unknown>; validationSucceeded = true; return result; }
      catch (error) { errorCode = error instanceof LLMError ? error.code : 'STRUCTURED_VALIDATION_FAILURE'; throw error; }
    } };
    const recommendation = await extractToolRecommendation(observed, item.input);
    if (!execute) continue;
    const output = structuredOutput as Record<string, unknown> | null, expected = item.expectedSlots;
    const first = recommendation?.recommendedTools[0];
    const toolModeMatched = validationSucceeded && (item.expectedRecommendation.recommendation === 'NONE' ? !first : first?.tool === item.expectedRecommendation.recommendation && item.expectedRecommendation.modes.includes(first.mode));
    const alias = output?.targetAliasEvidence as { state?: unknown; source?: unknown; quote?: unknown } | undefined;
    const missing = expected.missingSlots ?? expected.missingByIntent?.[String(output?.intent)];
    const structuralExpectedMatched = validationSucceeded && expected.requestPurposes.includes(String(output?.requestPurpose)) && (!expected.intents || expected.intents.includes(String(output?.intent))) && output?.explicitTool === expected.explicitTool
      && alias?.state === expected.aliasState && output?.highStakes === expected.highStakes && Array.isArray(output?.choicesEvidence) && output.choicesEvidence.length === expected.choiceCount
      && (!expected.exactTools || JSON.stringify(recommendation?.recommendedTools.map(tool => `${tool.tool}:${tool.mode}`) ?? []) === JSON.stringify(expected.exactTools))
      && (!first || !missing || JSON.stringify(first.missingSlots) === JSON.stringify(missing))
      && (expected.aliasSource === undefined || alias?.source === expected.aliasSource)
      && (expected.aliasQuote === undefined || alias?.quote === expected.aliasQuote)
      && (!expected.choiceSources || JSON.stringify((output?.choicesEvidence as { source: number }[]).map(evidence => evidence.source)) === JSON.stringify(expected.choiceSources))
      && (!expected.choiceQuotes || JSON.stringify((output?.choicesEvidence as { quote: string }[]).map(evidence => evidence.quote)) === JSON.stringify(expected.choiceQuotes))
      && (expected.recentSituationPresent === undefined || output?.recentSituationPresent === expected.recentSituationPresent)
      && (expected.periodPresent === undefined || output?.periodPresent === expected.periodPresent);
    const entry = { id: item.id, origin: item.origin, input: item.input, recommendation: recommendation as Recommendation | null, structuredOutput, validationSucceeded, errorCode,
      disposition: validationSucceeded ? recommendation ? 'VALID_RECOMMENDATION' : 'VALID_NONE' : 'FAILED_NULL', toolModeMatched, structuralExpectedMatched,
      semanticReview: 'UNREVIEWED', expectedRecommendation: item.expectedRecommendation, expectedSlots: expected };
    entries.push(entry); await writeFile(paths.results!, JSON.stringify({ scope: 'SYNTHETIC_INTENT_ONLY_NOT_FULL_ACCEPTANCE', entries, neuronsAccounted: accounted }, null, 2) + '\n');
    console.log(`${item.id} ${entry.disposition} accountedNeurons=${accounted.toFixed(2)}`);
    if (stopReason) break;
  }
  completed = execute ? entries.length === INTENT_V5_CASES.length && !stopReason : requests.length === INTENT_V5_CASES.length;
} finally {
  const after = await sourceHashes(), sourceFrozen = JSON.stringify(before) === JSON.stringify(after);
  const common = { version: INTENT_V5_CORPUS_VERSION, intentVersion: INTENT_PROMPT_VERSION, model, startedAt, completedAt: new Date().toISOString(), selectionSha256,
    sourceHashes: before, afterSourceHashes: after, sourceFrozen, rates, ceilingNeurons, maximumAttempts, requests,
    responseTokens: 350, initialTimeoutMs: 8000, repairTimeoutMs: 3000, thinking: { enable_thinking: false }, completed,
    endpoint: 'https://api.cloudflare.com/client/v4/accounts/[configured-account]/ai/v1/chat/completions', fullAcceptanceEligible: false };
  if (!execute) {
    const prior = JSON.parse(await readFile('tests/persona/benchmark-runs/intent-v4/initial26-final800-reviewed/manifest.json', 'utf8'));
    const oldAttempts = (await readFile('tests/persona/benchmark-runs/intent-v4/initial26-final800-reviewed/provider-attempts.jsonl', 'utf8')).trim().split('\n').map(row => JSON.parse(row) as { id: string; attempt: number; promptTokens: number; completionTokens: number });
    const samples = oldAttempts.map((row, index) => ({ attempt: row.attempt, ratio: row.promptTokens / (prior.requests as { id: string; utf8Bytes: number }[])[index]!.utf8Bytes, output: row.completionTokens })).filter(row => row.attempt === 1);
    const meanRatio = samples.reduce((sum, row) => sum + row.ratio, 0) / samples.length, maximumRatio = Math.max(...samples.map(row => row.ratio));
    const meanOutput = samples.reduce((sum, row) => sum + row.output, 0) / samples.length;
    const bytes = requests.map(row => Number(row.utf8Bytes));
    const forecast = { historicalIntentSamples: samples.length, meanRatio, maximumRatio, historicalMeanOutputTokens: meanOutput,
      initialHistoricalMean: bytes.reduce((sum, value) => sum + cost(value * meanRatio, meanOutput), 0),
      initialAtPriorMaxInputRatioAnd350Output: bytes.reduce((sum, value) => sum + cost(value * maximumRatio, 350), 0),
      allInitialConservativeReservations: requests.reduce((sum, row) => sum + Number(row.reserveNeurons), 0), largestReservation: Math.max(...requests.map(row => Number(row.reserveNeurons))),
      limitations: ['Historical token/byte ratios and output lengths are forecasts only; v5 clarifies the classification target and judgment domain; generic structured repair ordering also changes.', 'Every initial/repair reserves whole UTF8 bytes as input tokens plus350 output before I/O.', 'The800 cap can stop before28 cases; repair costs extra. Missing usage retains reservation.'] };
    await writeFile(paths.preflight!, JSON.stringify({ ...common, mode: 'PREFLIGHT', networkRequests: 0, forecast, actualModelCalls: 0, actualQuotaRemaining: 'NOT_QUERIED', pricingSource: 'https://developers.cloudflare.com/workers-ai/platform/pricing/' }, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ mode: 'PREFLIGHT', cases: requests.length, actualModelCalls: 0, completed, sourceFrozen, forecast, directory: relative(process.cwd(), directory) }));
  } else {
    await writeFile(paths.manifest!, JSON.stringify({ ...common, mode: 'LIVE', stopReason, neuronsAccounted: accounted,
      attempts: attempts.map(({ syntheticResponseText: _raw, ...metadata }) => metadata),
      pendingIds: INTENT_V5_CASES.filter(item => !entries.some(entry => entry.id === item.id) || !attempts.some(attempt => attempt.id === item.id)).map(item => item.id),
      assessment: 'NEEDS_INDEPENDENT_SEMANTIC_REVIEW', passedAutomatically: false }, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ mode: 'LIVE', completed, sourceFrozen, stopReason, entries: entries.length, attempts: attempts.length, neuronsAccounted: accounted }));
  }
  if (!completed || !sourceFrozen) process.exitCode = 1;
}
