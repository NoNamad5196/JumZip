import type { ApiError } from '../contracts/index.ts';
import { safeLLMDiagnostic } from '../llm/provider.ts';

export class ApiFailure extends Error {
  constructor(public code: string, public status: number, message: string, public retryable = false, public details?: Record<string, unknown>) { super(message); }
  toJSON(): ApiError { return { code: this.code, message: this.message, retryable: this.retryable, ...(this.details ? { details: this.details } : {}) }; }
}
const providerReasons = new Set(['LLM_TIMEOUT', 'LLM_INVALID_RESPONSE', 'LLM_UNAVAILABLE', 'LLM_NOT_CONFIGURED', 'LLM_AUTH_FAILED', 'LLM_RATE_LIMITED', 'LLM_BUDGET_EXCEEDED']);
/** A stored PARTIAL wrapper must retain the actual provider reason, never arbitrary details. */
export function partialFailureDetails(failure: ApiFailure): Record<string, unknown> {
  const candidate = failure.details?.reason;
  const reason = typeof candidate === 'string' && providerReasons.has(candidate) ? candidate : failure.code;
  const diagnostic = providerReasons.has(reason) ? safeLLMDiagnostic({ stage: failure.details?.kind, issues: failure.details?.issues, attempts: failure.details?.attempts, finishReason: failure.details?.finishReason }) : undefined;
  return { reason, ...(diagnostic ? { kind: diagnostic.stage, issues: [...diagnostic.issues], attempts: diagnostic.attempts, finishReason: diagnostic.finishReason } : {}) };
}
export function safeFailure(error: unknown): ApiFailure {
  if (error instanceof ApiFailure) return error;
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  const code = typeof record.code === 'string' ? record.code : '';
  // Even a forged error-like object passes through the fixed projection again.
  const diagnostic = safeLLMDiagnostic(record.diagnostic);
  const details = { reason: code, ...(diagnostic ? { kind: diagnostic.stage, issues: [...diagnostic.issues], attempts: diagnostic.attempts, finishReason: diagnostic.finishReason } : {}) };
  if (code === 'LLM_TIMEOUT') return new ApiFailure(code, 504, '응답 생성 시간이 초과되었습니다.', true, details);
  if (code === 'LLM_INVALID_RESPONSE') return new ApiFailure(code, 502, '응답 형식을 확인하지 못했습니다.', true, details);
  if (code === 'LLM_UNAVAILABLE') return new ApiFailure(code, 502, '응답 서비스에 연결하지 못했습니다.', true, details);
  if (code === 'LLM_RATE_LIMITED') return new ApiFailure('LLM_UNAVAILABLE', 502, '응답 서비스가 현재 요청을 제한하고 있습니다. 잠시 후 다시 시도해 주세요.', true, details);
  if (code === 'LLM_BUDGET_EXCEEDED') return new ApiFailure('LLM_UNAVAILABLE', 503, '보조 AI의 이용 한도 또는 사용 기간을 확인할 수 없어 답변 생성을 멈췄습니다.', false, details);
  if (['LLM_NOT_CONFIGURED', 'LLM_AUTH_FAILED'].includes(code)) return new ApiFailure('LLM_UNAVAILABLE', 502, '응답 서비스에 연결하지 못했습니다.', false, details);
  return new ApiFailure('INTERNAL_ERROR', 500, '요청을 처리하지 못했습니다.', true);
}
