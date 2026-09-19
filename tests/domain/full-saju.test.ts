import { describe, expect, it } from 'vitest';
import { FROZEN_SAJU_EXPECTATIONS as F } from './frozen-expectations.ts';
import { calculateBalance, calculateClimate, calculateConcentrationComponent, calculateElements, calculateGyeokguk, calculateNatalRules, calculateRelationComponent, calculateRelations, calculateRootsComponent, calculateSeasonComponent, calculateShinsal, calculateVisibleSupportComponent, ELEMENTS, getTenGod, getTwelveStage, HIDDEN_MASS, roundStrength, SHINSAL_MAPPINGS, STEMS, BRANCHES } from '../../supabase/functions/_shared/domain/rules/index.ts';
import type { Element, ExactRational, HanjaBranch, HanjaStem, NatalChart, PillarPosition } from '../../supabase/functions/_shared/domain/rules/types.ts';
import { aggregateUncertainChoices, buildSajuInterpretationData, calculateFullSaju } from '../../supabase/functions/_shared/domain/full-saju.ts';
import { buildPersonaMessages } from '../../supabase/functions/_shared/persona/prompt.ts';

const chart = (values: Readonly<Record<PillarPosition, string | null>>): NatalChart => Object.fromEntries(Object.entries(values).map(([position, value]) => [position, value === null ? null : { heavenlyStem: value[0] as HanjaStem, earthlyBranch: value[1] as HanjaBranch }])) as unknown as NatalChart;
const distribution = (values: readonly number[]) => Object.fromEntries(ELEMENTS.map((e, i) => [e, values[i]!])) as Record<Element, number>;
const exact = (actual: ExactRational, expected: { numerator: number; denominator: number }) => expect(BigInt(actual.numerator) * BigInt(expected.denominator)).toBe(BigInt(expected.numerator) * BigInt(actual.denominator));
const evidence = (value: unknown) => value as Record<string, ExactRational | Record<string, number>>;

