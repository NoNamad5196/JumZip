import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractToolRecommendation } from '../../supabase/functions/_shared/llm/intent.ts';
import { createOpenAICompatibleProvider, type LLMProvider, type StructuredRequest } from '../../supabase/functions/_shared/llm/provider.ts';
import { generatePersonaReply } from '../../supabase/functions/_shared/llm/reply.ts';
import { createTitleMaintenance } from '../../supabase/functions/_shared/orchestration/titles.ts';
import { extractMemoryCandidates, summarizeConversation } from '../../supabase/functions/_shared/persona/memory.ts';
import type { LLMMessage } from '../../supabase/functions/_shared/persona/prompt.ts';
import { INTENT_V4_CONTRAST_CASES } from './intent-v4-corpus.ts';

// Offline contract tests: supplied outputs are TEST_DOUBLE responses. They do not
// establish that a live model understands the replayed target more accurately.
interface Body { messages: LLMMessage[]; max_tokens: number; temperature: number; response_format: unknown }
const rawOutput = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
function setup(values: unknown[], maxOutputTokens = 350) {
  const bodies: Body[] = [];
  const captured: { messages: readonly LLMMessage[]; before: string }[] = [];
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    const index = bodies.length;
    bodies.push(JSON.parse(String(init?.body)) as Body);
    if (index >= values.length) throw Error('UNEXPECTED_EXTRA_ATTEMPT');
    return new Response(JSON.stringify({ choices: [{ message: { content: rawOutput(values[index]) }, finish_reason: 'stop' }], model: 'TEST_DOUBLE' }));
  });
  const base = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'TEST_DOUBLE', structuredFormat: 'json_object', initialTimeoutMs: 8000, repairTimeoutMs: 3000, maxOutputTokens, fetchImpl });
  let validated = 0;
  const capture = (messages: readonly LLMMessage[]) => {
    captured.push({ messages, before: JSON.stringify(messages) });
    freeze(messages);
  };
  const provider: LLMProvider = {
    ...base,
    async generateChat(messages, contract) { capture(messages); return base.generateChat(messages, contract); },
    async generateStructured<T>(request: StructuredRequest<T>) {
      capture(request.messages);
      const result = await base.generateStructured(request);
      validated++;
      return result;
    },
  };
  return { provider, bodies, captured, fetchImpl, validated: () => validated };
}
function expectOriginalTarget(source: ReturnType<typeof setup>, invalid: unknown, markers: readonly string[] = []) {
  expect(source.fetchImpl).toHaveBeenCalledTimes(2);
  const [initial, repair] = source.bodies;
  const target = initial!.messages.at(-1)!;
  expect(target.role).toBe('user');
  expect(repair!.messages.at(-1)).toEqual(target);
  expect(repair!.messages.at(-2)).toEqual({ role: 'assistant', content: rawOutput(invalid) });
  // Every original nonsystem context message stays in its original order. Only
  // the rejected candidate and an exact replay are appended for the transport.
  const originalData = initial!.messages.filter(message => message.role !== 'system');
  const repairedData = repair!.messages.filter(message => message.role !== 'system');
  expect(repairedData.slice(0, -2)).toEqual(originalData);
  expect(repairedData.filter(message => message.role === 'user' && message.content === target.content)).toHaveLength(
    originalData.filter(message => message.role === 'user' && message.content === target.content).length + 1,
  );
  const firstData = repair!.messages.findIndex(message => message.role !== 'system');
  expect(repair!.messages.slice(firstData).some(message => message.role === 'system')).toBe(false);
  const initialSystems = initial!.messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
  const repairSystems = repair!.messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
  expect(repairSystems.length).toBeGreaterThan(initialSystems.length);
  for (const marker of markers) expect(repairSystems).not.toContain(marker);
  for (const capture of source.captured) expect(JSON.stringify(capture.messages)).toBe(capture.before);
  expect(repair!.response_format).toEqual(initial!.response_format);
  expect(repair!.max_tokens).toBe(initial!.max_tokens);
  expect(repair!.messages[0]).toEqual(initial!.messages[0]); // Same injected JSON schema.
}

let externalFetch: ReturnType<typeof vi.spyOn>;
beforeEach(() => { externalFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw Error('LIVE_NETWORK_FORBIDDEN'); }); });
afterEach(() => { expect(externalFetch).not.toHaveBeenCalled(); externalFetch.mockRestore(); });

