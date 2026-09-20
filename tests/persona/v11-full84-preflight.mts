/** Zero-network original84 preparation. Importing this module never executes a run. */
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createOpenAICompatibleProvider } from '../../supabase/functions/_shared/llm/provider.ts';
import { PERSONA_PROMPT_VERSION } from '../../supabase/functions/_shared/llm/reply.ts';
import { INTENT_PROMPT_VERSION } from '../../supabase/functions/_shared/llm/intent.ts';
import { selectChatResponseContract } from '../../supabase/functions/_shared/llm/chat-contract.ts';
import { buildPersonaMessages } from '../../supabase/functions/_shared/persona/prompt.ts';
import { BENCHMARK_CHARACTERS, BENCHMARK_SCORE_KEYS, PERSONA_BENCHMARK_CASES, PERSONA_BENCHMARK_VERSION } from '../../supabase/functions/_shared/persona/benchmark.ts';
import { PRIVACY_CANARIES, SAJU_SUPPLEMENTAL_CASES } from './saju-benchmark-corpus.ts';

export const MODEL = '@cf/google/gemma-4-26b-a4b-it';
export const RATES = { inputNeuronsPerMillion: 9091, outputNeuronsPerMillion: 27273 };
export const CEILING_NEURONS = 3400, MAXIMUM_ATTEMPTS = 168;
export const DIRECTORY = resolve('tests/persona/benchmark-runs/v11-full84');
export const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const cost = (input: number, output: number) => (input * RATES.inputNeuronsPerMillion + output * RATES.outputNeuronsPerMillion) / 1_000_000;
export const CASES = [
  ...PERSONA_BENCHMARK_CASES.flatMap(item => BENCHMARK_CHARACTERS.map(characterId => ({ id: `${item.id}:${characterId}`, group: 'CORE' as const, input: { ...item.input, characterId }, reviewChecks: item.reviewChecks }))),
  ...SAJU_SUPPLEMENTAL_CASES.flatMap(item => BENCHMARK_CHARACTERS.map(characterId => ({ id: `${item.id}:${characterId}`, group: 'SUPPLEMENT' as const, input: { ...item.input, characterId }, reviewChecks: item.reviewChecks }))),
];
export const selection = { corpusVersions: [PERSONA_BENCHMARK_VERSION, 'JumZipSajuPersonaSupplement-v1'], originalOrderPreserved: true, coreCount: 60, supplementCount: 24,
  selection: CASES.map(item => ({ id: item.id, group: item.group, inputSha256: sha(JSON.stringify(item.input)), reviewChecks: item.reviewChecks })) };
