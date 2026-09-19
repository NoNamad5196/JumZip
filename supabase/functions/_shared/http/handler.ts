import type { ApiError } from '../contracts/index.ts';
import { requestSchemas, type ActionRequest, type Endpoint } from '../validation/requests.ts';
import { ApiFailure, safeFailure } from './errors.ts';

export type AuthenticatedUser = { id: string; isAnonymous: boolean };
export type ActionOutput = { data: unknown; status?: number };
export interface HttpDependencies {
  allowedOrigins: readonly string[];
  authenticate(token: string): Promise<AuthenticatedUser>;
  execute(endpoint: Endpoint, input: ActionRequest, user: AuthenticatedUser, deadlineAt: number): Promise<ActionOutput>;
  now?: () => Date;
}
const MAX_JSON_BYTES = 32_768;
const BODY_TIMEOUT_MS = 5_000;
async function readLimitedBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_JSON_BYTES) throw new ApiFailure('VALIDATION_ERROR', 400, '요청이 너무 큽니다.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiFailure('VALIDATION_ERROR', 400, 'JSON 요청이 필요합니다.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async () => {
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_JSON_BYTES) throw new ApiFailure('VALIDATION_ERROR', 400, '요청이 너무 큽니다.');
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new ApiFailure('VALIDATION_ERROR', 400, '유효한 JSON 요청이 필요합니다.'); }
  };
  try { return await Promise.race([read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ApiFailure('VALIDATION_ERROR', 408, '요청 데이터 수신 시간이 초과되었습니다.', true)), BODY_TIMEOUT_MS); })]); }
  finally {
    if (timer !== undefined) clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
    try { reader.releaseLock(); } catch { /* Already released. */ }
  }
}

export function createHandler(endpoint: Endpoint, dependencies: HttpDependencies) {
  return async (request: Request): Promise<Response> => {
    const deadlineAt = Date.now() + 100_000;
    let requestId = crypto.randomUUID();
    const origin = request.headers.get('origin');
    const allowed = !origin || dependencies.allowedOrigins.includes(origin);
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin' });
    if (origin && allowed) headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Max-Age', '600');
    const reply = (body: { ok: true; data: unknown } | { ok: false; error: ApiError }, status: number) => new Response(JSON.stringify({ ...body, meta: { requestId, schemaVersion: 1, createdAt: (dependencies.now?.() ?? new Date()).toISOString() } }), { status, headers });
    try {
      if (!allowed) throw new ApiFailure('FORBIDDEN', 403, '허용되지 않은 요청 출처입니다.');
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (request.method !== 'POST') throw new ApiFailure('VALIDATION_ERROR', 400, 'POST 요청만 지원합니다.');
      if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type') ?? '')) throw new ApiFailure('VALIDATION_ERROR', 400, 'application/json 형식이 필요합니다.');
      const authorization = request.headers.get('authorization');
      const bearer = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
      if (!bearer || bearer.length > 8192) throw new ApiFailure('AUTH_REQUIRED', 401, '인증이 필요합니다.');
      // Auth server lookup (not local JWT decoding) rejects already deleted accounts.
      const user = await dependencies.authenticate(bearer);
      const body = await readLimitedBody(request);
      if (body && typeof body === 'object' && 'requestId' in body && typeof body.requestId === 'string' && /^[\da-f-]{36}$/i.test(body.requestId)) requestId = body.requestId as `${string}-${string}-${string}-${string}-${string}`;
      const parsed = requestSchemas[endpoint].safeParse(body);
      if (!parsed.success) throw new ApiFailure('VALIDATION_ERROR', 400, '입력값을 확인해 주세요.', false, { fields: [...new Set(parsed.error.issues.map(issue => issue.path.join('.')))].slice(0, 20) });
      const result = await dependencies.execute(endpoint, parsed.data, user, deadlineAt);
      return reply({ ok: true, data: result.data }, result.status ?? 200);
    } catch (error) {
      const failure = safeFailure(error);
      if (failure.status === 429 && typeof failure.details?.retryAfterSeconds === 'number') headers.set('Retry-After', String(failure.details.retryAfterSeconds));
      return reply({ ok: false, error: failure.toJSON() }, failure.status);
    }
  };
}
