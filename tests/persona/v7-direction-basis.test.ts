import { describe, expect, it } from 'vitest';
import { TAROT_MEANINGS, TAROT_MEANING_VERSION, TAROT_SPREADS, buildTarotInterpretationData } from '../../supabase/functions/_shared/domain/tarot.ts';
import { buildPersonaToolFacts } from '../../supabase/functions/_shared/persona/tool-facts.ts';
import { buildPersonaMessages } from '../../supabase/functions/_shared/persona/prompt.ts';
import { buildSajuInterpretationData } from '../../supabase/functions/_shared/domain/full-saju.ts';
import { SUPPLEMENTAL_FIXTURES } from './saju-benchmark-corpus.ts';

interface CardView {
  cardId: number; orientation: 'UPRIGHT' | 'REVERSED'; positionIndex: number; positionKey: string;
  nameKo: string; orientationLabel: string; positionLabel: string; activeMeaning: readonly string[];
  meaningProvenance: { meaningVersion: string; cardId: number; orientation: string; positionIndex: number; positionKey: string };
  selectedDirectionBasisKo: string;
}
describe('v7 uniform direction/position evidence uses the unchanged canonical source', () => {
  it('binds all22×both directions×spread positions to the selected canonical row', () => {
    const original = JSON.stringify(TAROT_MEANINGS);
    const seen = new Set<string>();
    for (const meaning of TAROT_MEANINGS) for (const orientation of ['UPRIGHT', 'REVERSED'] as const) for (const positions of Object.values(TAROT_SPREADS)) {
      const cards = positions.map((position, positionIndex) => ({ cardId: meaning.id, orientation, positionIndex, positionKey: position.key }));
      const source = { kind: 'TAROT', cards: buildTarotInterpretationData(cards) }, before = JSON.stringify(source);
      const view = buildPersonaToolFacts(source) as { cards: CardView[]; requiredToolReferences: unknown[] };
      for (const [index, card] of view.cards.entries()) {
        seen.add(`${meaning.id}:${orientation}`);
        const expectedKeywords = orientation === 'UPRIGHT' ? meaning.upright : meaning.reversed;
        expect(card.meaningProvenance).toEqual({ meaningVersion: TAROT_MEANING_VERSION, ...cards[index] });
        expect(card.activeMeaning).toEqual(expectedKeywords);
        expect(card.selectedDirectionBasisKo).toContain(`“${positions[index]!.label}” 위치의 ${meaning.nameKo} ${orientation === 'UPRIGHT' ? '정방향' : '역방향'}`);
        const serializedKeywords = card.selectedDirectionBasisKo.split('상징 키워드는 ')[1]!.split('입니다.')[0];
        expect(serializedKeywords?.split(', ')).toEqual(expectedKeywords);
        expect(card.selectedDirectionBasisKo.endsWith('이는 실제 사람의 심정이나 행동을 관찰했다는 뜻이 아닙니다.')).toBe(true);
        expect(card).not.toHaveProperty('contextAdvice');
      }
      expect(view.requiredToolReferences).toEqual(cards.map(({ cardId, orientation, positionIndex }) => ({ cardId, orientation, positionIndex })));
      expect(JSON.stringify(source)).toBe(before);
    }
    expect(seen.size).toBe(44); expect(JSON.stringify(TAROT_MEANINGS)).toBe(original);
  });
  it('discards untrusted copied meaning/provenance fields and keeps actual card coordinates', () => {
    const card = { cardId: 15, orientation: 'REVERSED', positionIndex: 1, positionKey: 'RISK' } as const;
    const view = buildPersonaToolFacts({ kind: 'TAROT', cards: [{ ...card, nameKo: 'OTHER', activeMeaning: ['INVENTED'], meaningProvenance: { cardId: 0 }, selectedDirectionBasisKo: 'INVENTED' }] }) as { cards: CardView[] };
    expect(view.cards[0]!.meaningProvenance).toEqual({ meaningVersion: TAROT_MEANING_VERSION, ...card });
    expect(view.cards[0]!.selectedDirectionBasisKo).toContain('“주의해야 할 리스크” 위치의 악마 역방향');
    expect(view.cards[0]!.selectedDirectionBasisKo).toContain(TAROT_MEANINGS[15]!.reversed.join(', '));
    expect(JSON.stringify(view)).not.toMatch(/OTHER|INVENTED/);
  });
  it('reaches the provider prompt with the selected direction and position intact', () => {
    const tool = { kind: 'TAROT', cards: [{ cardId: 9, orientation: 'REVERSED', positionIndex: 0, positionKey: 'YOUR_ATTITUDE' }] };
    const messages = buildPersonaMessages({ characterId: 'BOMI', currentMessage: '저장된 카드 설명을 부탁해.', toolResult: tool });
    const serialized = JSON.stringify(messages);
    expect(serialized).toContain('selectedDirectionBasisKo'); expect(serialized).toContain('meaningProvenance');
    expect(serialized).toContain('고립, 회피, 과도한 폐쇄, 외로움, 방향 상실');
    expect(serialized).toContain('사용자의 마음 / 태도'); expect(serialized).not.toContain('contextAdvice');
  });
  it('does not add Tarot direction fields to Saju or ordinary chat', () => {
    const saju = buildPersonaToolFacts(buildSajuInterpretationData(SUPPLEMENTAL_FIXTURES.unknown));
    expect(JSON.stringify(saju)).not.toMatch(/selectedDirectionBasisKo|meaningProvenance/);
    expect(buildPersonaToolFacts(null)).toBe(null);
  });
});
