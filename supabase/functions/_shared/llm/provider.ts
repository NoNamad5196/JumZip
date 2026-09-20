import type { LLMMessage } from '../persona/prompt.ts';
import { getTarotMeaning } from '../domain/tarot.ts';
import { getChatResponseDefinition, TAROT_EVIDENCE_SPAN_MAX_LENGTH, type ChatResponseContract } from './chat-contract.ts';
export { CHAT_RESPONSE_SCHEMA } from './chat-contract.ts';

export type LLMErrorCode = 'LLM_NOT_CONFIGURED' | 'LLM_TIMEOUT' | 'LLM_UNAVAILABLE' | 'LLM_AUTH_FAILED' | 'LLM_RATE_LIMITED' | 'LLM_INVALID_RESPONSE' | 'LLM_BUDGET_EXCEEDED';
const VALIDATION_ISSUES = ['JSON_REQUIRED', 'RESPONSE_SCHEMA_INVALID', 'RESPONSE_CONTRACT_MISMATCH', 'MODEL_CONTROL_TEXT', 'PERSONA_BREAK', 'FORBIDDEN_CERTAINTY_OR_DEPENDENCY', 'BOMI_RELATIONSHIP_BOUNDARY', 'TOOL_REFERENCE_INVALID', 'TOOL_RESULT_CHANGED', 'UNSUPPORTED_PROBABILITY', 'TOOL_SCORE_CHANGED', 'TOOL_SCORE_POSSIBILITIES_CHANGED', 'TAROT_EVIDENCE_REQUIRED', 'TAROT_EVIDENCE_SHAPE_INVALID', 'TAROT_EVIDENCE_POSITION_INVALID', 'TAROT_EVIDENCE_KEYWORD_INVALID', 'TAROT_EVIDENCE_SPAN_MISSING', 'TAROT_EVIDENCE_KEYWORD_NOT_IN_SPAN', 'STRUCTURED_VALIDATION_FAILED', 'RESPONSE_VALIDATION_FAILED', 'REPAIR_USER_MESSAGE_MISSING'] as const;
const DIAGNOSTIC_ISSUES = [...VALIDATION_ISSUES, 'HTTP_AUTH_FAILED', 'HTTP_RATE_LIMITED', 'HTTP_UNAVAILABLE', 'NETWORK_ERROR', 'REQUEST_TIMEOUT', 'RESPONSE_BODY_MISSING', 'RESPONSE_BODY_TOO_LARGE', 'RESPONSE_ENVELOPE_JSON_INVALID', 'RESPONSE_ENVELOPE_INVALID', 'RESPONSE_CONTENT_MISSING', 'RESPONSE_INCOMPLETE', 'INTENT_ALIAS_SOURCE_INVALID', 'INTENT_CHOICES_INVALID'] as const;
export type LLMFailureStage = 'TRANSPORT' | 'ENVELOPE' | 'PARSE' | 'VALIDATION';
export type LLMFinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'function_call' | 'OTHER';
export interface LLMDiagnostic { stage: LLMFailureStage; issues: readonly typeof DIAGNOSTIC_ISSUES[number][]; attempts: 1 | 2; finishReason: LLMFinishReason | null }
const knownDiagnosticIssues = new Set<string>(DIAGNOSTIC_ISSUES);
export function safeFinishReason(value: unknown): LLMFinishReason | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' && ['stop', 'length', 'content_filter', 'tool_calls', 'function_call'].includes(value) ? value as LLMFinishReason : 'OTHER';
}
/** Reapply this projection at public boundaries too. Never spread a provider/error object. */
export function safeLLMDiagnostic(value: unknown): LLMDiagnostic | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.stage !== 'string' || !['TRANSPORT', 'ENVELOPE', 'PARSE', 'VALIDATION'].includes(record.stage) || ![1, 2].includes(record.attempts as number)) return undefined;
  const issues = Array.isArray(record.issues) ? [...new Set(record.issues.filter((issue): issue is typeof DIAGNOSTIC_ISSUES[number] => typeof issue === 'string' && knownDiagnosticIssues.has(issue)))].slice(0, 16) : [];
  return Object.freeze({ stage: record.stage as LLMFailureStage, issues: Object.freeze(issues), attempts: record.attempts as 1 | 2, finishReason: safeFinishReason(record.finishReason) });
}
export class LLMError extends Error {
  readonly code: LLMErrorCode;
  readonly retryable: boolean;
  readonly diagnostic?: LLMDiagnostic;
  constructor(code: LLMErrorCode, retryable = true, diagnostic?: unknown) { super(code); this.name = 'LLMError'; this.code = code; this.retryable = retryable; this.diagnostic = safeLLMDiagnostic(diagnostic); }
}
export interface ProviderResult { content: string; model: string; finishReason?: LLMFinishReason | null; usage?: { promptTokens: number; completionTokens: number } }
export type StructuredDiagnosticCode = 'INTENT_ALIAS_SOURCE_INVALID' | 'INTENT_CHOICES_INVALID';
export interface StructuredRequest<T> {
  messages: readonly LLMMessage[]; schema: Record<string, unknown>; validate: (value: unknown) => T; name?: string;
  /** Optional server-owned mapper. Raw exception strings never become repair guidance. */
  diagnoseValidationError?: (error: unknown) => StructuredDiagnosticCode | null;
}
export interface TarotRepairContext {
  expectedCards: readonly { cardId: number; orientation: 'UPRIGHT' | 'REVERSED'; positionIndex: number }[];
}
export interface LLMProvider {
  generateChat(messages: readonly LLMMessage[], contract?: ChatResponseContract): Promise<ProviderResult>;
  generateStructured<T>(input: StructuredRequest<T>): Promise<T>;
  repairChat(messages: readonly LLMMessage[], invalidOutput: string, issues: readonly string[], contract?: ChatResponseContract, context?: TarotRepairContext): Promise<ProviderResult>;
}
export interface FallbackReservationRequest { model: string; maxOutputTokens: number; inputBytes: number }
export interface FallbackUsage { promptTokens: number; completionTokens: number }
export interface FallbackReservation { settle(usage: FallbackUsage): Promise<void> }
export interface OpenAICompatibleConfig {
  baseUrl: string; apiKey?: string; model: string; fetchImpl?: typeof fetch;
  initialTimeoutMs?: number; repairTimeoutMs?: number; maxOutputTokens?: number;
  /** Server-only, separate credential. Used solely after Cloudflare HTTP 429. */
  fallback?: { baseUrl: string; apiKey: string; model: string; reserve(request: FallbackReservationRequest): Promise<FallbackReservation> };
  /** Use json_object for a provider without strict JSON Schema support; runtime validation remains mandatory. */
  structuredFormat?: 'json_schema' | 'json_object';
}

