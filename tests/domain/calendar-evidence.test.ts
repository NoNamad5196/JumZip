import { describe, expect, it } from 'vitest';
import { getSolarTerm, lunarToSolar, solarToLunar } from 'manseryeok';
import { calculateSajuFoundation, type SajuBirthInput } from '../../supabase/functions/_shared/domain/saju.ts';
import { KASI_CALENDAR_CASES, KASI_SOLAR_TERMS, KASI_SEOUL, KASI_FEBRUARY_DAYS, KASI_SOLAR_TRANSIT, IANA_CASES } from './calendar-evidence-fixtures.ts';

const input = (overrides: Partial<SajuBirthInput> = {}): SajuBirthInput => ({
  calendarType: 'SOLAR', leapMonth: false, birthDate: '2024-02-10', birthTime: '12:00',
  birthTimeUnknown: false, location: KASI_SEOUL, trueSolarTime: false, ...overrides,
});
const dayName = (result: ReturnType<typeof calculateSajuFoundation>) => result.pillars.day ? result.pillars.day.heavenlyStem + result.pillars.day.earthlyBranch : null;
const pillarName = (pillar: ReturnType<typeof calculateSajuFoundation>['pillars']['year']) => pillar ? pillar.heavenlyStem + pillar.earthlyBranch : null;

describe('official KASI facts frozen independently of the pinned implementation', () => {
  it.each(KASI_CALENDAR_CASES)('KASI p.$page $lunar leap=$leap → $solar, 日辰 $hanja', fixture => {
    const [year, month, day] = fixture.lunar.split('-').map(Number) as [number, number, number];
    const [solarYear, solarMonth, solarDay] = fixture.solar.split('-').map(Number) as [number, number, number];
    expect(lunarToSolar(year, month, day, fixture.leap)).toEqual({ year: solarYear, month: solarMonth, day: solarDay });
    expect(solarToLunar(solarYear, solarMonth, solarDay)).toMatchObject({ year, month, day, isLeapMonth: fixture.leap });
    // Noon / civil-time day isolates published 日辰 from chosen hour-boundary rules.
    expect(dayName(calculateSajuFoundation(input({ birthDate: fixture.solar })))).toBe(fixture.day);
    expect(dayName(calculateSajuFoundation(input({ calendarType: 'LUNAR', birthDate: fixture.lunar, leapMonth: fixture.leap })))).toBe(fixture.day);
  });

  it.each(KASI_SOLAR_TERMS)('KASI p.8 $name agrees within the published minute precision', fixture => {
    expect(Math.abs(getSolarTerm(2024, fixture.index).date.getTime() - Date.parse(fixture.kst))).toBeLessThanOrEqual(fixture.toleranceMs);
  });

  it('derives 1992-09-29 lunar by 28 civil days from the independently printed month start', () => {
    // 1992-09-26 + 28 days = 1992-10-24; 乙巳 + 28 places in the 60-day cycle = 癸酉.
    // These are manual calendar/cycle arithmetic, not an independently printed full 四柱.
    expect(lunarToSolar(1992, 9, 29, false)).toEqual({ year: 1992, month: 10, day: 24 });
    expect(dayName(calculateSajuFoundation(input({ calendarType: 'LUNAR', birthDate: '1992-09-29' })))).toBe('계유');
  });

  it('applies the adopted Ipchun year convention on opposite sides of KASI time', () => {
    expect(pillarName(calculateSajuFoundation(input({ birthDate: '2024-02-04', birthTime: '17:26' })).pillars.year)).toBe('계묘');
    expect(pillarName(calculateSajuFoundation(input({ birthDate: '2024-02-04', birthTime: '17:28' })).pillars.year)).toBe('갑진');
  });

  it('applies the adopted solar-month convention on opposite sides of KASI Gyeongchip', () => {
    expect(pillarName(calculateSajuFoundation(input({ birthDate: '2024-03-05', birthTime: '11:22' })).pillars.month)).toBe('병인');
    expect(pillarName(calculateSajuFoundation(input({ birthDate: '2024-03-05', birthTime: '11:24' })).pillars.month)).toBe('정묘');
  });

  it('separates KASI daily values from the adopted split-Jasi hour-stem rule', () => {
    const late = calculateSajuFoundation(input({ birthDate: '2024-02-10', birthTime: '23:30' }));
    const early = calculateSajuFoundation(input({ birthDate: '2024-02-11', birthTime: '00:30' }));
    expect(dayName(late)).toBe(KASI_FEBRUARY_DAYS['2024-02-10']);
    expect(dayName(early)).toBe(KASI_FEBRUARY_DAYS['2024-02-11']);
    // Both hours use 乙 day's 子 stem under JumZip split-Jasi: 丙子. KASI does not print this rule.
    expect(pillarName(late.pillars.hour)).toBe('병자');
    expect(pillarName(early.pillars.hour)).toBe('병자');
    expect(late.uncertaintyFlags).toContain('JASI_CONVENTION_BOUNDARY');
  });

  it('retains the official daily value without inventing an unknown hour', () => {
    const civil = calculateSajuFoundation(input({ birthTime: null, birthTimeUnknown: true }));
    expect(dayName(civil)).toBe(KASI_FEBRUARY_DAYS['2024-02-10']);
    expect(civil.candidateCount).toBe(1440); expect(civil.pillars.hour).toBeNull();
    expect(civil.possible_values).not.toHaveProperty('hour');
    const apparent = calculateSajuFoundation(input({ birthTime: null, birthTimeUnknown: true, trueSolarTime: true }));
    expect(apparent.pillars.day).toBeNull();
    expect(apparent.possible_values.day.map(pillarName).sort()).toEqual([KASI_FEBRUARY_DAYS['2024-02-09'], KASI_FEBRUARY_DAYS['2024-02-10']].sort());
    expect(apparent.pillars.hour).toBeNull();
  });

  it('uses KASI solar transit as an independent, far-from-boundary apparent-hour check', () => {
    // p.14: local apparent noon at civil 12:46:16, hence 07:05 ≈ 06:18:44 apparent.
    // EoT changes slightly within the day; the >40 minute margin makes this a branch check,
    // not an assertion of second-level EoT agreement or an independently verified hour stem.
    const fixture = KASI_SOLAR_TRANSIT;
    const civil = calculateSajuFoundation(input({ birthDate: fixture.date, birthTime: fixture.derivedCivilTime }));
    const apparent = calculateSajuFoundation(input({ birthDate: fixture.date, birthTime: fixture.derivedCivilTime, trueSolarTime: true }));
    expect(civil.pillars.hour?.earthlyBranch).toBe(fixture.civilHourBranch);
    expect(apparent.pillars.hour?.earthlyBranch).toBe(fixture.derivedApparentHourBranch);
  });
});

describe('published IANA rules: adapter interpretation, not independent astronomy', () => {
  it.each(IANA_CASES)('$timezone preserves folds and rejects gaps from fixed source rules', fixture => {
    const location = { name: fixture.timezone, timezone: fixture.timezone, latitude: fixture.latitude, longitude: fixture.longitude };
    const fold = calculateSajuFoundation(input({ location, birthDate: fixture.foldDate, birthTime: fixture.foldTime }));
    expect(fold.candidateCount).toBe(2); expect(fold.uncertaintyFlags).toContain('DST_AMBIGUOUS_TIME');
    expect(() => calculateSajuFoundation(input({ location, birthDate: fixture.gapDate, birthTime: fixture.gapTime }))).toThrow('SAJU_CONVENTION_UNSUPPORTED');
  });
});
