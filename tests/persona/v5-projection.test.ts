import { describe, expect, it } from 'vitest';
import { buildSajuInputContext, buildSajuInterpretationData, calculateFullSaju, type FullSajuResult } from '../../supabase/functions/_shared/domain/full-saju.ts';
import { buildCompatibilityInterpretationData, calculateSajuCompatibility } from '../../supabase/functions/_shared/domain/saju-compatibility.ts';
import { buildTarotInterpretationData, TAROT_MEANINGS, TAROT_SPREADS } from '../../supabase/functions/_shared/domain/tarot.ts';
import { buildPersonaToolFacts } from '../../supabase/functions/_shared/persona/tool-facts.ts';
import { buildPersonaMessages, sanitizePersonaToolResult } from '../../supabase/functions/_shared/persona/prompt.ts';
import { SUPPLEMENTAL_FIXTURES } from './saju-benchmark-corpus.ts';

const known = calculateFullSaju({ calendarType: 'SOLAR', leapMonth: false, birthDate: '1990-05-10', birthTime: '12:30', birthTimeUnknown: false,
  location: { name: 'Seoul', latitude: 37.5665, longitude: 126.978, timezone: 'Asia/Seoul' } });
const boundary = SUPPLEMENTAL_FIXTURES.boundary;
describe('v5 presence metadata is distinct from computed uncertainty', () => {
  it('preserves a validated date despite unknown clock and correlated Ipchun alternatives', () => {
    const before = JSON.stringify(boundary), view = buildSajuInterpretationData(boundary);
    expect(view.inputAvailability).toEqual({ calendarDate: 'PROVIDED', clockTime: 'UNKNOWN' });
    expect(view.calculationUncertainty.causes).toEqual(expect.arrayContaining(['UNKNOWN_CLOCK_TIME', 'BOUNDARY_VARIANTS', 'CURRENT_PERIOD_UNRESOLVED']));
    expect(view.strength.score).toBeNull();
    expect([...view.possible_values.score].sort((a, b) => a - b)).toEqual([32, 37, 58]);
    expect(view.pillars.hour).toBeNull(); expect(view.calculationUncertainty.unresolvedPillars).toContain('hour');
    expect(JSON.stringify(boundary)).toBe(before);
    const context = JSON.stringify(buildPersonaMessages({ characterId: 'ARANG', currentMessage: '어떤 점수가 확실해?', toolResult: view }));
    expect(context).toContain('PROVIDED'); expect(context).toContain('UNKNOWN_CLOCK_TIME');
    expect(context).not.toContain('2024-02-04');
  });
  it('does not mislabel missing luck-direction input as an unknown clock', () => {
    const view = buildSajuInterpretationData(known);
    expect(view.inputAvailability).toEqual({ calendarDate: 'PROVIDED', clockTime: 'PROVIDED' });
    expect(view.calculationUncertainty.causes).toContain('LUCK_DIRECTION_INPUT_MISSING');
    expect(view.calculationUncertainty.causes).not.toContain('UNKNOWN_CLOCK_TIME');
    const serialized = JSON.stringify(view);
    for (const value of ['1990-05-10', '12:30', '37.5665', '126.978', 'Asia/Seoul']) expect(serialized).not.toContain(value);
    for (const key of ['birthDate', 'birthTime', 'location', 'gender']) expect(serialized).not.toContain(`"${key}":`);
  });
  it('allows known clock with DST ambiguity; presence does not claim a unique instant', () => {
    // Synthetic projection-only state; astronomical DST expectations are tested elsewhere.
    const state: FullSajuResult = { ...known, uncertaintyFlags: ['DST_AMBIGUOUS_TIME'], possible_values: { ...known.possible_values, charts: [known.possible_values.charts[0]!, boundary.possible_values.charts[0]!] } };
    const view = buildSajuInputContext(state);
    expect(view.inputAvailability.clockTime).toBe('PROVIDED');
    expect(view.calculationUncertainty.causes).toEqual(expect.arrayContaining(['DST_AMBIGUITY', 'BOUNDARY_VARIANTS']));
    expect(view.calculationUncertainty.causes).not.toContain('UNKNOWN_CLOCK_TIME');
  });
  it('does not turn absent legacy provenance into missing user input or assume known time from pillars', () => {
    const legacy = structuredClone(known); delete legacy.inputAvailability;
    expect(buildSajuInputContext(legacy).inputAvailability).toEqual({ calendarDate: 'NOT_RECORDED', clockTime: 'NOT_RECORDED' });
    const legacyBoundary = structuredClone(boundary); delete legacyBoundary.inputAvailability;
    expect(buildSajuInputContext(legacyBoundary).inputAvailability).toEqual({ calendarDate: 'NOT_RECORDED', clockTime: 'UNKNOWN' });
    const component = buildSajuInputContext(SUPPLEMENTAL_FIXTURES.unknown);
    expect(component.inputAvailability).toEqual({ calendarDate: 'NOT_RECORDED', clockTime: 'UNKNOWN' });
  });
  it('keeps A/B presence separate, copies only derived states and leaves natal calculations unchanged', () => {
    const personB = { ...boundary, birthProfile: { birthDate: 'PRIVATE-DATE', longitude: 'PRIVATE-COORDINATE' } };
    const before = JSON.stringify([known, personB]);
    const result = calculateSajuCompatibility({ personA: known, personB });
    const view = buildCompatibilityInterpretationData(result);
    expect(view.personAInputContext.inputAvailability).toEqual({ calendarDate: 'PROVIDED', clockTime: 'PROVIDED' });
    expect(view.personBInputContext.inputAvailability).toEqual({ calendarDate: 'PROVIDED', clockTime: 'UNKNOWN' });
    const swapped = buildCompatibilityInterpretationData(calculateSajuCompatibility({ personA: personB, personB: known }));
    expect(swapped.personAInputContext).toEqual(view.personBInputContext); expect(swapped.personBInputContext).toEqual(view.personAInputContext);
    expect(JSON.stringify(result)).not.toContain('PRIVATE-'); expect(JSON.stringify([known, personB])).toBe(before);
    expect(result.personA.charts).toEqual(known.possible_values.charts); expect(result.personB.charts).toEqual(boundary.possible_values.charts);
  });
  it('handles old compatibility snapshots without inventing provenance', () => {
    const old = calculateSajuCompatibility({ personA: known, personB: boundary });
    delete old.personA.inputAvailability; delete old.personA.calculationUncertainty;
    delete old.personB.inputAvailability; delete old.personB.calculationUncertainty;
    const view = buildCompatibilityInterpretationData(old);
    expect(view.personAInputContext).toEqual({ inputAvailability: { calendarDate: 'NOT_RECORDED', clockTime: 'NOT_RECORDED' }, calculationUncertainty: null });
    expect(view.personBInputContext.inputAvailability).toEqual({ calendarDate: 'NOT_RECORDED', clockTime: 'UNKNOWN' });
  });
  it('also gives legacy compact payloads an explicit unrecorded fallback instead of inferring missing dates', () => {
    const legacy = { kind: 'SAJU', pillars: { year: null, month: null, day: null, hour: null }, uncertaintyFlags: ['BIRTH_TIME_UNKNOWN'] };
    const before = JSON.stringify(legacy);
    expect(buildPersonaToolFacts(legacy)).toMatchObject({ inputAvailability: { calendarDate: 'NOT_RECORDED', clockTime: 'UNKNOWN' }, calculationUncertainty: null });
    expect(JSON.stringify(legacy)).toBe(before);
    const oldCompatibility = { kind: 'SAJU_COMPATIBILITY', uncertaintyFlags: ['PERSON_A:BIRTH_TIME_UNKNOWN'] };
    expect(buildPersonaToolFacts(oldCompatibility)).toMatchObject({ personAInputContext: { inputAvailability: { calendarDate: 'NOT_RECORDED', clockTime: 'UNKNOWN' } }, personBInputContext: { inputAvailability: { calendarDate: 'NOT_RECORDED', clockTime: 'NOT_RECORDED' } } });
  });
  it('keeps presence through privacy scrubbing without carrying original date/time or extra provenance fields', () => {
    const malformed = { ...known, inputAvailability: { ...known.inputAvailability!, birthDate: 'PRIVATE-DATE', birthTime: 'PRIVATE-TIME' } };
    const view = buildSajuInterpretationData(malformed);
    expect(Object.keys(view.inputAvailability).sort()).toEqual(['calendarDate', 'clockTime']);
    expect(sanitizePersonaToolResult({ ...view, birthProfile: { birthDate: 'PRIVATE-DATE' } })).toMatchObject({ inputAvailability: { calendarDate: 'PROVIDED', clockTime: 'PROVIDED' } });
    expect(JSON.stringify(sanitizePersonaToolResult(view))).not.toContain('PRIVATE-');
  });
});

