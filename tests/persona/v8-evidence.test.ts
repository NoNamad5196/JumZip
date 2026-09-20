import { afterEach, describe, expect, it, vi } from 'vitest';
import { TAROT_MEANINGS, type TarotCard } from '../../supabase/functions/_shared/domain/tarot.ts';
import { CHAT_RESPONSE_SCHEMA, TAROT_EVIDENCE_RESPONSE_SCHEMA, selectChatResponseContract } from '../../supabase/functions/_shared/llm/chat-contract.ts';
import { createOpenAICompatibleProvider } from '../../supabase/functions/_shared/llm/provider.ts';
import { generatePersonaReply } from '../../supabase/functions/_shared/llm/reply.ts';
import { validateChatOutput } from '../../supabase/functions/_shared/llm/validator.ts';
import { buildPersonaMessages } from '../../supabase/functions/_shared/persona/prompt.ts';

const hermit: TarotCard = { cardId: 9, orientation: 'REVERSED', positionIndex: 1, positionKey: 'THEIR_ATTITUDE' };
const cards: TarotCard[] = [
  { cardId: 6, orientation: 'UPRIGHT', positionIndex: 0, positionKey: 'YOUR_ATTITUDE' }, hermit,
  { cardId: 11, orientation: 'UPRIGHT', positionIndex: 2, positionKey: 'RELATIONSHIP_DIRECTION' },
];
const refs = (draw: readonly TarotCard[]) => draw.map(({ cardId, orientation, positionIndex }) => ({ cardId, orientation, positionIndex }));
const evidence = { positionIndex: 1, keywordIndices: [0, 1], textEvidence: '고립, 회피' };
const valid = () => ({ text: '은둔자 역방향의 상징은 고립, 회피야. 실제 마음을 단정하지 말고 최근 행동을 확인해 보자.', toolReferences: refs(cards), interpretationEvidence: [structuredClone(evidence)] });
const check = (value: unknown, draw = cards) => validateChatOutput(JSON.stringify(value), { characterId: 'SANI', expectedCards: draw });
const completion = (value: unknown, finishReason = 'stop') => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: finishReason }], model: 'TEST_DOUBLE' }));
afterEach(() => vi.useRealTimers());

