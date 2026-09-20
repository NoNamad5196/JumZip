import { describe, expect, it, vi } from 'vitest';
import { createOpenAICompatibleProvider } from '../../supabase/functions/_shared/llm/provider.ts';
import { buildPersonaToolFacts } from '../../supabase/functions/_shared/persona/tool-facts.ts';
import { buildPersonaMessages } from '../../supabase/functions/_shared/persona/prompt.ts';
import { TAROT_MEANINGS, TAROT_SPREADS, buildTarotInterpretationData } from '../../supabase/functions/_shared/domain/tarot.ts';

const response = (content: unknown) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }));
describe('generic schema and tool projections after the preserved v2 failure', () => {
  it('sends required structured schema to a JSON-object-only provider on initial and repair', async () => {
    const schema = { type: 'object', additionalProperties: false, required: ['category', 'subject', 'content'], properties: { category: { const: 'PREFERENCE' }, subject: { const: 'USER' }, content: { type: 'string' } } };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ type: 'preference', evidence: '종이별' })).mockResolvedValueOnce(response({ category: 'PREFERENCE', subject: 'USER', content: '종이별 접기를 좋아한다.' }));
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'test-only', structuredFormat: 'json_object', fetchImpl });
    const result = await provider.generateStructured({ messages: [{ role: 'user', content: '종이별 접기를 좋아해.' }], schema, validate: value => {
      if (!value || typeof value !== 'object' || !('category' in value) || !('subject' in value) || !('content' in value)) throw Error('invalid'); return value;
    } });
    expect(result).toMatchObject({ category: 'PREFERENCE', subject: 'USER' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const call of fetchImpl.mock.calls) {
      const body = JSON.parse(call[1]!.body as string);
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.messages.some((message: { role: string; content: string }) => message.role === 'system' && message.content.includes(JSON.stringify(schema)))).toBe(true);
    }
  });
  it('preserves native strict-schema transport and still rejects an invalid second repair', async () => {
    const schema = { type: 'object', required: ['requiredField'] };
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => response({ missing: true }));
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'test-only', fetchImpl });
    await expect(provider.generateStructured({ messages: [{ role: 'user', content: '원래 입력을 분류해 줘.' }], schema, validate: () => { throw Error('invalid'); } })).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string).response_format.json_schema.schema).toEqual(schema);
  });
  it('uses each of all22 cards canonical selected direction and every spread position without changing the draw', () => {
    for (const meaning of TAROT_MEANINGS) for (const orientation of ['UPRIGHT', 'REVERSED'] as const) for (const positions of Object.values(TAROT_SPREADS)) {
      const cards = positions.map((position, positionIndex) => ({ cardId: meaning.id, orientation, positionIndex, positionKey: position.key }));
      const input = { kind: 'TAROT', cards: buildTarotInterpretationData(cards) }; const before = JSON.stringify(input);
      const projected = buildPersonaToolFacts(input) as { cards: Record<string, unknown>[]; requiredToolReferences: unknown[] };
      expect(JSON.stringify(input)).toBe(before);
      for (const [index, card] of projected.cards.entries()) {
        expect(card).toMatchObject({ cardId: meaning.id, orientation, positionIndex: index, positionKey: positions[index]!.key, positionLabel: positions[index]!.label, nameKo: meaning.nameKo, activeMeaning: meaning[orientation === 'UPRIGHT' ? 'upright' : 'reversed'] });
        expect(card).not.toHaveProperty('sharedGuidance');
      }
      expect(projected.requiredToolReferences).toEqual(cards.map(({ cardId, orientation, positionIndex }) => ({ cardId, orientation, positionIndex })));
    }
  });
  it('sorts only displayed discrete score possibilities and keeps correlation source immutable', () => {
    const original = { kind: 'SAJU', strength: { score: null }, pillars: { hour: null }, possible_values: { score: [37, 58, 32], charts: [{ chartIndex: 0, score: 37 }] } };
    const before = JSON.stringify(original); const projected = buildPersonaToolFacts(original);
    expect(projected).toMatchObject({ strength: { score: null }, pillars: { hour: null }, possible_values: { score: [32, 37, 58], charts: original.possible_values.charts } });
    expect(JSON.stringify(original)).toBe(before);
  });
  it('labels source relations without adding a marriage result and scrubs raw birth fields before projection', () => {
    const tool = { kind: 'SAJU_COMPATIBILITY', branchRelations: [{ type: 'SIX_COMBINATION', values: ['辰', '酉'], certainty: 'POSSIBLE' }], rawBirth: { city: 'PRIVATE_CITY_SENTINEL' } };
    const context = buildPersonaMessages({ characterId: 'ARANG', currentMessage: '결혼 날짜를 알려줘.', toolResult: tool }).find(message => message.content.startsWith('actualConversationContext:'))!.content;
    expect(context).toContain('육합'); expect(context).toContain('결혼할 날짜·월'); expect(context).not.toContain('PRIVATE_CITY_SENTINEL');
    const facts = buildPersonaToolFacts(tool) as Record<string, unknown>;
    expect(facts).not.toHaveProperty('marriageDate'); expect(facts).not.toHaveProperty('probability');
  });
  it('describes exact element extrema with all ties and zeros, without classifying strength', () => {
    const tool = { kind: 'SAJU', elements: { WOOD: .4, FIRE: .4, EARTH: .2, METAL: 0, WATER: 0 } };
    const before = JSON.stringify(tool); const projected = buildPersonaToolFacts(tool) as Record<string, unknown>;
    expect(projected.descriptiveElementFacts).toMatchObject({ maximumElements: ['목', '화'], minimumElements: ['금', '수'], zeroElements: ['금', '수'], percentageDecimals: 1 });
    expect(projected).not.toHaveProperty('strength'); expect(JSON.stringify(tool)).toBe(before);
    expect(buildPersonaToolFacts({ kind: 'SAJU', elements: null })).toMatchObject({ descriptiveElementFacts: null });
  });
  it('keeps unrounded ratios for comparisons even if their displayed percentages round equally', () => {
    const elementComplement = ['WOOD', 'FIRE', 'EARTH', 'METAL', 'WATER'].map(element => ({ element, possiblePersonAProportions: [element === 'WOOD' ? .20004 : .19999], possiblePersonBProportions: [.2] }));
    const facts = (buildPersonaToolFacts({ kind: 'SAJU_COMPATIBILITY', elementComplement }) as { descriptiveElementFacts: { comparisons: Record<string, unknown>[]; personA: unknown; personB: unknown } }).descriptiveElementFacts;
    expect(facts.comparisons[0]).toMatchObject({ personAPercent: 20, personBPercent: 20, comparison: 'A가 더 많음' });
    expect(facts.comparisons[0]!.statement).toContain('반올림 표시는 같지만 원 비율에서는');
    expect(facts.personA).toMatchObject({ maximumElements: ['목'] }); expect(facts.personB).toMatchObject({ maximumElements: ['목', '화', '토', '금', '수'], minimumElements: ['목', '화', '토', '금', '수'] });
  });
  it('does not infer a confirmed A/B distribution or comparison from alternative chart marginals', () => {
    const elementComplement = ['WOOD', 'FIRE', 'EARTH', 'METAL', 'WATER'].map(element => ({ element, possiblePersonAProportions: element === 'WOOD' ? [.3, .4] : [.15], possiblePersonBProportions: [.2] }));
    const tool = { kind: 'SAJU_COMPATIBILITY', elementComplement }; const before = JSON.stringify(tool);
    const facts = (buildPersonaToolFacts(tool) as { descriptiveElementFacts: { comparisons: Record<string, unknown>[]; personA: unknown; personB: unknown } }).descriptiveElementFacts;
    expect(facts.personA).toBeNull(); expect(facts.personB).not.toBeNull(); expect(facts.comparisons[0]).toMatchObject({ personAPercent: null, comparison: null });
    expect(JSON.stringify(tool)).toBe(before);
  });
  it('keeps current register and third-person uncertainty in trusted system rules', () => {
    for (const characterId of ['BOMI', 'SANI', 'ARANG'] as const) {
      const system = buildPersonaMessages({ characterId, currentMessage: '서로 좋아하는 것 같아.' })[0]!.content;
      expect(system).toContain('카드가 그것을 입증하지 않는다'); expect(system).toContain('사용자의 태도 위치를 상대의 마음으로 옮기지 않는다');
      expect(system).toContain(characterId === 'ARANG' ? '아랑: 첫 만남의 차분한 존댓말' : characterId === 'BOMI' ? '보미: 밝고 짧은 반말' : '산이: 담백하고 현실적인 반말');
    }
  });
});