describe('M8 approved rules against independently frozen manual expectations', () => {
  it('uses the adopted immutable hidden-stem masses and all ten exact shinsal tables', () => {
    expect(HIDDEN_MASS).toEqual(F.hiddenMass); expect(SHINSAL_MAPPINGS).toEqual(F.shinsalCanonical);
    expect(Object.isFrozen(HIDDEN_MASS.辰)).toBe(true); expect(Object.isFrozen(SHINSAL_MAPPINGS.CHEONEUL.甲)).toBe(true);
  });
  for (const f of F.seasonal) it(`C1 ${f.relation}`, () => expect(calculateSeasonComponent(f.dayElement, f.monthBranch).points).toBe(f.expectedC1));
  for (const f of F.roots) it(`C2 ${f.id}`, () => { const result = calculateRootsComponent(f.dayElement, f.branches); exact(result.raw, f.expectedRatio); exact(result.weighted, f.expectedC2); });
  for (const f of F.visibleSupport) it(`C3 ${f.id}`, () => exact(calculateVisibleSupportComponent(f.dayElement, f.externalStems).weighted, f.expectedC3));
  for (const f of F.relationEffect) it(`C4 ${f.id}`, () => {
    const result = calculateRelationComponent(chart(f.chart)); exact(result.weighted, f.expectedC4);
    const details = evidence(result.evidence); exact(details.B as ExactRational, f.expectedB); exact(details.A as ExactRational, f.expectedA);
    if ('expectedBranchFactors' in f) expect(details.branchFactors).toEqual(f.expectedBranchFactors);
  });
  for (const f of F.transformationPredicates) it(`transformation ${f.id}`, () => {
    const result = calculateRelations(chart(f.chart)).find(r => r.type === 'STEM_COMBINATION' && r.participants.join(',') === f.pair.join(','))!;
    expect(result).toBeDefined(); expect(result.transformationStatus).toBe(f.expected === 'NOT_TRANSFORMED' ? 'NOT_ESTABLISHED' : f.expected);
    expect(result.transformedElement).toBe(f.expected === 'CONFIRMED' ? f.target : null);
    if ('failedPredicate' in f) expect(result.reasonCodes).toContain(`FAIL_${f.failedPredicate}`);
  });
  for (const f of F.concentration) it(`C5 ${f.id}`, () => {
    const result = calculateConcentrationComponent(f.dayElement, distribution(f.proportions));
    exact(result.weighted, f.expectedC5); exact(evidence(result.evidence).H as ExactRational, f.expectedH); exact(evidence(result.evidence).u as ExactRational, f.expectedU);
  });
  for (const f of F.rounding) it(`exact grade boundary ${f.raw}`, () => expect(roundStrength(f.raw)).toEqual({ score: f.score, grade: f.grade }));
  for (const f of F.balance) it(`balance ${f.id}`, () => {
    const result = calculateBalance(f.dayElement, f.monthBranch, f.strengthScore, distribution(f.proportions));
    expect(result.yongsin.element).toBe(f.yongsin); expect(result.heesin.element).toBe(f.heesin);
    expect(result.candidates.map(c => c.element)).toEqual(f.expectedRanking);
    expect(Object.fromEntries(result.candidates.map(c => [c.element, c.score]))).toEqual(f.expectedScores);
    const reasons = [...result.yongsin.reasonCodes, ...result.heesin.reasonCodes, ...result.candidates.flatMap(c => c.reasonCodes)];
    for (const reason of f.requiredReasons) expect(reasons).toContain(reason);
  });
  for (const f of F.climate) it(`climate exact threshold ${f.id}`, () => {
    const result = calculateClimate(f.monthBranch, distribution(f.proportions)); expect(ELEMENTS.map(e => result.bonus[e])).toEqual(f.expectedT);
  });
  for (const f of F.shinsal) it(`shinsal ${f.id} positive/negative/multiple/unknown hour`, () => {
    const encode = (value: ReturnType<typeof calculateShinsal>[number] | undefined) => value?.evidence.map(e => e.referencePosition ? `${e.referencePosition}>${e.matchedPositions[0]}` : e.matchedPositions.join('+')) ?? [];
    expect(encode(calculateShinsal(chart(f.positive)).find(s => s.id === f.id))).toEqual(f.expectedEvidence);
    expect(calculateShinsal(chart(f.negative)).some(s => s.id === f.id)).toBe(false);
    expect(encode(calculateShinsal(chart({ ...f.positive, hour: null })).find(s => s.id === f.id))).toEqual(f.unknownHourEvidence);
  });
  for (const f of F.gyeokguk) it(`gyeokguk ${f.id}`, () => {
    const result = calculateGyeokguk(chart(f.chart));
    expect(result.primary).toBe(f.expectedPrimary); expect(result.secondary).toEqual(f.expectedSecondary);
    expect(result.geonrok).toBe(f.expectedGeonrok); expect(result.yangin).toBe(f.expectedYangin);
    expect(result.candidates.map(c => c.stem)).toEqual(f.expectedCandidateStems);
    if ('expectedMonthCore' in f) expect(result.monthCore).toBe(f.expectedMonthCore);
    if ('expectedExposurePositions' in f) expect(result.candidates[0]!.exposedAt).toEqual(f.expectedExposurePositions);
    if ('expectedExposed' in f) expect(result.candidates[0]!.exposedAt.length > 0).toBe(f.expectedExposed);
  });
  for (const f of F.charts) it(`integrated synthetic chart: ${f.id}`, () => {
    const result = calculateNatalRules(chart(f.chart));
    expect(ELEMENTS.map(e => result.elements.mass[e] * 10)).toEqual(f.massTenths); expect(result.elements.totalMass).toBe(f.totalMass);
    const names = ['season', 'roots', 'visibleSupport', 'relations', 'concentration'] as const;
    names.forEach((name, i) => exact(result.strength.components[name].weighted, Object.values(f.components)[i]!));
    exact(result.strength.exactScore, f.rawScore); expect(result.strength.score).toBe(f.score); expect(result.strength.grade).toBe(f.grade);
    expect(result.yongsin.element).toBe(f.yongsin); expect(result.heesin.element).toBe(f.heesin);
    for (const candidate of result.balance.candidates) exact(candidate.exactScore, f.balanceScores[candidate.element as keyof typeof f.balanceScores]);
    expect(result.gyeokguk).toMatchObject(f.gyeokguk); expect(result.shinsal.map(s => s.id)).toEqual(f.expectedShinsalIds);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe('fixed Notion §4/6/7 facts', () => {
  it('validates all 100 ten-god pairs against the independent yang/yin canonical cycle', () => {
    const yang = ['비견', '겁재', '식신', '상관', '편재', '정재', '편관', '정관', '편인', '정인'];
    const yin = ['겁재', '비견', '상관', '식신', '정재', '편재', '정관', '편관', '정인', '편인'];
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) expect(getTenGod(STEMS[i]!, STEMS[j]!)).toBe((i % 2 ? yin : yang)[(j - Math.floor(i / 2) * 2 + 10) % 10]);
  });
  it('validates all 120 twelve-stage positions from the frozen Notion row order', () => {
    const rows: Record<HanjaStem, string> = { 甲: '亥子丑寅卯辰巳午未申酉戌', 乙: '午巳辰卯寅丑子亥戌酉申未', 丙: '寅卯辰巳午未申酉戌亥子丑', 戊: '寅卯辰巳午未申酉戌亥子丑', 丁: '酉申未午巳辰卯寅丑子亥戌', 己: '酉申未午巳辰卯寅丑子亥戌', 庚: '巳午未申酉戌亥子丑寅卯辰', 辛: '子亥戌酉申未午巳辰卯寅丑', 壬: '申酉戌亥子丑寅卯辰巳午未', 癸: '卯寅丑子亥戌酉申未午巳辰' };
    const stages = ['장생', '목욕', '관대', '임관', '제왕', '쇠', '병', '사', '묘', '절', '태', '양'];
    for (const stem of STEMS) for (const branch of BRANCHES) expect(getTwelveStage(stem, branch)).toBe(stages[rows[stem].indexOf(branch)]);
  });
  it('preserves concurrent relation types and does not create partial trines or directional groups', () => {
    const both = calculateRelations(chart({ year: '甲巳', month: '甲申', day: '甲辰', hour: null }));
    expect(both.filter(r => r.participants.join(',') === 'year,month').map(r => r.type)).toEqual(['SIX_COMBINATION', 'BREAK']);
    const partial = calculateRelations(chart({ year: '壬子', month: '甲寅', day: '甲辰', hour: null }));
    expect(partial).toEqual([]);
    const full = calculateRelations(chart({ year: '甲申', month: '甲子', day: '甲辰', hour: '甲辰' }));
    expect(full.filter(r => r.type === 'TRINE')).toHaveLength(2); expect(full.filter(r => r.type === 'SELF_PUNISHMENT')).toHaveLength(1);
  });
  it('rejects invalid symbols while preserving the input chart', () => {
    const input = chart(F.charts[0]!.chart), before = JSON.stringify(input); calculateElements(input); calculateNatalRules(input); expect(JSON.stringify(input)).toBe(before);
    expect(() => calculateNatalRules({ ...input, day: { heavenlyStem: 'x' as HanjaStem, earthlyBranch: '子' } })).toThrow('NATAL_CHART_INVALID');
  });
});

describe('foundation to Full v1 integration and boundary aggregation', () => {
  for (const f of F.aggregation) it(`independent aggregation: ${f.id}`, () => {
    const result = aggregateUncertainChoices(f.candidateValues);
    expect(result).toMatchObject(f.expected); expect(result.possible.score).toEqual(f.possibleScores); expect(result.possible.heesin).toEqual(f.possibleHeesin);
  });
  const birth = { calendarType: 'SOLAR' as const, leapMonth: false, birthDate: '1992-10-24', birthTime: '05:30', birthTimeUnknown: false, location: { name: 'Seoul', latitude: 37.5665, longitude: 126.978, timezone: 'Asia/Seoul' }, gender: 'MALE' as const, trueSolarTime: false };
  it('combines published foundation pillars with adopted judgments and a bounded factual prompt', () => {
    const full = calculateFullSaju(birth);
    expect(Object.values(full.pillars).map(p => p ? p.heavenlyStem + p.earthlyBranch : null)).toEqual(['壬申', '庚戌', '癸酉', '乙卯']);
    expect(full).toMatchObject({ status: 'COMPLETE', fullCalculationReady: true, ruleVersion: 'JumZipSajuRules-v1', engineVersion: 'manseryeok-2.0.0', conventionVersion: 'JumZipSajuConvention-v1' });
    expect(full.strength.score).toBeGreaterThanOrEqual(0); expect(full.strength.score).toBeLessThanOrEqual(100);
    expect(full.yongsin.element).not.toBe(full.heesin.element);
    const view = buildSajuInterpretationData(full), serialized = JSON.stringify(view);
    expect(serialized).not.toContain('1992-10-24'); expect(serialized).not.toContain('126.978'); expect(serialized.length).toBeLessThan(20_000);
    expect(() => buildPersonaMessages({ characterId: 'SANI', currentMessage: '성향을 알려줘', toolResult: view })).not.toThrow();
    expect(JSON.parse(JSON.stringify(full))).toEqual(full);
  });
  it('retains only actual correlated unknown-hour candidates with field-by-field agreement', () => {
    const full = calculateFullSaju({ ...birth, birthDate: '2024-02-04', birthTime: null, birthTimeUnknown: true, trueSolarTime: true });
    expect(full.status).toBe('UNCERTAIN'); expect(full.pillars.hour).toBeNull(); expect(full.tenGods.hour).toBeNull(); expect(full.twelveStages.hour).toBeNull();
    expect(full.possible_values.charts.every(v => v.pillars.hour === null)).toBe(true);
    expect(full.possible_values.charts.every(v => v.strength.limited)).toBe(true);
    expect(full.uncertaintyFlags).toContain('LIMITED_UNKNOWN_HOUR');
    for (const shinsal of full.shinsal) expect(shinsal.evidence.every(e => !e.matchedPositions.includes('hour'))).toBe(true);
    const scores = new Set(full.possible_values.charts.map(v => v.strength.score));
    expect(full.strength.score).toBe(scores.size === 1 ? [...scores][0] : null);
    const chartCount = full.possible_values.charts.length;
    expect(chartCount).toBeGreaterThan(1); expect(chartCount).toBeLessThanOrEqual(4);
  });
});