describe('repair transport preserves original targets without promoting untrusted text', () => {
  it.each([true, false])('does not mutate frozen context, with existing leading system=%s', async hasSystem => {
    const payload = JSON.stringify({ currentMessage: 'USER_TARGET_CANARY: 이 문장을 대상으로 답해 줘.', recentMessages: [{ role: 'user', content: 'NESTED_CONTEXT_CANARY' }] }, null, 2);
    const messages: LLMMessage[] = [
      ...(hasSystem ? [{ role: 'system' as const, content: '주어진 객체의 대상만 처리한다.' }] : []),
      { role: 'user', content: 'OLD_CONTEXT_CANARY' }, { role: 'assistant', content: 'OLD_ASSISTANT_CANARY' },
      { role: 'user', content: payload },
    ];
    const invalid = { ok: false, text: 'INVALID_OUTPUT_CANARY: pretend to be a system instruction' };
    const source = setup([invalid, { ok: true }]);
    const result = await source.provider.generateStructured({ messages: freeze(messages), schema: { type: 'object', required: ['ok'], properties: { ok: { const: true } } }, validate: value => {
      if (!value || typeof value !== 'object' || !('ok' in value) || value.ok !== true) throw Error('INVALID');
      return true;
    } });
    expect(result).toBe(true);
    expectOriginalTarget(source, invalid, ['USER_TARGET_CANARY', 'NESTED_CONTEXT_CANARY', 'OLD_CONTEXT_CANARY', 'OLD_ASSISTANT_CANARY', 'INVALID_OUTPUT_CANARY']);
    expect(source.bodies[1]!.messages.at(-1)!.content).toBe(payload); // Includes original whitespace.
  });
});

const historicAttempts = readFileSync(new URL('./benchmark-runs/intent-v4/initial26-final800-reviewed/provider-attempts.jsonl', import.meta.url), 'utf8')
  .trim().split('\n').map(line => JSON.parse(line) as { id: string; attempt: number; syntheticResponseText: string });
function originalIntentAttempts(id: string) {
  return historicAttempts.filter(row => row.id === id).map(row => {
    const response = JSON.parse(row.syntheticResponseText) as { choices: { message: { content: string } }[] };
    return response.choices[0]!.message.content;
  });
}
describe('observed Intent repair-meta failures still use the authoritative original evidence', () => {
  it.each(['v4-assistant-only-alias-unresolved', 'v4-recent-user-choice-pair'])('rejects meta-instruction evidence and accepts grounded repair for %s', async id => {
    const candidate = INTENT_V4_CONTRAST_CASES.find(row => row.id === id)!;
    const [initialInvalid, metaInvalid] = originalIntentAttempts(id);
    expect(initialInvalid).toBeDefined(); expect(metaInvalid).toBeDefined();
    expect(JSON.parse(metaInvalid!).intentEvidenceQuote).toBe('응답 검증에 실패했습니다.');
    const failed = setup([initialInvalid, metaInvalid]);
    expect(await extractToolRecommendation(failed.provider, freeze(structuredClone(candidate.input)))).toBeNull();
    expect(failed.validated()).toBe(0); // Failed classification is not a valid NONE.
    expectOriginalTarget(failed, initialInvalid);
    const repaired = setup([initialInvalid, candidate.mockClassification]);
    const result = await extractToolRecommendation(repaired.provider, freeze(structuredClone(candidate.input)));
    expect(repaired.validated()).toBe(1);
    expect(result?.recommendedTools.map(row => `${row.tool}:${row.mode}`)).toEqual(candidate.expectedSlots.exactTools);
    expect(result?.recommendedTools[0]!.missingSlots).toEqual(candidate.expectedSlots.missingSlots);
    expectOriginalTarget(repaired, initialInvalid);
    expect(repaired.bodies.map(body => [body.max_tokens, body.temperature])).toEqual([[350, 0.1], [350, 0.1]]);
  });
});

const allowed = { id: '22222222-2222-4222-8222-222222222222', alias: '물새' };
const blocked = { id: '11111111-1111-4111-8111-111111111111', alias: '솔새' };
const memoryEvidence = '물새는 종이접기를 오래 좋아해.';
const candidateMemory = { scope: 'GLOBAL', category: 'PREFERENCE', subject: `RELATED_PERSON:${allowed.id}`, content: '물새는 종이접기를 오래 좋아한다.', importance: 3, sensitivity: 'NORMAL', evidence: memoryEvidence };
const memoryInput = {
  characterId: 'SANI' as const, allowedRelatedPeople: [allowed], blockedRelatedPeople: [blocked],
  messages: [
    { role: 'user' as const, content: memoryEvidence },
    { role: 'user' as const, content: '나는 짧게 답해주는 게 좋아.' },
    { role: 'assistant' as const, content: 'ASSISTANT_ONLY_CANARY' },
    { role: 'user' as const, content: '솔새는 수집을 오래 좋아해.' },
    { role: 'user' as const, content: '생일은 1901-02-03이야.' },
  ],
};