describe('v5 selected-direction symbolic frame is generic, not an opposite-meaning blacklist', () => {
  it('frames all22 selected meanings as unobserved possibilities at their actual positions', () => {
    for (const meaning of TAROT_MEANINGS) for (const orientation of ['UPRIGHT', 'REVERSED'] as const) for (const positions of Object.values(TAROT_SPREADS)) {
      const input = { kind: 'TAROT', cards: buildTarotInterpretationData(positions.map((position, positionIndex) => ({ cardId: meaning.id, orientation, positionIndex, positionKey: position.key }))) };
      const before = JSON.stringify(input);
      const view = buildPersonaToolFacts(input) as { cards: { activeMeaning: unknown; symbolicFrame: { evidenceKind: string; subjectRole: string; certainty: string } }[] };
      view.cards.forEach((card, index) => {
        expect(card.activeMeaning).toEqual(orientation === 'UPRIGHT' ? meaning.upright : meaning.reversed);
        expect(card.symbolicFrame).toMatchObject({ evidenceKind: 'SYMBOLIC_NOT_OBSERVED', certainty: 'POSSIBILITY' });
        const position = positions[index]!.key;
        expect(card.symbolicFrame.subjectRole).toBe(position === 'YOUR_ATTITUDE' ? 'USER' : position === 'THEIR_ATTITUDE' ? 'OTHER_PERSON' : position === 'RELATIONSHIP_DIRECTION' ? 'RELATIONSHIP' : 'QUESTION_CONTEXT');
      });
      expect(JSON.stringify(input)).toBe(before);
    }
  });
  it('preserves flipped owner and direction without treating advice as a proven mental cause', () => {
    const cards = buildTarotInterpretationData([{ cardId: 9, orientation: 'REVERSED', positionIndex: 0, positionKey: 'YOUR_ATTITUDE' }, { cardId: 6, orientation: 'UPRIGHT', positionIndex: 1, positionKey: 'THEIR_ATTITUDE' }, { cardId: 14, orientation: 'UPRIGHT', positionIndex: 2, positionKey: 'RELATIONSHIP_DIRECTION' }]);
    const view = buildPersonaToolFacts({ kind: 'TAROT', cards }) as { cards: { activeMeaning: string; symbolicFrame: { subjectRole: string } }[]; requiredToolReferences: unknown[] };
    expect(view.cards[0]!.activeMeaning).toContain('회피'); expect(view.cards[0]!.symbolicFrame.subjectRole).toBe('USER');
    expect(view.cards[1]!.symbolicFrame.subjectRole).toBe('OTHER_PERSON');
    expect(view.requiredToolReferences).toEqual(cards.map(({ cardId, orientation, positionIndex }) => ({ cardId, orientation, positionIndex })));
    const system = buildPersonaMessages({ characterId: 'SANI', currentMessage: '상대가 혼자 있고 싶은 게 확실해?', toolResult: { kind: 'TAROT', cards } })[0]!.content;
    expect(system).toContain('조언을 상대가 실제로 원하는 일이나 현재 행동의 확정 원인으로 바꾸지 않는다');
    expect(system).toContain('관찰 사실이 아닌 상징의 가능성');
  });
});
