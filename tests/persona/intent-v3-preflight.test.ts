import { describe, expect, it, vi } from 'vitest';
import { extractToolRecommendation } from '../../supabase/functions/_shared/llm/intent.ts';
import { createOpenAICompatibleProvider, type LLMProvider, type StructuredRequest } from '../../supabase/functions/_shared/llm/provider.ts';
import { INTENT_V3_CASES } from './intent-v3-corpus.ts';

// No live mode and no credentials. These frozen synthetic candidates prepare a
// future evaluation; mock classifications do not establish live model quality.
describe('Intent v3 zero-network evaluation preparation', () => {
  it('serializes the original eight plus ten missing matrix cases through the actual provider request builder', async () => {
    const candidates = INTENT_V3_CASES;
    const requestBytes: number[] = [], responseBytes: number[] = [];
    const actualNetwork = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw Error('NO_NETWORK_PREFLIGHT'); });
    try {
      for (const candidate of candidates) {
        const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
          const body = JSON.parse(init!.body as string);
          expect(body.max_tokens).toBe(350); expect(body.temperature).toBe(0.1);
          expect(body.response_format).toEqual({ type: 'json_object' });
          expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
          expect(JSON.stringify(body.messages)).toContain('JumZipIntent-v3');
          requestBytes.push(Buffer.byteLength(init!.body as string, 'utf8'));
          responseBytes.push(Buffer.byteLength(JSON.stringify(candidate.mockClassification), 'utf8'));
          return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(candidate.mockClassification) }, finish_reason: 'stop' }] }));
        });
        const provider = createOpenAICompatibleProvider({ baseUrl: 'https://api.cloudflare.com/client/v4/accounts/synthetic-offline-only/ai/v1', model: '@cf/google/gemma-4-26b-a4b-it', structuredFormat: 'json_object', maxOutputTokens: 350, initialTimeoutMs: 8_000, repairTimeoutMs: 3_000, fetchImpl });
        let validationSucceeded = false;
        const observed: LLMProvider = { ...provider, async generateStructured<T>(request: StructuredRequest<T>) {
          const result = await provider.generateStructured(request); validationSucceeded = true; return result;
        } };
        const result = await extractToolRecommendation(observed, candidate.input);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(validationSucceeded, candidate.id).toBe(true);
        const expected = candidate.expectedRecommendation;
        if (expected.recommendation === 'NONE') expect(result).toBeNull();
        else {
          expect(result?.recommendedTools[0]?.tool).toBe(expected.recommendation);
          expect(expected.modes).toContain(result?.recommendedTools[0]?.mode);
        }
        if (candidate.expectedSlots.exactTools) expect(result?.recommendedTools.map(item => item.tool + ':' + item.mode) ?? []).toEqual(candidate.expectedSlots.exactTools);
        if (expected.recommendation !== 'NONE' && candidate.expectedSlots.missingSlots) expect(result?.recommendedTools[0]?.missingSlots).toEqual(candidate.expectedSlots.missingSlots);
      }
      expect(actualNetwork).not.toHaveBeenCalled(); expect(candidates).toHaveLength(18);
      console.info(JSON.stringify({ scope: 'INTENT_V3_MOCK_PREFLIGHT_ONLY', candidates: candidates.length, liveModelCalls: 0,
        requestUtf8Bytes: { min: Math.min(...requestBytes), max: Math.max(...requestBytes) },
        mockOutputUtf8Bytes: { min: Math.min(...responseBytes), max: Math.max(...responseBytes) },
        tokenLimit: 350, timeoutsMs: [8_000, 3_000], note: 'Bytes are not a tokenizer bound or measured inference cost.' }));
    } finally { actualNetwork.mockRestore(); }
  });
});
