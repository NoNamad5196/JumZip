import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { extractToolRecommendation, INTENT_PROMPT_VERSION, INTENT_RESPONSE_SCHEMA } from '../../supabase/functions/_shared/llm/intent.ts';
import { createOpenAICompatibleProvider, type LLMProvider, type StructuredRequest } from '../../supabase/functions/_shared/llm/provider.ts';
import { INTENT_V6_CASES } from './intent-v6-corpus.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const base = new URL('./benchmark-runs/intent-v5/initial28-final800/', import.meta.url);
const originalSelection = JSON.parse(readFileSync(new URL('selection.json', base), 'utf8'));
const originalAttempts = readFileSync(new URL('provider-attempts.jsonl', base), 'utf8').trim().split('\n').map(row => JSON.parse(row) as { id: string; attempt: number; syntheticResponseText: string });
const candidate = (id: string) => INTENT_V6_CASES.find(item => item.id === id)!;
const historicalInvalid = (id: string): string => JSON.parse(originalAttempts.find(item => item.id === id && item.attempt === 1)!.syntheticResponseText).choices[0].message.content;
function addedSystemGuidance(initial: Record<string, any>, repair: Record<string, any>): string {
  return repair.messages.filter((message: { role: string }) => message.role === 'system').map((message: { content: string }) => {
    const previous = initial.messages.find((prior: { role: string; content: string }) => prior.role === 'system' && message.content.startsWith(prior.content));
    return previous ? message.content.slice(previous.content.length) : message.content;
  }).join('\n');
}
function setup(contents: string[]) {
  const bodies: Record<string, any>[] = [];
  const mapped: (string | null | undefined)[] = [];
  let request: StructuredRequest<unknown> | undefined, accepted = false;
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: contents[Math.min(bodies.length - 1, contents.length - 1)] }, finish_reason: 'stop' }] }));
  });
  const actual = createOpenAICompatibleProvider({ baseUrl: 'https://api.cloudflare.com/client/v4/accounts/synthetic-offline-only/ai/v1', model: '@cf/google/gemma-4-26b-a4b-it', structuredFormat: 'json_object', maxOutputTokens: 350, initialTimeoutMs: 8000, repairTimeoutMs: 3000, fetchImpl });
  const provider: LLMProvider = { ...actual, async generateStructured<T>(input: StructuredRequest<T>) {
    request = input;
    const value = await actual.generateStructured({ ...input, diagnoseValidationError(error) {
      const code = input.diagnoseValidationError?.(error); mapped.push(code); return code ?? null;
    } }); accepted = true; return value;
  } };
  return { provider, bodies, mapped, fetchImpl, request: () => request!, accepted: () => accepted };
}

