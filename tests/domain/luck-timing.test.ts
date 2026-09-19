import { describe, expect, it } from 'vitest';
import { LUCK_START_EXPECTATIONS, LUCK_PERIOD_EXPECTATIONS, LUCK_TIMEZONE_EXPECTATIONS } from './luck-start-expectations';
import { birthLocationCivilDate, calculateFullSajuWithTiming, calculateLuckStartDate, luckBoundaryDate, selectLuckPeriodIndex } from '../../supabase/functions/_shared/domain/fortune-timing.ts';
import { buildSajuInterpretationData, calculateFullSaju } from '../../supabase/functions/_shared/domain/full-saju.ts';
import { calculateSajuFoundation, type SajuBirthInput } from '../../supabase/functions/_shared/domain/saju.ts';
import { buildCompatibilityInterpretationData, calculateSajuCompatibility } from '../../supabase/functions/_shared/domain/saju-compatibility.ts';
import { buildPersonaMessages } from '../../supabase/functions/_shared/persona/prompt.ts';

const birth: SajuBirthInput = { calendarType: 'SOLAR', leapMonth: false, birthDate: '1992-10-24', birthTime: '05:30', birthTimeUnknown: false,
  location: { name: 'PRIVATE_CITY_SENTINEL', latitude: 37.5665, longitude: 126.978, timezone: 'Asia/Seoul' }, gender: 'MALE', trueSolarTime: false };
const asOf = new Date('2036-09-20T00:00:00Z');

describe('pre-implementation manual civil-date expectations', () => {
  for (const f of LUCK_START_EXPECTATIONS) it(f.id, () => expect(calculateLuckStartDate(f.birthDate, f)).toBe(f.expectedStart));
  for (const f of LUCK_PERIOD_EXPECTATIONS) it(f.id, () => {
    expect(selectLuckPeriodIndex(f.firstStart, f.localDate)).toBe(f.expectedIndex);
    if (f.expectedIndex !== null) {
      expect(luckBoundaryDate(f.firstStart, f.expectedIndex)).toBe(f.expectedStart);
      expect(luckBoundaryDate(f.firstStart, f.expectedIndex + 1)).toBe(f.expectedEnd);
    }
  });
  for (const f of LUCK_TIMEZONE_EXPECTATIONS) it(f.id, () => {
    const date = birthLocationCivilDate(new Date(f.asOf), f.timezone);
    expect(date).toBe(f.expectedLocalDate); expect(selectLuckPeriodIndex('1995-08-22', date)).toBe(f.expectedIndex);
  });
  it('does not extrapolate the finite library sequence or include its last excluded endpoint', () => {
    expect(selectLuckPeriodIndex('1995-08-22', '2095-08-22', 10)).toBeNull();
    expect(selectLuckPeriodIndex('1995-08-22', '2095-08-21', 10)).toBe(9);
  });
  it('rejects invalid civil dates, fractional durations and invalid timezone/instant', () => {
    expect(() => calculateLuckStartDate('2001-02-29', { startYears: 0, startMonths: 0, startDays: 0 })).toThrow('LUCK_CIVIL_DATE_INVALID');
    expect(() => calculateLuckStartDate('2000-01-01', { startYears: 1.5, startMonths: 0, startDays: 0 })).toThrow('LUCK_DURATION_INVALID');
    expect(() => calculateLuckStartDate('2000-01-01', { startYears: 0, startMonths: 0, startDays: -1 })).toThrow('LUCK_DURATION_INVALID');
    expect(() => birthLocationCivilDate(asOf, 'invalid/zone')).toThrow('LUCK_TIMEZONE_INVALID');
    expect(() => birthLocationCivilDate(new Date(NaN), 'Asia/Seoul')).toThrow('FLOW_DATE_INVALID');
  });
});

