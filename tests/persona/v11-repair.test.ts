import { describe, expect, it, vi } from 'vitest';
import { TAROT_MEANINGS, type TarotCard } from '../../supabase/functions/_shared/domain/tarot.ts';
import { createOpenAICompatibleProvider, type StructuredDiagnosticCode, type TarotRepairContext } from '../../supabase/functions/_shared/llm/provider.ts';
import { generatePersonaReply } from '../../supabase/functions/_shared/llm/reply.ts';
import { validateChatOutput } from '../../supabase/functions/_shared/llm/validator.ts';
import { buildPersonaToolFacts } from '../../supabase/functions/_shared/persona/tool-facts.ts';
import type { LLMMessage } from '../../supabase/functions/_shared/persona/prompt.ts';

const messages: readonly LLMMessage[] = Object.freeze([Object.freeze({ role: 'system' as const, content: 'SERVER_ORIGINAL' }), Object.freeze({ role: 'user' as const, content: ' USER_CANARY\r\n원래 질문 ' })]);
const completion = (content: unknown, raw = false) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: raw ? content : JSON.stringify(content) } }] }));
function setup() {
  const fetchImpl = vi.fn<typeof fetch>();
  const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'TEST_DOUBLE', structuredFormat: 'json_object', fetchImpl });
  return { provider, fetchImpl };
}
const bodyAt = (fetchImpl: ReturnType<typeof setup>['fetchImpl'], index: number) => JSON.parse(String(fetchImpl.mock.calls[index]![1]!.body));
const guidance = (body: { messages: LLMMessage[] }) => body.messages.find(item => item.role === 'system' && item.content.includes('응답 검증에 실패했습니다.'))!.content;
function table(body: { messages: LLMMessage[] }) {
  const text = guidance(body), prefix = '서버가 저장한 필수 참조와 선택방향 원본 index 표: ';
  return JSON.parse(text.slice(text.indexOf(prefix) + prefix.length).split('\n')[0]!);
}
const ref = (card: TarotCard) => ({ cardId: card.cardId, orientation: card.orientation, positionIndex: card.positionIndex });
const cards: TarotCard[] = [
  { cardId: 3, orientation: 'UPRIGHT', positionIndex: 2, positionKey: 'MESSAGE' },
  { cardId: 15, orientation: 'REVERSED', positionIndex: 0, positionKey: 'RISK' },
  { cardId: 17, orientation: 'UPRIGHT', positionIndex: 1, positionKey: 'ACTION' },
];

