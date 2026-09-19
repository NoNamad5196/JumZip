import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { createOpenAICompatibleProvider } from '../../supabase/functions/_shared/llm/provider.ts';
import { runPersonaBenchmark } from '../../supabase/functions/_shared/persona/benchmark.ts';

// Explicit opt-in: normal unit runs do not contact or spend money with any inference provider.
// PowerShell: $env:JUMZIP_RUN_LIVE_BENCHMARK='1'; node node_modules/vitest/vitest.mjs run tests/persona/benchmark.live.test.ts
// Requires server-only LLM_BASE_URL / LLM_MODEL / optional LLM_API_KEY in the process environment.
it.skipIf(process.env.JUMZIP_RUN_LIVE_BENCHMARK !== '1')('runs 20 prompts x 3 personas against the configured real provider', async () => {
  const provider = createOpenAICompatibleProvider({ baseUrl: process.env.LLM_BASE_URL ?? '', model: process.env.LLM_MODEL ?? '', apiKey: process.env.LLM_API_KEY,
    structuredFormat: process.env.LLM_STRUCTURED_FORMAT === 'json_object' ? 'json_object' : 'json_schema' });
  const report = await runPersonaBenchmark(provider, { executionMode: 'LIVE', onEntry: entry => {
    // No response text, prompts, authentication values or upstream error bodies in logs.
    console.info(`benchmark ${entry.id} ${entry.errorCode ?? 'generated'} ${entry.latencyMs}ms`);
  } });
  const file = resolve('tests/persona/benchmark-results.json');
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  expect(report.assessment.fullCoverage).toBe(true);
  expect(report.metrics.errorCount).toBe(0);
  expect(report.assessment.hardFailCount).toBe(0);
  // A successful execution remains NEEDS_REVIEW; it is not a model-quality release pass.
  expect(report.assessment.status).toBe('NEEDS_REVIEW');
}, 6_000_000);
