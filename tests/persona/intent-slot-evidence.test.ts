import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { extractToolRecommendation, INTENT_RESPONSE_SCHEMA, type IntentInput } from '../../supabase/functions/_shared/llm/intent.ts';
import { createOpenAICompatibleProvider, type LLMProvider, type StructuredRequest } from '../../supabase/functions/_shared/llm/provider.ts';
import { V5_INTENT_CASES } from './v5-focused-corpus.mts';

const current = '달새와의 관계가 궁금해. 직장을 유지할지 대학원에 진학할지 타로로 보고 싶어.';
const input = (patch: Partial<IntentInput> = {}): IntentInput => ({ currentMessage: current, recentMessages: [], hasOwnBirthData: false, hasPartnerBirthData: false, ...patch });
const unresolved = { state: 'UNRESOLVED', source: null, quote: null };
const output = (patch: Record<string, unknown> = {}) => ({
  requestPurpose: 'FORTUNE_EXPLORATION', intentEvidenceQuote: '직장을 유지할지 대학원에 진학할지', intent: 'career_decision',
  explicitTool: 'TAROT', explicitToolQuote: '타로로 보고 싶어', targetAliasEvidence: unresolved,
  recentSituationPresent: true, periodPresent: false, choicesEvidence: [], highStakes: false, ...patch,
});
function stub(value: unknown) {
  const valid: unknown[] = [], errors: unknown[] = [], requests: StructuredRequest<unknown>[] = [];
  const provider: LLMProvider = { generateChat: vi.fn(), repairChat: vi.fn(), async generateStructured<T>(request: StructuredRequest<T>) {
    requests.push(request);
    try { const accepted = request.validate(value); valid.push(accepted); return accepted; }
    catch (error) { errors.push(error); throw error; }
  } };
  return { provider, valid, errors, requests };
}
const evidence = (quote: string, source = -1) => ({ source, quote });
const pair = [evidence('직장을 유지할지'), evidence('대학원에 진학할지')];
const completion = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }));
const stored = JSON.parse(readFileSync(new URL('./benchmark-runs/v5-focused/results.json', import.meta.url), 'utf8')).entries as { id: string; phase: string; structuredOutput?: Record<string, unknown> }[];