describe('v11 canonical Tarot tables never synthesize model evidence', () => {
  it('matches every item and index for all22 × both directions ×3 positions in initial and repair views', async () => {
    const snapshot = JSON.stringify(TAROT_MEANINGS);
    const { provider, fetchImpl } = setup(); fetchImpl.mockImplementation(async () => completion({ text: '후속 대화', toolReferences: [] }));
    let count = 0;
    for (const meaning of TAROT_MEANINGS) for (const orientation of ['UPRIGHT', 'REVERSED'] as const) for (const positionIndex of [0, 1, 2]) {
      const card = Object.freeze({ cardId: meaning.id, orientation, positionIndex, positionKey: 'SYNTHETIC' });
      const items = (orientation === 'UPRIGHT' ? meaning.upright : meaning.reversed).map((keyword, index) => ({ index, keyword }));
      const input = Object.freeze({ cards: Object.freeze([card]) });
      const projected = buildPersonaToolFacts(input) as { cards: { activeKeywordOptions: unknown }[] };
      expect(projected.cards[0]!.activeKeywordOptions).toEqual(items);
      await provider.repairChat(messages, '{}', ['TOOL_RESULT_CHANGED'], 'TAROT_EVIDENCE_V1', Object.freeze({ expectedCards: Object.freeze([card]) }));
      expect(table(bodyAt(fetchImpl, count))).toEqual({ requiredToolReferences: [ref(card)], activeKeywordOptions: [{ positionIndex, items }] });
      expect(input).toEqual({ cards: [card] }); count++;
    }
    expect(count).toBe(132); expect(JSON.stringify(TAROT_MEANINGS)).toBe(snapshot);
  });
  it('narrows known keyword errors to the expected position, preserving all required refs and exact field path', async () => {
    const { provider, fetchImpl } = setup(); fetchImpl.mockResolvedValue(completion({}));
    const expected = cards[2]!, items = TAROT_MEANINGS[expected.cardId]!.upright;
    const invalid = { text: items[0], toolReferences: cards.map(ref), interpretationEvidence: [{ positionIndex: expected.positionIndex, keywordIndices: [1], textEvidence: items[0] }] };
    await provider.repairChat(messages, JSON.stringify(invalid), ['TAROT_EVIDENCE_KEYWORD_NOT_IN_SPAN'], 'TAROT_EVIDENCE_V1', { expectedCards: cards });
    expect(table(bodyAt(fetchImpl, 0))).toEqual({ requiredToolReferences: cards.map(ref), activeKeywordOptions: [{ positionIndex: expected.positionIndex, items: items.map((keyword, index) => ({ index, keyword })) }] });
    expect(guidance(bodyAt(fetchImpl, 0))).toContain('"path":"/interpretationEvidence/0/keywordIndices/0","reason":"SELECTED_KEYWORD_NOT_IN_TEXT_EVIDENCE"');
  });
  it('uses all bounded tables if refs or the position are unknown, without elevating untrusted strings', async () => {
    const { provider, fetchImpl } = setup(); fetchImpl.mockImplementation(async () => completion({}));
    const canary = 'UNTRUSTED_OUTPUT_CANARY';
    const context = { expectedCards: cards.map(card => ({ ...card, name: 'EXTRA_CONTEXT_CANARY', keyword: 'FALSE_KEYWORD_CANARY' })) };
    for (const invalid of ['not-json ' + canary, JSON.stringify({ text: canary, interpretationEvidence: [{ positionIndex: -7, keywordIndices: [100], textEvidence: canary }] })]) {
      await provider.repairChat(messages, invalid, ['TOOL_RESULT_CHANGED'], 'TAROT_EVIDENCE_V1', context);
      const body = bodyAt(fetchImpl, fetchImpl.mock.calls.length - 1);
      expect(table(body).activeKeywordOptions).toHaveLength(3);
      for (const value of [canary, 'EXTRA_CONTEXT_CANARY', 'FALSE_KEYWORD_CANARY', 'USER_CANARY']) expect(guidance(body)).not.toContain(value);
      expect(body.messages.at(-2).content).toBe(invalid); expect(body.messages.at(-1)).toEqual(messages.at(-1));
    }
  });
  it.each([
    undefined, {}, { expectedCards: [] }, { expectedCards: Array.from({ length: 4 }, () => ref(cards[0]!)) },
    { expectedCards: [{ ...ref(cards[0]!), cardId: -1 }] }, { expectedCards: [{ ...ref(cards[0]!), cardId: 22 }] },
    { expectedCards: [{ ...ref(cards[0]!), orientation: 'ORIENTATION_CANARY' }] },
    { expectedCards: [{ ...ref(cards[0]!), positionIndex: 3 }] },
    { expectedCards: [ref(cards[0]!), ref(cards[0]!)] }, { expectedCards: [null] },
  ])('omits canonical hint for malformed or absent context: %#', async context => {
    const { provider, fetchImpl } = setup(); fetchImpl.mockResolvedValue(completion({}));
    await provider.repairChat(messages, '{}', ['TOOL_RESULT_CHANGED'], 'TAROT_EVIDENCE_V1', context as TarotRepairContext | undefined);
    const text = guidance(bodyAt(fetchImpl, 0));
    expect(text).not.toContain('서버가 저장한 필수 참조와 선택방향 원본 index 표'); expect(text).not.toContain('ORIENTATION_CANARY');
    expect(text).toContain('타로 근거 수리 안내');
  });
  it('passes only stored tuples through the reply integration and never fills empty refs itself', async () => {
    const { provider, fetchImpl } = setup(); fetchImpl.mockImplementation(async () => completion({ text: '다시 뽑고 싶다면 새 추첨을 선택해 봐.', toolReferences: [], interpretationEvidence: [] }));
    const spy = vi.spyOn(provider, 'repairChat');
    await expect(generatePersonaReply(provider, { characterId: 'SANI', currentMessage: '새로 뽑고 싶어.', toolResult: { cards } })).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
    expect(fetchImpl).toHaveBeenCalledTimes(2); expect(spy.mock.calls[0]![4]).toEqual({ expectedCards: cards.map(ref) });
    expect(table(bodyAt(fetchImpl, 1)).requiredToolReferences).toEqual(cards.map(ref));
  });
  it('accepts only a model-authored repair and keeps full refs for single-card or non-fortune followups', async () => {
    const { provider, fetchImpl } = setup();
    const item = TAROT_MEANINGS[cards[0]!.cardId]!.upright[0]!;
    const repaired = { text: `이 카드의 ${item}을 현실의 작은 행동과 연결해 보자.`, toolReferences: cards.map(ref), interpretationEvidence: [{ positionIndex: cards[0]!.positionIndex, keywordIndices: [0], textEvidence: item }] };
    fetchImpl.mockResolvedValueOnce(completion({ ...repaired, toolReferences: [] })).mockResolvedValueOnce(completion(repaired));
    const result = await generatePersonaReply(provider, { characterId: 'SANI', currentMessage: '첫 카드만 설명해 줘.', toolResult: { cards } });
    expect(result.content).toBe(repaired.text); expect(result.repaired).toBe(true); expect(result.metadata.promptVersion).toBe('JumZipPersona-v11');
    expect(JSON.stringify(result)).not.toContain('interpretationEvidence'); expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(validateChatOutput(JSON.stringify({ text: '다른 이야기를 해 보자.', toolReferences: cards.map(ref), interpretationEvidence: [] }), { characterId: 'SANI', expectedCards: cards }).ok).toBe(true);
  });
  it('retains the wrong-cause limitation even with correct canonical indices and a source span', () => {
    const hermit: TarotCard = { cardId: 9, orientation: 'REVERSED', positionIndex: 1, positionKey: 'THEIR_ATTITUDE' };
    const output = { text: '상대는 혼자만의 시간이 필요해서 회피하고 있어.', toolReferences: [ref(hermit)], interpretationEvidence: [{ positionIndex: 1, keywordIndices: [1], textEvidence: '회피' }] };
    // This is a structural pass only; direct semantic review must still judge the wrong cause.
    expect(validateChatOutput(JSON.stringify(output), { characterId: 'SANI', expectedCards: [hermit] }).ok).toBe(true);
  });
});

