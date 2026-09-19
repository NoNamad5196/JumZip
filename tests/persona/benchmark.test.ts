import { describe, expect, it, vi } from 'vitest';
import { assessPersonaBenchmark, BENCHMARK_CHARACTERS, PERSONA_BENCHMARK_CASES, runPersonaBenchmark, type BenchmarkEntry } from '../../supabase/functions/_shared/persona/benchmark.ts';
import { LLMError, type LLMProvider } from '../../supabase/functions/_shared/llm/provider.ts';
import { TAROT_SPREADS, type TarotCard } from '../../supabase/functions/_shared/domain/tarot.ts';

const provider = (): LLMProvider => ({ generateChat: vi.fn(async () => ({ content: '{"text":"오늘은 어떤 일이 있었어?","toolReferences":[]}', model: 'TEST_DOUBLE' })), repairChat: vi.fn(), generateStructured: vi.fn() });
const fullEntries = (): BenchmarkEntry[] => PERSONA_BENCHMARK_CASES.flatMap(c => BENCHMARK_CHARACTERS.map(characterId => ({
  id: `${c.id}:${characterId}`, caseId: c.id, characterId, latencyMs: 1, response: { content: '평가 로직 테스트용 입력', segments: [], repaired: false, metadata: { model: 'ASSESSMENT_TEST_FIXTURE', promptVersion: 'test', provider: 'openai-compatible' as const, generatedAt: '2026-09-20T00:00:00Z' } }, errorCode: null, automaticFlags: [], reviewChecks: c.reviewChecks, review: null,
})));

describe('persona benchmark harness (test doubles, not model evaluation)', () => {
  it('defines exactly 20 shared cases and canonical tool positions', () => {
    expect(PERSONA_BENCHMARK_CASES).toHaveLength(20);
    expect(new Set(PERSONA_BENCHMARK_CASES.map(c => c.id)).size).toBe(20);
    for (const c of PERSONA_BENCHMARK_CASES) {
      const cards = (c.input.toolResult as { cards?: TarotCard[] } | undefined)?.cards;
      if (cards) expect(Object.values(TAROT_SPREADS).some(spread => spread.length === cards.length && spread.every((position, i) => position.key === cards[i]!.positionKey))).toBe(true);
    }
  });
  it('returns model metadata, latency, repair counts and pending qualitative reviews without claiming a pass', async () => {
    const report = await runPersonaBenchmark(provider(), { executionMode: 'TEST_DOUBLE', caseIds: ['01-first-meeting'], characters: ['SANI'] });
    expect(report.assessment).toMatchObject({ status: 'TEST_ONLY', fullCoverage: false, pendingReviews: 1, averageScore: null });
    expect(report.metrics).toMatchObject({ successCount: 1, errorCount: 0, repairCount: 0 });
    expect(report.entries[0]!.response!.metadata.model).toBe('TEST_DOUBLE');
    expect(report.entries[0]!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(JSON.stringify(report)).corpusVersion).toBe('JumZipPersonaBenchmark-v1');
  });
  it('records sanitized errors while continuing other cases', async () => {
    const mock = provider();
    mock.generateChat = vi.fn().mockRejectedValueOnce(new LLMError('LLM_TIMEOUT')).mockResolvedValue({ content: '{"text":"다음 이야기를 들어보자.","toolReferences":[]}', model: 'TEST_DOUBLE' });
    const report = await runPersonaBenchmark(mock, { executionMode: 'TEST_DOUBLE', caseIds: ['01-first-meeting', '02-small-talk'], characters: ['SANI'] });
    expect(report.metrics).toMatchObject({ errorCount: 1, successCount: 1 });
    expect(report.entries[0]!.errorCode).toBe('LLM_TIMEOUT');
  });
  it('flags identical outputs across all three characters', async () => {
    const report = await runPersonaBenchmark(provider(), { executionMode: 'TEST_DOUBLE', caseIds: ['01-first-meeting'] });
    expect(report.entries.every(entry => entry.automaticFlags.includes('IDENTICAL_PERSONA_OUTPUT'))).toBe(true);
  });
  it('requires full coverage, every authored score and zero hard fails for a live pass', () => {
    const entries = fullEntries();
    expect(assessPersonaBenchmark({ entries, executionMode: 'LIVE' }).status).toBe('NEEDS_REVIEW');
    for (const entry of entries) entry.review = { reviewer: 'synthetic gate test', reviewerKind: 'AI', method: 'DIRECT_RESPONSE_REVIEW', evidence: ['Schema test only; not a real model evaluation.'], reviewedOutput: entry.response!.content, scores: { personaFidelity: 2, naturalness: 2, contextConsistency: 2, toolFidelity: 2, concisionRhythm: 0 }, hardFails: [] };
    expect(assessPersonaBenchmark({ entries, executionMode: 'LIVE' })).toMatchObject({ status: 'PASSED', averageScore: 8 });
    expect(assessPersonaBenchmark({ entries, executionMode: 'TEST_DOUBLE' }).status).toBe('TEST_ONLY');
    entries[0]!.review!.reviewerKind = 'SCRIPT';
    expect(assessPersonaBenchmark({ entries, executionMode: 'LIVE' }).status).toBe('NEEDS_REVIEW');
    entries[0]!.review!.reviewerKind = 'AI'; entries[0]!.review!.reviewedOutput = 'a different response';
    expect(assessPersonaBenchmark({ entries, executionMode: 'LIVE' }).status).toBe('NEEDS_REVIEW');
    entries[0]!.review!.reviewedOutput = entries[0]!.response!.content; entries[0]!.review!.evidence = [];
    expect(assessPersonaBenchmark({ entries, executionMode: 'LIVE' }).status).toBe('NEEDS_REVIEW');
    entries[0]!.review!.evidence = ['Schema test only'];
    entries[0]!.review!.hardFails.push('RELATION_PERSON_CONFUSION');
    expect(assessPersonaBenchmark({ entries, executionMode: 'LIVE' }).status).toBe('FAILED');
    expect(assessPersonaBenchmark({ entries: entries.slice(1), executionMode: 'LIVE' }).status).toBe('INCOMPLETE');
  });
});
