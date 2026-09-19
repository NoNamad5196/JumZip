import { describe, expect, it } from 'vitest';
import { calculateFourPillars, getSolarTerm } from 'manseryeok';
import { calculateSajuFoundation, type SajuBirthInput } from '../../supabase/functions/_shared/domain/saju.ts';

const seoul = { name: 'Seoul', country: 'South Korea', latitude: 37.5665, longitude: 126.978, timezone: 'Asia/Seoul' };
const input = (overrides: Partial<SajuBirthInput> = {}): SajuBirthInput => ({ calendarType: 'SOLAR', leapMonth: false, birthDate: '1992-10-24', birthTime: '05:30', birthTimeUnknown: false, location: seoul, trueSolarTime: false, ...overrides });
const names = (result: ReturnType<typeof calculateSajuFoundation>) => Object.values(result.pillars).map(p => p ? `${p.heavenlyStem}${p.earthlyBranch}` : null);

describe('M7 pinned Saju foundation, never Full v1', () => {
  it('matches the published 1992 solar example while keeping M7 separate from adopted M8 judgments', () => {
    // Reference: manseryeok v2.0.0 README Usage. Correction explicitly OFF as in the example.
    const result = calculateSajuFoundation(input());
    expect(names(result)).toEqual(['임신', '경술', '계유', '을묘']);
    expect(result).toMatchObject({ status: 'FOUNDATION_ONLY', fullCalculationReady: false, engineVersion: 'manseryeok-2.0.0', ruleVersion: null });
    expect(result.pendingRules).toHaveLength(0);
    expect(result).not.toHaveProperty('strength'); expect(result).not.toHaveProperty('yongsin'); expect(result).not.toHaveProperty('shinsal');
  });
  it('matches the published corresponding lunar date', () => {
    // Reference: README lunar example 1992-09-29 = 1992-10-24.
    expect(names(calculateSajuFoundation(input({ calendarType: 'LUNAR', birthDate: '1992-09-29' })))).toEqual(['임신', '경술', '계유', '을묘']);
  });
  it('uses the canonical leap month conversion rather than treating it as the regular month', () => {
    // Reference: README lunarToSolar(2020,4,1,true) = 2020-05-23.
    const leap = calculateSajuFoundation(input({ calendarType: 'LUNAR', leapMonth: true, birthDate: '2020-04-01' }));
    const solar = calculateSajuFoundation(input({ birthDate: '2020-05-23' }));
    expect(leap.pillars).toEqual(solar.pillars);
    expect(leap.pillars).not.toEqual(calculateSajuFoundation(input({ calendarType: 'LUNAR', birthDate: '2020-04-01' })).pillars);
  });
  it('uses splitJasi day/hour stems at 23:30 as published', () => {
    // Reference: README dayBoundary example: 2024-03-10 23:30 = 계유일 갑자시.
    const result = calculateSajuFoundation(input({ birthDate: '2024-03-10', birthTime: '23:30' }));
    expect(names(result).slice(2)).toEqual(['계유', '갑자']);
    expect(result.uncertaintyFlags).toContain('JASI_CONVENTION_BOUNDARY');
    expect(names(calculateSajuFoundation(input({ birthDate: '2024-03-11', birthTime: '00:30' }))).slice(2)).toEqual(['갑술', '갑자']);
  });
  it('changes year at the published 2024 Ipchun instant', () => {
    // Reference: CHANGELOG v2.0.0: 2024-02-04 17:27 KST; 17:26 계묘, 17:28 갑진.
    expect(names(calculateSajuFoundation(input({ birthDate: '2024-02-04', birthTime: '17:26' })))[0]).toBe('계묘');
    expect(names(calculateSajuFoundation(input({ birthDate: '2024-02-04', birthTime: '17:28' })))[0]).toBe('갑진');
  });
  it('handles the month solar-term boundary at the absolute instant', () => {
    const instant = getSolarTerm(2024, 4).date.getTime();
    const at = (delta: number) => { const wall = new Date(instant + 9 * 3600_000 + delta); return input({ birthDate: wall.toISOString().slice(0, 10), birthTime: wall.toISOString().slice(11, 16) }); };
    const before = calculateSajuFoundation(at(-60_000)); const after = calculateSajuFoundation(at(60_000));
    expect(before.pillars.year).toEqual(after.pillars.year); expect(before.pillars.month).not.toEqual(after.pillars.month);
  });
  it('changes hour under true solar correction as in the published Seoul example', () => {
    // Reference: README: Seoul 1990-05-15 07:05 civil -> about 06:33 apparent, 卯 not 辰.
    const corrected = calculateSajuFoundation(input({ birthDate: '1990-05-15', birthTime: '07:05', trueSolarTime: true }));
    const civil = calculateSajuFoundation(input({ birthDate: '1990-05-15', birthTime: '07:05' }));
    expect(corrected.pillars.hour?.earthlyBranch).toBe('묘'); expect(civil.pillars.hour?.earthlyBranch).toBe('진');
    expect(corrected.pillars.year).toEqual(civil.pillars.year); expect(corrected.pillars.month).toEqual(civil.pillars.month);
  });
  it('does not double-apply historical Korea DST in the UTC/KST bridge', () => {
    const result = calculateSajuFoundation(input({ birthDate: '1988-07-01', birthTime: '12:00', trueSolarTime: true }));
    const native = calculateFourPillars({ year: 1988, month: 7, day: 1, hour: 12, minute: 0, dayBoundary: 'splitJasi', trueSolarTime: { longitude: seoul.longitude, applyHistoricalDst: true } });
    expect(result.pillars).toEqual({ year: native.year, month: native.month, day: native.day, hour: native.hour });
  });
  it('preserves both overseas DST-fold instants and rejects nonexistent civil time', () => {
    const location = { name: 'New York', latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York' };
    const result = calculateSajuFoundation(input({ birthDate: '2024-11-03', birthTime: '01:30', location, trueSolarTime: true }));
    expect(result.candidateCount).toBe(2); expect(result.uncertaintyFlags).toContain('DST_AMBIGUOUS_TIME');
    expect(() => calculateSajuFoundation(input({ birthDate: '2024-03-10', birthTime: '02:30', location }))).toThrow('SAJU_CONVENTION_UNSUPPORTED');
  });
  it('does not produce a fake hour or pick one representative time on an unknown-time solar term day', () => {
    const result = calculateSajuFoundation(input({ birthDate: '2024-02-04', birthTime: null, birthTimeUnknown: true, trueSolarTime: true }));
    expect(result.candidateCount).toBe(1440); expect(result.pillars.hour).toBeNull(); expect(result.tenGods.hour).toBeNull(); expect(result.hourStatus).toBe('UNKNOWN');
    expect(result.pillars.year).toBeNull(); expect(result.possible_values.year).toHaveLength(2); expect(result.possible_values.month).toHaveLength(2);
    expect(result.possible_values).not.toHaveProperty('hour'); expect(result.uncertaintyFlags).toContain('BIRTH_TIME_UNKNOWN');
    expect(result.possible_values.charts.length).toBeGreaterThan(1);
    expect(result.possible_values.charts.every(chart => !Object.hasOwn(chart, 'hour'))).toBe(true);
    expect(result.possible_values.day.length).toBeGreaterThan(1); // Solar correction can cross the local date boundary.
  });
  it('returns opposite luck directions for male/female in the same yang-stem year', () => {
    const male = calculateSajuFoundation(input({ birthDate: '1990-05-15', birthTime: '14:30', gender: 'MALE' }));
    const female = calculateSajuFoundation(input({ birthDate: '1990-05-15', birthTime: '14:30', gender: 'FEMALE' }));
    expect(male.daewoon?.forward).toBe(true); expect(female.daewoon?.forward).toBe(false);
    expect(male.gongmang).toEqual(['신', '유']);
  });
  it('validates input instead of guessing times, coordinates, calendar values or unsupported years', () => {
    expect(() => calculateSajuFoundation(input({ birthTimeUnknown: true, birthTime: '12:00' }))).toThrow('SAJU_INPUT_INCOMPLETE');
    expect(() => calculateSajuFoundation(input({ birthDate: '2024-02-31' }))).toThrow('SAJU_INPUT_INCOMPLETE');
    expect(() => calculateSajuFoundation(input({ birthDate: '1799-12-31' }))).toThrow('SAJU_CONVENTION_UNSUPPORTED');
    expect(() => calculateSajuFoundation(input({ location: { ...seoul, timezone: 'invalid/timezone' } }))).toThrow('SAJU_LOCATION_UNRESOLVED');
  });
});