// Bound decoded transport bytes before JSON allocation. A provider may omit or lie about
// Content-Length, and Response.text() would allocate the entire body before validation.
const MAX_RESPONSE_BYTES = 128_000;
const MAX_FALLBACK_INPUT_BYTES = 64_000;
const MAX_FALLBACK_OUTPUT_TOKENS = 900;
function fallbackUsage(value: unknown, inputBytes: number, maxOutputTokens: number): FallbackUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const usage = value as Record<string, unknown>;
  const promptTokens = usage.prompt_tokens, completionTokens = usage.completion_tokens;
  if (typeof promptTokens !== 'number' || !Number.isSafeInteger(promptTokens) || promptTokens < 0 || promptTokens > inputBytes + 1024
    || typeof completionTokens !== 'number' || !Number.isSafeInteger(completionTokens) || completionTokens < 0 || completionTokens > maxOutputTokens) return undefined;
  return { promptTokens, completionTokens };
}
function reservationFailure(error: unknown): LLMError {
  // Only a fixed server-owned code can cross the budget boundary, never its text.
  try {
    if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'LLM_BUDGET_EXCEEDED') return new LLMError('LLM_BUDGET_EXCEEDED', false);
  } catch { /* An untrusted getter is not a budget diagnostic. */ }
  return new LLMError('LLM_RATE_LIMITED');
}

function cancelWithoutWaiting(stream: { cancel: () => Promise<unknown> } | null): void {
  // A hostile/custom stream can return a never-settling cancel promise or throw.
  try { void stream?.cancel().catch(() => {}); } catch { /* Best effort cleanup. */ }
}