describe('Intent-v6 preserves the schema and historical28 while diagnosing only known slot failures', () => {
  it('keeps every original input, expectation, review criterion and schema unchanged', () => {
    expect(INTENT_PROMPT_VERSION).toBe('JumZipIntent-v6');
    expect(INTENT_V6_CASES).toHaveLength(28);
    const cases = INTENT_V6_CASES.map(({ mockClassification: _mock, ...item }) => ({ ...item, inputSha256: sha(JSON.stringify(item.input)) }));
    expect(JSON.parse(JSON.stringify(cases))).toEqual(originalSelection.cases);
    expect(sha(JSON.stringify(INTENT_RESPONSE_SCHEMA))).toBe('e4a5429d927615eab1fc6601a483a4e157ec889be1c9f853f8551aac377096b9');
  });

  it('maps only exact Error codes, not arbitrary strings, values, suffixes or lookalike objects', async () => {
    const item = candidate('v4-assistant-only-alias-unresolved');
    const source = setup([JSON.stringify(item.mockClassification)]);
    await extractToolRecommendation(source.provider, item.input);
    const request = source.request(); expect(request.name).toBe('jumzip_intent_v6');
    const map = request.diagnoseValidationError!;
    for (const code of ['INTENT_ALIAS_SOURCE_INVALID', 'INTENT_CHOICES_INVALID']) expect(map(new Error(code))).toBe(code);
    for (const error of [null, 'INTENT_CHOICES_INVALID', { message: 'INTENT_CHOICES_INVALID' }, new Error('INTENT_CHOICES_INVALID private-value'), new Error('PRIVATE_USER_VALUE'), new Error('INTENT_SLOT_EVIDENCE_INVALID')]) expect(map(error)).toBeNull();
    expect(source.mapped).toEqual([]); expect(source.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['v4-assistant-only-alias-unresolved', 'INTENT_ALIAS_SOURCE_INVALID', 'targetAliasEvidence'],
    ['v4-recent-user-choice-pair', 'INTENT_CHOICES_INVALID', 'choicesEvidence'],
  ])('routes the actual historical %s failure into bounded repair guidance without weakening validation', async (id, code, path) => {
    const item = candidate(id), invalid = historicalInvalid(id), source = setup([invalid, JSON.stringify(item.mockClassification)]);
    const result = await extractToolRecommendation(source.provider, item.input);
    expect(source.mapped).toEqual([code]); expect(source.accepted()).toBe(true); expect(source.fetchImpl).toHaveBeenCalledTimes(2);
    expect(result?.recommendedTools[0]).toMatchObject({ tool: 'TAROT', mode: item.expectedRecommendation.modes[0], missingSlots: item.expectedSlots.missingSlots });
    const [initial, repair] = source.bodies, extraGuidance = addedSystemGuidance(initial, repair);
    expect(extraGuidance).toContain(code); expect(extraGuidance).toContain(path);
    expect(extraGuidance).not.toContain('달새'); expect(extraGuidance).not.toContain('현 직장에 남기');
    expect(extraGuidance).not.toContain(invalid);
    expect(repair.messages.at(-1)).toEqual(initial.messages.at(-1));
    expect(repair.messages.at(-2)).toEqual({ role: 'assistant', content: invalid });
    for (const body of source.bodies) expect(body).toMatchObject({ max_tokens: 350, temperature: 0.1, response_format: { type: 'json_object' }, chat_template_kwargs: { enable_thinking: false } });
  });

  it.each(['v4-assistant-only-alias-unresolved', 'v4-recent-user-choice-pair'])('still fails closed if %s is repeated after the one allowed repair', async id => {
    const source = setup([historicalInvalid(id)]);
    expect(await extractToolRecommendation(source.provider, candidate(id).input)).toBeNull();
    expect(source.accepted()).toBe(false); expect(source.mapped).toHaveLength(1); expect(source.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps invalid JSON on generic repair and never invokes the intent mapper for parse failure', async () => {
    const item = candidate('v4-assistant-only-alias-unresolved'), source = setup(['{', JSON.stringify(item.mockClassification)]);
    expect(await extractToolRecommendation(source.provider, item.input)).not.toBeNull();
    expect(source.mapped).toEqual([]); expect(source.fetchImpl).toHaveBeenCalledTimes(2);
    const extra = addedSystemGuidance(source.bodies[0], source.bodies[1]);
    expect(extra).toContain('STRUCTURED_VALIDATION_FAILED'); expect(extra).not.toContain('INTENT_ALIAS_SOURCE_INVALID'); expect(extra).not.toContain('INTENT_CHOICES_INVALID');
  });

  it('keeps other validation errors generic and does not promote their values into system guidance', async () => {
    const item = candidate('v4-recent-user-choice-pair');
    const invalid = { ...item.mockClassification, intentEvidenceQuote: 'PRIVATE_UNMATCHED_SOURCE_VALUE' };
    const source = setup([JSON.stringify(invalid), JSON.stringify(item.mockClassification)]);
    expect(await extractToolRecommendation(source.provider, item.input)).not.toBeNull(); expect(source.mapped).toEqual([null]);
    const extra = addedSystemGuidance(source.bodies[0], source.bodies[1]);
    expect(extra).toContain('STRUCTURED_VALIDATION_FAILED'); expect(extra).not.toContain('PRIVATE_UNMATCHED_SOURCE_VALUE');
    expect(extra).not.toContain('INTENT_ALIAS_SOURCE_INVALID'); expect(extra).not.toContain('INTENT_CHOICES_INVALID');
  });
});
