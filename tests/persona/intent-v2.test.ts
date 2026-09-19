import { describe, expect, it, vi } from 'vitest';
import { extractToolRecommendation, INTENT_PROMPT_VERSION, INTENT_RESPONSE_SCHEMA, type IntentInput } from '../../supabase/functions/_shared/llm/intent.ts';
import { createOpenAICompatibleProvider, type LLMProvider, type StructuredRequest } from '../../supabase/functions/_shared/llm/provider.ts';

// These are contract/flow tests using supplied classifier outputs. They do not
// claim that a live model will classify the Korean contrast sentences correctly.
const recall = '내가 오래 즐겨 온 취미가 무엇이었는지 기억하고 있으면 말해 줘.';
const input = (currentMessage = recall, extra: Partial<IntentInput> = {}): IntentInput => ({ currentMessage, hasOwnBirthData: false, hasPartnerBirthData: false, ...extra });
const output = (currentMessage = recall, extra: Record<string, unknown> = {}) => ({
  requestPurpose: 'RECALL', intentEvidenceQuote: currentMessage,
  intent: 'general_concern', explicitTool: null, explicitToolQuote: null,
  targetPersonPresent: false, recentSituationPresent: false, periodPresent: false, choicesPresent: false, highStakes: false,
  ...extra,
});
function classifier(value: unknown) {
  const requests: StructuredRequest<unknown>[] = [];
  const validated: unknown[] = [];
  const errors: unknown[] = [];
  const provider: LLMProvider = { generateChat: vi.fn(), repairChat: vi.fn(),
    async generateStructured<T>(request: StructuredRequest<T>): Promise<T> {
      requests.push(request);
      try { const result = request.validate(value); validated.push(result); return result; }
      catch (error) { errors.push(error); throw error; }
    },
  };
  return { provider, requests, validated, errors };
}
const completion = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }));

