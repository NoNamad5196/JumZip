/** Zero-network cost preparation only. There is deliberately no live mode here.
 * Original core20x3 + supplement8x3 inputs remain unchanged. This cannot score quality. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createOpenAICompatibleProvider } from '../../supabase/functions/_shared/llm/provider.ts';
import { PERSONA_PROMPT_VERSION } from '../../supabase/functions/_shared/llm/reply.ts';
import { buildPersonaMessages } from '../../supabase/functions/_shared/persona/prompt.ts';
import { PERSONA_BENCHMARK_CASES, BENCHMARK_CHARACTERS } from '../../supabase/functions/_shared/persona/benchmark.ts';
import { SAJU_SUPPLEMENTAL_CASES, PRIVACY_CANARIES } from './saju-benchmark-corpus.ts';

if (process.argv.length > 2) throw Error('PREFLIGHT_HAS_NO_LIVE_ARGUMENTS');
const model = '@cf/google/gemma-4-26b-a4b-it';
const rates = { inputNeuronsPerMillion: 9091, outputNeuronsPerMillion: 27273 };
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const cost = (input: number, completion: number) => (input * rates.inputNeuronsPerMillion + completion * rates.outputNeuronsPerMillion) / 1_000_000;
const priorDirectory = 'tests/persona/model-comparison-runs/gemma4-v4-full84/';
const priorManifest = JSON.parse(await readFile(priorDirectory + 'benchmark-baseline-manifest.json', 'utf8'));
const priorRequests = JSON.parse(await readFile(priorDirectory + 'preflight.json', 'utf8')).requests as { id: string; bytes: number }[];
const priorAttempts = priorManifest.attempts as { entryId: string; promptTokens: number; completionTokens: number; neurons: number }[];
const paths = [...Object.keys(priorManifest.sourceHashes).filter(path => !path.endsWith('model-comparison-gemma4-full.mts')), 'tests/persona/v5-full84-preflight.mts'];
async function hashes() { return Object.fromEntries(await Promise.all(paths.map(async path => { const bytes = await readFile(path); return [path, { raw: sha(bytes), canonicalLF: sha(bytes.toString('utf8').replace(/\r\n/g, '\n')) }]; }))); }
const before = await hashes();
const requests: { id: string; group: string; bytes: number; sha256: string; canaryCount: 0; conservativeInitialReservation: number; priorInitialRatio: number; estimatedInitialNeurons: number }[] = [];
let activeId = '', group = 'CORE';
const provider = createOpenAICompatibleProvider({ baseUrl: 'https://api.cloudflare.com/client/v4/accounts/preflight-only/ai/v1', model,
  structuredFormat: 'json_object', maxOutputTokens: 900,
  fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); body.chat_template_kwargs = { enable_thinking: false };
    const serialized = JSON.stringify(body), bytes = Buffer.byteLength(serialized);
    if (PRIVACY_CANARIES.some(canary => serialized.includes(canary)) || /birthProfile|PRIVATE_CITY_SENTINEL|"latitude"|"longitude"/.test(serialized)) throw Error('PREFLIGHT_PRIVACY_FAILED');
    const oldRequest = priorRequests.find(item => item.id === activeId), oldAttempt = priorAttempts.find(item => item.entryId === activeId);
    if (!oldRequest || !oldAttempt || !Number.isFinite(oldAttempt.promptTokens + oldAttempt.completionTokens)) throw Error('PRIOR_MEASUREMENT_MISSING');
    const ratio = oldAttempt.promptTokens / oldRequest.bytes;
    requests.push({ id: activeId, group, bytes, sha256: sha(serialized), canaryCount: 0, conservativeInitialReservation: cost(bytes, 900), priorInitialRatio: ratio,
      estimatedInitialNeurons: cost(bytes * ratio, oldAttempt.completionTokens) });
    // Deliberately a local response: no fetch(), credentials, or network path exists.
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }), { status: 200 });
  } });
for (const [phase, cases] of [['CORE', PERSONA_BENCHMARK_CASES], ['SUPPLEMENT', SAJU_SUPPLEMENTAL_CASES]] as const) {
  group = phase;
  for (const item of cases) for (const characterId of BENCHMARK_CHARACTERS) {
    activeId = `${item.id}:${characterId}`;
    await provider.generateChat(buildPersonaMessages({ ...item.input, characterId }));
  }
}
if (requests.length !== 84 || new Set(requests.map(item => item.id)).size !== 84) throw Error('ORIGINAL84_COVERAGE_CHANGED');
const after = await hashes(), changedSources = paths.filter(path => before[path].canonicalLF !== after[path].canonicalLF);
if (changedSources.length) throw Error('PREFLIGHT_SOURCE_CHANGED');
const expectedInitial = requests.reduce((sum, item) => sum + item.estimatedInitialNeurons, 0);
const maxRatio = Math.max(...requests.map(item => item.priorInitialRatio));
const meanPriorOutput = priorRequests.reduce((sum, item) => sum + priorAttempts.find(attempt => attempt.entryId === item.id)!.completionTokens, 0) / 84;
const priorAllAttempts = priorAttempts.reduce((sum, attempt) => sum + attempt.neurons, 0);
const result = { schemaVersion: 1, mode: 'ZERO_NETWORK_PREFLIGHT', promptVersion: PERSONA_PROMPT_VERSION, model, createdAt: new Date().toISOString(),
  scope: 'ORIGINAL_CORE60_PLUS_SUPPLEMENT24', networkRequests: 0, credentialsRead: false, coreCount: 60, supplementCount: 24, requests,
  sourceHashes: before, sourceFrozen: true, changedSources, rawBirthCanaryCount: 0, thinking: { enable_thinking: false }, rates, maxOutputTokens: 900,
  forecast: { sameEntryPriorInputRatioAndOutput: expectedInitial,
    largestPriorRatioAndMeanPriorOutput: requests.reduce((sum, request) => sum + cost(request.bytes * maxRatio, meanPriorOutput), 0),
    planningWith20PercentHeadroom: expectedInitial * 1.2,
    all900OutputAtLargestPriorInputRatio: requests.reduce((sum, request) => sum + cost(request.bytes * maxRatio, 900), 0),
    sumOfByteBasedInitialReservations: requests.reduce((sum, request) => sum + request.conservativeInitialReservation, 0),
    priorFull84ActualNeuronsIncludingRepair: priorAllAttempts, priorFull84HttpAttempts: priorAttempts.length,
    assumptions: ['Uses the same model previous fixed-case token/byte and output observations, not a tokenizer or usage bound',
      'Prompt changes can change response length, repair incidence and tokenizer ratio', 'Repairs are additional; any future live run needs a separate hard budget and pre-call reservation',
      'No cached-input discount assumed', 'No final full84 live run is authorized by this file; Main must confirm account usage and budget'] },
  acceptanceStatus: 'NOT_RUN_NO_QUALITY_INFERENCE', pricingSource: 'https://developers.cloudflare.com/workers-ai/platform/pricing/' };
const directory = 'tests/persona/benchmark-runs/v5-full84-preparation'; await mkdir(directory, { recursive: true });
await writeFile(directory + '/preflight.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ networkRequests: 0, requestCount: 84, sourceFrozen: true, promptVersion: PERSONA_PROMPT_VERSION, expectedInitialNeurons: expectedInitial, planningWith20PercentHeadroom: expectedInitial * 1.2 }));
