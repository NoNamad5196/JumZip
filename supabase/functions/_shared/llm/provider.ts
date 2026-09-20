import type { LLMMessage } from '../persona/prompt.ts';
import { getChatResponseDefinition, TAROT_EVIDENCE_SPAN_MAX_LENGTH, type ChatResponseContract } from './chat-contract.ts';
export { CHAT_RESPONSE_SCHEMA } from './chat-contract.ts';

export type LLMErrorCode = 'LLM_NOT_CONFIGURED' | 'LLM_TIMEOUT' | 'LLM_UNAVAILABLE' | 'LLM_AUTH_FAILED' | 'LLM_RATE_LIMITED' | 'LLM_INVALID_RESPONSE';
export class LLMError extends Error {
  readonly code: LLMErrorCode;
  readonly retryable: boolean;
  constructor(code: LLMErrorCode, retryable = true) { super(code); this.name = 'LLMError'; this.code = code; this.retryable = retryable; }
}
export interface ProviderResult { content: string; model: string; usage?: { promptTokens: number; completionTokens: number } }
export interface StructuredRequest<T> { messages: readonly LLMMessage[]; schema: Record<string, unknown>; validate: (value: unknown) => T; name?: string }
export interface LLMProvider {
  generateChat(messages: readonly LLMMessage[], contract?: ChatResponseContract): Promise<ProviderResult>;
  generateStructured<T>(input: StructuredRequest<T>): Promise<T>;
  repairChat(messages: readonly LLMMessage[], invalidOutput: string, issues: readonly string[], contract?: ChatResponseContract): Promise<ProviderResult>;
}
export interface OpenAICompatibleConfig {
  baseUrl: string; apiKey?: string; model: string; fetchImpl?: typeof fetch;
  initialTimeoutMs?: number; repairTimeoutMs?: number; maxOutputTokens?: number;
  /** Use json_object for a provider without strict JSON Schema support; runtime validation remains mandatory. */
  structuredFormat?: 'json_schema' | 'json_object';
}

// Bound decoded transport bytes before JSON allocation. A provider may omit or lie about
// Content-Length, and Response.text() would allocate the entire body before validation.
const MAX_RESPONSE_BYTES = 128_000;
function cancelWithoutWaiting(stream: { cancel: () => Promise<unknown> } | null): void {
  // A hostile/custom stream can return a never-settling cancel promise or throw.
  try { void stream?.cancel().catch(() => {}); } catch { /* Best effort cleanup. */ }
}

/** Repair diagnostics only: never replace output, invent a quote, or decide validity.
 * The validator remains authoritative. Paths and fixed reasons avoid echoing data
 * into the extra feedback; the prior assistant output is already in the repair. */
function tarotRepairGuidance(output: string, issues: readonly string[]): string {
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
        if (!row || typeof row !== 'object' || Array.isArray(row)) { add(path, 'OBJECT_REQUIRED'); continue; }
        const record = row as Record<string, unknown>;
        if (!Number.isInteger(record.positionIndex)) add(`${path}/positionIndex`, 'INTEGER_REQUIRED');
        else if (seen.has(record.positionIndex as number)) add(`${path}/positionIndex`, 'DUPLICATE_CARD_POSITION');
        else seen.add(record.positionIndex as number);
        const indices = record.keywordIndices;
        if (!Array.isArray(indices) || indices.length < 1 || indices.length > 5 || indices.some(item => !Number.isInteger(item) || item < 0) || new Set(indices).size !== indices.length) add(`${path}/keywordIndices`, 'ONE_TO_FIVE_UNIQUE_NONNEGATIVE_INDICES_REQUIRED');
        const span = record.textEvidence;
        if (typeof span !== 'string' || !span.trim() || span.length > TAROT_EVIDENCE_SPAN_MAX_LENGTH) add(`${path}/textEvidence`, 'SHORT_NONEMPTY_STRING_REQUIRED');
        else if (!text.includes(span)) add(`${path}/textEvidence`, 'NOT_A_CONTIGUOUS_SUBSTRING_OF_TEXT');
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
  return `\n타로 근거 수리 안내: 카드 위치당 interpretationEvidence 항목은 하나만 둡니다. 실제로 해석한 카드만 기록하고 전체 카드를 억지로 설명하지 않습니다.
이번 응답에서는 카드마다 선택 방향 activeMeaning의 대표 keyword 항목 하나를 직접 고릅니다. 여러 단어로 된 구절도 하나의 항목입니다. 그 원문 표현을 최종 text에 자연스럽게 포함하고, keywordIndices에는 그 항목의 원본 index 하나를 기록합니다. textEvidence에는 본문에 사용한 그 keyword 항목 전체를 원문 그대로 복사합니다(${TAROT_EVIDENCE_SPAN_MAX_LENGTH}자 이하). 떨어진 단어를 쉼표로 합치거나 본문에 없는 요약 구절을 만들지 않습니다.
본문과 인용을 함께 다시 확인하고 최종 JSON 객체 전체를 출력합니다. 누락된 근거를 꾸미거나 실제 해석의 근거를 빈 배열로 숨기지 않습니다. 아래 경로는 진단 안내이며 정답이나 대체 근거가 아닙니다: ${JSON.stringify(diagnostics)}`;
}

