import { describe, expect, it } from 'vitest';
import { calculateFortuneTiming, calculateOverlayInteractions, withFortuneTiming, type LayerPillar } from '../../supabase/functions/_shared/domain/fortune-timing.ts';
import { calculateFullSaju } from '../../supabase/functions/_shared/domain/full-saju.ts';
import type { NatalChart } from '../../supabase/functions/_shared/domain/rules/types.ts';

const natal: NatalChart = { year: { heavenlyStem: '甲', earthlyBranch: '寅' }, month: { heavenlyStem: '丙', earthlyBranch: '午' }, day: { heavenlyStem: '庚', earthlyBranch: '辰' }, hour: null };
describe('source-tagged fortune timing overlays', () => {
  it('preserves duplicate-symbol activations from separate sources and keeps natal input unchanged', () => {
    const layers: LayerPillar[] = [
      { source: 'NATAL', position: 'year', pillar: { heavenlyStem: '甲', earthlyBranch: '子' } },
      { source: 'DAEWOON', position: 'current', pillar: { heavenlyStem: '丙', earthlyBranch: '子' } },
      { source: 'SEWOON', position: '2026', pillar: { heavenlyStem: '己', earthlyBranch: '午' } },
    ];
    const before = JSON.stringify(layers); const relations = calculateOverlayInteractions(layers, 'SEWOON');
    const clashes = relations.filter(relation => relation.type === 'CLASH');
    expect(clashes).toHaveLength(2);
    expect(clashes.map(relation => relation.activatedBy)).toEqual([['NATAL', 'SEWOON'], ['DAEWOON', 'SEWOON']]);
    expect(relations.find(relation => relation.type === 'STEM_COMBINATION')?.transformedElement).toBeNull();
    expect(JSON.stringify(layers)).toBe(before);
  });
  it('requires all three branches and preserves the layer that completes a trine', () => {
    const base: LayerPillar[] = [{ source: 'NATAL', position: 'year', pillar: natal.year }, { source: 'NATAL', position: 'month', pillar: natal.month }];
    expect(calculateOverlayInteractions(base, 'SEWOON')).toEqual([]);
    const full = calculateOverlayInteractions([...base, { source: 'SEWOON', position: '2026', pillar: { heavenlyStem: '壬', earthlyBranch: '戌' } }], 'SEWOON');
    expect(full.filter(relation => relation.type === 'TRINE')).toMatchObject([{ activatedBy: ['NATAL', 'SEWOON'], participants: [{ position: 'year' }, { position: 'month' }, { position: '2026' }] }]);
  });
  it('keeps different relationship types for the same participants and does not emit natal-only relations', () => {
    const relations = calculateOverlayInteractions([{ source: 'NATAL', position: 'year', pillar: { heavenlyStem: '甲', earthlyBranch: '寅' } },
      { source: 'MONTHLY', position: '2026-10', pillar: { heavenlyStem: '丙', earthlyBranch: '亥' } }], 'MONTHLY');
    expect(relations.map(relation => relation.type)).toEqual(['SIX_COMBINATION', 'BREAK']);
    expect(calculateOverlayInteractions([{ source: 'NATAL', position: 'year', pillar: natal.year }, { source: 'NATAL', position: 'month', pillar: { heavenlyStem: '己', earthlyBranch: '亥' } }], 'SEWOON')).toEqual([]);
  });
  it('uses frozen published Ipchun brackets rather than January 1 for the annual/monthly change', () => {
    const before = calculateFortuneTiming({ natal, asOf: new Date('2024-02-04T08:26:00Z'), activeDaewoon: null });
    const after = calculateFortuneTiming({ natal, asOf: new Date('2024-02-04T08:28:00Z'), activeDaewoon: null });
    expect(before.sewoon).toMatchObject({ year: 2023, pillar: { heavenlyStem: '癸', earthlyBranch: '卯' } });
    expect(after.sewoon).toMatchObject({ year: 2024, pillar: { heavenlyStem: '甲', earthlyBranch: '辰' } });
    expect(before.monthlyFortune).toMatchObject({ month: 12, pillar: { heavenlyStem: '乙', earthlyBranch: '丑' } });
    expect(after.monthlyFortune).toMatchObject({ month: 1, pillar: { heavenlyStem: '丙', earthlyBranch: '寅' } });
  });
  it('does not invent an active daewoon and never manufactures an unknown natal hour', () => {
    const timing = calculateFortuneTiming({ natal, asOf: new Date('2026-09-20T00:00:35Z') });
    expect(timing.asOf).toBe('2026-09-20T00:00:00.000Z'); expect(timing.limitations).toContain('CURRENT_DAEWOON_NOT_RESOLVED');
    expect([...timing.sewoon.interactions, ...timing.monthlyFortune.interactions].flatMap(relation => relation.participants).some(participant => participant.source === 'DAEWOON' || participant.source === 'NATAL' && participant.position === 'hour')).toBe(false);
  });
  it('adds correlated timing snapshots without changing natal judgments or the original result', () => {
    const full = calculateFullSaju({ calendarType: 'SOLAR', leapMonth: false, birthDate: '1992-10-24', birthTime: '05:30', birthTimeUnknown: false,
      location: { name: '서울', latitude: 37.5665, longitude: 126.978, timezone: 'Asia/Seoul' }, gender: 'MALE' });
    const before = JSON.stringify(full); const withTiming = withFortuneTiming(full, new Date('2026-09-20T00:00:00Z'));
    expect(JSON.stringify(full)).toBe(before); expect(withTiming.strength).toEqual(full.strength); expect(withTiming.yongsin).toEqual(full.yongsin);
    expect(withTiming.possible_values.timing).toHaveLength(full.possible_values.charts.length);
    expect(withTiming.timing).toMatchObject({ periodBasis: 'SOLAR_TERM', activeDaewoonStatus: 'UNRESOLVED' });
    expect(withTiming.status).toBe('LIMITED'); expect(withTiming.sewoon).not.toBeNull(); expect(withTiming.monthlyFortune).not.toBeNull();
  });
});
