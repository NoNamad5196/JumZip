import { describe, expect, it, vi } from 'vitest';
import { extractToolRecommendation, sanitizeIntentText, type IntentInput } from '../../supabase/functions/_shared/llm/intent.ts';
import { createOpenAICompatibleProvider, type LLMProvider, type StructuredRequest } from '../../supabase/functions/_shared/llm/provider.ts';
import type { Intent } from '../../supabase/functions/_shared/domain/router.ts';

const output = (intent: Intent, extra: Record<string, unknown> = {}) => ({
  intent, explicitTool: null, explicitToolQuote: null,
  targetPersonPresent: false, recentSituationPresent: false, periodPresent: false, choicesPresent: false, highStakes: false, ...extra,
});
const input = (extra: Partial<IntentInput> = {}): IntentInput => ({ currentMessage: '우리 관계가 궁금해.', hasOwnBirthData: false, hasPartnerBirthData: false, ...extra });
function testProvider(value: unknown): LLMProvider & { requests: StructuredRequest<unknown>[] } {
  const requests: StructuredRequest<unknown>[] = [];
  return { requests, generateChat: vi.fn(), repairChat: vi.fn(),
    async generateStructured<T>(request: StructuredRequest<T>): Promise<T> { requests.push(request); return request.validate(value); },
  };
}
const completion = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }));

