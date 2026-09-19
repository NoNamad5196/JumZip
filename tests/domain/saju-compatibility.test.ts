import { describe, expect, it } from 'vitest';
import { calculateFullSaju, type FullSajuResult } from '../../supabase/functions/_shared/domain/full-saju.ts';
import { calculateNatalRules } from '../../supabase/functions/_shared/domain/rules/natal.ts';
import { buildCompatibilityInterpretationData, calculateSajuCompatibility, compareNatalCharts } from '../../supabase/functions/_shared/domain/saju-compatibility.ts';
import { withFortuneTiming } from '../../supabase/functions/_shared/domain/fortune-timing.ts';
import { buildPersonaMessages } from '../../supabase/functions/_shared/persona/prompt.ts';
import type { HanjaBranch, HanjaStem, NatalChart } from '../../supabase/functions/_shared/domain/rules/types.ts';

const repeated = (stem: HanjaStem, branch: HanjaBranch): NatalChart => ({ year: { heavenlyStem: stem, earthlyBranch: branch }, month: { heavenlyStem: stem, earthlyBranch: branch }, day: { heavenlyStem: stem, earthlyBranch: branch }, hour: { heavenlyStem: stem, earthlyBranch: branch } });
const baseline = calculateFullSaju({ calendarType: 'SOLAR', leapMonth: false, birthDate: '1992-10-24', birthTime: '05:30', birthTimeUnknown: false, location: { name: 'Seoul', latitude: 37.5665, longitude: 126.978, timezone: 'Asia/Seoul' }, gender: 'MALE', trueSolarTime: false });
const synthetic = (...charts: NatalChart[]): FullSajuResult => ({ ...baseline, possible_values: { ...baseline.possible_values, charts: charts.map(calculateNatalRules) } });

