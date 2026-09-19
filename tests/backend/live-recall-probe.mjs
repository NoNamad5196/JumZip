// Controlled analogous recall, not an exact replay of the cleaned-up v3 account.
// node --env-file=.env.server.local tests/backend/live-recall-probe.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createOpenAICompatibleProvider } from '../../supabase/functions/_shared/llm/provider.ts';
import { extractToolRecommendation } from '../../supabase/functions/_shared/llm/intent.ts';
import { generatePersonaReply, PERSONA_PROMPT_VERSION } from '../../supabase/functions/_shared/llm/reply.ts';
import { validateChatOutput } from '../../supabase/functions/_shared/llm/validator.ts';

const { LLM_BASE_URL: baseUrl, LLM_MODEL: model, LLM_API_KEY: apiKey, LLM_STRUCTURED_FORMAT: format } = process.env;
if (!baseUrl || !model || !apiKey) throw new Error('Configured private provider environment is required.');
const currentMessage = '내가 오래 즐겨 온 취미가 무엇이었는지 기억하고 있으면 말해 줘.';
// Literal from the successful, schema-controlled synthetic extraction probe.
// The original v3 runtime memory row was deleted during verified account cleanup.
const memory = { id: '11111111-1111-4111-8111-111111111111', scope: 'GLOBAL', category: 'PREFERENCE', subject: 'USER',
  content: '종이별 접기를 오래 즐기고 있으며, 꾸준히 만드는 종이별을 가장 좋아함', importance: 5 };
const safeUsage = value => Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens', 'neurons'].filter(key => typeof value?.[key] === 'number' && Number.isFinite(value[key])).map(key => [key, value[key]]));
const sources = ['llm/provider.ts', 'llm/reply.ts', 'llm/intent.ts', 'llm/validator.ts', 'persona/prompt.ts', 'persona/tool-facts.ts', 'persona/config.ts', 'persona/context.ts'];
const sourceHashes = Object.fromEntries(sources.map(path => [path, createHash('sha256').update(readFileSync(`supabase/functions/_shared/${path}`, 'utf8').replace(/\r\n/g, '\n')).digest('hex')]));
const observations = [], syntheticResponses = [];
let attempts = 0;
function provider(phase, options) {
  return createOpenAICompatibleProvider({ baseUrl, model, apiKey, structuredFormat: format === 'json_object' ? 'json_object' : 'json_schema', ...options,
    async fetchImpl(url, init) {
      attempts += 1;
      if (attempts > 4) throw new Error('Diagnostic HTTP-attempt ceiling exceeded.');
      const started = Date.now();
      const response = await fetch(url, init);
      const body = await response.clone().json();
      const choice = body.choices?.[0];
      const content = typeof choice?.message?.content === 'string' ? choice.message.content : null;
      const validation = phase === 'RECALL' && content ? validateChatOutput(content, { characterId: 'BOMI', currentMessage }) : null;
      const observation = { phase, httpStatus: response.status, latencyMs: Date.now() - started,
        finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null, contentPresent: Boolean(content),
        usage: safeUsage(body.usage), validation: validation ? { ok: validation.ok, issues: validation.ok ? [] : validation.issues } : null };
      observations.push(observation);
      // Retain only synthetic model content and numeric/allowlisted observations.
      // Never retain URLs, request headers, credentials, response headers, or IDs.
      syntheticResponses.push({ ...observation, content });
      return response;
    },
  });
}
let recommendation = null, outcome, failureCode = null, replyRepaired = null, recallsPreference = null;
try {
  recommendation = await extractToolRecommendation(provider('INTENT', { initialTimeoutMs: 8_000, repairTimeoutMs: 3_000, maxOutputTokens: 350 }),
    { currentMessage, recentMessages: [], hasOwnBirthData: false, hasPartnerBirthData: false });
  const input = { characterId: 'BOMI', relationshipState: 'FIRST_MEETING', currentMessage, recentMessages: [], summary: '', memories: [memory],
    ...(recommendation ? { currentTask: `현재 이야기에 자연스럽게 답한다. 다음은 서버의 도구 제안이며 실행 결과가 아니다: ${JSON.stringify(recommendation)}. 도구를 사용하기 전 사용자가 직접 선택해야 한다. 필요한 정보가 있으면 핵심 한 가지만 캐릭터 말투로 묻되 정확한 생년월일이나 생시는 채팅에 요구하지 않고 출생 정보 입력 화면으로 안내한다. 준비된 카드나 사주 결과를 꾸미지 않는다.` } : {}) };
  const reply = await generatePersonaReply(provider('RECALL', { initialTimeoutMs: 60_000, repairTimeoutMs: 30_000, maxOutputTokens: 900 }), input);
  outcome = 'SUCCEEDED'; replyRepaired = reply.repaired; recallsPreference = /종이별/.test(reply.content);
} catch (error) {
  outcome = 'FAILED';
  failureCode = ['LLM_TIMEOUT', 'LLM_INVALID_RESPONSE', 'LLM_UNAVAILABLE', 'LLM_AUTH_FAILED', 'LLM_RATE_LIMITED'].includes(error?.code) ? error.code : 'PROBE_FAILED';
}
const unchangedSources = sources.every(path => sourceHashes[path] === createHash('sha256').update(readFileSync(`supabase/functions/_shared/${path}`, 'utf8').replace(/\r\n/g, '\n')).digest('hex'));
const report = { at: new Date().toISOString(), scope: 'Controlled analogous recall with the original synthetic question and a previously validated synthetic preference; not an exact replay of the cleaned-up v3 runtime context. No Auth or database writes.',
  promptVersion: PERSONA_PROMPT_VERSION, sourceHashes, unchangedSources, currentMessage, memorySource: 'Successful schema-controlled synthetic extraction from backend-memory-schema-probe',
  toolResult: null, relationshipState: 'FIRST_MEETING', historicalMessageCount: 0, summaryPresent: false,
  recommendation: recommendation ? { tools: recommendation.recommendedTools.map(row => ({ tool: row.tool, mode: row.mode, missingSlotCount: row.missingSlots.length })) } : null,
  outcome, failureCode, replyRepaired, recallsPreference, attempts, measuredNeurons: observations.reduce((sum, row) => sum + (row.usage.neurons ?? 0), 0),
  allAttemptsReportNeurons: observations.every(row => typeof row.usage.neurons === 'number'), observations,
  conclusionLimit: 'A successful analogous response cannot identify the cause of the original v3 LLM_INVALID_RESPONSE; only captured validation results explain this probe.' };
mkdirSync('test-results', { recursive: true }); mkdirSync('docs/evidence', { recursive: true });
writeFileSync('test-results/recall-probe-v4-synthetic-responses.json', JSON.stringify(syntheticResponses, null, 2));
writeFileSync('docs/evidence/backend-recall-probe-v4.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