describe('M11 structured intent → deterministic recommendation matrix', () => {
  it.each<[Intent, string, string]>([
    ['target_feelings', 'TAROT', 'RELATIONSHIP_3'], ['relationship_flow', 'TAROT', 'RELATIONSHIP_3'],
    ['daily_fortune', 'TAROT', 'DAILY'], ['career_decision', 'TAROT', 'DECISION_3'],
    ['yearly_flow', 'SAJU', 'SEWOON'], ['monthly_flow', 'SAJU', 'MONTHLY'], ['natal_character', 'SAJU', 'NATAL'],
    ['long_term_compatibility', 'COMPATIBILITY', 'SAJU'],
  ])('%s returns canonical %s/%s without executing it', async (intent, tool, mode) => {
    const provider = testProvider(output(intent));
    const result = await extractToolRecommendation(provider, input());
    expect(result?.recommendedTools[0]).toMatchObject({ tool, mode });
    expect(provider.generateChat).not.toHaveBeenCalled(); expect(provider.repairChat).not.toHaveBeenCalled();
  });

  it.each<Intent>(['small_talk', 'general_concern'])('%s does not force even an optional tool', async intent => {
    expect(await extractToolRecommendation(testProvider(output(intent)), input())).toBeNull();
  });

  it('uses server birth availability and offers Tarot compatibility when partner data is missing', async () => {
    const result = await extractToolRecommendation(testProvider(output('long_term_compatibility', { targetPersonPresent: true, recentSituationPresent: true })), input({ hasOwnBirthData: true }));
    expect(result?.recommendedTools).toEqual([
      expect.objectContaining({ tool: 'COMPATIBILITY', mode: 'SAJU', missingSlots: ['partnerBirthData'] }),
      expect.objectContaining({ tool: 'COMPATIBILITY', mode: 'TAROT', missingSlots: [] }),
    ]);
    const complete = await extractToolRecommendation(testProvider(output('long_term_compatibility')), input({ hasOwnBirthData: true, hasPartnerBirthData: true }));
    expect(complete?.recommendedTools).toHaveLength(1); expect(complete?.recommendedTools[0]?.missingSlots).toEqual([]);
  });

  it('preserves validated current explicit tool priority over the inferred default', async () => {
    const provider = testProvider(output('daily_fortune', { explicitTool: 'SAJU', explicitToolQuote: '사주로 오늘 운세' }));
    const result = await extractToolRecommendation(provider, input({ currentMessage: '사주로 오늘 운세 보고 싶어.', hasOwnBirthData: true }));
    expect(result?.recommendedTools[0]).toMatchObject({ tool: 'SAJU', mode: 'DAILY', missingSlots: [] });
    const explicitUI = await extractToolRecommendation(testProvider(output('natal_character')), input({ explicitTool: 'TAROT' }));
    expect(explicitUI?.recommendedTools[0]).toMatchObject({ tool: 'TAROT', mode: 'GENERAL_3' });
  });

  it('rejects invented explicit requests, old-message evidence and a negated tool choice', async () => {
    expect(await extractToolRecommendation(testProvider(output('daily_fortune', { explicitTool: 'SAJU', explicitToolQuote: '사주로 봐줘' })), input({ currentMessage: '오늘 운세', recentMessages: [{ role: 'user', content: '사주로 봐줘' }] }))).toBeNull();
    expect(await extractToolRecommendation(testProvider(output('daily_fortune', { explicitTool: 'SAJU', explicitToolQuote: '사주' })), input({ currentMessage: '사주 말고 타로로 봐줘' }))).toBeNull();
    const tarot = await extractToolRecommendation(testProvider(output('daily_fortune', { explicitTool: 'TAROT', explicitToolQuote: '타로로 봐줘' })), input({ currentMessage: '사주 말고 타로로 봐줘' }));
    expect(tarot?.recommendedTools[0]?.tool).toBe('TAROT');
  });

  it('requests only slots the structured input did not establish', async () => {
    const relation = await extractToolRecommendation(testProvider(output('target_feelings', { targetPersonPresent: true })), input());
    expect(relation?.recommendedTools[0]?.missingSlots).toEqual(['recentSituation']);
    const choices = await extractToolRecommendation(testProvider(output('career_decision', { choicesPresent: true })), input());
    expect(choices?.recommendedTools[0]?.missingSlots).toEqual(['recentSituation']);
  });

  it('sends no raw birth profile and minimizes birth details in current/recent chat', async () => {
    const provider = testProvider(output('natal_character'));
    await extractToolRecommendation(provider, input({
      currentMessage: '생년월일은 1992-10-24, 출생시간 05:30, 출생도시 서울이야.\n타고난 성향이 궁금해.',
      recentMessages: [{ role: 'user', content: 'birthDate=1992-10-24; timezone=Asia/Seoul; longitude=126.978' }, { role: 'assistant', content: '성향 이야기를 이어가요.' }],
    }));
    const sent = JSON.stringify(provider.requests[0]?.messages);
    for (const forbidden of ['1992-10-24', '05:30', '서울', 'Asia/Seoul', '126.978']) expect(sent).not.toContain(forbidden);
    const payload = JSON.parse(provider.requests[0]!.messages[1]!.content);
    expect(Object.keys(payload).sort()).toEqual(['currentMessage', 'recentMessages', 'hasOwnBirthData', 'hasPartnerBirthData'].sort());
    expect(payload.currentMessage).toContain('타고난 성향');
    expect(sanitizeIntentText('1992-10-24 05:30 37.566,126.978 test@example.com')).not.toMatch(/1992|05:30|37\.566|test@example/);
  });

  it.each(['타로로 어떤 주식을 매수할지 정해 줘', '사주로 수술 날짜를 정해 줘', '타로로 소송 결과를 알려줘', '죽고 싶어 오늘 운세 볼까'])('does not suggest fortune for high-stakes request: %s', async currentMessage => {
    const provider = testProvider(output('career_decision'));
    expect(await extractToolRecommendation(provider, input({ currentMessage }))).toBeNull();
    expect(provider.requests).toHaveLength(0);
  });

  it('also respects semantic high-stakes classification for cases outside the narrow text guard', async () => {
    expect(await extractToolRecommendation(testProvider(output('career_decision', { highStakes: true })), input())).toBeNull();
  });

  it('uses the provider low-temperature structured repair once, then returns only a validated matrix result', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(completion({ intent: 'bad' })).mockResolvedValueOnce(completion(output('daily_fortune')));
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'test', fetchImpl });
    expect((await extractToolRecommendation(provider, input()))?.recommendedTools[0]).toMatchObject({ tool: 'TAROT', mode: 'DAILY' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const call of fetchImpl.mock.calls) expect(JSON.parse(call[1]!.body as string).temperature).toBe(0.1);
  });

  it('fails softly on transport, extra model keys and two invalid structured outputs', async () => {
    const broken: LLMProvider = { generateChat: vi.fn(), repairChat: vi.fn(), generateStructured: vi.fn().mockRejectedValue(new Error('upstream private details')) };
    expect(await extractToolRecommendation(broken, input())).toBeNull();
    expect(await extractToolRecommendation(testProvider(output('daily_fortune', { birthDate: '1992-10-24' })), input())).toBeNull();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => completion({ intent: 'unknown' }));
    expect(await extractToolRecommendation(createOpenAICompatibleProvider({ baseUrl: 'https://example.test', model: 'test', fetchImpl }), input())).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
