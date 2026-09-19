import { describe, expect, it } from 'vitest';
import { TAROT_MEANINGS, TAROT_SPREADS, buildTarotInterpretationData } from '../../supabase/functions/_shared/domain/tarot.ts';
import { getComputedPillarCoverage, buildSajuInterpretationData } from '../../supabase/functions/_shared/domain/full-saju.ts';
import { calculateSajuCompatibility, buildCompatibilityInterpretationData } from '../../supabase/functions/_shared/domain/saju-compatibility.ts';
import type { NatalChart } from '../../supabase/functions/_shared/domain/rules/types.ts';
import { buildPersonaToolFacts } from '../../supabase/functions/_shared/persona/tool-facts.ts';
import { buildPersonaMessages } from '../../supabase/functions/_shared/persona/prompt.ts';
import { SUPPLEMENTAL_FIXTURES } from './saju-benchmark-corpus.ts';

const allConfirmed = { year: 'CONFIRMED', month: 'CONFIRMED', day: 'CONFIRMED', hour: 'CONFIRMED' };
describe('v6 removes competing common advice without changing the canonical Tarot dataset', () => {
  it('exposes only selected-direction meanings for all22 cards, both directions, every spread position', () => {
    const canonicalBefore = JSON.stringify(TAROT_MEANINGS);
    for (const meaning of TAROT_MEANINGS) for (const orientation of ['UPRIGHT', 'REVERSED'] as const) for (const positions of Object.values(TAROT_SPREADS)) {
      const cards = positions.map((position, positionIndex) => ({ cardId: meaning.id, orientation, positionIndex, positionKey: position.key }));
      const input = { kind: 'TAROT', cards: buildTarotInterpretationData(cards) }, before = JSON.stringify(input);
      const view = buildPersonaToolFacts(input) as { cards: Record<string, unknown>[]; requiredToolReferences: unknown[] };
      for (const [index, card] of view.cards.entries()) {
        expect(card).toMatchObject({ ...cards[index], activeMeaning: meaning[orientation === 'UPRIGHT' ? 'upright' : 'reversed'], positionLabel: positions[index]!.label });
        expect(card).not.toHaveProperty('contextAdvice'); expect(card).not.toHaveProperty('sharedGuidance'); expect(card).not.toHaveProperty('guidance');
      }
      expect(JSON.stringify(view)).not.toContain(meaning.guidance.advice);
      expect(view.requiredToolReferences).toEqual(cards.map(({ cardId, orientation, positionIndex }) => ({ cardId, orientation, positionIndex })));
      expect(JSON.stringify(input)).toBe(before);
    }
    expect(JSON.stringify(TAROT_MEANINGS)).toBe(canonicalBefore);
    // The provider omission does not delete or rewrite the underlying approved dataset.
    expect(TAROT_MEANINGS[9]!.guidance.advice).toBe('혼자 있는 것과 도망치는 것을 구분한다.');
    expect(TAROT_MEANINGS[15]!.guidance.advice).toBe('내가 스스로 묶여 있는 지점을 확인한다.');
  });
  it('omits the common advice on the complete provider-message path', () => {
    const cards = buildTarotInterpretationData([{ cardId: 9, orientation: 'REVERSED', positionIndex: 0, positionKey: 'CORE_MESSAGE' }]);
    const serialized = JSON.stringify(buildPersonaMessages({ characterId: 'BOMI', currentMessage: '이 카드의 의미를 설명해 줘.', toolResult: { kind: 'TAROT', cards } }));
    expect(serialized).toContain('과도한 폐쇄'); expect(serialized).toContain('REVERSED');
    expect(serialized).not.toContain('contextAdvice'); expect(serialized).not.toContain(TAROT_MEANINGS[9]!.guidance.advice);
  });
});

