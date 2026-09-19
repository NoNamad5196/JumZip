// Narrow diagnostic: exact synthetic input, no Auth data, no persistence or source mutation.
// node --env-file=.env.server.local tests/backend/live-memory-schema-probe.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { createOpenAICompatibleProvider } from '../../supabase/functions/_shared/llm/provider.ts';
import { extractMemoryCandidates } from '../../supabase/functions/_shared/persona/memory.ts';

const { LLM_BASE_URL: baseUrl, LLM_MODEL: model, LLM_API_KEY: apiKey, LLM_STRUCTURED_FORMAT: format } = process.env;
if (!baseUrl || !model || !apiKey) throw new Error('Configured private provider environment is required.');
const input = { characterId: 'BOMI', messages: [{ role: 'user', content: '나는 오래 즐겨 온 취미가 종이별 접기야. 꾸준히 만드는 종이별을 가장 좋아해. 다음에 이야기할 때도 이 취향을 기억해 줘.' }], allowedRelatedPeople: [], suppressions: [] };
const required = ['scope', 'category', 'subject', 'content', 'importance', 'sensitivity', 'evidence'];
const reports = [], syntheticResponses = [];
let attempts = 0;
const safeUsage = value => Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens', 'neurons'].filter(key => typeof value?.[key] === 'number' && Number.isFinite(value[key])).map(key => [key, value[key]]));
function describeContent(content) {
  try {
    const parsed = JSON.parse(content);
    return { validJson: true, topKeys: Object.keys(parsed ?? {}), candidates: Array.isArray(parsed?.candidates) ? parsed.candidates.map(row => ({ keys: Object.keys(row ?? {}), missingKeys: required.filter(key => !Object.hasOwn(row ?? {}, key)), category: typeof row.category === 'string' ? row.category : null, subject: typeof row.subject === 'string' ? row.subject : null })) : null };
  } catch { return { validJson: false }; }
}
for (const variant of ['CONFIGURED_BASELINE', 'SCHEMA_IN_SYSTEM_DIAGNOSTIC']) {
  const observations = [];
  const fetchImpl = async (url, init) => {
    attempts += 1;
    if (attempts > 4) throw new Error('Diagnostic HTTP-attempt ceiling exceeded.');
    const sent = JSON.parse(init.body);
    const started = Date.now();
    const response = await fetch(url, init);
    // Only model-generated synthetic content and numeric usage are retained. Never
    // retain endpoint URLs, request headers, credentials, response headers, or IDs.
    const body = await response.clone().json();
    const choice = body.choices?.[0];
    const content = typeof choice?.message?.content === 'string' ? choice.message.content : null;
    const observation = { httpStatus: response.status, latencyMs: Date.now() - started,
      responseFormat: sent.response_format?.type,
      schemaInResponseFormat: Boolean(sent.response_format?.json_schema?.schema),
      schemaInMessages: sent.messages.some(message => message.content.includes('"required":["candidates"]')),
      finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
      contentPresent: Boolean(content), usage: safeUsage(body.usage), shape: content ? describeContent(content) : null };
    observations.push(observation);
    syntheticResponses.push({ variant, attempt: observations.length, content, ...observation });
    return response;
  };
  const base = createOpenAICompatibleProvider({ baseUrl, model, apiKey, structuredFormat: format === 'json_object' ? 'json_object' : 'json_schema', initialTimeoutMs: 8_000, repairTimeoutMs: 3_000, maxOutputTokens: 500, fetchImpl });
  const provider = variant === 'CONFIGURED_BASELINE' ? base : {
    ...base,
    generateStructured: request => base.generateStructured({ ...request, messages: [{ role: 'system', content: `최종 JSON은 다음 JSON Schema의 필수 키와 enum을 정확히 따른다. additionalProperties:false 규칙을 지킨다. ${JSON.stringify(request.schema)}` }, ...request.messages] }),
  };
  try {
    const candidates = await extractMemoryCandidates(provider, input);
    reports.push({ variant, outcome: 'SUCCEEDED', candidateCount: candidates.length, expectedPreferencePresent: candidates.some(row => row.subject === 'USER' && row.content.includes('종이별')), observations });
  } catch (error) {
    const code = ['LLM_TIMEOUT', 'LLM_INVALID_RESPONSE', 'LLM_UNAVAILABLE', 'LLM_AUTH_FAILED', 'LLM_RATE_LIMITED'].includes(error?.code) ? error.code : 'PROBE_FAILED';
    reports.push({ variant, outcome: 'FAILED', code, observations });
  }
}
const report = { at: new Date().toISOString(), scope: 'One exact synthetic memory input; baseline then diagnostic schema hint. No production prompt/provider changes, no Auth identities or database writes.',
  attempts, measuredNeurons: syntheticResponses.reduce((sum, row) => sum + (row.usage.neurons ?? 0), 0), allAttemptsReportNeurons: syntheticResponses.every(row => typeof row.usage.neurons === 'number'), reports };
mkdirSync('test-results', { recursive: true });
mkdirSync('docs/evidence', { recursive: true });
writeFileSync('test-results/memory-schema-probe-synthetic-responses.json', JSON.stringify(syntheticResponses, null, 2));
writeFileSync('docs/evidence/backend-memory-schema-probe.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
