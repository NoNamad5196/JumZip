/** Zero-network cost preparation only. There is deliberately no live mode here.
 * Original core20x3 + supplement8x3 inputs remain unchanged. This cannot score quality. */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { createOpenAICompatibleProvider } from '../../supabase/functions/_shared/llm/provider.ts';
import { PERSONA_PROMPT_VERSION } from '../../supabase/functions/_shared/llm/reply.ts';
import { buildPersonaMessages } from '../../supabase/functions/_shared/persona/prompt.ts';
import { selectChatResponseContract } from '../../supabase/functions/_shared/llm/chat-contract.ts';
import { PERSONA_BENCHMARK_CASES, BENCHMARK_CHARACTERS, BENCHMARK_SCORE_KEYS, PERSONA_BENCHMARK_VERSION } from '../../supabase/functions/_shared/persona/benchmark.ts';
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
const files: string[] = [];
const walk = async (path: string) => { for (const entry of await readdir(path, { withFileTypes: true })) { const file = join(path, entry.name); if (entry.isDirectory()) await walk(file); else if (file.endsWith('.ts') && !file.replaceAll('\\', '/').endsWith('/persona/memory.ts')) files.push(file); } };
for (const directory of ['domain', 'persona', 'llm']) await walk(resolve(`supabase/functions/_shared/${directory}`));
for (const file of ['saju-benchmark-corpus.ts', 'saju-benchmark-runner.ts', 'v8-full84-preflight.mts', 'v8-full84-runner.mts']) files.push(resolve(`tests/persona/${file}`));
const paths = files.sort().map(path => relative(process.cwd(), path).replaceAll('\\', '/'));
async function hashes() { return Object.fromEntries(await Promise.all(paths.map(async path => { const bytes = await readFile(path); return [path, { raw: sha(bytes), canonicalLF: sha(bytes.toString('utf8').replace(/\r\n/g, '\n')) }]; }))); }
const before = await hashes();
const requests: { id: string; group: string; responseContract: string; bytes: number; sha256: string; canaryCount: 0; conservativeInitialReservation: number; priorInitialRatio: number; estimatedInitialNeurons: number }[] = [];
const selection: { id: string; group: string; inputSha256: string; reviewChecks: readonly string[] }[] = [];
let activeId = '', group = 'CORE', responseContract: ReturnType<typeof selectChatResponseContract> = 'DEFAULT';
const provider = createOpenAICompatibleProvider({ baseUrl: 'https://api.cloudflare.com/client/v4/accounts/preflight-only/ai/v1', model,
  structuredFormat: 'json_object', maxOutputTokens: 900,
  fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (JSON.stringify(body.chat_template_kwargs) !== JSON.stringify({ enable_thinking: false })) throw Error('V8_PROVIDER_MODEL_OPTIONS_MISMATCH');
    const serialized = JSON.stringify(body), bytes = Buffer.byteLength(serialized);
    if (PRIVACY_CANARIES.some(canary => serialized.includes(canary)) || /birthProfile|PRIVATE_CITY_SENTINEL|"latitude"|"longitude"/.test(serialized)) throw Error('PREFLIGHT_PRIVACY_FAILED');
    const oldRequest = priorRequests.find(item => item.id === activeId), oldAttempt = priorAttempts.find(item => item.entryId === activeId);
    if (!oldRequest || !oldAttempt || !Number.isFinite(oldAttempt.promptTokens + oldAttempt.completionTokens)) throw Error('PRIOR_MEASUREMENT_MISSING');
    const ratio = oldAttempt.promptTokens / oldRequest.bytes;
    requests.push({ id: activeId, group, responseContract, bytes, sha256: sha(serialized), canaryCount: 0, conservativeInitialReservation: cost(bytes, 900), priorInitialRatio: ratio,
      estimatedInitialNeurons: cost(bytes * ratio, oldAttempt.completionTokens) });
    // Deliberately a local response: no fetch(), credentials, or network path exists.
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }), { status: 200 });
  } });
for (const [phase, cases] of [['CORE', PERSONA_BENCHMARK_CASES], ['SUPPLEMENT', SAJU_SUPPLEMENTAL_CASES]] as const) {
  group = phase;
  for (const item of cases) for (const characterId of BENCHMARK_CHARACTERS) {
    activeId = `${item.id}:${characterId}`;
    selection.push({ id: activeId, group, inputSha256: sha(JSON.stringify({ ...item.input, characterId })), reviewChecks: item.reviewChecks });
    responseContract = selectChatResponseContract(item.input.toolResult);
    await provider.generateChat(buildPersonaMessages({ ...item.input, characterId }), responseContract);
  }
}
if (requests.length !== 84 || new Set(requests.map(item => item.id)).size !== 84) throw Error('ORIGINAL84_COVERAGE_CHANGED');
if (JSON.stringify(requests.map(item => item.id)) !== JSON.stringify(priorRequests.map(item => item.id))) throw Error('ORIGINAL84_ORDER_CHANGED');
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
      'Previous outputs contain no v8 evidence: prior-output forecasts and their20percent headroom are optimistic scenarios, not validated v8 output estimates',
      'Prompt changes can change response length, repair incidence and tokenizer ratio', 'Repairs are additional; any future live run needs a separate hard budget and pre-call reservation',
      'No cached-input discount assumed', 'No final full84 live run is authorized by this file; Main must confirm account usage and budget'] },
  proposedLiveBudgetNeurons: 3500, livePrerequisites: ['Main verifies00UTC/09KST free reset', 'Independent v8 micro8 review completed', 'Main explicitly approves full84 and budget'],
  acceptanceStatus: 'NOT_RUN_NO_QUALITY_INFERENCE', pricingSource: 'https://developers.cloudflare.com/workers-ai/platform/pricing/' };
const directory = 'tests/persona/benchmark-runs/v8-full84-preparation'; await mkdir(directory, { recursive: true });
await writeFile(directory + '/preflight.json', JSON.stringify(result, null, 2) + '\n');
await writeFile(directory + '/selection.json', JSON.stringify({ corpusVersions: [PERSONA_BENCHMARK_VERSION, 'JumZipSajuPersonaSupplement-v1'], originalOrderPreserved: true, coreCount: 60, supplementCount: 24, selection }, null, 2) + '\n');
await writeFile(directory + '/review-template.json', JSON.stringify({ status: 'UNREVIEWED', reviewer: null, reviewerKind: null, method: 'DIRECT_RESPONSE_REVIEW', instructionsKo: '각 실제 원문과 고정 입력을 직접 읽고5축0~2점을 기록한다. 빈 점수나 자동 체크만으로 품질 PASS를 선언하지 않는다. core60과supplement24를 각각 평가한다.',
  entries: selection.map(item => ({ ...item, scores: Object.fromEntries(BENCHMARK_SCORE_KEYS.map(key => [key, null])), hardFails: null, evidenceKo: [], reviewedOutput: null })) }, null, 2) + '\n');
console.log(JSON.stringify({ networkRequests: 0, requestCount: 84, sourceFrozen: true, promptVersion: PERSONA_PROMPT_VERSION, expectedInitialNeurons: expectedInitial, planningWith20PercentHeadroom: expectedInitial * 1.2 }));

