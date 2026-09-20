import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { extractToolRecommendation, INTENT_PROMPT_VERSION, sanitizeIntentText } from '../../supabase/functions/_shared/llm/intent.ts';
import { createOpenAICompatibleProvider, type LLMProvider, type StructuredRequest } from '../../supabase/functions/_shared/llm/provider.ts';
import { INTENT_V4_CASES } from './intent-v4-corpus.ts';
import { INTENT_V5_CASES, INTENT_V5_CONTRAST_CASES } from './intent-v5-corpus.ts';

const completion = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }));
function setup(values: unknown[]) {
  const bodies: Record<string, any>[] = [];
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    bodies.push(JSON.parse(init!.body as string));
    return completion(values[Math.min(bodies.length - 1, values.length - 1)]);
  });
  const provider = createOpenAICompatibleProvider({ baseUrl: 'https://api.cloudflare.com/client/v4/accounts/synthetic-offline-only/ai/v1',
    model: '@cf/google/gemma-4-26b-a4b-it', structuredFormat: 'json_object', initialTimeoutMs: 8000, repairTimeoutMs: 3000, maxOutputTokens: 350, fetchImpl });
  let validated = 0;
  const observed: LLMProvider = { ...provider, async generateStructured<T>(request: StructuredRequest<T>) {
    const result = await provider.generateStructured(request); validated++; return result;
  } };
  return { provider: observed, bodies, fetchImpl, validated: () => validated };
}
const get = (id: string) => INTENT_V4_CASES.find(candidate => candidate.id === id)!;

describe('Current Intent runtime retains frozen v5 current-payload and judgment-domain contracts', () => {
  it('preserves the original26 inputs and expectations exactly against the executed v4 selection', () => {
    const frozen = JSON.parse(readFileSync(new URL('./benchmark-runs/intent-v4/initial26-final800-reviewed/selection.json', import.meta.url), 'utf8'));
    expect(INTENT_PROMPT_VERSION).toBe('JumZipIntent-v6');
    expect(INTENT_V5_CASES).toHaveLength(28);
    expect(INTENT_V5_CASES.slice(0, 26)).toEqual(INTENT_V4_CASES);
    for (const [index, item] of INTENT_V5_CASES.slice(0, 26).entries()) {
      expect(item.input).toEqual(frozen.cases[index].input);
      expect(item.expectedRecommendation).toEqual(frozen.cases[index].expectedRecommendation);
      expect(JSON.parse(JSON.stringify(item.expectedSlots))).toEqual(frozen.cases[index].expectedSlots);
    }
  });

  it.each(INTENT_V5_CONTRAST_CASES)('$id reaches the unchanged structured path and distinguishes valid safety NONE from failed null', async candidate => {
    const actualNetwork = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw Error('LIVE_NETWORK_FORBIDDEN'); });
    try {
      const source = setup([candidate.mockClassification]);
      expect(await extractToolRecommendation(source.provider, candidate.input)).toBeNull();
      expect(source.fetchImpl).toHaveBeenCalledTimes(1); expect(source.validated()).toBe(1);
      const failed = setup([{ ...candidate.mockClassification, highStakes: 'true' }]);
      expect(await extractToolRecommendation(failed.provider, candidate.input)).toBeNull();
      expect(failed.fetchImpl).toHaveBeenCalledTimes(2); expect(failed.validated()).toBe(0);
      for (const body of [...source.bodies, ...failed.bodies]) expect(body).toMatchObject({ max_tokens: 350, temperature: 0.1, response_format: { type: 'json_object' }, chat_template_kwargs: { enable_thinking: false } });
      expect(actualNetwork).not.toHaveBeenCalled();
    } finally { actualNetwork.mockRestore(); }
  });

  it.each(['v3-decision-two-real-choices', 'v4-unrelated-recent-quotes-not-choices'])('keeps career matrix behavior and does not post-correct a semantic safety false positive: %s', async id => {
    const candidate = get(id);
    const correct = setup([candidate.mockClassification]);
    expect((await extractToolRecommendation(correct.provider, candidate.input))?.recommendedTools[0]).toMatchObject({ tool: 'TAROT', mode: 'DECISION_3', missingSlots: candidate.expectedSlots.missingSlots });
    expect(correct.validated()).toBe(1);
    const wrong = setup([{ ...candidate.mockClassification, highStakes: true }]);
    expect(await extractToolRecommendation(wrong.provider, candidate.input)).toBeNull();
    expect(wrong.validated()).toBe(1); expect(wrong.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(['v4-assistant-only-alias-unresolved', 'v4-recent-user-choice-pair'])('repairs invalid evidence with the byte-identical original payload last: %s', async id => {
    const candidate = get(id);
    const invalid = id === 'v4-assistant-only-alias-unresolved'
      ? { ...candidate.mockClassification, targetAliasEvidence: { state: 'ALIAS', source: 0, quote: '달새' } }
      : { ...candidate.mockClassification, choicesEvidence: [{ source: 0, quote: '현 직장에 남기와 대학원 진학이야.' }] };
    const source = setup([invalid, candidate.mockClassification]);
    const result = await extractToolRecommendation(source.provider, candidate.input);
    expect(source.fetchImpl).toHaveBeenCalledTimes(2); expect(source.validated()).toBe(1);
    expect(result?.recommendedTools[0]?.missingSlots).toEqual(candidate.expectedSlots.missingSlots);
    const initial = source.bodies[0].messages, repaired = source.bodies[1].messages;
    expect(repaired.at(-1)).toEqual(initial.at(-1));
    expect(Buffer.from(repaired.at(-1).content).equals(Buffer.from(initial.at(-1).content))).toBe(true);
    expect(JSON.parse(repaired.at(-1).content).currentMessage).toBe(sanitizeIntentText(candidate.input.currentMessage));
    expect(repaired.at(-2)).toEqual({ role: 'assistant', content: JSON.stringify(invalid) });
    expect(initial.at(-1).content).not.toContain('STRUCTURED_VALIDATION_FAILED');
  });

  it('rejects classification of repair-control text again rather than defaulting to a successful NONE', async () => {
    const candidate = get('v4-assistant-only-alias-unresolved');
    const previousFailure = { ...candidate.mockClassification, targetAliasEvidence: { state: 'ALIAS', source: 0, quote: '달새' } };
    const classifiedControl = { ...candidate.mockClassification, requestPurpose: 'GENERAL_CHAT', intent: 'small_talk',
      intentEvidenceQuote: '응답 검증에 실패했습니다.', periodPresent: false };
    const source = setup([previousFailure, classifiedControl]);
    expect(await extractToolRecommendation(source.provider, candidate.input)).toBeNull();
    expect(source.fetchImpl).toHaveBeenCalledTimes(2); expect(source.validated()).toBe(0);
  });
});
