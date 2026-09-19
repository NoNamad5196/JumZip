import type { ApiError } from '../contracts/index.ts';

export class ApiFailure extends Error {
  constructor(public code: string, public status: number, message: string, public retryable = false, public details?: Record<string, unknown>) { super(message); }
  toJSON(): ApiError { return { code: this.code, message: this.message, retryable: this.retryable, ...(this.details ? { details: this.details } : {}) }; }
}
export function safeFailure(error: unknown): ApiFailure {
  if (error instanceof ApiFailure) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (code === 'LLM_TIMEOUT') return new ApiFailure(code, 504, '응답 생성 시간이 초과되었습니다.', true);
  if (code === 'LLM_INVALID_RESPONSE') return new ApiFailure(code, 502, '응답 형식을 확인하지 못했습니다.', true);
  if (code === 'LLM_UNAVAILABLE') return new ApiFailure(code, 502, '응답 서비스에 연결하지 못했습니다.', true);
  if (['LLM_NOT_CONFIGURED', 'LLM_AUTH_FAILED', 'LLM_RATE_LIMITED'].includes(code)) return new ApiFailure('LLM_UNAVAILABLE', 502, '응답 서비스에 연결하지 못했습니다.', code === 'LLM_RATE_LIMITED', { reason: code });
  return new ApiFailure('INTERNAL_ERROR', 500, '요청을 처리하지 못했습니다.', true);
}