describe('Intent v3 source-grounded slots', () => {
  it('replaces two unverified booleans without expanding the public recommendation contract', async () => {
    const required = INTENT_RESPONSE_SCHEMA.required as string[];
    expect(required).toHaveLength(10);
    expect(required).toEqual(expect.arrayContaining(['choicesEvidence', 'targetAliasEvidence']));
    expect(required).not.toContain('choicesPresent'); expect(required).not.toContain('targetPersonPresent');
    const source = stub(output({ choicesEvidence: pair }));
    expect(await extractToolRecommendation(source.provider, input())).toEqual({ recommendedTools: [{ tool: 'TAROT', mode: 'DECISION_3', reason: expect.any(String), missingSlots: [] }] });
    expect(source.valid).toHaveLength(1);
  });

  // The frozen inputs and their original real outputs are unchanged. These are
  // new v3 contract mocks, not a claim about how a live model will classify them.
  it.each(V5_INTENT_CASES)('keeps frozen input $id under supplied v3 classifications', async item => {
    const old = stored.find(entry => entry.id === item.id)!.structuredOutput!;
    const { targetPersonPresent: _target, choicesPresent: _choices, ...retained } = old;
    const source = stub({ ...retained, targetAliasEvidence: unresolved, choicesEvidence: [] });
    const result = await extractToolRecommendation(source.provider, item.input);
    expect(source.valid).toHaveLength(1); expect(source.errors).toHaveLength(0);
    if (item.expected.recommendation === 'NONE') expect(result).toBeNull();
    else {
      expect(result?.recommendedTools[0]?.tool).toBe(item.expected.recommendation);
      expect(item.expected.modes).toContain(result?.recommendedTools[0]?.mode);
    }
    if (item.id === 'v5-intent-target-remembers') expect(result?.recommendedTools[0]?.missingSlots).toEqual(['targetPerson', 'recentSituation']);
    if (item.id === 'v5-intent-recall-explicit-tarot') expect(old.choicesPresent).toBe(true);
  });

  it('preserves a positive explicit Tarot request while missing choice evidence requests choices', async () => {
    const source = stub(output());
    expect((await extractToolRecommendation(source.provider, input()))?.recommendedTools[0]).toMatchObject({ tool: 'TAROT', mode: 'DECISION_3', missingSlots: ['choices'] });
    expect(source.valid).toHaveLength(1);
  });

  it.each([
    { choicesEvidence: [] }, { choicesEvidence: [evidence('직장을 유지할지'), evidence('대학원에 진학할지')] },
  ])('accepts zero or two bounded source-valid choices: $choicesEvidence', async ({ choicesEvidence }) => {
    const source = stub(output({ choicesEvidence }));
    await extractToolRecommendation(source.provider, input()); expect(source.valid).toHaveLength(1);
  });

  it.each([
    ['one choice', [evidence('직장을 유지할지')]],
    ['three choices', [...pair, evidence('달새')]],
    ['invented opposite', [evidence('직장을 유지할지'), evidence('직장을 그만둘지')]],
    ['duplicate quote', [evidence('직장을 유지할지'), evidence('직장을 유지할지')]],
    ['overlapping-only spans', [evidence('직장을 유지할지'), evidence('유지할지')]],
    ['invalid source', [evidence('직장을 유지할지', 0), evidence('대학원에 진학할지')]],
    ['fractional source', [evidence('직장을 유지할지', -0.5), evidence('대학원에 진학할지')]],
    ['out-of-range source', [evidence('직장을 유지할지', 8), evidence('대학원에 진학할지')]],
    ['extra field', [{ ...pair[0], invented: true }, pair[1]]],
    ['whitespace only', [evidence(' '), evidence('대학원에 진학할지')]],
    ['wrong type', [evidence('직장을 유지할지'), { source: -1, quote: true }]],
  ])('rejects %s without recording a successful no-tool classification', async (_label, choicesEvidence) => {
    const source = stub(output({ choicesEvidence }));
    expect(await extractToolRecommendation(source.provider, input())).toBeNull();
    expect(source.valid).toHaveLength(0); expect(source.errors).toHaveLength(1);
  });

  it('rejects equivalent repeated labels across separate source messages', async () => {
    const source = stub(output({ choicesEvidence: [evidence('Ａ', 0), evidence('a', 1)] }));
    expect(await extractToolRecommendation(source.provider, input({ recentMessages: [{ role: 'user', content: 'Ａ' }, { role: 'user', content: 'a' }] }))).toBeNull();
    expect(source.errors).toHaveLength(1);
  });

  it('allows distinct disjoint labels even if one label is a substring of the other', async () => {
    const source = stub(output({ choicesEvidence: [evidence('A', 0), evidence('A+', 0)] }));
    await extractToolRecommendation(source.provider, input({ recentMessages: [{ role: 'user', content: 'A와 A+ 중에서 고를 거야.' }] }));
    expect(source.valid).toHaveLength(1);
  });

  it('accepts related previous assistant choice context while requiring user-origin alias evidence', async () => {
    const source = stub(output({ targetAliasEvidence: { state: 'ALIAS', ...evidence('달새', 1) }, choicesEvidence: [evidence('직장 유지', 0), evidence('진학', 0)] }));
    await extractToolRecommendation(source.provider, input({ recentMessages: [{ role: 'assistant', content: '선택지는 직장 유지와 진학이야.' }, { role: 'user', content: '상대는 달새라고 부를게.' }] }));
    expect(source.valid).toHaveLength(1);
    const invalid = stub(output({ targetAliasEvidence: { state: 'ALIAS', ...evidence('달새', 0) } }));
    expect(await extractToolRecommendation(invalid.provider, input({ recentMessages: [{ role: 'assistant', content: '상대를 달새라고 부르자.' }] }))).toBeNull();
    expect(invalid.errors).toHaveLength(1);
  });

  it('uses indexes after birth minimization and filtering, never original message indexes', async () => {
    const recentMessages = [{ role: 'user' as const, content: '출생도시는 서울이야.' }, { role: 'assistant' as const, content: '관계 이야기를 이어가자.' }, { role: 'user' as const, content: '상대 별칭은 달새야.' }];
    const source = stub(output({ targetAliasEvidence: { state: 'ALIAS', ...evidence('달새', 1) } }));
    await extractToolRecommendation(source.provider, input({ recentMessages })); expect(source.valid).toHaveLength(1);
    const sent = JSON.parse(source.requests[0]!.messages[1]!.content);
    expect(sent.recentMessages).toHaveLength(2); expect(sent.recentMessages[1].content).toContain('달새');
    expect(JSON.stringify(sent)).not.toContain('서울');
    const stale = stub(output({ targetAliasEvidence: { state: 'ALIAS', ...evidence('달새', 2) } }));
    expect(await extractToolRecommendation(stale.provider, input({ recentMessages }))).toBeNull(); expect(stale.errors).toHaveLength(1);
  });

  it.each([
    ['unknown discriminator', { state: 'PERSON', ...evidence('달새') }],
    ['invented alias', { state: 'ALIAS', ...evidence('별비') }],
    ['ALIAS without quote', { state: 'ALIAS', source: -1, quote: null }],
    ['UNRESOLVED with source', { state: 'UNRESOLVED', source: -1, quote: null }],
    ['UNRESOLVED with quote', { state: 'UNRESOLVED', source: null, quote: '달새' }],
    ['extra field', { state: 'ALIAS', ...evidence('달새'), relation: 'friend' }],
    ['wrong source type', { state: 'ALIAS', source: '-1', quote: '달새' }],
  ])('rejects alias %s', async (_label, targetAliasEvidence) => {
    const source = stub(output({ targetAliasEvidence }));
    expect(await extractToolRecommendation(source.provider, input())).toBeNull(); expect(source.errors).toHaveLength(1);
  });

  it.each([
    ['purpose', 97], ['explicit', 65], ['choice', 49], ['alias', 25],
  ])('rejects overlength %s quote even when its full text exists in the source', async (field, length) => {
    const quote = field === 'explicit' ? `타로${'가'.repeat(Number(length) - 2)}` : '가'.repeat(Number(length));
    const patch = field === 'purpose' ? { intentEvidenceQuote: quote } : field === 'explicit' ? { explicitToolQuote: quote }
      : field === 'choice' ? { choicesEvidence: [evidence(quote), pair[1]] } : { targetAliasEvidence: { state: 'ALIAS', ...evidence(quote) } };
    const source = stub(output(patch));
    expect(await extractToolRecommendation(source.provider, input({ currentMessage: `${current} ${quote}` }))).toBeNull(); expect(source.errors).toHaveLength(1);
  });

  it('documents that unrelated real quotes and a mislabeled pronoun can pass source validity', async () => {
    // These intentionally wrong semantic classifications demonstrate the limit.
    // Source-validity is not semantic proof; no blacklist is added for this text.
    const source = stub(output({ targetAliasEvidence: { state: 'ALIAS', ...evidence('그 사람') }, choicesEvidence: [evidence('이번 주'), evidence('도서관')] }));
    await extractToolRecommendation(source.provider, input({ currentMessage: `${current} 그 사람을 이번 주 도서관에서 만났어.` }));
    expect(source.valid).toHaveLength(1);
  });

  it('keeps one repair, 350 output tokens and separate structured settings with no real fetch', async () => {
    const invalid = output({ choicesEvidence: [pair[0]] });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(completion(invalid)).mockResolvedValueOnce(completion(output({ choicesEvidence: pair })));
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'test', structuredFormat: 'json_object', maxOutputTokens: 350, initialTimeoutMs: 8_000, repairTimeoutMs: 3_000, fetchImpl });
    expect((await extractToolRecommendation(provider, input()))?.recommendedTools[0]?.missingSlots).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const call of fetchImpl.mock.calls) {
      const sent = JSON.parse(call[1]!.body as string);
      expect(sent.max_tokens).toBe(350); expect(sent.temperature).toBe(0.1);
      expect(JSON.stringify(sent.messages)).toContain('choicesEvidence');
      expect(JSON.stringify(sent.messages)).toContain('targetAliasEvidence');
    }
    const brokenFetch = vi.fn<typeof fetch>().mockImplementation(async () => completion(invalid));
    const broken = createOpenAICompatibleProvider({ baseUrl: 'https://example.test/v1', model: 'test', maxOutputTokens: 350, initialTimeoutMs: 8_000, repairTimeoutMs: 3_000, fetchImpl: brokenFetch });
    expect(await extractToolRecommendation(broken, input())).toBeNull(); expect(brokenFetch).toHaveBeenCalledTimes(2);
  });
});
