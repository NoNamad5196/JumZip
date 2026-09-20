/** Original core60 + supplement24. Default is a read-only plan, never a model call.
 * Live requires --execute + JUMZIP_RUN_V11_FULL84=LIVE + fresh Main usage/approval.
 * Original corpus, runtime schemas,900 output tokens and one repair stay unchanged. */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createOpenAICompatibleProvider, LLMError } from '../../supabase/functions/_shared/llm/provider.ts';
import { PERSONA_PROMPT_VERSION } from '../../supabase/functions/_shared/llm/reply.ts';
import { INTENT_PROMPT_VERSION } from '../../supabase/functions/_shared/llm/intent.ts';
import { runPersonaBenchmark, type BenchmarkEntry } from '../../supabase/functions/_shared/persona/benchmark.ts';
import { runSajuSupplement } from './saju-benchmark-runner.ts';
import { summarizeMicroProgress, type MicroEntryProgress } from './v9-run-accounting.ts';
import { CASES, CEILING_NEURONS, DIRECTORY, MAXIMUM_ATTEMPTS, MODEL, RATES, assertOriginalSelection, assertVersions, cost, inspectBody, mustNotExist, selection, sha, sourceHashes } from './v11-full84-preflight.mts';

if (process.argv.slice(2).some(arg => arg !== '--execute') || process.argv.slice(2).length > 1) throw Error('V11_FULL84_ARGUMENTS_INVALID');
const execute = process.argv.includes('--execute');
if (!execute) {
  console.log(JSON.stringify({ mode: 'PLAN_ONLY', networkRequests: 0, requiredVersions: ['JumZipPersona-v11', 'JumZipIntent-v6'], coreCount: 60, supplementCount: 24, ceilingNeurons: CEILING_NEURONS, maximumAttempts: MAXIMUM_ATTEMPTS, liveAuthorized: false }));
} else {
  if (process.env.JUMZIP_RUN_V11_FULL84 !== 'LIVE' || process.env.JUMZIP_V11_FULL84_USAGE_GO !== 'FRESH_USAGE_CONFIRMED') throw Error('V11_FULL84_MAIN_USAGE_AND_LIVE_GO_REQUIRED');
  assertVersions(); await assertOriginalSelection();
  const endpoint = new URL(process.env.LLM_BASE_URL ?? '');
  if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'api.cloudflare.com' || !/^\/client\/v4\/accounts\/[^/]+\/ai\/v1\/?$/.test(endpoint.pathname) || endpoint.search || endpoint.hash || endpoint.username || endpoint.password || !process.env.LLM_API_KEY) throw Error('V11_FULL84_DESTINATION_OR_CONFIGURATION_INVALID');
  const paths = { start: join(DIRECTORY, 'run-start.json'), result: join(DIRECTORY, 'results.json'), core: join(DIRECTORY, 'benchmark-results.json'), supplement: join(DIRECTORY, 'saju-benchmark-results.json'), progress: join(DIRECTORY, 'progress.jsonl'), raw: join(DIRECTORY, 'provider-attempts.jsonl'), manifest: join(DIRECTORY, 'manifest.json') };
  for (const path of Object.values(paths)) await mustNotExist(path);
  const before = await sourceHashes();
  const preflightBytes = await readFile(join(DIRECTORY, 'preflight.json'));
  const preflight = JSON.parse(preflightBytes.toString('utf8'));
  const selectionBytes = await readFile(join(DIRECTORY, 'selection.json'));
  const rubricBytes = await readFile(join(DIRECTORY, 'review-template.json'));
  if (preflight.networkRequests !== 0 || !preflight.sourceFrozen || preflight.promptVersion !== PERSONA_PROMPT_VERSION || preflight.intentPromptVersion !== INTENT_PROMPT_VERSION || preflight.ceilingNeurons !== CEILING_NEURONS || preflight.maximumAttempts !== MAXIMUM_ATTEMPTS || preflight.coreCount !== 60 || preflight.supplementCount !== 24 || preflight.selectionSha256 !== sha(selectionBytes) || preflight.rubricSha256 !== sha(rubricBytes) || JSON.stringify(JSON.parse(selectionBytes.toString('utf8'))) !== JSON.stringify(selection) || Object.keys(before).length !== Object.keys(preflight.sourceHashes).length || Object.keys(before).some(path => before[path].canonicalLF !== preflight.sourceHashes?.[path]?.canonicalLF)) throw Error('V11_FULL84_FRESH_PREFLIGHT_REQUIRED');
  const expectedOrder = CASES.map(item => item.id);
  if (JSON.stringify(expectedOrder) !== JSON.stringify(preflight.requests.map((item: { id: string }) => item.id))) throw Error('V11_FULL84_PREFLIGHT_ORDER_CHANGED');
  await mkdir(DIRECTORY, { recursive: true });
  const startedAt = new Date().toISOString();
  await writeFile(paths.start, JSON.stringify({ startedAt, mode: 'LIVE', preflightSha256: sha(preflightBytes), selectionSha256: sha(selectionBytes), rubricSha256: sha(rubricBytes), ceilingNeurons: CEILING_NEURONS, maximumAttempts: MAXIMUM_ATTEMPTS, sourceHashes: before }, null, 2) + '\n', { flag: 'wx' });
  // Exclusive run-start is the run lock. Empty append-only ledgers are reserved next.
  await writeFile(paths.raw, '', { flag: 'wx' }); await writeFile(paths.progress, '', { flag: 'wx' });
  const entries: (BenchmarkEntry & MicroEntryProgress & { group: string })[] = [];
  const attempts: Record<string, unknown>[] = [], requests: Record<string, unknown>[] = [], notSentRequests: Record<string, unknown>[] = [];
  let group = 'CORE', accounted = 0, stopReason: string | null = null, completed = false;
  const progress = () => summarizeMicroProgress(expectedOrder, entries);
  const cancel = (stream: { cancel(): Promise<unknown> } | null | undefined) => { try { void stream?.cancel().catch(() => {}); } catch { /* Do not await hostile cancellation. */ } };
  async function boundedBody(response: Response, signal: AbortSignal | null | undefined): Promise<string> {
    const reader = response.body?.getReader(); if (!reader) throw Error('EMPTY_BODY');
    const decoder = new TextDecoder(); let total = 0, raw = ''; let abort: (() => void) | undefined;
    try {
      return await Promise.race([(async () => {
        while (true) { const { value, done } = await reader.read(); if (done) break; total += value.byteLength; if (total > 128_000) { cancel(reader); throw Error('BODY_CAP'); } raw += decoder.decode(value, { stream: true }); }
        return raw + decoder.decode();
      })(), new Promise<never>((_, reject) => { abort = () => { cancel(reader); reject(Error('BODY_ABORTED')); }; if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true }); })]);
    } finally { if (abort) signal?.removeEventListener('abort', abort); }
  }
  const fetchImpl: typeof fetch = async (url, init) => {
    const destination = new URL(String(url));
    if (destination.origin !== endpoint.origin || destination.pathname !== endpoint.pathname.replace(/\/$/, '') + '/chat/completions' || destination.search || destination.hash) throw Error('V11_FULL84_DESTINATION_CHANGED');
    const serialized = String(init?.body); inspectBody(serialized);
    const entryId = expectedOrder[entries.length]; if (!entryId) throw Error('V11_FULL84_UNEXPECTED_REQUEST');
    const stage = attempts.some(item => item.entryId === entryId) ? 'REPAIR' : 'INITIAL';
    if (attempts.filter(item => item.entryId === entryId).length >= 2) throw Error('V11_FULL84_REPAIR_LIMIT_CHANGED');
    const bytes = Buffer.byteLength(serialized), reserve = cost(bytes, 900), requestSha256 = sha(serialized);
    if (stage === 'INITIAL' && requestSha256 !== preflight.requests.find((item: { id: string }) => item.id === entryId)?.sha256) throw Error('V11_FULL84_PREPARED_REQUEST_CHANGED');
    requests.push({ entryId, group, stage, requestSha256, bytes, conservativeReserveNeurons: reserve });
    if (stopReason || attempts.length >= MAXIMUM_ATTEMPTS || accounted + reserve > CEILING_NEURONS) {
      stopReason ??= 'LOCAL_BUDGET_OR_ATTEMPT_CAP';
      notSentRequests.push({ entryId, group, stage, requestSha256, reason: stopReason, reserveNeurons: reserve, neuronsAccounted: accounted });
      throw new LLMError('LLM_RATE_LIMITED', false);
    }
    accounted += reserve;
    const attempt: Record<string, unknown> = { entryId, group, stage, requestSha256, reserveNeurons: reserve, neurons: reserve, usageEstimated: true };
    attempts.push(attempt); const started = performance.now();
    try {
      const response = await fetch(url, { ...init, body: serialized, redirect: 'error' }); attempt.status = response.status;
      if (!response.ok) { cancel(response.body); stopReason ??= response.status === 429 ? 'PROVIDER_QUOTA_OR_RATE_LIMIT' : 'PROVIDER_HTTP_ERROR'; attempt.responseBodyOmitted = true; return new Response(null, { status: response.status }); }
      const raw = await boundedBody(response, init?.signal);
      let captured: Record<string, unknown> | null = null;
      try { captured = JSON.parse(raw) as Record<string, unknown>; } catch { /* Provider validation stays authoritative; do not log arbitrary error bodies. */ }
      const usage = captured?.usage as { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined;
      const input = usage?.prompt_tokens, completion = usage?.completion_tokens;
      if (typeof input === 'number' && typeof completion === 'number' && Number.isFinite(input + completion) && input >= 0 && completion >= 0) {
        const actual = cost(input, completion); accounted += actual - reserve;
        Object.assign(attempt, { promptTokens: input, completionTokens: completion, neurons: actual, usageEstimated: false });
        if (actual > reserve || accounted > CEILING_NEURONS) stopReason ??= 'PROVIDER_USAGE_EXCEEDED_RESERVATION';
      }
      if (captured) attempt.response = captured; else attempt.responseCapture = 'NON_JSON_BODY_OMITTED';
      return new Response(raw, { status: response.status, headers: { 'Content-Type': 'application/json' } });
    } catch {
      stopReason ??= init?.signal?.aborted ? 'PROVIDER_TIMEOUT' : 'TRANSPORT_OR_CAPTURE_FAILED'; attempt.responseBodyOmitted = true;
      throw new LLMError(init?.signal?.aborted ? 'LLM_TIMEOUT' : 'LLM_UNAVAILABLE');
    } finally { attempt.latencyMs = Math.round(performance.now() - started); await appendFile(paths.raw, JSON.stringify(attempt) + '\n'); }
  };
  const provider = createOpenAICompatibleProvider({ baseUrl: endpoint.href, apiKey: process.env.LLM_API_KEY, model: MODEL, structuredFormat: 'json_object', maxOutputTokens: 900, initialTimeoutMs: 60_000, repairTimeoutMs: 30_000, fetchImpl });
  async function recordEntry(entry: BenchmarkEntry) {
    if (entry.id !== expectedOrder[entries.length]) throw Error('V11_FULL84_ENTRY_ORDER_CHANGED');
    const actualHTTPAttempts = attempts.filter(item => item.entryId === entry.id).length;
    // A local request/configuration rejection is neither a delivered response nor
    // an attempted case; stop instead of advancing the original runner silently.
    if (actualHTTPAttempts === 0) stopReason ??= 'LOCAL_REQUEST_REJECTED_BEFORE_SEND';
    if (actualHTTPAttempts > 0) entries.push(Object.assign(entry, { group, actualHTTPAttempts, completionStatus: stopReason ? 'INTERRUPTED' as const : entry.response ? 'VALID' as const : 'INVALID' as const }));
    await appendFile(paths.progress, JSON.stringify({ at: new Date().toISOString(), entry: actualHTTPAttempts > 0 ? entries.at(-1) : null, notSentRequests, neuronsAccounted: accounted, stopReason, ...progress() }) + '\n');
    console.log(`${group} ${entry.id} ${entry.errorCode ?? 'generated'} neurons=${accounted.toFixed(2)}`);
    if (stopReason) throw Error('V11_FULL84_STOPPED');
  }
  try {
    const core = await runPersonaBenchmark(provider, { executionMode: 'LIVE', onEntry: recordEntry });
    await writeFile(paths.core, JSON.stringify(core, null, 2) + '\n', { flag: 'wx' });
    group = 'SUPPLEMENT';
    const supplement = await runSajuSupplement(provider, { executionMode: 'LIVE', onEntry: recordEntry });
    await writeFile(paths.supplement, JSON.stringify(supplement, null, 2) + '\n', { flag: 'wx' });
    completed = entries.length === 84 && !stopReason;
  } catch { stopReason ??= 'FULL84_RUN_FAILED'; }
  finally {
    const after = await sourceHashes(); const changedSources = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path]?.canonicalLF !== after[path]?.canonicalLF);
    const bookkeeping = progress();
    const result = { scope: 'ORIGINAL_CORE60_PLUS_SUPPLEMENT24', entries, notSentRequests, ...bookkeeping, neuronsAccounted: accounted, completed, stopReason, qualityAssessment: 'NEEDS_DIRECT_REVIEW_NO_AUTOMATIC_PASS' };
    await writeFile(paths.result, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    await writeFile(paths.manifest, JSON.stringify({ schemaVersion: 1, mode: 'LIVE', startedAt, completedAt: new Date().toISOString(), completed, stopReason, model: MODEL,
      promptVersion: PERSONA_PROMPT_VERSION, intentPromptVersion: INTENT_PROMPT_VERSION, scope: 'ORIGINAL_CORE60_PLUS_SUPPLEMENT24', expectedOrder,
      preflightSha256: sha(preflightBytes), selectionSha256: sha(selectionBytes), rubricSha256: sha(rubricBytes), sourceHashes: before, afterSourceHashes: after, sourceFrozen: !changedSources.length, changedSources,
      sourceFreezeScope: 'domain/persona/llm excluding background memory; original corpus/frozen expectations/shared accounting/new runner pair',
      rates: RATES, ceilingNeurons: CEILING_NEURONS, maximumAttempts: MAXIMUM_ATTEMPTS, neuronsAccounted: accounted, attempts: attempts.map(({ response: _response, ...metadata }) => metadata),
      requests, notSentRequests, preparedRequestCount: requests.length, actualHTTPAttemptCount: attempts.length, ...bookkeeping,
      thinking: { enable_thinking: false }, maxOutputTokens: 900, initialTimeoutMs: 60_000, repairTimeoutMs: 30_000, maximumRepairsPerReply: 1, maximumResponseBytes: 128_000,
      sourceAccountUsageNotQueriedByHarness: true, assessment: 'NEEDS_DIRECT_CORE_AND_SUPPLEMENT_REVIEW_NO_AUTOMATIC_PASS' }, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ completed, stopReason, entryCount: entries.length, actualHTTPAttemptCount: attempts.length, neuronsAccounted: accounted, sourceFrozen: !changedSources.length, pendingCount: bookkeeping.pendingIds.length }));
    if (!completed || changedSources.length) process.exitCode = 1;
  }
}
