import { describe, expect, it, vi } from 'vitest';
import { TAROT_MEANINGS, type TarotCard } from '../../supabase/functions/_shared/domain/tarot.ts';
import { CHAT_RESPONSE_SCHEMA, TAROT_EVIDENCE_RESPONSE_SCHEMA } from '../../supabase/functions/_shared/llm/chat-contract.ts';
import { createOpenAICompatibleProvider } from '../../supabase/functions/_shared/llm/provider.ts';
import { generatePersonaReply } from '../../supabase/functions/_shared/llm/reply.ts';
import { validateChatOutput } from '../../supabase/functions/_shared/llm/validator.ts';

const card: TarotCard = { cardId: 17, orientation: 'UPRIGHT', positionIndex: 0, positionKey: 'MESSAGE' };
const keywords = TAROT_MEANINGS.find(item => item.id === card.cardId)!.upright;
const refs = [{ cardId: card.cardId, orientation: card.orientation, positionIndex: card.positionIndex }];
const span = `${keywords[0]} 그리고 ${keywords[1]}`;
const valid = () => ({ text: `이 카드의 상징은 ${span}야. 지금 네가 원하는 작은 행동을 골라 보자.`, toolReferences: refs,
  interpretationEvidence: [{ positionIndex: 0, keywordIndices: [0, 1], textEvidence: span }] });
const invalid = () => ({ ...valid(), interpretationEvidence: [{ positionIndex: 0, keywordIndices: [0, 1], textEvidence: `${keywords[0]}, ${keywords[1]}` }] });
const completion = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }], model: 'TEST_DOUBLE' }));
const setup = () => {
  const fetchImpl = vi.fn<typeof fetch>();
  const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'TEST_DOUBLE', structuredFormat: 'json_object', fetchImpl });
  return { fetchImpl, provider };
};
const bodyAt = (fetchImpl: ReturnType<typeof setup>['fetchImpl'], index: number) => JSON.parse(String(fetchImpl.mock.calls[index]![1]!.body));
const repairUser = [{ role: 'user' as const, content: '원래 요청을 처리해 줘.' }];
const feedbackOf = (body: { messages: { role: string; content: string }[] }) => body.messages.find(message => message.role === 'system' && message.content.includes('응답 검증에 실패했습니다.'))!.content;
const genericRepair = (issues: string[]) => `응답 검증에 실패했습니다. 원래 마지막 사용자 요청에 대한 응답을 수리하세요. 수리 안내 자체를 새 사용자 질문이나 대화 자료로 해석하지 않습니다. JSON Schema와 실제 도구 자료를 다시 대조해 JSON 객체 하나를 출력하세요. requiredToolReferences가 있으면 그대로 복사하고, 미확정 값과 가능한 점수 전체를 유지하세요. 시스템의 캐릭터와 원본 도구 결과를 변경하지 않습니다. 오류: ${JSON.stringify(issues)}`;