describe('Tarot internal evidence is lexical provenance, not semantic certification', () => {
  it('binds all22 canonical cards, both directions, every position and every keyword without changing source rows', () => {
    const original = JSON.stringify(TAROT_MEANINGS);
    for (const row of TAROT_MEANINGS) for (const orientation of ['UPRIGHT', 'REVERSED'] as const) for (const positionIndex of [0, 1, 2]) {
      const keywords = orientation === 'UPRIGHT' ? row.upright : row.reversed;
      const draw: TarotCard[] = [{ cardId: row.id, orientation, positionIndex, positionKey: 'SYNTHETIC_VALIDATOR_POSITION' }];
      const span = keywords.join(', ');
      const value = { text: `선택 방향의 상징: ${span}.`, toolReferences: refs(draw), interpretationEvidence: [{ positionIndex, keywordIndices: keywords.map((_, i) => i), textEvidence: span }] };
      expect(check(value, draw), `${row.id}/${orientation}/${positionIndex}`).toEqual({ ok: true, value: { text: value.text, toolReferences: refs(draw) } });
    }
    expect(JSON.stringify(TAROT_MEANINGS)).toBe(original);
  });
  it('permits one interpreted card in a three-card followup and strips internal evidence', () => {
    expect(check(valid())).toEqual({ ok: true, value: { text: valid().text, toolReferences: refs(cards) } });
  });
  it.each([undefined, null, {}, [null], [{ ...evidence, extra: true }], [{ positionIndex: 1, keywordIndices: [0] }], [{ ...evidence, keywordIndices: [] }], [{ ...evidence, keywordIndices: [0, 1, 2, 3, 4, 5] }], [{ ...evidence, textEvidence: '   ' }], [{ ...evidence, textEvidence: '고'.repeat(201) }], [evidence, evidence, evidence, evidence]])('rejects missing or malformed evidence without completing it: %j', interpretationEvidence => {
    const value: Record<string, unknown> = { ...valid(), interpretationEvidence };
    if (interpretationEvidence === undefined) delete value.interpretationEvidence;
    expect(check(value)).toMatchObject({ ok: false, issues: expect.arrayContaining([interpretationEvidence === undefined ? 'TAROT_EVIDENCE_REQUIRED' : 'TAROT_EVIDENCE_SHAPE_INVALID']) });
  });
  it.each([[-1], [0.5], [5], ['0'], [0, 0]])('rejects invalid or duplicate keyword index %j', (...keywordIndices) => {
    expect(check({ ...valid(), interpretationEvidence: [{ ...evidence, keywordIndices }] })).toMatchObject({ ok: false, issues: ['TAROT_EVIDENCE_KEYWORD_INVALID'] });
  });
  it('rejects a nonexistent position and repeated position without requiring all positions', () => {
    expect(check({ ...valid(), interpretationEvidence: [{ ...evidence, positionIndex: 0 }] }, [hermit])).toMatchObject({ ok: false, issues: expect.arrayContaining(['TAROT_EVIDENCE_POSITION_INVALID']) });
    expect(check({ ...valid(), interpretationEvidence: [evidence, evidence] })).toMatchObject({ ok: false, issues: ['TAROT_EVIDENCE_POSITION_INVALID'] });
  });
  it('checks the saved direction, not a plausible opposite-direction keyword or declaration', () => {
    const opposite = { ...valid(), text: '선택 방향의 상징은 성찰이야.', interpretationEvidence: [{ positionIndex: 1, keywordIndices: [0], textEvidence: '성찰' }] };
    expect(check(opposite)).toMatchObject({ ok: false, issues: ['TAROT_EVIDENCE_KEYWORD_NOT_IN_SPAN'] });
    expect(check({ ...valid(), interpretationEvidence: [{ ...evidence, orientation: 'UPRIGHT' }] })).toMatchObject({ ok: false, issues: ['TAROT_EVIDENCE_SHAPE_INVALID'] });
  });
  it('requires a contiguous exact substring within final trimmed text and the selected keyword within that span', () => {
    expect(check({ ...valid(), interpretationEvidence: [{ ...evidence, textEvidence: '고립 또는 회피' }] })).toMatchObject({ ok: false, issues: ['TAROT_EVIDENCE_SPAN_MISSING'] });
    expect(check({ ...valid(), interpretationEvidence: [{ ...evidence, textEvidence: '최근 행동' }] })).toMatchObject({ ok: false, issues: ['TAROT_EVIDENCE_KEYWORD_NOT_IN_SPAN'] });
    expect(check({ ...valid(), text: ' 고립 ', interpretationEvidence: [{ positionIndex: 1, keywordIndices: [0], textEvidence: ' 고립 ' }] })).toMatchObject({ ok: false, issues: ['TAROT_EVIDENCE_SPAN_MISSING'] });
    const span200 = '고립' + '가'.repeat(198);
    expect(check({ ...valid(), text: span200, interpretationEvidence: [{ positionIndex: 1, keywordIndices: [0], textEvidence: span200 }] }).ok).toBe(true);
  });
  it('allows an empty array for non-fortune followups; interpretation omitted from evidence remains a documented limitation', () => {
    expect(check({ ...valid(), text: '오늘 점심에는 뭘 먹었어?', interpretationEvidence: [] }).ok).toBe(true);
    expect(check({ ...valid(), interpretationEvidence: [] }).ok).toBe(true); // Structural pass only; a direct review must catch this evasion.
  });
  it('retains the known semantic Hard Fail even though exact keyword/span checks pass', () => {
    const knownSemanticHardFail = '상대는 혼자만의 시간이 필요하거나 회피하는 모습이야.';
    const output = { ...valid(), text: knownSemanticHardFail, interpretationEvidence: [{ positionIndex: 1, keywordIndices: [1], textEvidence: knownSemanticHardFail }] };
    expect(check(output).ok).toBe(true); // Not a quality pass: the wrong alternative still reverses the selected meaning.
    const directReviewFixture = { hardFails: ['TOOL_MEANING_CHANGED'], evidence: knownSemanticHardFail };
    expect(directReviewFixture.hardFails).toHaveLength(1);
  });
  it('keeps Saju and nonempty DEFAULT snapshots on the two-key contract; merely asking Tarot does not enable evidence', () => {
    expect(selectChatResponseContract(undefined)).toBe('TEXT_ONLY_V1');
    // Direct legacy validator callers still default to the original two-key shape.
    expect(validateChatOutput(JSON.stringify({ text: '이야기부터 들어보자.', toolReferences: [] }), { characterId: 'SANI' }).ok).toBe(true);
    for (const toolResult of [{ kind: 'SAJU', strength: { score: 83 } }, { cards: [] }]) {
      expect(selectChatResponseContract(toolResult)).toBe('DEFAULT');
      expect(validateChatOutput(JSON.stringify({ text: '이야기부터 들어보자.', toolReferences: [] }), { characterId: 'SANI', toolResult }).ok).toBe(true);
      expect(validateChatOutput(JSON.stringify({ text: '이야기부터 들어보자.', toolReferences: [], interpretationEvidence: [] }), { characterId: 'SANI', toolResult })).toMatchObject({ ok: false, issues: ['RESPONSE_SCHEMA_INVALID'] });
      const system = buildPersonaMessages({ characterId: 'SANI', currentMessage: '타로 보고 싶어.', toolResult })[0]!.content;
      expect(system).toContain('{"text":"사용자에게 보일 한국어 답변","toolReferences":[]}');
      expect(system).not.toContain('interpretationEvidence');
    }
    const tarotSystem = buildPersonaMessages({ characterId: 'SANI', currentMessage: '은둔자만 설명해 줘.', toolResult: { cards } })[0]!.content;
    expect(tarotSystem).toContain('200자 이하');
    expect(tarotSystem).toContain('한 카드만 묻는 후속 질문');
    expect(tarotSystem).not.toContain('{"text":"사용자에게 보일 한국어 답변","toolReferences":[]}');
  });
});

