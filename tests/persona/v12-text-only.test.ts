import { describe, expect, it, vi } from 'vitest';
import { CHAT_RESPONSE_SCHEMA, TAROT_EVIDENCE_RESPONSE_SCHEMA, TEXT_ONLY_RESPONSE_SCHEMA, getChatResponseDefinition, selectChatResponseContract } from '../../supabase/functions/_shared/llm/chat-contract.ts';
import { createOpenAICompatibleProvider } from '../../supabase/functions/_shared/llm/provider.ts';
import { generatePersonaReply } from '../../supabase/functions/_shared/llm/reply.ts';
import { validateChatOutput } from '../../supabase/functions/_shared/llm/validator.ts';
import { buildPersonaMessages } from '../../supabase/functions/_shared/persona/prompt.ts';
import { drawTarot, buildTarotInterpretationData } from '../../supabase/functions/_shared/domain/tarot.ts';

const input = { characterId: 'SANI' as const, currentMessage: '오늘 재미있는 일이 있었어.' };
const textOnly = { ...input, contract: 'TEXT_ONLY_V1' as const };
const completion = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: 'stop' }] }));
const provider = (fetchImpl: typeof fetch) => createOpenAICompatibleProvider({ baseUrl: 'https://synthetic.example/v1', model: 'test-double', structuredFormat: 'json_object', fetchImpl });

describe('v12 explicitly selected no-tool text-only contract', () => {
  it('selects text-only exclusively for null/undefined, never user prose or falsey tool snapshots', () => {
    expect(selectChatResponseContract(null)).toBe('TEXT_ONLY_V1'); expect(selectChatResponseContract(undefined)).toBe('TEXT_ONLY_V1');
    for (const value of [false, 0, '', 'TEXT_ONLY_V1', {}, { cards: [] }, { kind: 'SAJU' }, { kind: 'SAJU_COMPATIBILITY' }]) expect(selectChatResponseContract(value)).toBe('DEFAULT');
    expect(selectChatResponseContract({ cards: [{}] })).toBe('TAROT_EVIDENCE_V1');
    expect(getChatResponseDefinition()).toEqual({ schema: CHAT_RESPONSE_SCHEMA, name: 'jumzip_chat' });
    expect(getChatResponseDefinition('TAROT_EVIDENCE_V1').schema).toBe(TAROT_EVIDENCE_RESPONSE_SCHEMA);
    expect(getChatResponseDefinition('TEXT_ONLY_V1').schema).toEqual({ type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 6000 } } });
  });
  it('accepts only the newly declared shape and creates internal empty references without relaxing DEFAULT', () => {
    expect(validateChatOutput('{"text":"어떤 일이었어?"}', textOnly)).toEqual({ ok: true, value: { text: '어떤 일이었어?', toolReferences: [] } });
    expect(validateChatOutput('{"text":"어떤 일이었어?"}', input)).toMatchObject({ ok: false, issues: ['RESPONSE_SCHEMA_INVALID'] });
    for (const value of [{ text: '말해 줘.', toolReferences: [] }, { text: '말해 줘.', interpretationEvidence: [] }, { text: '' }, { text: 1 }, { text: ' '.repeat(8) }, { text: '가'.repeat(6001) }]) expect(validateChatOutput(JSON.stringify(value), textOnly).ok).toBe(false);
    expect(validateChatOutput('{"text":"말해 줘."}', { ...textOnly, toolResult: { kind: 'SAJU' } })).toMatchObject({ ok: false, issues: ['RESPONSE_CONTRACT_MISMATCH'] });
  });
  it.each([
    ['<think>PRIVATE</think>', 'MODEL_CONTROL_TEXT'], ['나는 AI야.', 'PERSONA_BREAK'], ['무조건 성공한다.', 'FORBIDDEN_CERTAINTY_OR_DEPENDENCY'],
  ])('keeps semantic safety validation for text-only: %s', (text, issue) => {
    expect(validateChatOutput(JSON.stringify({ text }), textOnly)).toMatchObject({ ok: false, issues: [issue] });
  });
  it('keeps BOMI relationship boundaries and stored-tool checks intact', () => {
    expect(validateChatOutput('{"text":"나랑 사귀자."}', { ...textOnly, characterId: 'BOMI' })).toMatchObject({ ok: false, issues: ['BOMI_RELATIONSHIP_BOUNDARY'] });
    const cards = drawTarot('ONE_CARD', () => 0);
    expect(validateChatOutput('{"text":"카드를 보자."}', { ...textOnly, expectedCards: cards })).toMatchObject({ ok: false, issues: ['RESPONSE_CONTRACT_MISMATCH'] });
    expect(validateChatOutput(JSON.stringify({ text: '강약 점수는 99야.', toolReferences: [] }), { ...input, contract: 'DEFAULT', toolResult: { kind: 'SAJU', strength: { score: 50 } } })).toMatchObject({ ok: false, issues: ['TOOL_SCORE_CHANGED'] });
  });
  it('uses the text-only schema/prompt and returns the existing public reply fields on one request', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion({ text: '어떤 일이었어? 좀 궁금한데.' }));
    const reply = await generatePersonaReply(provider(fetchImpl), input);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    expect(body.messages[0].content).toContain(JSON.stringify(TEXT_ONLY_RESPONSE_SCHEMA));
    expect(body.messages.some((message: { content: string }) => message.content.includes('필수 키와 허용 키는 text 하나뿐'))).toBe(true);
    expect(reply).toMatchObject({ content: '어떤 일이었어? 좀 궁금한데.', repaired: false, metadata: { promptVersion: 'JumZipPersona-v12' } });
    expect(reply).not.toHaveProperty('toolReferences'); expect(reply).not.toHaveProperty('interpretationEvidence'); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('repairs malformed text-only output once with the same contract and byte-identical original final user', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(completion('not JSON')).mockResolvedValueOnce(completion({ text: '재밌었겠다. 무슨 일이었어?' }));
    const reply = await generatePersonaReply(provider(fetchImpl), input);
    expect(reply.repaired).toBe(true); expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [initial, repaired] = fetchImpl.mock.calls.map(call => JSON.parse(String(call[1]!.body)));
    expect(repaired.messages.at(-1)).toEqual(initial.messages.at(-1));
    expect(repaired.messages[0].content).toContain(JSON.stringify(TEXT_ONLY_RESPONSE_SCHEMA));
    expect(repaired.messages.at(-2)).toEqual({ role: 'assistant', content: 'not JSON' });
  });
  it('does not convert legacy missing refs into success: DEFAULT still repairs/rejects missing refs', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => completion({ text: '자료를 살펴보자.' }));
    await expect(generatePersonaReply(provider(fetchImpl), { ...input, toolResult: { kind: 'SAJU' } })).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE', diagnostic: { stage: 'VALIDATION', issues: ['RESPONSE_SCHEMA_INVALID'], attempts: 2 } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('keeps Saju DEFAULT and Tarot evidence prompt/schema selection unchanged', async () => {
    const saju = { ...input, toolResult: { kind: 'SAJU', strength: { score: 50 } } };
    expect(buildPersonaMessages(saju)[0]!.content).toContain('"toolReferences":[]');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion({ text: '강약 점수는 50이야.', toolReferences: [] }));
    expect((await generatePersonaReply(provider(fetchImpl), saju)).content).toContain('50');
    const cards = drawTarot('ONE_CARD', () => 0);
    const tarot = { ...input, toolResult: { cards: buildTarotInterpretationData(cards) } };
    expect(buildPersonaMessages(tarot)[0]!.content).toContain('필수 키는 text, toolReferences, interpretationEvidence');
  });
});