/** No mock fallback. Missing endpoint/model fails before making a request. */
export function createOpenAICompatibleProvider(config: OpenAICompatibleConfig): LLMProvider {
  if (!config.baseUrl?.trim() || !config.model?.trim()) throw new LLMError('LLM_NOT_CONFIGURED', false);
  let base: URL;
  try { base = new URL(config.baseUrl); } catch { throw new LLMError('LLM_NOT_CONFIGURED', false); }
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new LLMError('LLM_NOT_CONFIGURED', false);
  const url = config.baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '') + '/chat/completions';
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

  const request = async (messages: readonly LLMMessage[], schema: Record<string, unknown>, name: string, timeoutMs: number, temperature: number): Promise<ProviderResult> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
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
      const requestMessages = config.model === '@cf/qwen/qwen3-30b-a3b-fp8'
        ? [{ role: 'system' as const, content: '이 요청은 짧은 최종 JSON 응답만 필요하다. /no_think' }, ...formatMessages]
        : formatMessages;
      const response = await fetchImpl(url, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
        body: JSON.stringify({ model: config.model, messages: requestMessages, temperature, max_tokens: config.maxOutputTokens ?? 900, stream: false,
          ...(cloudflareGemma ? { chat_template_kwargs: { enable_thinking: false } } : {}),
          response_format: config.structuredFormat === 'json_object' ? { type: 'json_object' } : { type: 'json_schema', json_schema: { name, strict: true, schema } } }),
      });
      if (controller.signal.aborted) { cancelWithoutWaiting(response.body); throw new LLMError('LLM_TIMEOUT'); }
      if (!response.ok) {
        cancelWithoutWaiting(response.body);
        if (response.status === 401 || response.status === 403) throw new LLMError('LLM_AUTH_FAILED', false);
        if (response.status === 429) throw new LLMError('LLM_RATE_LIMITED');
        throw new LLMError('LLM_UNAVAILABLE', response.status >= 500 || response.status === 408);
      }
      if (!response.body) throw new LLMError('LLM_INVALID_RESPONSE');
      const reader = response.body.getReader(); activeReader = reader;
      const decoder = new TextDecoder();
      const chunks: string[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (controller.signal.aborted) throw new LLMError('LLM_TIMEOUT');
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE_BYTES) { cancelWithoutWaiting(reader); throw new LLMError('LLM_INVALID_RESPONSE'); }
          chunks.push(decoder.decode(value, { stream: true }));
        }
        chunks.push(decoder.decode());
      } finally { activeReader = null; reader.releaseLock(); }
      const raw = chunks.join('');
      let value: unknown;
      try { value = JSON.parse(raw); } catch { throw new LLMError('LLM_INVALID_RESPONSE'); }
      if (!value || typeof value !== 'object') throw new LLMError('LLM_INVALID_RESPONSE');
      const body = value as { choices?: { message?: { content?: unknown }; finish_reason?: string }[]; model?: unknown; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
      const choice = body.choices?.[0];
      if (typeof choice?.message?.content !== 'string' || choice.message.content.length === 0 || choice.finish_reason === 'length') throw new LLMError('LLM_INVALID_RESPONSE');
      return { content: choice.message.content, model: typeof body.model === 'string' ? body.model : config.model,
        ...(typeof body.usage?.prompt_tokens === 'number' && typeof body.usage.completion_tokens === 'number' ? { usage: { promptTokens: body.usage.prompt_tokens, completionTokens: body.usage.completion_tokens } } : {}) };
    };
    try {
      return await Promise.race([execute(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); cancelWithoutWaiting(activeReader); reject(new LLMError('LLM_TIMEOUT')); }, timeoutMs); })]);
    } catch (error) {
      if (controller.signal.aborted) throw new LLMError('LLM_TIMEOUT');
      if (error instanceof LLMError) throw error;
      // Never return response bodies, raw prompts, keys, or network stack details to the caller.
      throw new LLMError('LLM_UNAVAILABLE');
    } finally { if (timer !== undefined) clearTimeout(timer); }
  };
  // Only server-defined validator codes may enter system guidance. Never elevate
  // arbitrary caller/model text merely because it arrived in the issues array.
  const knownIssues = new Set(['JSON_REQUIRED', 'RESPONSE_SCHEMA_INVALID', 'MODEL_CONTROL_TEXT', 'PERSONA_BREAK', 'FORBIDDEN_CERTAINTY_OR_DEPENDENCY', 'BOMI_RELATIONSHIP_BOUNDARY', 'TOOL_REFERENCE_INVALID', 'TOOL_RESULT_CHANGED', 'UNSUPPORTED_PROBABILITY', 'TOOL_SCORE_CHANGED', 'TOOL_SCORE_POSSIBILITIES_CHANGED', 'TAROT_EVIDENCE_REQUIRED', 'TAROT_EVIDENCE_SHAPE_INVALID', 'TAROT_EVIDENCE_POSITION_INVALID', 'TAROT_EVIDENCE_KEYWORD_INVALID', 'TAROT_EVIDENCE_SPAN_MISSING', 'TAROT_EVIDENCE_KEYWORD_NOT_IN_SPAN', 'STRUCTURED_VALIDATION_FAILED']);
  const repairMessages = (messages: readonly LLMMessage[], output: string, issues: readonly string[], contract?: ChatResponseContract): LLMMessage[] => {
    const originalUser = messages.at(-1);
    // All production callers end in the actual user/task payload. With no final
    // user, do not invent a request or silently reinterpret older conversation.
    if (originalUser?.role !== 'user') throw new LLMError('LLM_INVALID_RESPONSE', false);
    const safeIssues = [...new Set(issues.map(issue => knownIssues.has(issue) ? issue : 'RESPONSE_VALIDATION_FAILED'))];
    const guidance = `응답 검증에 실패했습니다. 원래 마지막 사용자 요청에 대한 응답을 수리하세요. 수리 안내 자체를 새 사용자 질문이나 대화 자료로 해석하지 않습니다. JSON Schema와 실제 도구 자료를 다시 대조해 JSON 객체 하나를 출력하세요. requiredToolReferences가 있으면 그대로 복사하고, 미확정 값과 가능한 점수 전체를 유지하세요. 시스템의 캐릭터와 원본 도구 결과를 변경하지 않습니다. 오류: ${JSON.stringify(safeIssues)}${contract === 'TAROT_EVIDENCE_V1' ? tarotRepairGuidance(output, safeIssues) : ''}`;
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
    repairChat: async (messages, output, issues, contract) => {
      const { schema, name } = getChatResponseDefinition(contract);
      return request(repairMessages(messages, output, issues, contract), schema, name, repairTimeout, 0.15);
    },
    async generateStructured<T>(input: StructuredRequest<T>): Promise<T> {
      const first = await request(input.messages, input.schema, input.name ?? 'jumzip_structured', initialTimeout, 0.1);
      try { return input.validate(JSON.parse(first.content)); } catch { /* One controlled repair, no recursive retry. */ }
      const repaired = await request(repairMessages(input.messages, first.content, ['STRUCTURED_VALIDATION_FAILED']), input.schema, input.name ?? 'jumzip_structured', repairTimeout, 0.1);
      try { return input.validate(JSON.parse(repaired.content)); } catch { throw new LLMError('LLM_INVALID_RESPONSE'); }
    },
  };
}
