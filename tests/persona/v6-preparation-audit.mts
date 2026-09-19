/** Local evidence only: no provider construction, credentials or network calls. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { V5_REPLY_CASES, V5_INTENT_CASES, V5_EXECUTION_ORDER } from './v5-focused-corpus.mts';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const directory = 'tests/persona/benchmark-runs/v6-focused/';
const previousDirectory = 'tests/persona/benchmark-runs/v5-focused/';
const previousSelection = JSON.parse(await readFile(previousDirectory + 'selection.json', 'utf8'));
const previousManifest = JSON.parse(await readFile(previousDirectory + 'manifest.json', 'utf8'));
const currentPreflight = JSON.parse(await readFile(directory + 'preflight-JumZipPersona-v6-JumZipIntent-v2.json', 'utf8'));
const stripAddedCoverage = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripAddedCoverage);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'computedPillarCoverage').map(([key, item]) => [key, stripAddedCoverage(item)]));
  return value;
};
const rows = [...V5_REPLY_CASES, ...V5_INTENT_CASES].map(item => {
  const previous = [...previousSelection.reply, ...previousSelection.intent].find(row => row.id === item.id);
  const inputSha256 = sha(JSON.stringify(item.input));
  const strippedInputSha256 = sha(JSON.stringify(stripAddedCoverage(item.input)));
  return { id: item.id, inputSha256, previousInputSha256: previous?.inputSha256,
    exactInputUnchanged: previous?.inputSha256 === inputSha256,
    onlyAddedComputedCoverage: previous?.inputSha256 !== inputSha256 && previous?.inputSha256 === strippedInputSha256,
    sameReviewChecks: JSON.stringify(item.reviewChecks) === JSON.stringify(previous?.reviewChecks),
    sameExpected: !('expected' in item) || JSON.stringify(item.expected) === JSON.stringify(previous?.expected) };
});
const allCasesPreserved = rows.length === 24 && rows.every(row => (row.exactInputUnchanged || row.onlyAddedComputedCoverage) && row.sameReviewChecks && row.sameExpected)
  && JSON.stringify(V5_EXECUTION_ORDER) === JSON.stringify(previousSelection.executionOrder);
type Request = { id: string; bytes: number; maximumOutputTokens: number; conservativeReserveNeurons: number };
type Attempt = { id: string; promptTokens: number; completionTokens: number; usageEstimated: boolean };
const cost = (input: number, output: number) => (input * 9091 + output * 27273) / 1_000_000;
const forecasts = (currentPreflight.requests as Request[]).map(request => {
  const previousRequest = (previousManifest.requests as Request[]).find(item => item.id === request.id);
  const previousAttempt = (previousManifest.attempts as Attempt[]).find(item => item.id === request.id);
  if (!previousRequest || !previousAttempt || previousAttempt.usageEstimated) throw Error('VERIFIED_PRIOR_USAGE_REQUIRED');
  const estimatedInput = request.bytes * previousAttempt.promptTokens / previousRequest.bytes;
  return { id: request.id, byteDelta: request.bytes - previousRequest.bytes,
    estimatedInitialNeurons: cost(estimatedInput, previousAttempt.completionTokens),
    estimatedAtMaximumOutput: cost(estimatedInput, request.maximumOutputTokens),
    conservativeReserveNeurons: request.conservativeReserveNeurons };
});
const artifact = {
  schemaVersion: 1, status: allCasesPreserved ? 'LOCAL_PREPARATION_VERIFIED' : 'FAILED', networkRequests: 0,
  source: { previousSelection: previousDirectory + 'selection.json', previousUsage: previousDirectory + 'manifest.json', currentPreflight: directory + 'preflight-JumZipPersona-v6-JumZipIntent-v2.json' },
  sameOriginalCaseIdsOrderExpectationsAndRubric: allCasesPreserved, rows,
  changedInputsExplanation: 'The frozen source corpus is unchanged. Production compact projection now adds computedPillarCoverage. Recursively removing only that field exactly recovers each prior v5 input hash; all other cases are byte-identical.',
  forecasts, forecastTotals: {
    priorActualV5Neurons: previousManifest.neuronsAccounted,
    estimatedInitialNeuronsUsingSameEntryV5Tokens: forecasts.reduce((sum, row) => sum + row.estimatedInitialNeurons, 0),
    estimatedAtMaximumOutput: forecasts.reduce((sum, row) => sum + row.estimatedAtMaximumOutput, 0),
    largestPrecallReserve: Math.max(...forecasts.map(row => row.conservativeReserveNeurons)),
    configuredHardCeiling: currentPreflight.ceilingNeurons,
  },
  limitations: ['Estimates are not bounds and do not include repairs.', 'Actual execution still reserves request bytes as input tokens plus maximum output before each HTTP call.', 'A hard cap may stop before all24. This artifact gives no live authorization or current account balance.', 'This focused suite cannot replace original84 acceptance.'],
};
await writeFile(directory + 'preparation-audit.json', JSON.stringify(artifact, null, 2) + '\n');
console.log(JSON.stringify({ status: artifact.status, networkRequests: 0, cases: rows.length, changedOnlyByCoverage: rows.filter(row => row.onlyAddedComputedCoverage).map(row => row.id), forecastTotals: artifact.forecastTotals }));
if (!allCasesPreserved) process.exitCode = 1;