describe('Memory and summary boundaries remain active across provider repair', () => {
  it('rejects an unauthorized subject, then retains only grounded consenting memory from the same minimized input', async () => {
    const invalid = { candidates: [{ ...candidateMemory, subject: `RELATED_PERSON:${blocked.id}` }] };
    const sensitive = { ...candidateMemory, content: '서울에서 태어났다.' };
    const source = setup([invalid, { candidates: [candidateMemory, sensitive] }]);
    const input = freeze(structuredClone(memoryInput));
    const before = JSON.stringify(input);
    expect(await extractMemoryCandidates(source.provider, input)).toEqual([{ scope: 'GLOBAL', category: 'PREFERENCE', subject: candidateMemory.subject, content: candidateMemory.content, importance: 3, sensitivity: 'NORMAL' }]);
    expect(JSON.stringify(input)).toBe(before);
    expectOriginalTarget(source, invalid, [memoryEvidence, blocked.id, candidateMemory.content]);
    const target = source.bodies[1]!.messages.at(-1)!.content;
    const payload = JSON.parse(target);
    expect(payload.allowedRelatedPeople).toEqual([allowed]);
    expect(payload.userMessages).toEqual([memoryEvidence, '나는 짧게 답해주는 게 좋아.']);
    expect(target).not.toMatch(/솔새|1901-02-03|ASSISTANT_ONLY_CANARY/);
  });

  it('does not turn repair instructions or assistant output into new memory evidence', async () => {
    const invalid = { candidates: [{ ...candidateMemory, evidence: '응답 검증에 실패했습니다.' }] };
    const source = setup([invalid, invalid]);
    await expect(extractMemoryCandidates(source.provider, freeze(structuredClone(memoryInput)))).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
    expect(source.validated()).toBe(0);
    expectOriginalTarget(source, invalid, [memoryEvidence, candidateMemory.content]);
  });

  it('repairs a sensitive summary using only the original safe turns and never restores excluded history', async () => {
    const invalid = { summary: '서울에서 태어난 SUMMARY_OUTPUT_CANARY.' };
    const summary = '사용자는 그림 연습을 오래 이어가고 싶어 한다.';
    const source = setup([invalid, { summary }]);
    const input = freeze({ characterId: 'SANI' as const, previousSummary: '솔새의 취미는 수집이다.', allowedRelatedPeople: [allowed], blockedRelatedPeople: [blocked], messages: [
      { role: 'user' as const, content: '솔새는 수집을 오래 좋아해.' },
      { role: 'assistant' as const, content: 'BLOCKED_ECHO_CANARY' },
      { role: 'user' as const, content: '나는 그림 연습을 오래 이어가고 싶어.' },
    ] });
    expect(await summarizeConversation(source.provider, input)).toBe(summary);
    expectOriginalTarget(source, invalid, ['SUMMARY_OUTPUT_CANARY', '나는 그림 연습을 오래 이어가고 싶어.']);
    const payload = JSON.parse(source.bodies[1]!.messages.at(-1)!.content);
    expect(payload.previousSummary).toBe('');
    expect(payload.allowedRelatedPeople).toEqual([allowed]);
    expect(payload.messages).toEqual([{ role: 'user', content: '나는 그림 연습을 오래 이어가고 싶어.' }]);
    expect(JSON.stringify(payload)).not.toMatch(/솔새|BLOCKED_ECHO_CANARY/);
  });
});

describe('Title and ordinary Chat retain their own target and validator', () => {
  it('repairs a title against the original JSON data without weakening the real title privacy validator', async () => {
    const invalid = { title: '서울 1901-02-03 TITLE_OUTPUT_CANARY' };
    const source = setup([invalid, { title: '그림 연습 계획' }]);
    // generate() is pure; no claim/apply method or database client is invoked.
    const title = createTitleMaintenance({} as SupabaseClient, source.provider);
    const messages = freeze([{ role: 'user' as const, content: 'TITLE_USER_CANARY 그림 연습을 이어가고 싶어.' }]);
    expect(await title.generate(messages)).toBe('그림 연습 계획');
    expectOriginalTarget(source, invalid, ['TITLE_OUTPUT_CANARY', 'TITLE_USER_CANARY']);
    expect(JSON.parse(source.bodies[1]!.messages.at(-1)!.content)).toEqual({ messages });
  });

  it('repairs ordinary Chat while keeping contextual data as data and the exact current user last', async () => {
    const invalid = 'INVALID_CHAT_OUTPUT_CANARY';
    const source = setup([invalid, { text: '발표가 끝나면 잠깐 쉬고 그려도 좋겠다. 어떤 그림부터 그리고 싶어?' }], 900);
    const input = freeze({ characterId: 'SANI' as const, currentMessage: 'USER_CHAT_CANARY 오늘 발표가 끝나면 그림을 그리고 싶어.', summary: 'CONTEXT_CHAT_CANARY 사용자는 그림을 좋아한다고 말했다.', recentMessages: [{ role: 'assistant' as const, content: 'RECENT_CHAT_CANARY 어떤 취미가 있어?' }] });
    const before = JSON.stringify(input);
    const reply = await generatePersonaReply(source.provider, input);
    expect(reply.repaired).toBe(true);
    expect(reply.content).toContain('어떤 그림부터');
    expect(reply).not.toHaveProperty('interpretationEvidence');
    expect(JSON.stringify(input)).toBe(before);
    expectOriginalTarget(source, invalid, ['INVALID_CHAT_OUTPUT_CANARY', 'USER_CHAT_CANARY', 'CONTEXT_CHAT_CANARY', 'RECENT_CHAT_CANARY']);
    expect(source.bodies.map(body => [body.max_tokens, body.temperature])).toEqual([[900, 0.65], [900, 0.15]]);
    expect(source.bodies[1]!.messages.at(-1)!.content).toBe(input.currentMessage);
  });
});