describe('Tarot transport, repair and public reply compatibility', () => {
  it.each(['json_object', 'json_schema'] as const)('sends the same actual evidence schema on initial and single repair (%s)', async structuredFormat => {
    const legacy = { text: valid().text, toolReferences: valid().toolReferences };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(completion(legacy)).mockResolvedValueOnce(completion(valid()));
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'TEST_DOUBLE', structuredFormat, fetchImpl });
    const snapshot = JSON.stringify(cards);
    const result = await generatePersonaReply(provider, { characterId: 'SANI', currentMessage: '같은 은둔자만 다시 설명해 줘.', toolResult: { cards } });
    expect(fetchImpl).toHaveBeenCalledTimes(2); expect(result.repaired).toBe(true);
    expect(Object.keys(result).sort()).toEqual(['content', 'metadata', 'repaired', 'segments']);
    expect(result.content).toBe(valid().text); expect(JSON.stringify(result)).not.toContain('interpretationEvidence');
    expect(JSON.stringify(cards)).toBe(snapshot);
    const bodies = fetchImpl.mock.calls.map(call => JSON.parse(String(call[1]!.body)));
    for (const body of bodies) {
      expect(body.max_tokens).toBe(900);
      if (structuredFormat === 'json_object') expect(body.messages[0].content).toContain(JSON.stringify(TAROT_EVIDENCE_RESPONSE_SCHEMA));
      else expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'jumzip_tarot_evidence_v1', strict: true, schema: TAROT_EVIDENCE_RESPONSE_SCHEMA } });
    }
    expect(bodies.map(body => body.temperature)).toEqual([0.65, 0.15]);
    expect(bodies[1].messages.filter((item: { role: string }) => item.role === 'system').map((item: { content: string }) => item.content).join('\n')).toContain('TAROT_EVIDENCE_REQUIRED');
  });
  it('fails missing evidence after exactly one repair instead of silently adding a field', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => completion({ text: valid().text, toolReferences: refs(cards) }));
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'TEST_DOUBLE', fetchImpl });
    await expect(generatePersonaReply(provider, { characterId: 'SANI', currentMessage: '다시 설명해 줘.', toolResult: { cards } })).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('keeps the default schema for initial and repair without the optional contract', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => completion({ text: '안녕.', toolReferences: [] }));
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'TEST_DOUBLE', fetchImpl });
    await provider.generateChat([]); await provider.repairChat([{ role: 'user', content: '원래 질문' }], '{}', ['JSON_REQUIRED']);
    for (const call of fetchImpl.mock.calls) expect(JSON.parse(String(call[1]!.body)).response_format.json_schema).toEqual({ name: 'jumzip_chat', strict: true, schema: CHAT_RESPONSE_SCHEMA });
  });
  it('continues rejecting length-truncated evidence responses without relaxing the 900-token cap', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion(valid(), 'length'));
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'TEST_DOUBLE', fetchImpl });
    await expect(provider.generateChat([], 'TAROT_EVIDENCE_V1')).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body)).max_tokens).toBe(900);
  });
  it('still bounds streamed Tarot bytes and never waits on malicious stream cancellation', async () => {
    let pulls = 0;
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(64_001)); }, cancel }, { highWaterMark: 0 }));
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'TEST_DOUBLE', fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response) });
    await expect(provider.generateChat([], 'TAROT_EVIDENCE_V1')).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
    expect(pulls).toBe(2); expect(cancel).toHaveBeenCalledOnce();
  });
  it('still times out a hanging Tarot body and aborts/cancels without waiting', async () => {
    vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => {}));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ cancel })));
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'TEST_DOUBLE', fetchImpl, initialTimeoutMs: 50 });
    const assertion = expect(provider.generateChat([], 'TAROT_EVIDENCE_V1')).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(51); await assertion;
    expect(cancel).toHaveBeenCalledOnce(); expect(fetchImpl.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });
});