describe('M9 engine integration, correlation and privacy (not independent astronomy goldens)', () => {
  const known = calculateFullSajuWithTiming(birth, asOf);
  const uncertainBirth: SajuBirthInput = { ...birth, birthDate: '2024-02-04', birthTime: null, birthTimeUnknown: true, trueSolarTime: true };
  const unknownStarted = performance.now();
  const uncertain = calculateFullSajuWithTiming(uncertainBirth, asOf);
  const unknownWallMs = performance.now() - unknownStarted;

  it('selects a real active period with day precision and leaves all natal judgments intact', () => {
    const natal = calculateFullSaju(birth);
    expect(known.timing).toMatchObject({ conventionVersion: 'JumZipLuckTiming-v1', activeDaewoonStatus: 'ACTIVE', precision: 'MINUTE',
      luck: { precision: 'DAY', dateBasis: 'BIRTH_LOCATION_CIVIL_DAY', asOfLocalDate: '2036-09-20', candidateCount: 1 } });
    expect(known.status).toBe('COMPLETE');
    for (const key of ['pillars', 'hiddenStems', 'tenGods', 'elements', 'relations', 'strength', 'gyeokguk', 'yongsin', 'heesin', 'shinsal', 'twelveStages'] as const) expect(known[key]).toEqual(natal[key]);
    const current = known.timing!.luck!.currentPeriod!;
    expect(current.startDate <= '2036-09-20' && current.endDate > '2036-09-20').toBe(true);
    expect(known.uncertaintyFlags).not.toContain('CURRENT_DAEWOON_NOT_RESOLVED');
    expect(known.possible_values.timing![0]!.luckIndices).toEqual([0]);
  });
  it('uses converted lunar solar date; an equivalent verified solar input yields identical derived dates', () => {
    // KASI calendar-evidence-fixtures independently fixes lunar leap 4/1 -> 2020-05-23.
    const lunar = calculateFullSajuWithTiming({ ...birth, calendarType: 'LUNAR', leapMonth: true, birthDate: '2020-04-01' }, asOf);
    const solar = calculateFullSajuWithTiming({ ...birth, birthDate: '2020-05-23' }, asOf);
    expect(lunar.timing).toEqual(solar.timing); expect(lunar.possible_values.luckTiming).toEqual(solar.possible_values.luckTiming);
  });
  it('retains genuine chart/luck links through Ipchun without producing a Cartesian product', () => {
    const links = uncertain.possible_values.chartLuck!;
    expect(uncertain.pillars.hour).toBeNull(); expect(uncertain.possible_values.charts.every(chart => chart.pillars.hour === null)).toBe(true);
    expect(uncertain.possible_values.charts).toHaveLength(3);
    expect(links.length).toBeLessThan(uncertain.possible_values.charts.length * uncertain.possible_values.daewoon.length);
    for (const time of ['00:00', '08:00', '17:26', '17:28', '23:59']) {
      const sampled = calculateSajuFoundation({ ...uncertainBirth, birthTime: time, birthTimeUnknown: false });
      const sampledChart = sampled.possible_values.charts[0]!;
      const matchingChart = calculateFullSaju({ ...uncertainBirth, birthTime: time, birthTimeUnknown: false }).pillars;
      const chartIndex = uncertain.possible_values.charts.findIndex(chart => ['year', 'month', 'day'].every(key => JSON.stringify(chart.pillars[key as 'year']) === JSON.stringify(matchingChart[key as 'year'])));
      expect(sampledChart.hour).toBeDefined();
      const luckIndex = uncertain.possible_values.daewoon.findIndex(luck => JSON.stringify(luck) === JSON.stringify(sampled.daewoon));
      expect(chartIndex).toBeGreaterThanOrEqual(0); expect(luckIndex).toBeGreaterThanOrEqual(0);
      expect(links).toContainEqual({ chartIndex, luckIndex });
    }
    for (const overlay of uncertain.possible_values.timing!) for (const luckIndex of overlay.luckIndices!) expect(links).toContainEqual({ chartIndex: overlay.chartIndex, luckIndex });
    for (const link of links) expect(uncertain.possible_values.timing!.some(overlay => overlay.chartIndex === link.chartIndex && overlay.luckIndices!.includes(link.luckIndex))).toBe(true);
  });
  it('does not flatten uncertain start dates or uncertain current periods', () => {
    expect(uncertain.timing!.activeDaewoonStatus).toBe('UNCERTAIN'); expect(uncertain.timing!.luck!.currentPeriod).toBeNull();
    expect(uncertain.uncertaintyFlags).toContain('DAEWOON_START_UNCERTAIN');
    expect(uncertain.uncertaintyFlags).toContain('CURRENT_DAEWOON_UNCERTAIN');
    expect(uncertain.timing!.luck!.periods.some(period => period.startDate === null && period.startDateRange.earliest !== period.startDateRange.latest)).toBe(true);
    for (const field of ['sewoon', 'monthlyFortune'] as const) for (const interaction of uncertain[field]!.interactions) {
      expect(uncertain.possible_values.timing!.every(candidate => candidate[field].interactions.some(other => JSON.stringify(other) === JSON.stringify(interaction)))).toBe(true);
      expect(interaction.transformedElement).toBeNull();
    }
  });
  it('can confirm no active period before every possible start while retaining uncertain future dates', () => {
    const beforeAll = calculateFullSajuWithTiming(uncertainBirth, new Date('2026-09-20T00:00:00Z'));
    expect(beforeAll.timing!.activeDaewoonStatus).toBe('NO_ACTIVE_PERIOD');
    expect(beforeAll.uncertaintyFlags).toContain('DAEWOON_START_UNCERTAIN');
    expect(beforeAll.timing!.luck!.periods[0]!.startDate).toBeNull();
    expect(beforeAll.possible_values.luckTiming!.every(candidate => candidate.status === 'NO_ACTIVE_PERIOD')).toBe(true);
  });
  it('keeps DST-fold duration alternatives even when natal pillars happen to agree', () => {
    const fold = calculateFullSajuWithTiming({ ...birth, birthDate: '1988-10-09', birthTime: '02:30', trueSolarTime: true }, asOf);
    expect(fold.uncertaintyFlags).toContain('DST_AMBIGUOUS_TIME');
    expect(fold.possible_values.chartLuck!.length).toBeGreaterThan(1);
    expect(fold.timing!.luck!.candidateCount).toBeGreaterThan(1);
    expect(fold.timing!.activeDaewoonStatus).toBe('UNCERTAIN');
    expect(fold.timing!.luck!.currentPeriod).toBeNull();
  });
  it('distinguishes before-first, missing gender and exhausted finite sequence', () => {
    const before = calculateFullSajuWithTiming(birth, new Date('1992-10-24T03:00:00Z'));
    expect(before.timing!.activeDaewoonStatus).toBe('NO_ACTIVE_PERIOD'); expect(before.timing!.luck!.currentPeriod).toBeNull();
    const missing = calculateFullSajuWithTiming({ ...birth, gender: undefined }, asOf);
    expect(missing.timing!.activeDaewoonStatus).toBe('UNRESOLVED'); expect(missing.timing!.luck!.periods).toEqual([]);
    expect(missing.uncertaintyFlags).toContain('DAEWOON_REQUIRES_GENDER');
    const old = calculateFullSajuWithTiming({ ...birth, birthDate: '1900-05-10' }, asOf);
    expect(old.timing!.activeDaewoonStatus).toBe('OUTSIDE_COMPUTED_RANGE'); expect(old.status).toBe('LIMITED');
    expect(old.uncertaintyFlags).toContain('CURRENT_DAEWOON_OUTSIDE_COMPUTED_RANGE');
  });
  it('preserves raw-input minimization and bounded detail/prompts, including person B', () => {
    const compatibility = calculateSajuCompatibility({ personA: known, personB: uncertain });
    expect(compatibility.personB.chartLuck).toEqual(uncertain.possible_values.chartLuck);
    expect(compatibility.personB.possibleLuckTiming).toEqual(uncertain.possible_values.luckTiming);
    expect(compatibility.summary.timing.limitations).toContain('CURRENT_DAEWOON_SIMULTANEOUS_ACTIVATION_NOT_CONFIRMED');
    const texts = [JSON.stringify(known), JSON.stringify(uncertain), JSON.stringify(compatibility), JSON.stringify(buildSajuInterpretationData(uncertain)), JSON.stringify(buildCompatibilityInterpretationData(compatibility))];
    for (const text of texts) for (const raw of ['PRIVATE_CITY_SENTINEL', '126.978', '37.5665', '05:30', '1992-10-24', '2024-02-04', 'birthDate', 'birthTime', 'solarBirthDate', 'Asia/Seoul']) expect(text).not.toContain(raw);
    for (const text of texts.slice(0, 3)) expect(new TextEncoder().encode(text).byteLength).toBeLessThan(4 * 1024 * 1024);
    for (const data of [buildSajuInterpretationData(uncertain), buildCompatibilityInterpretationData(compatibility)]) expect(() => buildPersonaMessages({ characterId: 'SANI', currentMessage: '현재 흐름을 조심스럽게 설명해줘', toolResult: data })).not.toThrow();
    console.info(JSON.stringify({ evidence: 'M9_LOCAL_INTEGRATION_ONLY', unknownSweepWallMs: Math.round(unknownWallMs), fullUnknownBytes: new TextEncoder().encode(texts[1]!).byteLength, compatibilityBytes: new TextEncoder().encode(texts[2]!).byteLength, sajuPromptDataChars: texts[3]!.length, compatibilityPromptDataChars: texts[4]!.length }));
  });
});