describe('M10 structural Saju compatibility without invented probability', () => {
  it('computes both day-master perspectives and all cross-person matches with source identity', () => {
    // Manual table facts: 甲 sees 己 as 正財; 己 sees 甲 as 正官. 寅亥 has 六合 AND 破.
    // Four A positions x four B positions = sixteen distinct pairs for each matching type.
    const result = compareNatalCharts(calculateNatalRules(repeated('甲', '寅')), calculateNatalRules(repeated('己', '亥')));
    expect(result.dayMasterRelation).toEqual({ personA: '甲', personB: '己', aSeesB: '정재', bSeesA: '정관', elementRelation: 'A_CONTROLS_B' });
    expect(result.stemRelations).toHaveLength(16);
    expect(result.branchRelations.filter(r => r.type === 'SIX_COMBINATION')).toHaveLength(16);
    expect(result.branchRelations.filter(r => r.type === 'BREAK')).toHaveLength(16);
    expect(result.spousePalaceRelations.map(r => r.type)).toEqual(['SIX_COMBINATION', 'BREAK']);
    expect(result.stemRelations.every(r => r.transformedElement === null)).toBe(true);
    expect(result.branchRelations.every(r => new Set(r.participants.map(p => p.person)).size === 2)).toBe(true);
    expect(result.mutualTenGods.filter(g => g.observer === 'A').every(g => g.tenGod === '정재')).toBe(true);
    expect(result.mutualTenGods.filter(g => g.observer === 'B').every(g => g.tenGod === '정관')).toBe(true);
  });
  it('retains full cross-person triads, not incomplete pairs or within-person-only relations', () => {
    const a = calculateNatalRules({ ...repeated('甲', '寅'), month: { heavenlyStem: '丙', earthlyBranch: '午' }, hour: null });
    const b = calculateNatalRules({ ...repeated('戊', '戌'), hour: null });
    const result = compareNatalCharts(a, b);
    expect(result.branchRelations.some(r => r.type === 'TRINE' && r.participants.map(p => p.value).sort().join('') === ['寅', '午', '戌'].sort().join(''))).toBe(true);
    expect(result.branchRelations.every(r => !r.participants.some(p => p.position === 'hour'))).toBe(true);
    expect(result.mutualTenGods).toHaveLength(6);
  });
  it('keeps correlated possibilities and marks only shared evidence confirmed', () => {
    const a = repeated('甲', '寅'), changed = { ...a, day: { heavenlyStem: '乙' as const, earthlyBranch: '寅' as const } };
    const result = calculateSajuCompatibility({ personA: synthetic(a, changed), personB: synthetic(repeated('己', '亥')) });
    expect(result.possible_values.pairs).toHaveLength(2);
    expect(result.summary.dayMasterRelation).toBeNull();
    expect(result.summary.stemRelations.filter(r => r.participants.some(p => p.person === 'A' && p.position === 'day')).every(r => r.certainty === 'POSSIBLE')).toBe(true);
    expect(result.summary.branchRelations.every(r => r.certainty === 'CONFIRMED')).toBe(true);
    expect(result.uncertaintyFlags).toContain('COMPATIBILITY_BOUNDARY_VARIANTS');
  });
  it('projects only derived snapshots, does not mutate either person and never creates a compatibility score', () => {
    const personB = { ...synthetic(repeated('己', '亥')), birthDate: 'PRIVATE-DOB', input: { birthTime: 'PRIVATE-TIME', location: { name: 'PRIVATE-CITY', latitude: 1.23456789 } } };
    const personA = synthetic(repeated('甲', '寅')), before = JSON.stringify([personA, personB]);
    const result = calculateSajuCompatibility({ personA, personB }), serialized = JSON.stringify(result);
    expect(serialized).not.toContain('PRIVATE-'); expect(serialized).not.toContain('1.23456789');
    expect(result.summary).not.toHaveProperty('score'); expect(result.summary).not.toHaveProperty('percentage'); expect(result).not.toHaveProperty('probability');
    expect(JSON.stringify([personA, personB])).toBe(before);
    expect(result.personB.charts[0]!.pillars).toEqual(personB.possible_values.charts[0]!.pillars);
  });
  it('includes concurrent yearly/monthly evidence and distinguishes unresolved active-luck selection', () => {
    const timed = withFortuneTiming(baseline, new Date('2024-04-10T03:00:00Z'));
    const result = calculateSajuCompatibility({ personA: timed, personB: timed });
    expect(result.summary.timing.simultaneousActivations.length).toBeGreaterThan(0);
    expect(result.summary.timing.simultaneousActivations.every(a => a.personA.length && a.personB.length)).toBe(true);
    expect(result.summary.timing.limitations).toContain('CURRENT_DAEWOON_SIMULTANEOUS_ACTIVATION_NOT_CONFIRMED');
    const noActive = withFortuneTiming(baseline, new Date('2024-04-10T03:00:00Z'), null);
    expect(calculateSajuCompatibility({ personA: noActive, personB: noActive }).summary.timing.limitations).not.toContain('CURRENT_DAEWOON_SIMULTANEOUS_ACTIVATION_NOT_CONFIRMED');
  });
  it('keeps dense structural evidence within Persona context and preserves explicit total counts', () => {
    const result = calculateSajuCompatibility({ personA: synthetic(repeated('甲', '寅')), personB: synthetic(repeated('己', '亥')) });
    const view = buildCompatibilityInterpretationData(result);
    expect(view.stemRelationCount).toBe(16); expect(view.stemRelations).toHaveLength(12); expect(view.branchRelationCount).toBe(32);
    expect(() => buildPersonaMessages({ characterId: 'ARANG', currentMessage: '우리의 관계를 어떻게 볼까?', toolResult: view })).not.toThrow();
    expect(JSON.stringify(view).length).toBeLessThan(22_000);
  });
  it('rejects incompatible saved rule versions', () => {
    const incompatible = { ...baseline, ruleVersion: 'different-version' } as unknown as FullSajuResult;
    expect(() => calculateSajuCompatibility({ personA: baseline, personB: incompatible })).toThrow('COMPATIBILITY_VERSION_MISMATCH');
  });
});