describe('v11 optional structured diagnostics are provider-owned and fixed', () => {
  const schema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } };
  const validate = (value: unknown) => { if ((value as { ok?: boolean })?.ok !== true) throw Error('PRIVATE_ERROR_CANARY'); return value; };
  it.each([
    ['INTENT_ALIAS_SOURCE_INVALID', '/targetAliasEvidence/source', 'ALIAS_SOURCE_MUST_BE_CURRENT_OR_RECENT_USER'],
    ['INTENT_CHOICES_INVALID', '/choicesEvidence', 'CHOICES_REQUIRE_ZERO_OR_TWO_SEPARATE_SOURCE_QUOTE_OBJECTS'],
  ] as const)('adds only fixed diagnostics for %s, then validates model-authored repair', async (code, path, reason) => {
    const { provider, fetchImpl } = setup(); fetchImpl.mockResolvedValueOnce(completion({})).mockResolvedValueOnce(completion({ ok: true }));
    const mapper = vi.fn(() => code);
    await expect(provider.generateStructured({ messages, schema, validate, diagnoseValidationError: mapper })).resolves.toEqual({ ok: true });
    expect(mapper).toHaveBeenCalledTimes(1); expect(fetchImpl).toHaveBeenCalledTimes(2);
    const body = bodyAt(fetchImpl, 1), text = guidance(body);
    expect(text).toContain(JSON.stringify({ code, path, reason })); expect(text).toContain('STRUCTURED_VALIDATION_FAILED');
    for (const canary of ['PRIVATE_ERROR_CANARY', 'USER_CANARY']) expect(text).not.toContain(canary);
    expect(body.messages.at(-1)).toEqual(messages.at(-1)); expect(body.max_tokens).toBe(900); expect(body.temperature).toBe(0.1);
  });
  it.each([null, 'UNKNOWN_CODE_CANARY', 'INTENT_ALIAS_SOURCE_INVALID suffix', { code: 'INTENT_ALIAS_SOURCE_INVALID' }, ['INTENT_CHOICES_INVALID'], '__proto__'])('falls back for non-allowlisted mapper return: %#', async code => {
    const { provider, fetchImpl } = setup(); fetchImpl.mockResolvedValueOnce(completion({})).mockResolvedValueOnce(completion({ ok: true }));
    await provider.generateStructured({ messages, schema, validate, diagnoseValidationError: () => code as StructuredDiagnosticCode | null });
    const text = guidance(bodyAt(fetchImpl, 1)); expect(text).not.toContain('서버 구조 검증 진단'); expect(text).not.toContain('UNKNOWN_CODE_CANARY'); expect(text).toContain('STRUCTURED_VALIDATION_FAILED');
  });
  it('keeps mapper failure generic and does not diagnose a repeated failed repair', async () => {
    const { provider, fetchImpl } = setup(); fetchImpl.mockImplementation(async () => completion({}));
    const mapper = vi.fn(() => { throw Error('MAPPER_PRIVATE_CANARY'); });
    await expect(provider.generateStructured({ messages, schema, validate, diagnoseValidationError: mapper })).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
    expect(mapper).toHaveBeenCalledTimes(1); expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(guidance(bodyAt(fetchImpl, 1))).not.toContain('MAPPER_PRIVATE_CANARY'); expect(guidance(bodyAt(fetchImpl, 1))).not.toContain('서버 구조 검증 진단');
  });
  it('never maps parse failures and never maps or repairs initial success', async () => {
    const { provider, fetchImpl } = setup(); const mapper = vi.fn(() => 'INTENT_CHOICES_INVALID' as const);
    fetchImpl.mockResolvedValueOnce(completion('not-json PRIVATE_PARSE_CANARY', true)).mockResolvedValueOnce(completion({ ok: true })).mockResolvedValueOnce(completion({ ok: true }));
    await provider.generateStructured({ messages, schema, validate, diagnoseValidationError: mapper });
    expect(guidance(bodyAt(fetchImpl, 1))).not.toContain('서버 구조 검증 진단'); expect(guidance(bodyAt(fetchImpl, 1))).not.toContain('PRIVATE_PARSE_CANARY');
    await provider.generateStructured({ messages, schema, validate, diagnoseValidationError: mapper });
    expect(mapper).not.toHaveBeenCalled(); expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('leaves no-mapper repair identical to generic behavior and ignores Tarot context on DEFAULT', async () => {
    const { provider, fetchImpl } = setup(); fetchImpl.mockImplementation(async () => completion({}));
    await provider.repairChat(messages, '{}', ['STRUCTURED_VALIDATION_FAILED'], 'DEFAULT', { expectedCards: cards });
    await expect(provider.generateStructured({ messages, schema, validate })).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
    // The first schema-only system message differs by requested schema, as in v10.
    expect(bodyAt(fetchImpl, 2).messages.slice(1)).toEqual(bodyAt(fetchImpl, 0).messages.slice(1));
    expect(guidance(bodyAt(fetchImpl, 0))).not.toContain('activeKeywordOptions'); expect(guidance(bodyAt(fetchImpl, 2))).not.toContain('서버 구조 검증 진단');
  });
});