describe('Intent v2 purpose and current utterance evidence', () => {
  it('versions the internal structured contract while retaining the public recommendation shape', async () => {
    expect(INTENT_PROMPT_VERSION).toBe('JumZipIntent-v2');
    expect(INTENT_RESPONSE_SCHEMA).toMatchObject({ additionalProperties: false, required: expect.arrayContaining(['requestPurpose', 'intentEvidenceQuote']) });
    const source = classifier(output());
    expect(await extractToolRecommendation(source.provider, input())).toBeNull();
    expect(source.requests[0]?.name).toBe('jumzip_intent_v2');
    expect(source.validated).toHaveLength(1);
    expect(source.errors).toHaveLength(0);
    const payload = JSON.parse(source.requests[0]!.messages[1]!.content);
    expect(Object.keys(payload).sort()).toEqual(['currentMessage', 'recentMessages', 'hasOwnBirthData', 'hasPartnerBirthData'].sort());
  });

  it.each([false, true])('birth availability=%s and old assistant suggestions never override a validated recall purpose', async hasOwnBirthData => {
    // Even a conflicting broad natal topic must not escape the purpose gate.
    const source = classifier(output(recall, { intent: 'natal_character' }));
    expect(await extractToolRecommendation(source.provider, input(recall, { hasOwnBirthData, recentMessages: [{ role: 'assistant', content: '타고난 성향을 사주로 살펴볼 수도 있어.' }] }))).toBeNull();
    expect(source.validated).toHaveLength(1);
    expect(source.errors).toHaveLength(0);
  });

  it.each([
    ['MEMORY_CONTROL', '종이별을 좋아한다는 얘기는 이제 기억하지 마.'],
    ['MEMORY_CONTROL', '전에 저장한 취미를 그림 그리기로 정정해 줘.'],
    ['PREFERENCE_SHARING', '나는 요즘 조용히 종이별 접는 시간이 제일 좋아.'],
    ['GENERAL_CHAT', '그냥 편하게 오늘 얘기를 나누고 싶어.'],
  ])('validated %s remains a successful no-tool result', async (requestPurpose, currentMessage) => {
    const source = classifier(output(currentMessage, { requestPurpose }));
    expect(await extractToolRecommendation(source.provider, input(currentMessage))).toBeNull();
    expect(source.validated).toHaveLength(1);
    expect(source.provider.generateChat).not.toHaveBeenCalled();
    expect(source.provider.repairChat).not.toHaveBeenCalled();
  });

  it('allows a genuine natal-purpose classification without requiring an explicit tool word', async () => {
    const currentMessage = '내가 타고난 기질이나 성향을 이해하고 싶어.';
    const source = classifier(output(currentMessage, { requestPurpose: 'FORTUNE_EXPLORATION', intent: 'natal_character' }));
    expect(await extractToolRecommendation(source.provider, input(currentMessage))).toEqual({ recommendedTools: [expect.objectContaining({ tool: 'SAJU', mode: 'NATAL', missingSlots: ['ownBirthData'] })] });
  });

  it.each([
    { currentMessage: '내 취미 기억해? 이번 주 모임에서 먼저 인사할지 타로로도 보고 싶어.', requestPurpose: 'RECALL', intent: 'career_decision', quote: '타로로도 보고 싶어', mode: 'DECISION_3' },
    { currentMessage: '그 사람이 나를 기억하는지 타로로 보고 싶어.', requestPurpose: 'FORTUNE_EXPLORATION', intent: 'target_feelings', quote: '타로로 보고 싶어', mode: 'RELATIONSHIP_3' },
    { currentMessage: '그 얘기는 기억하지 말고, 오늘 운세는 타로로 보고 싶어.', requestPurpose: 'MEMORY_CONTROL', intent: 'daily_fortune', quote: '타로로 보고 싶어', mode: 'DAILY' },
  ])('honors the current positive tool request: $currentMessage', async ({ currentMessage, requestPurpose, intent, quote, mode }) => {
    const source = classifier(output(currentMessage, { requestPurpose, intentEvidenceQuote: quote, intent, explicitTool: 'TAROT', explicitToolQuote: quote }));
    expect((await extractToolRecommendation(source.provider, input(currentMessage)))?.recommendedTools[0]).toMatchObject({ tool: 'TAROT', mode });
    expect(source.validated).toHaveLength(1);
  });

  it('retains the trusted current UI selection even alongside a recall classification', async () => {
    const source = classifier(output());
    expect((await extractToolRecommendation(source.provider, input(recall, { explicitTool: 'TAROT' })))?.recommendedTools[0]).toMatchObject({ tool: 'TAROT', mode: 'GENERAL_3' });
  });

  it('does not promote a denied tool or a previous assistant request to explicit current intent', async () => {
    const currentMessage = '사주는 보지 말고 내가 말한 취미만 기억해서 답해 줘.';
    const denied = classifier(output(currentMessage, { explicitTool: 'SAJU', explicitToolQuote: '사주는 보지 말고' }));
    expect(await extractToolRecommendation(denied.provider, input(currentMessage))).toBeNull();
    expect(denied.errors).toHaveLength(1);
    expect(denied.validated).toHaveLength(0);
    const previousOnly = classifier(output(recall, { explicitTool: 'SAJU', explicitToolQuote: '사주로 봐줘' }));
    expect(await extractToolRecommendation(previousOnly.provider, input(recall, { recentMessages: [{ role: 'assistant', content: '사주로 봐줘' }] }))).toBeNull();
    expect(previousOnly.errors).toHaveLength(1);
  });

  it.each([
    ['unknown purpose', { requestPurpose: 'PERSONALITY' }],
    ['wrong purpose type', { requestPurpose: 1 }],
    ['invented quote', { intentEvidenceQuote: '선천적 기질을 사주로 알고 싶어.' }],
    ['old-context quote', { intentEvidenceQuote: '타고난 성향을 사주로 살펴볼 수도 있어.' }],
    ['empty quote', { intentEvidenceQuote: '' }],
    ['whitespace quote', { intentEvidenceQuote: ' ' }],
    ['nullable quote', { intentEvidenceQuote: null }],
    ['too-long quote', { intentEvidenceQuote: '가'.repeat(201) }],
    ['extra action', { deleteMemory: true }],
    ['invalid intent', { intent: 'recall' }],
    ['invalid slot', { periodPresent: 'false' }],
  ])('rejects %s rather than counting failure as successful NONE', async (_label, patch) => {
    const source = classifier(output(recall, patch));
    expect(await extractToolRecommendation(source.provider, input(recall, { recentMessages: [{ role: 'assistant', content: '타고난 성향을 사주로 살펴볼 수도 있어.' }] }))).toBeNull();
    expect(source.validated).toHaveLength(0);
    expect(source.errors).toHaveLength(1);
  });

  it('rejects the old eight-field schema and preserves the one-repair limit', async () => {
    const old = output(); delete (old as Partial<typeof old>).requestPurpose; delete (old as Partial<typeof old>).intentEvidenceQuote;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(completion(old)).mockResolvedValueOnce(completion(output()));
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'test', structuredFormat: 'json_object', fetchImpl });
    const successful: unknown[] = [];
    const wrapped: LLMProvider = { ...provider, async generateStructured<T>(request: StructuredRequest<T>) { const result = await provider.generateStructured(request); successful.push(result); return result; } };
    expect(await extractToolRecommendation(wrapped, input())).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(successful).toHaveLength(1);
    for (const call of fetchImpl.mock.calls) {
      const body = JSON.parse(call[1]!.body as string);
      expect(body.temperature).toBe(0.1);
      expect(JSON.stringify(body.messages)).toContain('intentEvidenceQuote');
    }
    const brokenFetch = vi.fn<typeof fetch>().mockImplementation(async () => completion(old));
    const broken = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'test', fetchImpl: brokenFetch });
    expect(await extractToolRecommendation(broken, input())).toBeNull();
    expect(brokenFetch).toHaveBeenCalledTimes(2);
  });

  it('validates purpose evidence against the minimized current text, never hidden birth values', async () => {
    const currentMessage = '생년월일은 1992-10-24이고 출생도시는 서울이야.\n전에 말한 내 취미를 기억해?';
    const source = classifier(output(currentMessage, { intentEvidenceQuote: '1992-10-24' }));
    expect(await extractToolRecommendation(source.provider, input(currentMessage))).toBeNull();
    expect(source.errors).toHaveLength(1);
    expect(JSON.stringify(source.requests[0]!.messages)).not.toMatch(/1992-10-24|서울/);
  });
});
