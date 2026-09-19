/** Opt-in observational harness. It does not change prompts, generation options or validators.
 * Run with Node --env-file=.env.server.local --experimental-transform-types, and both live
 * benchmark opt-in environment variables set to 1. Successful synthetic provider bodies
 * are local artifacts; HTTP error bodies and credentials are never read or recorded. */
import { appendFile, readFile, readdir, writeFile, access, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, relative } from 'node:path';
import { createOpenAICompatibleProvider, LLMError } from '../../supabase/functions/_shared/llm/provider.ts';
import { BENCHMARK_CHARACTERS, PERSONA_BENCHMARK_CASES, runPersonaBenchmark, type BenchmarkEntry } from '../../supabase/functions/_shared/persona/benchmark.ts';
import { SAJU_SUPPLEMENTAL_CASES } from './saju-benchmark-corpus.ts';
import { runSajuSupplement } from './saju-benchmark-runner.ts';
import { FOCUSED_CORE_CASE_IDS, FOCUSED_SUPPLEMENT_CASE_IDS } from './focused-benchmark-selection.ts';

if (process.env.JUMZIP_RUN_LIVE_BENCHMARK !== '1' || process.env.JUMZIP_RUN_LIVE_SAJU_BENCHMARK !== '1') throw new Error('EXPLICIT_LIVE_OPT_IN_REQUIRED');
if (process.env.LLM_MODEL !== '@cf/qwen/qwen3-30b-a3b-fp8') throw new Error('APPROVED_MODEL_REQUIRED');
const runId = process.env.JUMZIP_BENCHMARK_RUN_ID;
if (runId !== undefined && !/^v[2-9]\d*$/.test(runId)) throw new Error('BENCHMARK_RUN_ID_INVALID');
const focused = process.env.JUMZIP_BENCHMARK_SCOPE === 'FOCUSED';
if (process.env.JUMZIP_BENCHMARK_SCOPE && !focused) throw new Error('BENCHMARK_SCOPE_INVALID');
if (focused && !runId) throw new Error('VERSIONED_FOCUSED_RUN_REQUIRED');
const coreSelection = focused ? [...FOCUSED_CORE_CASE_IDS] : undefined;
const supplementSelection = focused ? [...FOCUSED_SUPPLEMENT_CASE_IDS] : undefined;
const output = runId ? resolve('tests/persona/benchmark-runs', runId, ...(focused ? ['focused'] : [])) : resolve('tests/persona');
await mkdir(output, { recursive: true });
const files = { core: join(output, 'benchmark-results.json'), supplement: join(output, 'saju-benchmark-results.json'), raw: join(output, 'benchmark-provider-attempts.jsonl'), progress: join(output, 'benchmark-progress.json'), manifest: join(output, 'benchmark-baseline-manifest.json') };
for (const file of Object.values(files)) { try { await access(file); throw new Error('BASELINE_ARTIFACT_ALREADY_EXISTS'); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; } }
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
async function sourceHashes(): Promise<Record<string, string>> {
  const paths: string[] = [];
  async function walk(path: string) { for (const entry of await readdir(path, { withFileTypes: true })) { const next = join(path, entry.name); if (entry.isDirectory()) await walk(next); else if (entry.name.endsWith('.ts')) paths.push(next); } }
  for (const folder of ['domain', 'persona', 'llm']) await walk(resolve(`supabase/functions/_shared/${folder}`));
  paths.push(resolve('tests/persona/saju-benchmark-corpus.ts'), resolve('tests/persona/saju-benchmark-runner.ts'), resolve('tests/persona/focused-benchmark-selection.ts'), resolve('tests/persona/run-live-baseline.mts'));
  return Object.fromEntries(await Promise.all(paths.sort().map(async path => [relative(process.cwd(), path).replaceAll('\\', '/'), sha(await readFile(path))])));
}
const before = await sourceHashes();
const entries: BenchmarkEntry[] = [];
const attempts: { entryId: string; phase: string; latencyMs: number; status: number; promptTokens: number | null; completionTokens: number | null; neurons: number; estimated: boolean }[] = [];
let phase = 'CORE', caseIds = PERSONA_BENCHMARK_CASES.filter(item => !coreSelection || coreSelection.includes(item.id as typeof coreSelection[number])).flatMap(item => BENCHMARK_CHARACTERS.map(character => `${item.id}:${character}`));
let entryIndex = 0, stopReason: string | null = null, budgetNeurons = 0;
const startedAt = new Date().toISOString();
const MAX_NEURONS = focused ? 800 : runId && Number(runId.slice(1)) >= 3 ? 1_700 : runId ? 2_500 : 8_500;
const pending = new Set<Promise<void>>();
const cost = (input: number, output: number) => (input * 4625 + output * 30475) / 1_000_000;
const cancel = (reader: { cancel(): Promise<unknown> }) => { try { void reader.cancel().catch(() => {}); } catch { /* cleanup only */ } };

