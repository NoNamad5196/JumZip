/** Explicitly approved completion of the four uncalled v4 focused slots. Preserves
 * the original 800-neuron local-budget event and aggregates both runs under1000.
 * No prompt/provider option or conservative reservation policy is changed. */
import { readFile, writeFile, appendFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { generatePersonaReply } from '../../supabase/functions/_shared/llm/reply.ts';
import { createOpenAICompatibleProvider, LLMError } from '../../supabase/functions/_shared/llm/provider.ts';
import { SAJU_SUPPLEMENTAL_CASES } from './saju-benchmark-corpus.ts';
import type { CharacterId } from '../../supabase/functions/_shared/persona/config.ts';
if (process.env.JUMZIP_RUN_V4_CONTINUATION !== '1') throw new Error('EXPLICIT_LIVE_OPT_IN_REQUIRED');
const base = resolve('tests/persona/benchmark-runs/v4/focused');
const original = JSON.parse(await readFile(join(base, 'benchmark-baseline-manifest.json'), 'utf8'));
if (original.stopReason !== 'LOCAL_NEURON_BUDGET' || original.attempts.length !== 32 || original.ceilingNeurons !== 800 || !original.sourceFrozen) throw new Error('UNEXPECTED_BASELINE');
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
async function sourceHashes() { return Object.fromEntries(await Promise.all(Object.keys(original.sourceHashes).map(async path => [path, sha(await readFile(path))]))); }
const before = await sourceHashes();
if (Object.keys(before).some(key => before[key] !== original.sourceHashes[key])) throw new Error('FROZEN_SOURCE_CHANGED');
const endpoint = new URL(process.env.LLM_BASE_URL ?? '');
if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'api.cloudflare.com' || !/^\/client\/v4\/accounts\/[^/]+\/ai\/v1\/?$/.test(endpoint.pathname) || process.env.LLM_MODEL !== '@cf/qwen/qwen3-30b-a3b-fp8') throw new Error('DESTINATION_NOT_APPROVED');
const out = join(base, 'continuation'); await mkdir(out, { recursive: true });
const files = { result: join(out, 'results.json'), raw: join(out, 'provider-attempts.jsonl'), manifest: join(out, 'manifest.json') };
for (const file of Object.values(files)) { try { await access(file); throw new Error('CONTINUATION_ARTIFACT_ALREADY_EXISTS'); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; } }
const ids = ['s06-compatibility-uncertain:ARANG', 's07-no-invented-score:BOMI', 's07-no-invented-score:SANI', 's07-no-invented-score:ARANG'];
const earlier = JSON.parse(await readFile(join(base, 'benchmark-progress.json'), 'utf8')).entries;
if (ids.some(id => earlier.some((entry: { id: string; response: unknown }) => entry.id === id && entry.response))) throw new Error('WOULD_REPEAT_VALID_OUTPUT');
const cost = (input: number, output: number) => (input * 4625 + output * 30475) / 1_000_000;
const priorNeurons = original.neuronsAccounted;
let consumed = 0, stopReason: string | null = null, activeId = '';
const attempts: unknown[] = [], entries: unknown[] = [];
const cancel = (reader: { cancel(): Promise<unknown> }) => { try { void reader.cancel().catch(() => {}); } catch { /* cleanup only */ } };
const fetchImpl: typeof fetch = async (url, init) => {
  const requestText = String(init?.body ?? '');
  const reserve = cost(new TextEncoder().encode(requestText).length, 900);
  if (stopReason || priorNeurons + consumed + reserve > 1000) { stopReason ??= 'LOCAL_NEURON_BUDGET'; throw new LLMError('LLM_RATE_LIMITED', false); }
  const started = performance.now(); let response: Response;
  try { response = await fetch(url, init); } catch { stopReason = 'TRANSPORT_FAILED'; throw new LLMError('LLM_UNAVAILABLE'); }
  if (!response.ok) {
    if (response.status === 429) stopReason = 'PROVIDER_QUOTA_OR_RATE_LIMIT';
    const item = { entryId: activeId, status: response.status, responseBodyOmitted: true }; attempts.push(item); await appendFile(files.raw, JSON.stringify(item) + '\n'); return response;
  }
  const reader = response.clone().body?.getReader(); const decoder = new TextDecoder(); let raw = '', size = 0;
  const abort = () => { if (reader) cancel(reader); }; init?.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (!reader) throw Error('EMPTY_BODY');
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 128_000) { cancel(reader); throw Error('BODY_CAP'); } raw += decoder.decode(value, { stream: true }); }
    raw += decoder.decode(); const body = JSON.parse(raw); const input = body.usage?.prompt_tokens, output = body.usage?.completion_tokens;
    const reported = typeof input === 'number' && typeof output === 'number' && Number.isFinite(input + output) && input >= 0 && output >= 0;
    const neurons = reported ? cost(input, output) : reserve; consumed += neurons;
    const item = { entryId: activeId, latencyMs: Math.round(performance.now() - started), status: response.status, promptTokens: reported ? input : null, completionTokens: reported ? output : null, neurons, estimated: !reported };
    attempts.push(item); await appendFile(files.raw, JSON.stringify({ ...item, requestSha256: sha(requestText), response: body }) + '\n');
  } catch { consumed += reserve; await appendFile(files.raw, JSON.stringify({ entryId: activeId, captureError: 'RESPONSE_CAPTURE_FAILED', responseBodyOmitted: true }) + '\n'); }
  finally { init?.signal?.removeEventListener('abort', abort); }
  return response;
};
const provider = createOpenAICompatibleProvider({ baseUrl: endpoint.href, model: process.env.LLM_MODEL!, apiKey: process.env.LLM_API_KEY, structuredFormat: process.env.LLM_STRUCTURED_FORMAT === 'json_object' ? 'json_object' : 'json_schema', fetchImpl });
const startedAt = new Date().toISOString(); let completed = false;
try {
  for (const id of ids) {
    activeId = id; const [caseId, characterId] = id.split(':'); const item = SAJU_SUPPLEMENTAL_CASES.find(value => value.id === caseId)!;
    const started = performance.now(); let response = null, errorCode = null;
    try { response = await generatePersonaReply(provider, { ...item.input, characterId: characterId as CharacterId }); }
    catch (error) { errorCode = error instanceof LLMError ? error.code : 'BENCHMARK_EXECUTION_FAILED'; }
    entries.push({ id, caseId, characterId, latencyMs: Math.round(performance.now() - started), response, errorCode, automaticFlags: [], reviewChecks: item.reviewChecks, review: null });
    await writeFile(files.result, JSON.stringify({ runId: 'v4', scope: 'FOCUSED_CONTINUATION_ONLY', entries }, null, 2));
    console.log(`${id} ${errorCode ?? 'generated'} aggregateNeurons=${(priorNeurons + consumed).toFixed(2)}`);
    if (stopReason) break;
  }
  completed = entries.length === ids.length && !stopReason;
} finally {
  const after = await sourceHashes(); const changedSources = Object.keys(before).filter(key => before[key] !== after[key]);
  await writeFile(files.manifest, JSON.stringify({ startedAt, completedAt: new Date().toISOString(), completed, stopReason, ids, originalManifest: '../benchmark-baseline-manifest.json', originalBudgetNeurons: 800,
    approvedAggregateBudgetNeurons: 1000, priorNeurons, continuationNeurons: consumed, aggregateNeurons: priorNeurons + consumed, entries: entries.length, attempts,
    sourceHashes: before, sourceFrozen: !changedSources.length, changedSources, continuationHarnessSha256: sha(await readFile('tests/persona/run-live-v4-continuation.mts')),
    reservation: 'Unchanged: all request UTF-8 bytes as input tokens plus900output tokens', model: process.env.LLM_MODEL }, null, 2));
  console.log(JSON.stringify({ completed, stopReason, entries: entries.length, aggregateNeurons: priorNeurons + consumed, sourceFrozen: !changedSources.length }));
  if (!completed || changedSources.length) process.exitCode = 1;
}
