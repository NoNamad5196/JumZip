import { describe, expect, it, vi } from 'vitest';
import { buildPersonaMessages } from '../../supabase/functions/_shared/persona/prompt.ts';
import { createOpenAICompatibleProvider } from '../../supabase/functions/_shared/llm/provider.ts';
import { generatePersonaReply } from '../../supabase/functions/_shared/llm/reply.ts';
import { validateChatOutput } from '../../supabase/functions/_shared/llm/validator.ts';

const raw = (text: string) => JSON.stringify({ text, toolReferences: [] });
const completion = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: raw(text) }, finish_reason: 'stop' }] }));
describe('regressions from the preserved real v1 baseline', () => {
  it('never places fictional style exchanges into actual user/assistant history', () => {
    for (const characterId of ['BOMI', 'SANI', 'ARANG'] as const) {
      const messages = buildPersonaMessages({ characterId, currentMessage: '오늘 빵은 지켰다.', recentMessages: [{ role: 'user', content: '실제 앞선 질문' }, { role: 'assistant', content: '실제 앞선 답변' }] });
      expect(messages.filter(message => message.role === 'assistant')).toEqual([{ role: 'assistant', content: '실제 앞선 답변' }]);
      const facts = messages.filter(message => message.role !== 'system').map(message => message.content).join('\n');
      expect(facts).not.toContain('A 회사랑 B 회사'); expect(facts).not.toContain('오늘 필요한 조언으로 한 장 뽑아보자');
      expect(facts).toContain('"toolResult":null'); expect(messages.at(-1)!.content).toBe('오늘 빵은 지켰다.');
    }
  });
  it('keeps named relationship facts in the real context without turning examples into facts', () => {
    const summary = '민수는 아직 말하지 않은 동아리 친구다. 지수와 발표 주제에 합의했다.';
    const messages = buildPersonaMessages({ characterId: 'SANI', currentMessage: '민수에게 말을 걸고 싶어.', summary });
    expect(messages.filter(message => message.role === 'assistant')).toEqual([]);
    expect(messages.find(message => message.content.startsWith('actualConversationContext:'))!.content).toContain(summary);
  });
  it('rejects the actual fabricated65% claims and bare-score evasion in a probability request', () => {
    const options = { characterId: 'BOMI' as const, toolResult: { kind: 'SAJU_COMPATIBILITY' }, currentMessage: '결혼 성공 확률을 숫자 하나로 말해 줘.' };
    for (const text of ['65% 정도야. 하지만 참고용이야.', '궁합은 약65% 수준이라고 볼 수 있어요.', '65 정도야. 실제 관계는 더 복잡해.']) {
      expect(validateChatOutput(raw(text), options)).toMatchObject({ ok: false, issues: expect.arrayContaining(['UNSUPPORTED_PROBABILITY']) });
    }
    expect(validateChatOutput(raw('0에서100%로 환산할 수 없어. 자료에는 확률이 없어.'), options).ok).toBe(true);
    expect(validateChatOutput(raw('두 사람의 일간은 같지만 성공 확률은 제공되지 않아.'), options).ok).toBe(true);
    expect(validateChatOutput(raw('목 비중은50%야.'), { ...options, currentMessage: '오행 비중을 설명해 줘.' }).ok).toBe(true);
  });
  it('rejects changed strength and a score range excluding an actual boundary candidate', () => {
    const options = { characterId: 'SANI' as const, toolResult: { kind: 'SAJU', strength: { score: null }, possible_values: { score: [37, 58, 32] } } };
    expect(validateChatOutput(raw('점수는37~58 사이야.'), options)).toMatchObject({ ok: false, issues: expect.arrayContaining(['TOOL_SCORE_POSSIBILITIES_CHANGED']) });
    expect(validateChatOutput(raw('점수는80이야.'), options)).toMatchObject({ ok: false, issues: expect.arrayContaining(['TOOL_SCORE_CHANGED']) });
    expect(validateChatOutput(raw('점수는32,37,58 중 하나이고 아직 확정되지 않았어.'), options).ok).toBe(true);
    expect(validateChatOutput(raw('강약 점수83이야.'), { ...options, toolResult: { kind: 'SAJU', strength: { score: 83 } } }).ok).toBe(true);
  });
  it('runs the same grounding guard after the one permitted repair without a canned reply', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => completion('결혼 확률은65%야.'));
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'fixture', fetchImpl });
    await expect(generatePersonaReply(provider, { characterId: 'ARANG', currentMessage: '결혼 확률을 알려줘.', toolResult: { kind: 'SAJU_COMPATIBILITY' } })).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('uses only the documented Qwen soft switch, leaving strict length acceptance in place', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion('오늘 어떤 일이 있었어?'));
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: '@cf/qwen/qwen3-30b-a3b-fp8', fetchImpl });
    await provider.generateChat([{ role: 'user', content: '안녕' }]);
    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(body.messages[0]).toMatchObject({ role: 'system', content: expect.stringContaining('/no_think') });
    expect(body).not.toHaveProperty('enable_thinking'); expect(body).not.toHaveProperty('reasoning_effort'); expect(body.max_tokens).toBe(900);
    fetchImpl.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: null }, finish_reason: 'length' }] })));
    await expect(provider.generateChat([{ role: 'user', content: '안녕' }])).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
  });
});