/** Repair diagnostics only: never replace output, invent a quote, or decide validity.
 * The validator remains authoritative. Paths and fixed reasons avoid echoing data
 * into the extra feedback; the prior assistant output is already in the repair. */
function canonicalTarotContext(context: TarotRepairContext | undefined) {
  const cards = context?.expectedCards;
  if (!Array.isArray(cards) || cards.length < 1 || cards.length > 3) return null;
  const positions = new Set<number>();
  const requiredToolReferences: TarotRepairContext['expectedCards'][number][] = [];
  for (const card of cards) {
    if (!card || typeof card !== 'object' || !Number.isInteger(card.cardId) || card.cardId < 0 || card.cardId > 21
      || !['UPRIGHT', 'REVERSED'].includes(card.orientation) || !Number.isInteger(card.positionIndex) || card.positionIndex < 0 || card.positionIndex > 2 || positions.has(card.positionIndex)) return null;
    positions.add(card.positionIndex);
    requiredToolReferences.push({ cardId: card.cardId, orientation: card.orientation, positionIndex: card.positionIndex });
  }
  const activeKeywordOptions = requiredToolReferences.map(card => {
    const meaning = getTarotMeaning(card.cardId);
    return { positionIndex: card.positionIndex, items: (card.orientation === 'UPRIGHT' ? meaning.upright : meaning.reversed).map((keyword, index) => ({ index, keyword })) };
  });
  return { requiredToolReferences, activeKeywordOptions };
}

