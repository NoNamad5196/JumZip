/** Reads only frozen synthetic measurements/local preflights. No provider or credentials. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = 'tests/persona/benchmark-runs/';
const cost = (input: number, output: number) => input * 0.009091 + output * 0.027273;
const sha = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');
const microPath = root + 'v8-micro8/preflight-JumZipPersona-v8-JumZipIntent-v3.json';
const priorPath = root + 'v7-micro8/micro-manifest.json';
const current = JSON.parse(await readFile(microPath, 'utf8')) as { requests: { id: string; bytes: number; responseContract: string; conservativeReserveNeurons: number }[] };
const prior = JSON.parse(await readFile(priorPath, 'utf8')) as { neuronsAccounted: number; requests: { id: string; bytes: number }[]; attempts: { id: string; promptTokens: number; completionTokens: number }[] };
let cumulative = 0, peak = 0;
const rows = current.requests.map(request => {
  const attempt = prior.attempts.find(item => item.id === request.id), previous = prior.requests.find(item => item.id === request.id);
  if (!attempt || !previous) throw Error('MISSING_PRIOR_CASE');
  const input = request.bytes * attempt.promptTokens / previous.bytes, priorOutput = cost(input, attempt.completionTokens);
  const reserveNeeded = cumulative + request.conservativeReserveNeurons;
  peak = Math.max(peak, reserveNeeded); cumulative += priorOutput;
  return { id: request.id, responseContract: request.responseContract, priorOutputTokens: attempt.completionTokens,
    estimatedInputTokens: input, priorOutputScenarioNeurons: priorOutput,
    tarotAt900ScenarioNeurons: cost(input, request.responseContract === 'TAROT_EVIDENCE_V1' ? 900 : attempt.completionTokens),
    all900ScenarioNeurons: cost(input, 900), conservativeReservationNeurons: request.conservativeReserveNeurons,
    cumulativePriorOutputScenario: cumulative, reserveNeededBeforeRequest: reserveNeeded };
});
const oldSelection = JSON.parse(await readFile(root + 'v7-micro8/selection.json', 'utf8'));
const selection = JSON.parse(await readFile(root + 'v8-micro8/selection.json', 'utf8'));
if (JSON.stringify(oldSelection.reply) !== JSON.stringify(selection.reply)) throw Error('MICRO8_INPUT_OR_RUBRIC_CHANGED');
const micro = { mode: 'ZERO_NETWORK_BUDGET_PREPARATION', networkRequests: 0, preflightSha256: await sha(microPath), priorMeasurementSha256: await sha(priorPath),
  sameInputsAndReviewChecksAsV7: true, priorActualNeurons: prior.neuronsAccounted, rows,
  priorOutputScenarioNeurons: cumulative, tarotAt900ScenarioNeurons: rows.reduce((sum, row) => sum + row.tarotAt900ScenarioNeurons, 0),
  all900ScenarioNeurons: rows.reduce((sum, row) => sum + row.all900ScenarioNeurons, 0), peakSequentialReserveWithPriorOutput: peak,
  proposedHardCap: 600, liveAuthorized: false, limitations: [
    'Source input ratios are previous same-case observations, not guaranteed tokenization',
    'Prior output omits evidence and is an optimistic scenario, not measured v8 quality or cost',
    '900-output scenarios still estimate input; repairs are extra',
    'The pre-call reserve can stop the run before all8 even if total measured cost would have fit',
  ] };
await writeFile(root + 'v8-micro8/budget-preparation.json', JSON.stringify(micro, null, 2) + '\n');
const fullPath = root + 'v8-full84-preparation/preflight.json';
const fullPreflight = JSON.parse(await readFile(fullPath, 'utf8')) as { forecast: unknown; requests: { responseContract: string; conservativeInitialReservation: number; estimatedInitialNeurons: number }[] };
let used = 0, fullPeak = 0;
for (const request of fullPreflight.requests) { fullPeak = Math.max(fullPeak, used + request.conservativeInitialReservation); used += request.estimatedInitialNeurons; }
const fullSelection = JSON.parse(await readFile(root + 'v8-full84-preparation/selection.json', 'utf8'));
const oldFullSelection = JSON.parse(await readFile(root + 'v7-full84-preparation/selection.json', 'utf8'));
if (JSON.stringify(fullSelection) !== JSON.stringify(oldFullSelection)) throw Error('ORIGINAL84_INPUT_OR_RUBRIC_CHANGED');
const full = { mode: 'ZERO_NETWORK_BUDGET_PREPARATION', networkRequests: 0, preflightSha256: await sha(fullPath),
  sameInputsOrderAndReviewChecksAsV7: true, forecast: fullPreflight.forecast, peakSequentialReserveWithPriorOutput: fullPeak,
  largestSingleReserve: Math.max(...fullPreflight.requests.map(item => item.conservativeInitialReservation)),
  tarotEvidenceRequests: fullPreflight.requests.filter(item => item.responseContract === 'TAROT_EVIDENCE_V1').length,
  defaultRequests: fullPreflight.requests.filter(item => item.responseContract === 'DEFAULT').length,
  proposedHardCap: 3500, liveAuthorized: false };
await writeFile(root + 'v8-full84-preparation/budget-proposal.json', JSON.stringify(full, null, 2) + '\n');
console.log(JSON.stringify({ networkRequests: 0, sameInputsAndRubric: true, micro: { priorOutputScenario: cumulative,
  tarotAt900: micro.tarotAt900ScenarioNeurons, all900: micro.all900ScenarioNeurons, peakReserve: peak },
  full: { priorOutputScenario: used, peakReserve: fullPeak } }));