export const assertVersions = () => {
  if (String(PERSONA_PROMPT_VERSION) !== 'JumZipPersona-v11' || String(INTENT_PROMPT_VERSION) !== 'JumZipIntent-v6') throw Error('V11_FULL84_FROZEN_VERSIONS_REQUIRED');
};
export async function mustNotExist(path: string) {
  try { await access(path); throw Error('V11_FULL84_ARTIFACT_ALREADY_EXISTS'); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
}
export async function sourceHashes() {
  const files: string[] = [];
  const walk = async (path: string) => { for (const entry of await readdir(path, { withFileTypes: true })) { const file = join(path, entry.name); if (entry.isDirectory()) await walk(file); else if (file.endsWith('.ts') && !file.replaceAll('\\', '/').endsWith('/persona/memory.ts')) files.push(file); } };
  for (const directory of ['domain', 'persona', 'llm']) await walk(resolve(`supabase/functions/_shared/${directory}`));
  for (const file of ['tests/persona/saju-benchmark-corpus.ts', 'tests/persona/saju-benchmark-runner.ts', 'tests/domain/frozen-expectations.ts', 'tests/persona/v9-run-accounting.ts', 'tests/persona/v11-full84-preflight.mts', 'tests/persona/v11-full84-runner.mts']) files.push(resolve(file));
  return Object.fromEntries(await Promise.all(files.sort().map(async path => { const bytes = await readFile(path); return [relative(process.cwd(), path).replaceAll('\\', '/'), { raw: sha(bytes), canonicalLF: sha(bytes.toString('utf8').replace(/\r\n/g, '\n')) }]; })));
}
export async function assertOriginalSelection() {
  const old = JSON.parse(await readFile('tests/persona/benchmark-runs/v7-full84-preparation/selection.json', 'utf8'));
  if (CASES.length !== 84 || new Set(CASES.map(item => item.id)).size !== 84 || JSON.stringify(selection) !== JSON.stringify(old)) throw Error('V11_FULL84_ORIGINAL_INPUT_ORDER_OR_RUBRIC_CHANGED');
}
export function inspectBody(serialized: string) {
  const body = JSON.parse(serialized);
  if (body.model !== MODEL || body.max_tokens !== 900 || body.response_format?.type !== 'json_object' || JSON.stringify(body.chat_template_kwargs) !== JSON.stringify({ enable_thinking: false })) throw Error('V11_FULL84_PROVIDER_CONFIGURATION_CHANGED');
  if (PRIVACY_CANARIES.some(canary => serialized.includes(canary)) || /birthProfile|PRIVATE_CITY_SENTINEL|"latitude"|"longitude"/.test(serialized)) throw Error('V11_FULL84_PRIVACY_CHECK_FAILED');
  return body;
}
interface PriorAttempt { id?: string; entryId?: string; requestSha256?: string; promptTokens: number; completionTokens: number; neurons: number }
interface PriorRequest { id: string; bytes: number; sha256?: string; responseContract?: string }
export async function prepare() {
  if (process.argv.length > 2) throw Error('V11_FULL84_PREFLIGHT_ACCEPTS_NO_ARGUMENTS');
  globalThis.fetch = async () => { throw Error('V11_FULL84_PREFLIGHT_NETWORK_FORBIDDEN'); };
  assertVersions(); await assertOriginalSelection();
  for (const file of ['preflight.json', 'selection.json', 'review-template.json', 'run-start.json', 'manifest.json', 'results.json', 'provider-attempts.jsonl']) await mustNotExist(join(DIRECTORY, file));
  const before = await sourceHashes();
  const microFile = 'tests/persona/benchmark-runs/v10-micro8/micro-manifest.json';
  const micro = JSON.parse(await readFile(microFile, 'utf8')) as { sourceFrozen: boolean; sourceHashes: Record<string, { canonicalLF: string }>; attempts: PriorAttempt[]; requests: PriorRequest[]; neuronsAccounted: number };
  if (!micro.sourceFrozen) throw Error('V11_FULL84_HISTORICAL_MICRO_NOT_FROZEN');
  // The executed v10 micro is historical cost evidence, not a v11 source match.
  const historicalRuntimeDifferences = Object.keys(before).filter(path => path.startsWith('supabase/') && before[path].canonicalLF !== micro.sourceHashes[path]?.canonicalLF);
  const historicalDirectory = 'tests/persona/model-comparison-runs/gemma4-v4-full84/';
  const historicalRequests = JSON.parse(await readFile(historicalDirectory + 'preflight.json', 'utf8')).requests as PriorRequest[];
  const historicalAttempts = JSON.parse(await readFile(historicalDirectory + 'benchmark-baseline-manifest.json', 'utf8')).attempts as PriorAttempt[];
  const requests: { id: string; group: string; responseContract: string; bytes: number; sha256: string; conservativeReserveNeurons: number; canaryCount: 0 }[] = [];
  let active = CASES[0];
  const provider = createOpenAICompatibleProvider({ baseUrl: 'https://api.cloudflare.com/client/v4/accounts/preflight-only/ai/v1', model: MODEL, structuredFormat: 'json_object', maxOutputTokens: 900,
    initialTimeoutMs: 60_000, repairTimeoutMs: 30_000, fetchImpl: async (_url, init) => {
      const serialized = String(init?.body); inspectBody(serialized); const bytes = Buffer.byteLength(serialized);
      requests.push({ id: active.id, group: active.group, responseContract: selectChatResponseContract(active.input.toolResult), bytes, sha256: sha(serialized), conservativeReserveNeurons: cost(bytes, 900), canaryCount: 0 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }), { status: 200 });
    } });
  for (const item of CASES) { active = item; await provider.generateChat(buildPersonaMessages(item.input), selectChatResponseContract(item.input.toolResult)); }
  if (requests.length !== 84 || JSON.stringify(requests.map(item => item.id)) !== JSON.stringify(historicalRequests.map(item => item.id))) throw Error('V11_FULL84_REQUEST_ORDER_CHANGED');
  const historicalEstimate = requests.reduce((sum, request) => {
    const oldRequest = historicalRequests.find(item => item.id === request.id), oldAttempt = historicalAttempts.find(item => item.entryId === request.id);
    if (!oldRequest || !oldAttempt) throw Error('V11_FULL84_PRIOR_MEASUREMENT_MISSING');
    return sum + cost(request.bytes * oldAttempt.promptTokens / oldRequest.bytes, oldAttempt.completionTokens);
  }, 0);
  const sample = micro.attempts.map(attempt => { const request = micro.requests.find(item => item.sha256 === attempt.requestSha256); if (!request) throw Error('V11_FULL84_MICRO_USAGE_UNBOUND'); return { id: attempt.id!, contract: request.responseContract!, ratio: attempt.promptTokens / request.bytes, output: attempt.completionTokens, neurons: attempt.neurons }; });
  const firstSample = sample.filter((item, index) => sample.findIndex(other => other.id === item.id) === index);
  const forecasts = requests.map(request => {
    const matched = firstSample.find(item => item.id === request.id), compatible = firstSample.filter(item => item.contract === request.responseContract);
    if (!compatible.length) throw Error('V11_FULL84_MICRO_CONTRACT_SAMPLE_MISSING');
    const ratioMean = compatible.reduce((sum, item) => sum + item.ratio, 0) / compatible.length;
    const outputMean = compatible.reduce((sum, item) => sum + item.output, 0) / compatible.length;
    return { id: request.id, exactMicroId: Boolean(matched), estimatedInitialNeurons: cost(request.bytes * (matched?.ratio ?? ratioMean), matched?.output ?? outputMean),
      estimatedInitialAtContractMaximums: cost(request.bytes * Math.max(...compatible.map(item => item.ratio)), Math.max(...compatible.map(item => item.output))),
      estimatedInitialAt900Output: cost(request.bytes * Math.max(...compatible.map(item => item.ratio)), 900) };
  });
  const initialEstimate = forecasts.reduce((sum, item) => sum + item.estimatedInitialNeurons, 0);
  const tarotSampleCount = firstSample.filter(item => item.contract === 'TAROT_EVIDENCE_V1').length;
  const repairSample = sample.filter((item, index) => sample.findIndex(other => other.id === item.id) !== index);
  const tarotCount = requests.filter(item => item.responseContract === 'TAROT_EVIDENCE_V1').length;
  const repairScenario = repairSample.length && tarotSampleCount ? tarotCount * repairSample.length / tarotSampleCount * repairSample.reduce((sum, item) => sum + item.neurons, 0) / repairSample.length : 0;
  let cumulative = 0, peakInitialReserve = 0;
  for (const request of requests) { peakInitialReserve = Math.max(peakInitialReserve, cumulative + request.conservativeReserveNeurons); cumulative += forecasts.find(item => item.id === request.id)!.estimatedInitialNeurons; }
  const after = await sourceHashes();
  const changedSources = Object.keys(before).filter(path => before[path].canonicalLF !== after[path]?.canonicalLF);
  if (changedSources.length || Object.keys(before).length !== Object.keys(after).length) throw Error('V11_FULL84_PREFLIGHT_SOURCE_CHANGED');
  const selectionBytes = JSON.stringify(selection, null, 2) + '\n';
  const rubric = { schemaVersion: 1, status: 'UNREVIEWED', reviewer: null, reviewerKind: null, method: 'DIRECT_RESPONSE_REVIEW', scoreKeys: BENCHMARK_SCORE_KEYS,
    criteria: { coreRequired: 60, supplementRequired: 24, averageAtLeast: 8, hardFailsRequired: 0, coreAndSupplementEvaluatedSeparately: true },
    instructionsKo: '실제 원문 전체와 고정 입력을 직접 읽고 각 축0~2점을 기록한다. AI 검토는 AI라고 귀속한다. 무효/미전달 응답의 의미 점수는 null로 남기며 성공 응답 평균과 운영 범위를 분리한다. 자동 검사나 비어 있는 평가만으로 품질 PASS를 선언하지 않는다.',
    entries: selection.selection.map(item => ({ ...item, scores: Object.fromEntries(BENCHMARK_SCORE_KEYS.map(key => [key, null])), hardFails: null, evidenceKo: [], reviewedOutput: null, reviewedOutputSha256: null })) };
  const rubricBytes = JSON.stringify(rubric, null, 2) + '\n';
  const result = { schemaVersion: 1, mode: 'ZERO_NETWORK_PREFLIGHT', createdAt: new Date().toISOString(), scope: 'ORIGINAL_CORE60_PLUS_SUPPLEMENT24', networkRequests: 0, credentialsRead: false,
    promptVersion: PERSONA_PROMPT_VERSION, intentPromptVersion: INTENT_PROMPT_VERSION, model: MODEL, rates: RATES, thinking: { enable_thinking: false }, maxOutputTokens: 900, maximumAttempts: MAXIMUM_ATTEMPTS,
    ceilingNeurons: CEILING_NEURONS, initialTimeoutMs: 60_000, repairTimeoutMs: 30_000, maximumRepairsPerReply: 1, maximumResponseBytes: 128_000,
    coreCount: 60, supplementCount: 24, requests, selectionSha256: sha(selectionBytes), rubricSha256: sha(rubricBytes), sourceHashes: before, sourceFrozen: true, changedSources,
    originalSelectionEvidence: 'tests/persona/benchmark-runs/v7-full84-preparation/selection.json', originalInputOrderAndRubricUnchanged: true,
    microEvidence: { path: microFile, sha256: sha(await readFile(microFile)), sourceMatched: historicalRuntimeDifferences.length === 0, historicalOnly: true, historicalRuntimeDifferences, observedNeurons: micro.neuronsAccounted, observedHTTPAttempts: sample.length, initialSamples: firstSample.length, repairSamples: repairSample.length },
    forecast: { entries: forecasts, historicalV4SameEntryInputRatioAndOutput: historicalEstimate, v10MicroMatchedOrSameContractInitialEstimate: initialEstimate,
      v10MicroContractMaximumInitialEstimate: forecasts.reduce((sum, item) => sum + item.estimatedInitialAtContractMaximums, 0),
      v10MicroContractMaximumRatioAnd900Output: forecasts.reduce((sum, item) => sum + item.estimatedInitialAt900Output, 0),
      extrapolatedTarotRepairCost: repairScenario, initialPlusExtrapolatedTarotRepairs: initialEstimate + repairScenario,
      peakSequentialInitialReservationAtEstimatedUsage: peakInitialReserve, largestSingleInitialReserve: Math.max(...requests.map(item => item.conservativeReserveNeurons)),
      sumOfAllInitialReservations: requests.reduce((sum, item) => sum + item.conservativeReserveNeurons, 0),
      limitations: ['Estimates use historical actual token/byte and output observations, not a tokenizer or upper bound.', 'The v4 outputs predate evidence and are optimistic historical context only.', 'The v10 micro predates v11 canonical repair hints; historical repair costs are not a bound on the current repair payload.', 'The v10 micro has8 initial samples and2 repairs; other84 cases can differ in output size, ratio and repair incidence.', 'Repair extrapolation applies the2/6 Tarot micro incidence and measured repair costs to all Tarot requests; it is a planning scenario, not a prediction.', 'Initial peak excludes possible repairs. Every live initial/repair reserves current serialized UTF-8 bytes as input tokens plus900 output tokens synchronously before sending.', 'Unknown usage remains fully reserved;3400 may stop before84. No cached-input discount. This file is not a live authorization.'] },
    accountBudgetStatus: 'PENDING_FRESH_MAIN_USAGE_CHECK_AND_LIVE_GO', liveAuthorized: false, assessment: 'NOT_RUN_NO_QUALITY_INFERENCE',
    pricingSource: 'https://developers.cloudflare.com/workers-ai/platform/pricing/', modelOptionsSource: 'https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/' };
  await mkdir(DIRECTORY, { recursive: true });
  await writeFile(join(DIRECTORY, 'selection.json'), selectionBytes, { flag: 'wx' });
  await writeFile(join(DIRECTORY, 'review-template.json'), rubricBytes, { flag: 'wx' });
  await writeFile(join(DIRECTORY, 'preflight.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ networkRequests: 0, requestCount: requests.length, sourceFrozen: true, initialEstimate, initialPlusExtrapolatedRepairs: initialEstimate + repairScenario, proposedCap: CEILING_NEURONS, peakInitialReserve, liveAuthorized: false }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await prepare();
