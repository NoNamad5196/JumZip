import { generatePersonaReply } from '../../supabase/functions/_shared/llm/reply.ts';
import { LLMError, type LLMProvider } from '../../supabase/functions/_shared/llm/provider.ts';
import { BENCHMARK_CHARACTERS, BENCHMARK_SCORE_KEYS, hasAuthoredBenchmarkReview, type BenchmarkEntry } from '../../supabase/functions/_shared/persona/benchmark.ts';
import { PRIVACY_CANARIES, SAJU_SUPPLEMENTAL_CASES } from './saju-benchmark-corpus.ts';

export function assessSajuSupplement(entries: readonly BenchmarkEntry[], executionMode: 'LIVE' | 'TEST_DOUBLE') {
  const expected = SAJU_SUPPLEMENTAL_CASES.flatMap(item => BENCHMARK_CHARACTERS.map(character => `${item.id}:${character}`));
  const fullCoverage = entries.length === expected.length && new Set(entries.map(entry => entry.id)).size === expected.length && expected.every(id => entries.some(entry => entry.id === id));
  const pendingReviews = entries.filter(entry => !hasAuthoredBenchmarkReview(entry)).length;
  const hardFailCount = entries.reduce((sum, entry) => sum + entry.automaticFlags.length + (entry.review?.hardFails.length ?? 0), 0);
  const averageScore = entries.length && pendingReviews === 0 ? entries.reduce((sum, entry) => sum + BENCHMARK_SCORE_KEYS.reduce((score, key) => score + entry.review!.scores[key], 0), 0) / entries.length : null;
  const status = executionMode === 'TEST_DOUBLE' ? 'TEST_ONLY' : !fullCoverage ? 'INCOMPLETE' : entries.some(entry => !entry.response || entry.errorCode || entry.automaticFlags.length) ? 'AUTOMATED_CHECKS_FAILED' : pendingReviews ? 'NEEDS_REVIEW' : hardFailCount || (averageScore ?? 0) < 8 ? 'FAILED' : 'PASSED';
  return { status, fullCoverage, averageScore, hardFailCount, pendingReviews };
}

/** 8 supplementary cases x 3 Personas; never substitutes for the core 20 x 3 contract. */
export async function runSajuSupplement(provider: LLMProvider, options: { executionMode: 'LIVE' | 'TEST_DOUBLE'; onEntry?: (entry: BenchmarkEntry) => void | Promise<void> }) {
  const entries: BenchmarkEntry[] = [];
  const startedAt = new Date().toISOString();
  for (const item of SAJU_SUPPLEMENTAL_CASES) for (const characterId of BENCHMARK_CHARACTERS) {
    const start = performance.now();
    const entry: BenchmarkEntry = { id: `${item.id}:${characterId}`, caseId: item.id, characterId, latencyMs: 0, response: null, errorCode: null, automaticFlags: [], reviewChecks: item.reviewChecks, review: null };
    try { entry.response = await generatePersonaReply(provider, { ...item.input, characterId }); }
    catch (error) { entry.errorCode = error instanceof LLMError ? error.code : 'BENCHMARK_EXECUTION_FAILED'; }
    entry.latencyMs = Math.round(performance.now() - start);
    if (entry.response && PRIVACY_CANARIES.some(value => entry.response!.content.includes(value))) entry.automaticFlags.push('RAW_BIRTH_CANARY_LEAK');
    entries.push(entry); await options.onEntry?.(entry);
  }
  for (const item of SAJU_SUPPLEMENTAL_CASES) {
    const responses = entries.filter(entry => entry.caseId === item.id && entry.response);
    if (responses.length === 3 && new Set(responses.map(entry => entry.response!.content.replace(/[\s\p{P}]/gu, ''))).size === 1) for (const entry of responses) entry.automaticFlags.push('IDENTICAL_PERSONA_OUTPUT');
  }
  const latencies = entries.map(entry => entry.latencyMs).sort((a, b) => a - b);
  const successes = entries.filter(entry => entry.response);
  const repairs = successes.filter(entry => entry.response?.repaired).length;
  return { schemaVersion: 2, suite: 'JumZipSajuPersonaSupplement-v1', fixtureKind: 'SYNTHETIC', doesNotReplaceCoreBenchmark: true,
    coreRequiredCaseCount: 60, supplementalRequiredCaseCount: 24, executionMode: options.executionMode, startedAt, completedAt: new Date().toISOString(), entries,
    metrics: { successCount: successes.length, errorCount: entries.length - successes.length, repairCount: repairs,
      repairRateAmongSuccesses: successes.length ? repairs / successes.length : 0,
      p50LatencyMs: latencies[Math.ceil(latencies.length * .5) - 1] ?? 0, p95LatencyMs: latencies[Math.ceil(latencies.length * .95) - 1] ?? 0 },
    assessment: assessSajuSupplement(entries, options.executionMode) };
}
