import { describe, expect, it, vi } from 'vitest';
import { buildPersonaMessages } from '../../supabase/functions/_shared/persona/prompt.ts';
import { PERSONA_BENCHMARK_CASES, BENCHMARK_CHARACTERS, type BenchmarkEntry } from '../../supabase/functions/_shared/persona/benchmark.ts';
import { type LLMProvider, LLMError } from '../../supabase/functions/_shared/llm/provider.ts';
import { FROZEN_SAJU_EXPECTATIONS } from '../domain/frozen-expectations.ts';
import { SUPPLEMENTAL_FIXTURES, SAJU_SUPPLEMENTAL_CASES, PRIVACY_CANARIES } from './saju-benchmark-corpus.ts';
import { assessSajuSupplement, runSajuSupplement } from './saju-benchmark-runner.ts';

function fakeProvider(content?: string): LLMProvider {
  let counter = 0;
  return { generateChat: vi.fn(async () => ({ content: JSON.stringify({ text: content ?? `자료에 적힌 범위부터 같이 살펴보자. 시각이 불확실한 부분은 남겨 둘게. 확인 차례 ${++counter}.`, toolReferences: [] }), model: 'test-double-only' })), repairChat: vi.fn(), generateStructured: vi.fn() };
}

describe('supplemental synthetic Saju/compatibility model-evaluation harness, no live model', () => {
  it('keeps the mandatory core20 untouched and gives the 8 supplements a separate namespace', () => {
    expect(PERSONA_BENCHMARK_CASES).toHaveLength(20); expect(SAJU_SUPPLEMENTAL_CASES).toHaveLength(8);
    expect(SAJU_SUPPLEMENTAL_CASES.every(item => !PERSONA_BENCHMARK_CASES.some(core => core.id === item.id))).toBe(true);
    expect(new Set(SAJU_SUPPLEMENTAL_CASES.map(item => item.id)).size).toBe(8);
  });

  it('checks computed synthetic source facts against the independently frozen expected values', () => {
    for (const [index, snapshot] of [SUPPLEMENTAL_FIXTURES.known, SUPPLEMENTAL_FIXTURES.unknown].entries()) {
      const expected = FROZEN_SAJU_EXPECTATIONS.charts[index]!;
      expect(snapshot.strength.score).toBe(expected.score); expect(snapshot.strength.grade).toBe(expected.grade);
      expect(snapshot.yongsin.element).toBe(expected.yongsin); expect(snapshot.heesin.element).toBe(expected.heesin);
      expect(snapshot.shinsal.map(item => item.id).sort()).toEqual([...expected.expectedShinsalIds].sort());
      expect(snapshot.uncertaintyFlags).toContain('SYNTHETIC_COMPONENT_FIXTURE');
    }
    expect(SUPPLEMENTAL_FIXTURES.unknown.pillars.hour).toBeNull();
    expect(SUPPLEMENTAL_FIXTURES.unknown.tenGods.hour).toBeNull();
  });

  it('includes real-shaped correlated boundary data with null judgments and unresolved current luck', () => {
    const boundary = SUPPLEMENTAL_FIXTURES.boundary;
    expect(boundary.strength.score).toBeNull(); expect(boundary.strength.grade).toBeNull();
    expect(boundary.pillars.hour).toBeNull(); expect(boundary.timing?.activeDaewoonStatus).toBe('UNRESOLVED');
    expect(boundary.possible_values.charts.map(chart => ['year', 'month', 'day'].map(position => {
      const pillar = chart.pillars[position as 'year' | 'month' | 'day']; return pillar.heavenlyStem + pillar.earthlyBranch;
    }).join('/')).sort()).toEqual(['癸卯/乙丑/丁酉', '癸卯/乙丑/戊戌', '甲辰/丙寅/戊戌'].sort());
  });

  it('uses both-person derived charts, never a invented compatibility probability or hour', () => {
    expect(SUPPLEMENTAL_FIXTURES.compatibility.summary.dayMasterRelation).toMatchObject({ personA: '甲', personB: '甲', aSeesB: '비견', bSeesA: '비견' });
    expect(SUPPLEMENTAL_FIXTURES.compatibility.summary).not.toHaveProperty('score');
    expect(SUPPLEMENTAL_FIXTURES.compatibility).not.toHaveProperty('probability');
    expect(SUPPLEMENTAL_FIXTURES.uncertainCompatibility.possible_values.pairs).toHaveLength(3);
    expect(SUPPLEMENTAL_FIXTURES.uncertainCompatibility.personA.charts.every(chart => chart.pillars.hour === null)).toBe(true);
    expect(SUPPLEMENTAL_FIXTURES.uncertainCompatibility.personB.charts.every(chart => chart.pillars.hour === null)).toBe(true);
  });

  it('builds every persona prompt within the normal budget and strips all structured birth canaries without changing source', () => {
    const before = JSON.stringify(SAJU_SUPPLEMENTAL_CASES);
    for (const item of SAJU_SUPPLEMENTAL_CASES) for (const characterId of BENCHMARK_CHARACTERS) {
      const messages = buildPersonaMessages({ ...item.input, characterId });
      const serialized = JSON.stringify(messages);
      for (const value of PRIVACY_CANARIES) expect(serialized).not.toContain(value);
      expect(serialized).not.toContain('birthProfile');
    }
    expect(JSON.stringify(SAJU_SUPPLEMENTAL_CASES)).toBe(before);
    // The canaries existed before scrubbing, so the absence assertion is meaningful.
    expect(before).toContain(PRIVACY_CANARIES[2]);
  });

  it('records 24 outputs and per-output model/prompt metadata but never counts test doubles as a quality pass', async () => {
    const provider = fakeProvider(); const report = await runSajuSupplement(provider, { executionMode: 'TEST_DOUBLE' });
    expect(provider.generateChat).toHaveBeenCalledTimes(24);
    expect(report).toMatchObject({ doesNotReplaceCoreBenchmark: true, coreRequiredCaseCount: 60, supplementalRequiredCaseCount: 24, fixtureKind: 'SYNTHETIC', metrics: { successCount: 24 }, assessment: { status: 'TEST_ONLY', fullCoverage: true, pendingReviews: 24 } });
    expect(report.entries.every(entry => entry.response?.metadata.model === 'test-double-only' && entry.response.metadata.promptVersion)).toBe(true);
  });

  it('records hard flags for exact privacy canary leakage and identical three-persona outputs', async () => {
    const report = await runSajuSupplement(fakeProvider(`출생 도시는 ${PRIVACY_CANARIES[2]}야.`), { executionMode: 'TEST_DOUBLE' });
    expect(report.entries.every(entry => entry.automaticFlags.includes('RAW_BIRTH_CANARY_LEAK') && entry.automaticFlags.includes('IDENTICAL_PERSONA_OUTPUT'))).toBe(true);
    expect(report.assessment.hardFailCount).toBe(48);
  });

  it('requires all supplementary qualitative scores and zero hard fails, independently of the core verdict', async () => {
    const report = await runSajuSupplement(fakeProvider(), { executionMode: 'TEST_DOUBLE' });
    // This exercises scoring logic with artificial reviews; it is not written as a live report.
    expect(assessSajuSupplement(report.entries, 'LIVE').status).toBe('NEEDS_REVIEW');
    const reviewed: BenchmarkEntry[] = report.entries.map(entry => ({ ...entry, review: { reviewer: 'unit-test-only', reviewerKind: 'AI', method: 'DIRECT_RESPONSE_REVIEW', evidence: ['Schema test only, not quality evidence.'], reviewedOutput: entry.response!.content, scores: { personaFidelity: 2, naturalness: 2, contextConsistency: 2, toolFidelity: 2, concisionRhythm: 2 }, hardFails: [] } }));
    expect(assessSajuSupplement(reviewed, 'LIVE').status).toBe('PASSED');
    expect(assessSajuSupplement(reviewed.slice(1), 'LIVE').status).toBe('INCOMPLETE');
    reviewed[0]!.review!.hardFails.push('SAJU_FACT_CHANGED');
    expect(assessSajuSupplement(reviewed, 'LIVE').status).toBe('FAILED');
    expect(assessSajuSupplement(reviewed, 'TEST_DOUBLE').status).toBe('TEST_ONLY');
  });

  it('keeps sanitized failures and continues remaining cases without manufacturing responses', async () => {
    const provider = fakeProvider(); vi.mocked(provider.generateChat).mockRejectedValueOnce(new LLMError('LLM_TIMEOUT'));
    const report = await runSajuSupplement(provider, { executionMode: 'TEST_DOUBLE' });
    expect(report.entries).toHaveLength(24); expect(report.metrics.errorCount).toBe(1);
    expect(report.entries[0]).toMatchObject({ response: null, errorCode: 'LLM_TIMEOUT' });
    expect(provider.generateChat).toHaveBeenCalledTimes(24);
  });
});