const instrumentedFetch: typeof fetch = async (url, init) => {
  const entryId = caseIds[entryIndex]!;
  const requestText = typeof init?.body === 'string' ? init.body : '';
  // A conservative byte-as-token reserve protects the approved daily allowance if the
  // provider omits usage. Actual reported token counts replace this reserve on success.
  const reserve = cost(new TextEncoder().encode(requestText).length, 900);
  if (stopReason || budgetNeurons + reserve > MAX_NEURONS) { stopReason ??= 'LOCAL_NEURON_BUDGET'; throw new LLMError('LLM_RATE_LIMITED', false); }
  const start = performance.now();
  let response: Response;
  try { response = await fetch(url, init); } catch { stopReason = 'TRANSPORT_FAILED'; throw new LLMError('LLM_UNAVAILABLE'); }
  if (response.status === 429) stopReason = 'PROVIDER_QUOTA_OR_RATE_LIMIT';
  if (!response.ok) {
    attempts.push({ entryId, phase, latencyMs: Math.round(performance.now() - start), status: response.status, promptTokens: null, completionTokens: null, neurons: 0, estimated: false });
    await appendFile(files.raw, `${JSON.stringify({ entryId, phase, status: response.status, responseBodyOmitted: true })}\n`);
    return response;
  }
  const copy = response.clone();
  const task = (async () => {
    const reader = copy.body?.getReader();
    let raw = '', bytes = 0;
    const decoder = new TextDecoder();
    try {
      if (!reader) throw new Error('EMPTY_BODY');
      const abort = () => cancel(reader);
      init?.signal?.addEventListener('abort', abort, { once: true });
      try {
        while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 128_000) { cancel(reader); throw new Error('BODY_CAP'); } raw += decoder.decode(value, { stream: true }); }
        raw += decoder.decode();
      } finally { init?.signal?.removeEventListener('abort', abort); }
      const body = JSON.parse(raw) as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
      const input = body.usage?.prompt_tokens, output = body.usage?.completion_tokens;
      const reported = typeof input === 'number' && typeof output === 'number' && Number.isFinite(input + output) && input >= 0 && output >= 0;
      const neurons = reported ? cost(input, output) : reserve;
      budgetNeurons += neurons;
      const measurement = { entryId, phase, latencyMs: Math.round(performance.now() - start), status: response.status,
        promptTokens: reported ? input : null, completionTokens: reported ? output : null, neurons, estimated: !reported };
      attempts.push(measurement);
      await appendFile(files.raw, `${JSON.stringify({ ...measurement, requestSha256: sha(requestText), response: body })}\n`);
    } catch {
      budgetNeurons += reserve;
      attempts.push({ entryId, phase, latencyMs: Math.round(performance.now() - start), status: response.status, promptTokens: null, completionTokens: null, neurons: reserve, estimated: true });
      await appendFile(files.raw, `${JSON.stringify({ entryId, phase, status: response.status, captureError: 'RESPONSE_CAPTURE_FAILED', responseBodyOmitted: true })}\n`);
    }
  })();
  pending.add(task); void task.finally(() => pending.delete(task));
  return response;
};

async function recordEntry(entry: BenchmarkEntry) {
  await Promise.all(pending);
  entries.push(entry); entryIndex++;
  await writeFile(files.progress, JSON.stringify({ startedAt, phase, entries, attempts, neuronsAccounted: budgetNeurons, stopReason }, null, 2));
  console.log(`${phase} ${entry.id} ${entry.errorCode ?? 'generated'} ${entry.latencyMs}ms neurons=${budgetNeurons.toFixed(2)}`);
  if (stopReason) throw new Error('BENCHMARK_STOPPED');
}
const provider = createOpenAICompatibleProvider({ baseUrl: process.env.LLM_BASE_URL ?? '', model: process.env.LLM_MODEL, apiKey: process.env.LLM_API_KEY,
  structuredFormat: process.env.LLM_STRUCTURED_FORMAT === 'json_object' ? 'json_object' : 'json_schema', fetchImpl: instrumentedFetch });
let completed = false;
try {
  const core = await runPersonaBenchmark(provider, { executionMode: 'LIVE', caseIds: coreSelection, onEntry: recordEntry });
  await writeFile(files.core, JSON.stringify(core, null, 2));
  phase = 'SUPPLEMENT'; entryIndex = 0;
  caseIds = SAJU_SUPPLEMENTAL_CASES.filter(item => !supplementSelection || supplementSelection.includes(item.id as typeof supplementSelection[number])).flatMap(item => BENCHMARK_CHARACTERS.map(character => `${item.id}:${character}`));
  const supplement = await runSajuSupplement(provider, { executionMode: 'LIVE', caseIds: supplementSelection, onEntry: recordEntry });
  await writeFile(files.supplement, JSON.stringify(supplement, null, 2));
  completed = true;
} catch { stopReason ??= 'BASELINE_RUN_FAILED'; }
finally {
  await Promise.all(pending);
  const after = await sourceHashes();
  const changedSources = Object.keys(before).filter(key => before[key] !== after[key]);
  await writeFile(files.manifest, JSON.stringify({ version: 1, mode: 'LIVE', startedAt, completedAt: new Date().toISOString(), completed, stopReason,
    model: process.env.LLM_MODEL, structuredFormat: process.env.LLM_STRUCTURED_FORMAT === 'json_object' ? 'json_object' : 'json_schema', maxOutputTokens: 900,
    sourceHashes: before, changedSources, sourceFrozen: changedSources.length === 0,
    runId: runId ?? 'v1-baseline', scope: focused ? 'FOCUSED_12_X_3' : 'FULL_84', coreSelection: coreSelection ?? null, supplementSelection: supplementSelection ?? null,
    neuronsAccounted: budgetNeurons, ceilingNeurons: MAX_NEURONS, allowanceReserveNeurons: runId ? null : 1500,
    usageBasis: 'Provider-reported tokens at 4625 input / 30475 output neurons per million; conservative byte-as-token reserve when unavailable',
    pricingSource: 'https://developers.cloudflare.com/workers-ai/platform/pricing/', entries: entries.length, attempts }, null, 2));
  console.log(JSON.stringify({ completed, stopReason, entries: entries.length, attempts: attempts.length, neuronsAccounted: Math.round(budgetNeurons * 100) / 100, sourceFrozen: changedSources.length === 0 }));
  if (!completed || changedSources.length) process.exitCode = 1;
}
