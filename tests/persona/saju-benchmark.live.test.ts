import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { createOpenAICompatibleProvider } from '../../supabase/functions/_shared/llm/provider.ts';
import { runSajuSupplement } from './saju-benchmark-runner.ts';

// Explicit, separate opt-in. Normal tests never call a model or consume credits.
it.skipIf(process.env.JUMZIP_RUN_LIVE_SAJU_BENCHMARK !== '1')('runs the supplemental 8 x 3 Saju/compatibility interpretation cases against a real model', async () => {
  const provider = createOpenAICompatibleProvider({ baseUrl: process.env.LLM_BASE_URL ?? '', model: process.env.LLM_MODEL ?? '', apiKey: process.env.LLM_API_KEY,
    structuredFormat: process.env.LLM_STRUCTURED_FORMAT === 'json_object' ? 'json_object' : 'json_schema' });
  const report = await runSajuSupplement(provider, { executionMode: 'LIVE', onEntry: entry => console.info(`saju supplement ${entry.id} ${entry.errorCode ?? 'generated'} ${entry.latencyMs}ms`) });
  await writeFile(resolve('tests/persona/saju-benchmark-results.json'), JSON.stringify(report, null, 2));
  expect(report.assessment.fullCoverage).toBe(true); expect(report.metrics.errorCount).toBe(0);
  expect(report.assessment.hardFailCount).toBe(0); expect(report.assessment.status).toBe('NEEDS_REVIEW');
}, 2_500_000);
