import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { extractToolRecommendation, INTENT_PROMPT_VERSION } from '../../supabase/functions/_shared/llm/intent.ts';
import { createOpenAICompatibleProvider, type LLMProvider, type StructuredRequest } from '../../supabase/functions/_shared/llm/provider.ts';
import { INTENT_V3_CASES } from './intent-v3-corpus.ts';
import { INTENT_V4_CASES, INTENT_V4_CONTRAST_CASES } from './intent-v4-corpus.ts';

// Supplied classifications test boundaries/flow, not live semantic accuracy.
const get = (id: string) => INTENT_V4_CONTRAST_CASES.find(row => row.id === id)!;
const completion = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }));
function setup(values: unknown[]) {
  const bodies: Record<string, any>[] = [];
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    bodies.push(JSON.parse(init!.body as string)); return completion(values[Math.min(bodies.length - 1, values.length - 1)]);
  });
  const provider = createOpenAICompatibleProvider({ baseUrl: 'https://api.cloudflare.com/client/v4/accounts/synthetic-offline-only/ai/v1', model: '@cf/google/gemma-4-26b-a4b-it', structuredFormat: 'json_object', initialTimeoutMs: 8000, repairTimeoutMs: 3000, maxOutputTokens: 350, fetchImpl });
  let validated = 0;
  const observed: LLMProvider = { ...provider, async generateStructured<T>(request: StructuredRequest<T>) {
    const result = await provider.generateStructured(request); validated++; return result;
  } };
  return { provider: observed, bodies, fetchImpl, validated: () => validated };
}

describe('current Intent runtime retains frozen v4 contrast contracts without a live model', () => {
  it('preserves all original 18 inputs and expected fields exactly, including the observed failing expectations', () => {
    const frozen = JSON.parse(readFileSync(new URL('./benchmark-runs/intent-v3/initial18-final600/selection.json', import.meta.url), 'utf8'));
    expect(INTENT_V4_CASES.slice(0, 18)).toEqual(INTENT_V3_CASES);
    for (const [index, item] of INTENT_V4_CASES.slice(0, 18).entries()) {
      expect(item.input).toEqual(frozen.cases[index].input);
      expect(item.expectedRecommendation).toEqual(frozen.cases[index].expectedRecommendation);
      expect(item.expectedSlots).toEqual(frozen.cases[index].expectedSlots);
    }
  });

  it.each(INTENT_V4_CONTRAST_CASES)('validates supplied contrast $id and preserves matrix/slot behavior', async candidate => {
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw Error('LIVE_NETWORK_FORBIDDEN'); });
    try {
      const source = setup([candidate.mockClassification]);
      const result = await extractToolRecommendation(source.provider, candidate.input);
      expect(source.fetchImpl).toHaveBeenCalledTimes(1); expect(source.validated()).toBe(1);
      for (const field of ['recentSituationPresent', 'periodPresent'] as const) {
        const expected = candidate.expectedSlots[field];
        if (expected !== undefined) expect(candidate.mockClassification[field]).toBe(expected);
      }
      expect(result?.recommendedTools.map(row => `${row.tool}:${row.mode}`) ?? []).toEqual(candidate.expectedSlots.exactTools);
      if (result) expect(result.recommendedTools[0]!.missingSlots).toEqual(candidate.expectedSlots.missingSlots);
      expect(network).not.toHaveBeenCalled();
      expect(JSON.stringify(source.bodies[0].messages)).toContain(INTENT_PROMPT_VERSION);
      expect(source.bodies[0]).toMatchObject({ max_tokens: 350, temperature: 0.1, response_format: { type: 'json_object' }, chat_template_kwargs: { enable_thinking: false } });
    } finally { network.mockRestore(); }
  });

  it('repairs an original unfiltered source index once while retaining only minimized recent text', async () => {
    const candidate = get('v4-recent-user-alias-filtered-index');
    const stale = { ...candidate.mockClassification, targetAliasEvidence: { state: 'ALIAS', source: 2, quote: '달새' } };
    const source = setup([stale, candidate.mockClassification]);
    expect((await extractToolRecommendation(source.provider, candidate.input))?.recommendedTools[0]?.missingSlots).toEqual([]);
    expect(source.fetchImpl).toHaveBeenCalledTimes(2); expect(source.validated()).toBe(1);
    const payload = JSON.parse(source.bodies[0]!.messages.find((m: { role: string }) => m.role === 'user').content);
    expect(payload.recentMessages).toEqual(candidate.input.recentMessages!.slice(1));
    expect(JSON.stringify(source.bodies)).not.toContain('출생 도시는');
    for (const body of source.bodies) expect(body).toMatchObject({ max_tokens: 350, temperature: 0.1 });
  });

  it('never accepts an assistant-only alias and distinguishes repaired unresolved from two failed attempts', async () => {
    const candidate = get('v4-assistant-only-alias-unresolved');
    const inventedOwnership = { ...candidate.mockClassification, targetAliasEvidence: { state: 'ALIAS', source: 0, quote: '달새' } };
    const fixed = setup([inventedOwnership, candidate.mockClassification]);
    expect((await extractToolRecommendation(fixed.provider, candidate.input))?.recommendedTools[0]?.missingSlots).toEqual(['targetPerson']);
    expect(fixed.validated()).toBe(1); expect(fixed.fetchImpl).toHaveBeenCalledTimes(2);
    const failed = setup([inventedOwnership]);
    expect(await extractToolRecommendation(failed.provider, candidate.input)).toBeNull();
    expect(failed.validated()).toBe(0); expect(failed.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('records semantic medical suppression as validated NONE after one structured request', async () => {
    const candidate = get('v4-semantic-medical-high-stakes');
    const source = setup([candidate.mockClassification]);
    expect(await extractToolRecommendation(source.provider, candidate.input)).toBeNull();
    expect(source.fetchImpl).toHaveBeenCalledTimes(1); expect(source.validated()).toBe(1);
    // It actually reached structured classification: the narrow text guard did not short-circuit.
    const broken = setup([{ ...candidate.mockClassification, highStakes: 'true' }]);
    expect(await extractToolRecommendation(broken.provider, candidate.input)).toBeNull();
    expect(broken.fetchImpl).toHaveBeenCalledTimes(2); expect(broken.validated()).toBe(0);
  });

  it('does not silently reinterpret a source-valid wrong topic or unrelated choice quotes', async () => {
    // Prompt clarification is not a new deterministic semantic oracle. These
    // incorrect supplied outputs remain observable evaluation failures.
    const relation = get('v4-period-specific-relationship');
    const wrongTopic = setup([{ ...relation.mockClassification, intent: 'monthly_flow' }]);
    expect((await extractToolRecommendation(wrongTopic.provider, relation.input))?.recommendedTools[0]?.tool).toBe('SAJU');
    expect(wrongTopic.validated()).toBe(1);
    const choices = get('v4-unrelated-recent-quotes-not-choices');
    const unrelated = setup([{ ...choices.mockClassification, choicesEvidence: [{ source: 0, quote: '공원 산책' }, { source: 0, quote: '점심 메뉴' }] }]);
    expect((await extractToolRecommendation(unrelated.provider, choices.input))?.recommendedTools[0]?.missingSlots).toEqual([]);
    expect(unrelated.validated()).toBe(1);
  });
});
