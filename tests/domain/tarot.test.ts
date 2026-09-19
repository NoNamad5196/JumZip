import { describe, expect, it, vi } from 'vitest';
import { TAROT_MEANINGS, TAROT_SPREADS, buildTarotInterpretationData, drawTarot, getTarotMeaning, secureRandomInt } from '../../supabase/functions/_shared/domain/tarot.ts';

describe('canonical Tarot data', () => {
  it('covers all 22 card IDs with distinct slugs and both orientations', () => {
    expect(TAROT_MEANINGS.map(c => c.id)).toEqual(Array.from({ length: 22 }, (_, i) => i));
    expect(new Set(TAROT_MEANINGS.map(c => c.slug)).size).toBe(22);
    for (const card of TAROT_MEANINGS) { expect(card.upright).toHaveLength(5); expect(card.reversed).toHaveLength(5); expect(card.guidance.advice.length).toBeGreaterThan(0); }
    expect(getTarotMeaning(8).nameEn).toBe('Strength');
    expect(getTarotMeaning(11).nameEn).toBe('Justice');
    expect(getTarotMeaning(20).nameEn).toBe('Judgement');
    expect(getTarotMeaning(15).reversed).toContain('해방');
  });
  it('keeps the four canonical spread position meanings', () => {
    expect(TAROT_SPREADS.ONE_CARD).toHaveLength(1);
    expect(TAROT_SPREADS.RELATIONSHIP_3.map(p => p.label)).toEqual(['사용자의 마음 / 태도', '상대의 마음 / 태도', '관계의 흐름 / 조언']);
    expect(TAROT_SPREADS.DECISION_3[1]?.label).toBe('주의해야 할 리스크');
  });
  it('rejects invalid cards, orientations and spread values', () => {
    expect(() => getTarotMeaning(22)).toThrow('CARD_ID_INVALID');
    expect(() => getTarotMeaning(1.5)).toThrow('CARD_ID_INVALID');
    expect(() => drawTarot('toString' as never)).toThrow('SPREAD_INVALID');
    expect(() => buildTarotInterpretationData([{ cardId: 1, orientation: 'SIDEWAYS' as never, positionIndex: 0, positionKey: 'CORE_MESSAGE' }])).toThrow('ORIENTATION_INVALID');
  });
});

describe('authoritative draw', () => {
  it('draws without replacement even if random source always selects the same index', () => {
    const cards = drawTarot('GENERAL_3', () => 0);
    expect(cards.map(c => c.cardId)).toEqual([0, 1, 2]);
    expect(cards.map(c => c.positionIndex)).toEqual([0, 1, 2]);
    expect(cards.every(c => c.orientation === 'UPRIGHT')).toBe(true);
    expect(Object.isFrozen(cards)).toBe(true);
    expect(cards.every(Object.isFrozen)).toBe(true);
  });
  it('samples orientation independently using a fair two-value range', () => {
    const values = [21, 1, 0, 0, 19, 1];
    const random = vi.fn((_exclusiveMax: number) => values.shift()!);
    expect(drawTarot('DECISION_3', random).map(c => [c.cardId, c.orientation])).toEqual([[21, 'REVERSED'], [0, 'UPRIGHT'], [20, 'REVERSED']]);
    expect(random.mock.calls).toHaveLength(6);
    expect(random.mock.calls.map(call => call[0])).toEqual([22, 2, 21, 2, 20, 2]);
  });
  it('uses rejection sampling instead of biasing the highest uint32 values', () => {
    const bytes = vi.spyOn(globalThis.crypto, 'getRandomValues');
    bytes.mockImplementationOnce(array => { (array as Uint32Array)[0] = 0xffff_ffff; return array; });
    bytes.mockImplementationOnce(array => { (array as Uint32Array)[0] = 23; return array; });
    expect(secureRandomInt(22)).toBe(1);
    expect(bytes).toHaveBeenCalledTimes(2);
    bytes.mockRestore();
  });
  it('keeps an already saved draw and canonical meanings unchanged across interpretations', () => {
    const cards = drawTarot('ONE_CARD', max => max - 1);
    const first = buildTarotInterpretationData(cards);
    const retry = buildTarotInterpretationData(JSON.parse(JSON.stringify(cards)));
    expect(retry).toEqual(first);
    expect(retry[0]?.keywords).toEqual(getTarotMeaning(21).reversed);
    expect(cards[0]?.cardId).toBe(21);
  });
  it('fails explicitly on a broken injected entropy source', () => {
    expect(() => drawTarot('ONE_CARD', max => max)).toThrow('RANDOM_SOURCE_INVALID');
    expect(() => secureRandomInt(0)).toThrow('RANDOM_BOUND_INVALID');
  });
});