describe('v6 positive calculated-pillar coverage is independent of input provenance', () => {
  it('distinguishes known calculated hours from unavailable hours despite component provenance absence', () => {
    const known = buildSajuInterpretationData(SUPPLEMENTAL_FIXTURES.known), unknown = buildSajuInterpretationData(SUPPLEMENTAL_FIXTURES.unknown);
    expect(known.inputAvailability).toEqual({ calendarDate: 'NOT_RECORDED', clockTime: 'NOT_RECORDED' });
    expect(known.computedPillarCoverage).toEqual(allConfirmed);
    expect(unknown.inputAvailability.clockTime).toBe('UNKNOWN');
    expect(unknown.computedPillarCoverage).toEqual({ ...allConfirmed, hour: 'UNAVAILABLE' });
  });
  it('requires agreement across actual correlated chart candidates and never fills a missing hour', () => {
    // Pure projection fixtures, not an astronomical or Strength golden assertion.
    const left: NatalChart = { year: { heavenlyStem: '甲', earthlyBranch: '子' }, month: { heavenlyStem: '丙', earthlyBranch: '寅' }, day: { heavenlyStem: '戊', earthlyBranch: '辰' }, hour: null };
    const right: NatalChart = { ...left, month: { heavenlyStem: '丁', earthlyBranch: '卯' } };
    const candidates = [{ pillars: left }, { pillars: right }], before = JSON.stringify(candidates);
    expect(getComputedPillarCoverage(candidates)).toEqual({ year: 'CONFIRMED', month: 'POSSIBLE', day: 'CONFIRMED', hour: 'UNAVAILABLE' });
    expect(getComputedPillarCoverage([{ pillars: left }, { pillars: { ...right, hour: { heavenlyStem: '庚', earthlyBranch: '午' } } }]).hour).toBe('POSSIBLE');
    expect(JSON.stringify(candidates)).toBe(before);
  });
  it('retains boundary alternatives rather than calling all pillars missing when time is unknown', () => {
    const view = buildSajuInterpretationData(SUPPLEMENTAL_FIXTURES.boundary);
    expect(view.inputAvailability).toEqual({ calendarDate: 'PROVIDED', clockTime: 'UNKNOWN' });
    expect(view.computedPillarCoverage.year).toBe('POSSIBLE'); expect(view.computedPillarCoverage.month).toBe('POSSIBLE');
    expect(view.computedPillarCoverage.hour).toBe('UNAVAILABLE');
    expect([...view.possible_values.score].sort((a, b) => a - b)).toEqual([32, 37, 58]);
  });
  it('keeps A/B ownership through swaps, including an old saved snapshot without input metadata', () => {
    const a = SUPPLEMENTAL_FIXTURES.unknown, b = SUPPLEMENTAL_FIXTURES.known;
    const sourceBefore = JSON.stringify([a, b]);
    const result = calculateSajuCompatibility({ personA: a, personB: b });
    delete result.personA.inputAvailability; delete result.personB.inputAvailability;
    delete result.personA.calculationUncertainty; delete result.personB.calculationUncertainty;
    const view = buildCompatibilityInterpretationData(result);
    expect(view.computedPillarCoverage).toEqual({ personA: { ...allConfirmed, hour: 'UNAVAILABLE' }, personB: allConfirmed });
    expect(view.personBInputContext.inputAvailability.clockTime).toBe('NOT_RECORDED');
    const swapped = buildCompatibilityInterpretationData(calculateSajuCompatibility({ personA: b, personB: a }));
    expect(swapped.computedPillarCoverage).toEqual({ personA: view.computedPillarCoverage.personB, personB: view.computedPillarCoverage.personA });
    expect(JSON.stringify([a, b])).toBe(sourceBefore);
    expect(Object.values(view.computedPillarCoverage.personB)).toEqual(['CONFIRMED', 'CONFIRMED', 'CONFIRMED', 'CONFIRMED']);
  });
  it('sends compact positive facts without reintroducing raw dates/times/coordinates or extra chart combinations', () => {
    const b = { ...SUPPLEMENTAL_FIXTURES.known, birthProfile: { birthDate: 'PRIVATE-DATE', birthTime: 'PRIVATE-CLOCK', location: { longitude: 'PRIVATE-COORD' } } };
    const result = calculateSajuCompatibility({ personA: SUPPLEMENTAL_FIXTURES.unknown, personB: b });
    const view = buildCompatibilityInterpretationData(result), before = JSON.stringify(view);
    const messages = buildPersonaMessages({ characterId: 'SANI', currentMessage: 'A는 민수고 B는 나야. 누구의 시주가 미상이야?', toolResult: view });
    const serialized = JSON.stringify(messages);
    expect(serialized).toContain('computedPillarCoverage'); expect(serialized).toContain('CONFIRMED');
    expect(serialized).not.toContain('PRIVATE-'); expect(serialized).not.toContain('"charts":');
    expect(JSON.stringify(view)).toBe(before); expect(result.possible_values.pairs).toHaveLength(1);
    expect(JSON.stringify(view.computedPillarCoverage).length).toBeLessThan(200);
  });
});
