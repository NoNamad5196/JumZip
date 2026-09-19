/** Prepared only. Main must confirm the free reset, independent review and live budget.
 * Reuses original core/supplement runners and the micro8 synchronous reserve/capture path.
 * No model switch, corpus edits, or overwriting earlier run artifacts. */
import { access, appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { createOpenAICompatibleProvider, LLMError } from '../../supabase/functions/_shared/llm/provider.ts';
import { PERSONA_PROMPT_VERSION } from '../../supabase/functions/_shared/llm/reply.ts';
import { BENCHMARK_CHARACTERS, PERSONA_BENCHMARK_CASES, runPersonaBenchmark, type BenchmarkEntry } from '../../supabase/functions/_shared/persona/benchmark.ts';
import { SAJU_SUPPLEMENTAL_CASES, PRIVACY_CANARIES } from './saju-benchmark-corpus.ts';
import { runSajuSupplement } from './saju-benchmark-runner.ts';

if (process.argv.slice(2).length || process.env.JUMZIP_RUN_V7_FULL84 !== 'LIVE' || process.env.JUMZIP_V7_FULL84_PREREQUISITES !== 'RESET_AND_REVIEW_CONFIRMED' || String(PERSONA_PROMPT_VERSION) !== 'JumZipPersona-v7') throw Error('V7_FULL84_RESET_REVIEW_AND_MAIN_GO_REQUIRED');
const model = '@cf/google/gemma-4-26b-a4b-it';
const endpoint = new URL(process.env.LLM_BASE_URL ?? '');
if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'api.cloudflare.com' || !/^\/client\/v4\/accounts\/[^/]+\/ai\/v1\/?$/.test(endpoint.pathname) || endpoint.search || endpoint.hash || endpoint.username || endpoint.password || !process.env.LLM_API_KEY) throw Error('V7_FULL84_DESTINATION_OR_CONFIG_INVALID');
const ceilingNeurons = 3500, maximumAttempts = 168;
const rates = { inputNeuronsPerMillion: 9091, outputNeuronsPerMillion: 27273 };
const output = resolve('tests/persona/benchmark-runs/v7-full84');
const paths = { core: join(output, 'benchmark-results.json'), supplement: join(output, 'saju-benchmark-results.json'), progress: join(output, 'progress.json'), raw: join(output, 'provider-attempts.jsonl'), manifest: join(output, 'manifest.json') };
for (const path of Object.values(paths)) {
  try { await access(path); throw Error('V7_FULL84_ARTIFACT_ALREADY_EXISTS'); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
}
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const cost = (input: number, completion: number) => (input * rates.inputNeuronsPerMillion + completion * rates.outputNeuronsPerMillion) / 1_000_000;
async function sourceHashes() {
  const files: string[] = [];
  const walk = async (path: string) => { for (const entry of await readdir(path, { withFileTypes: true })) { const file = join(path, entry.name); if (entry.isDirectory()) await walk(file); else if (file.endsWith('.ts') && !file.replaceAll('\\', '/').endsWith('/persona/memory.ts')) files.push(file); } };
  for (const directory of ['domain', 'persona', 'llm']) await walk(resolve(`supabase/functions/_shared/${directory}`));
  for (const file of ['saju-benchmark-corpus.ts', 'saju-benchmark-runner.ts', 'v7-full84-preflight.mts', 'v7-full84-runner.mts']) files.push(resolve(`tests/persona/${file}`));
  return Object.fromEntries(await Promise.all(files.sort().map(async path => { const bytes = await readFile(path); return [relative(process.cwd(), path).replaceAll('\\', '/'), { raw: sha(bytes), canonicalLF: sha(bytes.toString('utf8').replace(/\r\n/g, '\n')) }]; })));
}
const before = await sourceHashes();
const preflight = JSON.parse(await readFile('tests/persona/benchmark-runs/v7-full84-preparation/preflight.json', 'utf8'));
if (preflight.networkRequests !== 0 || preflight.coreCount !== 60 || preflight.supplementCount !== 24 || preflight.promptVersion !== PERSONA_PROMPT_VERSION || Object.keys(before).some(path => before[path].canonicalLF !== preflight.sourceHashes?.[path]?.canonicalLF)) throw Error('V7_FULL84_FRESH_PREFLIGHT_REQUIRED');
await mkdir(output, { recursive: true });
const expectedOrder = [...PERSONA_BENCHMARK_CASES, ...SAJU_SUPPLEMENTAL_CASES].flatMap(item => BENCHMARK_CHARACTERS.map(character => `${item.id}:${character}`));
if (expectedOrder.length !== 84 || new Set(expectedOrder).size !== 84 || JSON.stringify(expectedOrder) !== JSON.stringify(preflight.requests.map((item: { id: string }) => item.id))) throw Error('V7_FULL84_ORIGINAL_ORDER_CHANGED');
const entries: BenchmarkEntry[] = [], attempts: Record<string, unknown>[] = [], requests: Record<string, unknown>[] = [];
let phase = 'CORE', accounted = 0, stopReason: string | null = null;
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
  if (destination.origin !== endpoint.origin || destination.pathname !== endpoint.pathname.replace(/\/$/, '') + '/chat/completions' || destination.search || destination.hash) throw Error('V7_FULL84_DESTINATION_CHANGED');
  const body = JSON.parse(String(init?.body)); body.chat_template_kwargs = { enable_thinking: false };
  const serialized = JSON.stringify(body), entryId = expectedOrder[entries.length];
  if (!entryId || body.model !== model || body.max_tokens !== 900 || body.response_format?.type !== 'json_object') throw Error('V7_FULL84_REQUEST_CHANGED');
  if (PRIVACY_CANARIES.some(value => serialized.includes(value)) || /birthProfile|PRIVATE_CITY_SENTINEL|"latitude"|"longitude"/.test(serialized)) throw Error('V7_FULL84_PRIVACY_FAILED');
  const bytes = Buffer.byteLength(serialized), reserve = cost(bytes, 900);
  requests.push({ entryId, phase, requestSha256: sha(serialized), bytes, conservativeReserveNeurons: reserve });
  if (stopReason || attempts.length >= maximumAttempts || accounted + reserve > ceilingNeurons) { stopReason ??= 'LOCAL_BUDGET_OR_ATTEMPT_CAP'; throw new LLMError('LLM_RATE_LIMITED', false); }
  accounted += reserve;
  const attempt: Record<string, unknown> = { entryId, phase, requestSha256: sha(serialized), reserveNeurons: reserve, neurons: reserve, usageEstimated: true };
  attempts.push(attempt); const started = performance.now();
  try {
    const response = await fetch(url, { ...init, body: serialized }); attempt.status = response.status;
    if (!response.ok) {
      cancel(response.body); stopReason ??= response.status === 429 ? 'PROVIDER_QUOTA_OR_RATE_LIMIT' : 'PROVIDER_HTTP_ERROR';
      attempt.responseBodyOmitted = true; return new Response(null, { status: response.status });
    }
    const raw = await boundedBody(response, init?.signal);
    let captured: Record<string, unknown> | null = null;
    try { captured = JSON.parse(raw) as Record<string, unknown>; } catch { /* Keep provider validation, omit non-JSON bodies. */ }
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
const provider = createOpenAICompatibleProvider({ baseUrl: endpoint.href, apiKey: process.env.LLM_API_KEY, model,
  structuredFormat: 'json_object', maxOutputTokens: 900, initialTimeoutMs: 60_000, repairTimeoutMs: 30_000, fetchImpl });
const startedAt = new Date().toISOString(); let completed = false;
async function recordEntry(entry: BenchmarkEntry) {
  if (entry.id !== expectedOrder[entries.length]) throw Error('ORIGINAL_CASE_ORDER_CHANGED');
  entries.push(entry);
  await writeFile(paths.progress, JSON.stringify({ startedAt, phase, entries, neuronsAccounted: accounted, stopReason }, null, 2));
  console.log(`${phase} ${entry.id} ${entry.errorCode ?? 'generated'} neurons=${accounted.toFixed(2)}`);
  if (stopReason) throw Error('V7_FULL84_STOPPED');
}
try {
  const core = await runPersonaBenchmark(provider, { executionMode: 'LIVE', onEntry: recordEntry });
  await writeFile(paths.core, JSON.stringify(core, null, 2));
  phase = 'SUPPLEMENT';
  const supplement = await runSajuSupplement(provider, { executionMode: 'LIVE', onEntry: recordEntry });
  await writeFile(paths.supplement, JSON.stringify(supplement, null, 2));
  completed = entries.length === 84 && !stopReason;
} catch { stopReason ??= 'FULL84_RUN_FAILED'; }
finally {
  const after = await sourceHashes(); const changedSources = Object.keys(before).filter(path => before[path].canonicalLF !== after[path]?.canonicalLF);
  await writeFile(paths.manifest, JSON.stringify({ schemaVersion: 1, mode: 'LIVE', startedAt, completedAt: new Date().toISOString(), completed, stopReason,
    model, promptVersion: PERSONA_PROMPT_VERSION, scope: 'ORIGINAL_CORE60_PLUS_SUPPLEMENT24', expectedOrder, sourceHashes: before, afterSourceHashes: after,
    sourceFrozen: !changedSources.length, changedSources, sourceFreezeScope: 'domain/persona/llm excluding background memory; original core/supplement and these runners',
    rates, ceilingNeurons, maximumAttempts, neuronsAccounted: accounted, attempts: attempts.map(({ response: _response, ...metadata }) => metadata), requests,
    thinking: { enable_thinking: false }, maxOutputTokens: 900, initialTimeoutMs: 60_000, repairTimeoutMs: 30_000,
    entryCount: entries.length, pendingIds: expectedOrder.filter(id => !entries.some(entry => entry.id === id)),
    assessment: 'NEEDS_DIRECT_FULL_REVIEW; no script-only quality pass' }, null, 2) + '\n');
  console.log(JSON.stringify({ completed, stopReason, entryCount: entries.length, attempts: attempts.length, neuronsAccounted: accounted, sourceFrozen: !changedSources.length }));
  if (!completed || changedSources.length) process.exitCode = 1;
}