function tarotRepairGuidance(output: string, issues: readonly string[], context?: TarotRepairContext): string {
  const canonical = canonicalTarotContext(context);
  const affectedPositions = new Set<number>();
  let uncertainPosition = false;
  const diagnostics: { path: string; reason: string }[] = [];
  const add = (path: string, reason: string) => {
    if (diagnostics.length < 16 && !diagnostics.some(item => item.path === path && item.reason === reason)) diagnostics.push({ path, reason });
  };
  let value: unknown;
  try { value = JSON.parse(output); } catch { add('/', 'JSON_PARSE_FAILED'); }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const root = value as Record<string, unknown>;
    const rows = root.interpretationEvidence;
    const text = typeof root.text === 'string' ? root.text.trim() : '';
    if (!Array.isArray(rows)) add('/interpretationEvidence', 'ARRAY_REQUIRED');
    else {
      if (rows.length > 3) add('/interpretationEvidence', 'AT_MOST_THREE_ROWS');
      const seen = new Set<number>();
      // Diagnostics stay bounded even when a malformed provider emits many rows.
      for (const [index, row] of rows.slice(0, 12).entries()) {
        const path = `/interpretationEvidence/${index}`;
        if (!row || typeof row !== 'object' || Array.isArray(row)) { add(path, 'OBJECT_REQUIRED'); uncertainPosition = true; continue; }
        const record = row as Record<string, unknown>;
        const before = diagnostics.length;
        if (!Number.isInteger(record.positionIndex)) add(`${path}/positionIndex`, 'INTEGER_REQUIRED');
        else if (seen.has(record.positionIndex as number)) add(`${path}/positionIndex`, 'DUPLICATE_CARD_POSITION');
        else seen.add(record.positionIndex as number);
        const indices = record.keywordIndices;
        if (!Array.isArray(indices) || indices.length < 1 || indices.length > 5 || indices.some(item => !Number.isInteger(item) || item < 0) || new Set(indices).size !== indices.length) add(`${path}/keywordIndices`, 'ONE_TO_FIVE_UNIQUE_NONNEGATIVE_INDICES_REQUIRED');
        const span = record.textEvidence;
        if (typeof span !== 'string' || !span.trim() || span.length > TAROT_EVIDENCE_SPAN_MAX_LENGTH) add(`${path}/textEvidence`, 'SHORT_NONEMPTY_STRING_REQUIRED');
        else if (!text.includes(span)) add(`${path}/textEvidence`, 'NOT_A_CONTIGUOUS_SUBSTRING_OF_TEXT');
        const options = canonical?.activeKeywordOptions.find(item => item.positionIndex === record.positionIndex);
        if (canonical && !options) { add(`${path}/positionIndex`, 'POSITION_NOT_IN_EXPECTED_CARDS'); uncertainPosition = true; }
        if (options && Array.isArray(indices)) for (const [itemIndex, keywordIndex] of indices.slice(0, 5).entries()) {
          const item = Number.isInteger(keywordIndex) ? options.items[keywordIndex] : undefined;
          if (!item) add(`${path}/keywordIndices/${itemIndex}`, 'KEYWORD_INDEX_OUT_OF_RANGE');
          else if (typeof span === 'string' && !span.includes(item.keyword)) add(`${path}/keywordIndices/${itemIndex}`, 'SELECTED_KEYWORD_NOT_IN_TEXT_EVIDENCE');
        }
        if (options && diagnostics.length > before) affectedPositions.add(options.positionIndex);
      }
    }
  }
  const issuePaths: Record<string, string> = {
    TAROT_EVIDENCE_REQUIRED: '/interpretationEvidence', TAROT_EVIDENCE_SHAPE_INVALID: '/interpretationEvidence',
    TAROT_EVIDENCE_POSITION_INVALID: '/interpretationEvidence/*/positionIndex',
    TAROT_EVIDENCE_KEYWORD_INVALID: '/interpretationEvidence/*/keywordIndices',
    TAROT_EVIDENCE_SPAN_MISSING: '/interpretationEvidence/*/textEvidence',
    TAROT_EVIDENCE_KEYWORD_NOT_IN_SPAN: '/interpretationEvidence/*/textEvidence',
  };
  for (const issue of issues) if (Object.hasOwn(issuePaths, issue)) add(issuePaths[issue], issue);
  const allPositions = uncertainPosition || !affectedPositions.size || issues.includes('TOOL_RESULT_CHANGED') || issues.includes('TOOL_REFERENCE_INVALID');
  const canonicalGuidance = canonical ? `\n서버가 저장한 필수 참조와 선택방향 원본 index 표: ${JSON.stringify({ requiredToolReferences: canonical.requiredToolReferences,
    activeKeywordOptions: canonical.activeKeywordOptions.filter(item => allPositions || affectedPositions.has(item.positionIndex)) })}
requiredToolReferences 전체는 재추첨 요청이나 카드를 풀이하지 않는 후속 대화에서도 toolReferences에 그대로 복사합니다. 풀이하지 않은 카드의 interpretationEvidence만 생략할 수 있습니다. 표는 가능한 원본 항목이며 정답을 고른 것이 아닙니다. 실제로 해석할 항목·본문·인용은 직접 선택하고 원본 index와 대조합니다.` : '';
  return `\n타로 근거 수리 안내: 카드 위치당 interpretationEvidence 항목은 하나만 둡니다. 실제로 해석한 카드만 기록하고 전체 카드를 억지로 설명하지 않습니다.
이번 응답에서는 카드마다 선택 방향 activeMeaning의 대표 keyword 항목 하나를 직접 고릅니다. 여러 단어로 된 구절도 하나의 항목입니다. 그 원문 표현을 최종 text에 자연스럽게 포함하고, keywordIndices에는 그 항목의 원본 index 하나를 기록합니다. textEvidence에는 본문에 사용한 그 keyword 항목 전체를 원문 그대로 복사합니다(${TAROT_EVIDENCE_SPAN_MAX_LENGTH}자 이하). 떨어진 단어를 쉼표로 합치거나 본문에 없는 요약 구절을 만들지 않습니다.
본문과 인용을 함께 다시 확인하고 최종 JSON 객체 전체를 출력합니다. 누락된 근거를 꾸미거나 실제 해석의 근거를 빈 배열로 숨기지 않습니다.${canonicalGuidance} 아래 경로는 진단 안내이며 정답이나 대체 근거가 아닙니다: ${JSON.stringify(diagnostics)}`;
}