describe('v9 Tarot-only repair feedback without validation relaxation', () => {
  it('points to a noncontiguous quote, preserves the invalid output, and accepts only the actual valid repair', async () => {
    const { fetchImpl, provider } = setup();
    fetchImpl.mockResolvedValueOnce(completion(invalid())).mockResolvedValueOnce(completion(valid()));
    const output = await generatePersonaReply(provider, { characterId: 'SANI', currentMessage: '이 카드 하나를 설명해 줘.', toolResult: { cards: [card] } });
    expect(output.repaired).toBe(true); expect(output.content).toBe(valid().text);
    expect(output.metadata.promptVersion).toBe('JumZipPersona-v11');
    expect(JSON.stringify(output)).not.toContain('interpretationEvidence');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const initial = bodyAt(fetchImpl, 0), repair = bodyAt(fetchImpl, 1);
    for (const body of [initial, repair]) {
      expect(body.max_tokens).toBe(900);
      expect(body.messages[0].content).toContain(JSON.stringify(TAROT_EVIDENCE_RESPONSE_SCHEMA));
    }
    expect([initial.temperature, repair.temperature]).toEqual([0.65, 0.15]);
    expect(repair.messages.at(-2)).toEqual({ role: 'assistant', content: JSON.stringify(invalid()) });
    const feedback = feedbackOf(repair);
    expect(feedback).toContain('"path":"/interpretationEvidence/0/textEvidence","reason":"NOT_A_CONTIGUOUS_SUBSTRING_OF_TEXT"');
    expect(feedback).toContain('떨어진 단어를 쉼표로 합치거나');
    expect(feedback).toContain('카드 위치당 interpretationEvidence 항목은 하나');
    expect(feedback).not.toContain(span); // The server does not fabricate the replacement quote.
    expect(repair.messages.filter((item: { content: string }) => item.content === '이 카드 하나를 설명해 줘.')).toHaveLength(2);
  });
  it('diagnoses oversized evidence and duplicate positions even when the validator stops at array shape', async () => {
    const { fetchImpl, provider } = setup(); fetchImpl.mockResolvedValue(completion(valid()));
    const output = { ...valid(), interpretationEvidence: Array.from({ length: 5 }, () => valid().interpretationEvidence[0]) };
    await provider.repairChat(repairUser, JSON.stringify(output), ['TAROT_EVIDENCE_SHAPE_INVALID'], 'TAROT_EVIDENCE_V1');
    const feedback = feedbackOf(bodyAt(fetchImpl, 0));
    expect(feedback).toContain('"path":"/interpretationEvidence","reason":"AT_MOST_THREE_ROWS"');
    expect(feedback).toContain('"path":"/interpretationEvidence/1/positionIndex","reason":"DUPLICATE_CARD_POSITION"');
    expect(feedback).toContain('"path":"/interpretationEvidence/4/positionIndex","reason":"DUPLICATE_CARD_POSITION"');
  });
  it('still fails repeated invalid spans after exactly one repair without creating evidence', async () => {
    const { fetchImpl, provider } = setup(); fetchImpl.mockImplementation(async () => completion(invalid()));
    await expect(generatePersonaReply(provider, { characterId: 'SANI', currentMessage: '설명해 줘.', toolResult: { cards: [card] } })).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('keeps Chat/Saju on generic system repair guidance, even if issue strings mention Tarot', async () => {
    const { fetchImpl, provider } = setup(); fetchImpl.mockImplementation(async () => completion({ text: '안녕.', toolReferences: [] }));
    const issues = ['TAROT_EVIDENCE_REQUIRED'];
    await provider.repairChat(repairUser, '{}', issues);
    await provider.repairChat(repairUser, '{}', issues, 'DEFAULT');
    for (const index of [0, 1]) {
      const body = bodyAt(fetchImpl, index);
      expect(feedbackOf(body)).toBe(genericRepair(issues));
      expect(body.messages.at(-1)).toEqual(repairUser[0]);
      expect(body.messages[0].content).toContain(JSON.stringify(CHAT_RESPONSE_SCHEMA));
    }
  });
  it('keeps structured Intent/Memory repair generic and schema-specific', async () => {
    const { fetchImpl, provider } = setup();
    const schema = { type: 'object', required: ['flag'], properties: { flag: { type: 'boolean' } } };
    fetchImpl.mockResolvedValueOnce(completion({})).mockResolvedValueOnce(completion({ flag: true }));
    const result = await provider.generateStructured({ messages: repairUser, schema, validate(value: unknown) {
      if (!value || typeof value !== 'object' || !('flag' in value) || value.flag !== true) throw Error('INVALID'); return value;
    } });
    expect(result).toEqual({ flag: true }); expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(feedbackOf(bodyAt(fetchImpl, 1))).toBe(genericRepair(['STRUCTURED_VALIDATION_FAILED']));
    expect(bodyAt(fetchImpl, 1).messages.at(-1)).toEqual(repairUser[0]);
    for (const index of [0, 1]) { expect(bodyAt(fetchImpl, index).temperature).toBe(0.1); expect(bodyAt(fetchImpl, index).messages[0].content).toContain(JSON.stringify(schema)); }
  });
  it('bounds diagnostics and emits fixed paths/reasons, never arbitrary values from invalid fields', async () => {
    const { fetchImpl, provider } = setup(); fetchImpl.mockResolvedValue(completion(valid()));
    const privateCanary = 'PRIVATE_INVALID_FIELD_CANARY';
    await provider.repairChat(repairUser, JSON.stringify({ text: privateCanary, interpretationEvidence: Array.from({ length: 500 }, () => ({ positionIndex: privateCanary, keywordIndices: [privateCanary], textEvidence: 'absent' })) }), ['TAROT_EVIDENCE_SHAPE_INVALID'], 'TAROT_EVIDENCE_V1');
    const feedback = feedbackOf(bodyAt(fetchImpl, 0));
    expect(feedback).not.toContain(privateCanary);
    const diagnostics = JSON.parse(feedback.slice(feedback.lastIndexOf('아래 경로는 진단 안내이며 정답이나 대체 근거가 아닙니다: ') + '아래 경로는 진단 안내이며 정답이나 대체 근거가 아닙니다: '.length));
    expect(diagnostics).toHaveLength(16);
    expect(diagnostics.every((item: { path: string; reason: string }) => item.path.startsWith('/interpretationEvidence') && /^[A-Z_]+$/.test(item.reason))).toBe(true);
  });
  it.each(['not-json', '{}', '{"interpretationEvidence":[null]}'])('handles malformed prior output safely: %s', async prior => {
    const { fetchImpl, provider } = setup(); fetchImpl.mockResolvedValue(completion(valid()));
    await provider.repairChat(repairUser, prior, ['TAROT_EVIDENCE_SHAPE_INVALID'], 'TAROT_EVIDENCE_V1');
    expect(feedbackOf(bodyAt(fetchImpl, 0))).toContain('타로 근거 수리 안내');
    expect(bodyAt(fetchImpl, 0).messages.at(-2).content).toBe(prior);
  });
  it('does not require all cards, and does not claim lexical provenance proves meaning', () => {
    const empty = { text: '다른 이야기부터 해 보자.', toolReferences: refs, interpretationEvidence: [] };
    expect(validateChatOutput(JSON.stringify(empty), { characterId: 'SANI', expectedCards: [card] }).ok).toBe(true);
    // Wrong-cause counterexample deliberately remains a structural pass and a qualitative Hard Fail.
    const hermit: TarotCard = { cardId: 9, orientation: 'REVERSED', positionIndex: 1, positionKey: 'THEIR_ATTITUDE' };
    const wrongCause = '상대는 혼자만의 시간이 필요하거나 회피하는 모습이야.';
    const candidate = { text: wrongCause, toolReferences: [{ cardId: 9, orientation: 'REVERSED', positionIndex: 1 }], interpretationEvidence: [{ positionIndex: 1, keywordIndices: [1], textEvidence: wrongCause }] };
    expect(validateChatOutput(JSON.stringify(candidate), { characterId: 'SANI', expectedCards: [hermit] }).ok).toBe(true);
  });
});