const structuredDiagnostics: Record<StructuredDiagnosticCode, { path: string; reason: string; instruction: string }> = {
  INTENT_ALIAS_SOURCE_INVALID: { path: '/targetAliasEvidence/source', reason: 'ALIAS_SOURCE_MUST_BE_CURRENT_OR_RECENT_USER',
    instruction: '별칭은 먼저 source의 role을 확인합니다. 현재 발화(source=-1) 또는 전달된 recentMessages의 user 항목만 근거로 쓰고, assistant에만 있는 이름이면 UNRESOLVED를 유지합니다. 그 뒤 해당 원문의 인용을 직접 선택합니다.' },
  INTENT_CHOICES_INVALID: { path: '/choicesEvidence', reason: 'CHOICES_REQUIRE_ZERO_OR_TWO_SEPARATE_SOURCE_QUOTE_OBJECTS',
    instruction: '선택 대안 근거가 없으면 빈 배열을 씁니다. 실제 관련 대안 두 개가 있으면 각각 별도 {source,quote} 객체로 작성합니다. source가 같아도 두 대안을 하나의 긴 인용 객체로 합치지 않습니다.' },
};
function structuredRepairGuidance(code: StructuredDiagnosticCode | null): string {
  if (typeof code !== 'string' || !Object.hasOwn(structuredDiagnostics, code)) return '';
  const { path, reason, instruction } = structuredDiagnostics[code];
  return `\n서버 구조 검증 진단: ${JSON.stringify({ code, path, reason })}\n${instruction}`;
}

/** No mock fallback. Missing endpoint/model fails before making a request. */
export function createOpenAICompatibleProvider(config: OpenAICompatibleConfig): LLMProvider {
  if (!config.baseUrl?.trim() || !config.model?.trim()) throw new LLMError('LLM_NOT_CONFIGURED', false);
  let base: URL;
  try { base = new URL(config.baseUrl); } catch { throw new LLMError('LLM_NOT_CONFIGURED', false); }
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new LLMError('LLM_NOT_CONFIGURED', false);
  const url = config.baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '') + '/chat/completions';
  const cloudflareEndpoint = base.origin === 'https://api.cloudflare.com'
    && /^\/client\/v4\/accounts\/[^/]+\/ai\/v1(?:\/chat\/completions)?\/?$/.test(base.pathname);
  let fallback: Readonly<{ url: string; apiKey: string; model: string; reserve: NonNullable<OpenAICompatibleConfig['fallback']>['reserve']; maxOutputTokens: number }> | undefined;
  if (config.fallback !== undefined) {
    const candidate = config.fallback;
    if (!cloudflareEndpoint || !candidate || typeof candidate !== 'object' || Array.isArray(candidate)
      || candidate.baseUrl !== 'https://api.openai.com/v1'
      || candidate.model !== 'gpt-5.6-luna' || typeof candidate.apiKey !== 'string' || !candidate.apiKey.trim()
      || candidate.apiKey.trim() === config.apiKey?.trim() || typeof candidate.reserve !== 'function'
      || !Number.isSafeInteger(config.maxOutputTokens ?? 900) || (config.maxOutputTokens ?? 900) < 1) throw new LLMError('LLM_NOT_CONFIGURED', false);
    fallback = Object.freeze({ url: `${candidate.baseUrl}/chat/completions`, apiKey: candidate.apiKey.trim(), model: candidate.model, reserve: candidate.reserve, maxOutputTokens: Math.min(config.maxOutputTokens ?? 900, MAX_FALLBACK_OUTPUT_TOKENS) });
  }
  // Sticky only within this provider instance: a controlled repair does not retry
  // an exhausted primary. There is no recursive request or second repair budget.
  let usingFallback = false;
  // Cloudflare's Gemma4 example explicitly disables reasoning this way. Keep this
  // narrow to its actual account API + exact model; other compatible APIs differ.
  // https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/
  const cloudflareGemma = base.origin === 'https://api.cloudflare.com'
    && /^\/client\/v4\/accounts\/[^/]+\/ai\/v1(?:\/chat\/completions)?\/?$/.test(base.pathname)
    && config.model === '@cf/google/gemma-4-26b-a4b-it';
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const initialTimeout = Math.min(config.initialTimeoutMs ?? 60_000, 60_000);
  const repairTimeout = Math.min(config.repairTimeoutMs ?? 30_000, 30_000);
  if (initialTimeout <= 0 || repairTimeout <= 0 || !Number.isFinite(initialTimeout + repairTimeout)) throw new LLMError('LLM_NOT_CONFIGURED', false);

  const request = async (messages: readonly LLMMessage[], schema: Record<string, unknown>, name: string, timeoutMs: number, temperature: number, attempts: 1 | 2 = 1): Promise<ProviderResult> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let stage: LLMFailureStage = 'TRANSPORT';
    let finishReason: LLMFinishReason | null = null;
    const failure = (code: LLMErrorCode, issue: typeof DIAGNOSTIC_ISSUES[number], retryable = true) => new LLMError(code, retryable, { stage, issues: [issue], attempts, finishReason });
    const execute = async (): Promise<ProviderResult> => {
      // Official Qwen3 soft switch, not an undocumented Cloudflare API parameter.
      // Keep the token/time limits and incomplete-response rejection unchanged: the
      // prompt request can reduce reasoning, but is not a hard backend guarantee.
      // JSON object mode guarantees JSON syntax only. Its response_format does not
      // carry a schema, so every request (including repair) must state the actual
      // server-owned schema in the prompt as well. Runtime validation still applies.
      const formatMessages: LLMMessage[] = config.structuredFormat === 'json_object'
        ? [{ role: 'system', content: `출력은 다음 JSON Schema를 만족하는 JSON 객체 하나다. 필수 키, enum, 자료형을 정확히 지킨다. 다른 키나 설명을 추가하지 않는다.\n${JSON.stringify(schema)}` }, ...messages]
        : [...messages];
      let target = usingFallback ? fallback : undefined;
      let settlement: { reservation: FallbackReservation; inputBytes: number; maxOutputTokens: number } | undefined;
      const send = async (secondary: typeof fallback): Promise<Response> => {
        const requestMessages = !secondary && config.model === '@cf/qwen/qwen3-30b-a3b-fp8'
          ? [{ role: 'system' as const, content: '이 요청은 짧은 최종 JSON 응답만 필요하다. /no_think' }, ...formatMessages]
          : formatMessages;
        const apiKey = secondary?.apiKey ?? config.apiKey;
        const responseFormat = config.structuredFormat === 'json_object' ? { type: 'json_object' } : { type: 'json_schema', json_schema: { name, strict: true, schema } };
        // Keep primary serialization unchanged. OpenAI uses a separate documented
        // request dialect; neither CF options nor its credential cross providers.
        const requestBody = JSON.stringify(secondary ? {
          model: secondary.model, messages: requestMessages, reasoning_effort: 'none',
          max_completion_tokens: secondary.maxOutputTokens, store: false, service_tier: 'default', stream: false,
          response_format: responseFormat,
        } : { model: config.model, messages: requestMessages, temperature, max_tokens: config.maxOutputTokens ?? 900, stream: false,
          ...(cloudflareGemma ? { chat_template_kwargs: { enable_thinking: false } } : {}),
          response_format: responseFormat });
        if (controller.signal.aborted) { throw failure('LLM_TIMEOUT', 'REQUEST_TIMEOUT'); }
        if (secondary) {
          const inputBytes = new TextEncoder().encode(requestBody).byteLength;
          if (inputBytes > MAX_FALLBACK_INPUT_BYTES) throw new LLMError('LLM_BUDGET_EXCEEDED', false);
          let reservation: FallbackReservation;
          try {
            reservation = await secondary.reserve(Object.freeze({ model: secondary.model, maxOutputTokens: secondary.maxOutputTokens, inputBytes }));
            if (!reservation || typeof reservation !== 'object' || typeof reservation.settle !== 'function') throw new Error('INVALID_RESERVATION');
          } catch (error) { throw reservationFailure(error); }
          // A late reservation must never start a paid request after the deadline.
          if (controller.signal.aborted) { throw failure('LLM_TIMEOUT', 'REQUEST_TIMEOUT'); }
          settlement = { reservation, inputBytes, maxOutputTokens: secondary.maxOutputTokens };
        }
        return fetchImpl(secondary?.url ?? url, {
          method: 'POST', signal: controller.signal, ...(apiKey ? { redirect: 'error' as const } : {}),
          headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
          body: requestBody,
        });
      };
      let response = await send(target);
      if (controller.signal.aborted) { cancelWithoutWaiting(response.body); throw failure('LLM_TIMEOUT', 'REQUEST_TIMEOUT'); }
      if (response.status === 429 && !target && fallback) {
        cancelWithoutWaiting(response.body);
        usingFallback = true; target = fallback;
        // The same controller/timer bounds both sends and the eventual body read.
        response = await send(target);
      }
      if (controller.signal.aborted) { cancelWithoutWaiting(response.body); throw failure('LLM_TIMEOUT', 'REQUEST_TIMEOUT'); }
      if (!response.ok) {
        cancelWithoutWaiting(response.body);
        if (response.status === 401 || response.status === 403) throw failure('LLM_AUTH_FAILED', 'HTTP_AUTH_FAILED', false);
        if (response.status === 429) throw failure('LLM_RATE_LIMITED', 'HTTP_RATE_LIMITED');
        throw failure('LLM_UNAVAILABLE', 'HTTP_UNAVAILABLE', response.status >= 500 || response.status === 408);
      }
      stage = 'ENVELOPE';
      if (!response.body) throw failure('LLM_INVALID_RESPONSE', 'RESPONSE_BODY_MISSING');
      const reader = response.body.getReader(); activeReader = reader;
      const decoder = new TextDecoder();
      const chunks: string[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (controller.signal.aborted) throw failure('LLM_TIMEOUT', 'REQUEST_TIMEOUT');
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE_BYTES) { cancelWithoutWaiting(reader); throw failure('LLM_INVALID_RESPONSE', 'RESPONSE_BODY_TOO_LARGE'); }
          chunks.push(decoder.decode(value, { stream: true }));
        }
        chunks.push(decoder.decode());
      } finally { activeReader = null; reader.releaseLock(); }
      const raw = chunks.join('');
      let value: unknown;
      try { value = JSON.parse(raw); } catch { throw failure('LLM_INVALID_RESPONSE', 'RESPONSE_ENVELOPE_JSON_INVALID'); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('LLM_INVALID_RESPONSE', 'RESPONSE_ENVELOPE_INVALID');
      const body = value as { choices?: { message?: { content?: unknown }; finish_reason?: string }[]; model?: unknown; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
      const choice = Array.isArray(body.choices) ? body.choices[0] : undefined;
      finishReason = safeFinishReason(choice?.finish_reason);
      if (choice?.finish_reason === 'length') throw failure('LLM_INVALID_RESPONSE', 'RESPONSE_INCOMPLETE');
      if (typeof choice?.message?.content !== 'string' || choice.message.content.length === 0) throw failure('LLM_INVALID_RESPONSE', 'RESPONSE_CONTENT_MISSING');
      // Bill only bounded numeric usage from a successful response envelope. Any
      // missing/invalid usage or failed transport keeps the full conservative hold.
      const paidUsage = settlement ? fallbackUsage(body.usage, settlement.inputBytes, settlement.maxOutputTokens) : undefined;
      if (settlement && paidUsage) {
        try { await settlement.reservation.settle(Object.freeze(paidUsage)); }
        catch { /* Settlement failure preserves the answer and the reserved cost. */ }
        if (controller.signal.aborted) { throw failure('LLM_TIMEOUT', 'REQUEST_TIMEOUT'); }
      }
      return { content: choice.message.content, model: typeof body.model === 'string' ? body.model : target?.model ?? config.model, finishReason,
        ...(settlement ? (paidUsage ? { usage: paidUsage } : {}) : (typeof body.usage?.prompt_tokens === 'number' && typeof body.usage.completion_tokens === 'number' ? { usage: { promptTokens: body.usage.prompt_tokens, completionTokens: body.usage.completion_tokens } } : {})) };
    };
    try {
      return await Promise.race([execute(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); cancelWithoutWaiting(activeReader); reject(failure('LLM_TIMEOUT', 'REQUEST_TIMEOUT')); }, timeoutMs); })]);
    } catch (error) {
      if (controller.signal.aborted) throw failure('LLM_TIMEOUT', 'REQUEST_TIMEOUT');
      if (error instanceof LLMError) throw error;
      // Never return response bodies, raw prompts, keys, or network stack details to the caller.
      throw failure('LLM_UNAVAILABLE', 'NETWORK_ERROR');
    } finally { if (timer !== undefined) clearTimeout(timer); }
  };
  // Only server-defined validator codes may enter system guidance. Never elevate
  // arbitrary caller/model text merely because it arrived in the issues array.
  const knownIssues = new Set<string>(VALIDATION_ISSUES);
  const repairMessages = (messages: readonly LLMMessage[], output: string, issues: readonly string[], contract?: ChatResponseContract, context?: TarotRepairContext, diagnostic: StructuredDiagnosticCode | null = null): LLMMessage[] => {
    const originalUser = messages.at(-1);
    // All production callers end in the actual user/task payload. With no final
    // user, do not invent a request or silently reinterpret older conversation.
    if (originalUser?.role !== 'user') throw new LLMError('LLM_INVALID_RESPONSE', false, { stage: 'VALIDATION', issues: ['REPAIR_USER_MESSAGE_MISSING'], attempts: 1, finishReason: null });
    const safeIssues = [...new Set(issues.map(issue => knownIssues.has(issue) ? issue : 'RESPONSE_VALIDATION_FAILED'))];
    const guidance = `응답 검증에 실패했습니다. 원래 마지막 사용자 요청에 대한 응답을 수리하세요. 수리 안내 자체를 새 사용자 질문이나 대화 자료로 해석하지 않습니다. JSON Schema와 실제 도구 자료를 다시 대조해 JSON 객체 하나를 출력하세요. requiredToolReferences가 있으면 그대로 복사하고, 미확정 값과 가능한 점수 전체를 유지하세요. 시스템의 캐릭터와 원본 도구 결과를 변경하지 않습니다. 오류: ${JSON.stringify(safeIssues)}${contract === 'TAROT_EVIDENCE_V1' ? tarotRepairGuidance(output, safeIssues, context) : ''}${structuredRepairGuidance(diagnostic)}`;
    const cloned = messages.map(message => ({ ...message }));
    if (cloned[0]?.role === 'system') cloned[0].content += `\n\n${guidance}`;
    else cloned.unshift({ role: 'system', content: guidance });
    return [...cloned, { role: 'assistant', content: output }, { ...originalUser }];
  };
  return {
    generateChat: (messages, contract) => {
      const { schema, name } = getChatResponseDefinition(contract);
      return request(messages, schema, name, initialTimeout, 0.65);
    },
    repairChat: async (messages, output, issues, contract, context) => {
      const { schema, name } = getChatResponseDefinition(contract);
      return request(repairMessages(messages, output, issues, contract, context), schema, name, repairTimeout, 0.15, 2);
    },
    async generateStructured<T>(input: StructuredRequest<T>): Promise<T> {
      const first = await request(input.messages, input.schema, input.name ?? 'jumzip_structured', initialTimeout, 0.1);
      let parsed: unknown, parsedSuccessfully = false;
      let diagnostic: StructuredDiagnosticCode | null = null;
      try { parsed = JSON.parse(first.content); parsedSuccessfully = true; } catch { /* Parse failures never enter a validator mapper. */ }
      if (parsedSuccessfully) {
        try { return input.validate(parsed); } catch (error) {
          // One server-selected code only. The mapper cannot supply text, paths,
          // quotes, or a replacement result; its own failure stays generic.
          try {
            const code = input.diagnoseValidationError?.(error);
            if (typeof code === 'string' && Object.hasOwn(structuredDiagnostics, code)) diagnostic = code;
          } catch { /* Preserve the original generic controlled repair. */ }
        }
      }
      const repaired = await request(repairMessages(input.messages, first.content, ['STRUCTURED_VALIDATION_FAILED'], undefined, undefined, diagnostic), input.schema, input.name ?? 'jumzip_structured', repairTimeout, 0.1, 2);
      let repairedValue: unknown;
      try { repairedValue = JSON.parse(repaired.content); }
      catch { throw new LLMError('LLM_INVALID_RESPONSE', true, { stage: 'PARSE', issues: ['JSON_REQUIRED'], attempts: 2, finishReason: repaired.finishReason }); }
      try { return input.validate(repairedValue); }
      catch { throw new LLMError('LLM_INVALID_RESPONSE', true, { stage: 'VALIDATION', issues: ['STRUCTURED_VALIDATION_FAILED'], attempts: 2, finishReason: repaired.finishReason }); }
    },
  };
}
