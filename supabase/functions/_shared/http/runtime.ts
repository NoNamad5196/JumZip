import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHandler } from './handler.ts';
import { ApiFailure } from './errors.ts';
import type { Endpoint } from '../validation/requests.ts';
import { createExecutor } from '../orchestration/execute.ts';
import { createBoundedFetch } from './network.ts';

type EdgeRuntime = { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void };
export function environment(name: string): string | undefined {
  return (globalThis as unknown as { Deno?: EdgeRuntime }).Deno?.env.get(name);
}
export async function authenticateCurrentUser(client: SupabaseClient, token: string) {
  const { data, error } = await client.auth.getUser(token);
  if (error && (error.name === 'AuthRetryableFetchError' || !error.status || error.status >= 500 || error.status === 408 || error.status === 429)) throw new ApiFailure('INTERNAL_ERROR', 503, '인증 서버에 연결하지 못했습니다.', true);
  if (error || !data.user) throw new ApiFailure('AUTH_EXPIRED', 401, '인증이 만료되었습니다.');
  return { id: data.user.id, isAnonymous: Boolean(data.user.is_anonymous) };
}
export function makeRuntimeHandler(endpoint: Endpoint) {
  const url = environment('SUPABASE_URL');
  const key = environment('SUPABASE_SERVICE_ROLE_KEY');
  const allowedOrigins = (environment('ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(value => value.trim()).filter(Boolean);
  const client = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: createBoundedFetch() } }) : null;
  const execute = client ? createExecutor(client, environment) : null;
  return createHandler(endpoint, {
    allowedOrigins,
    async authenticate(token) {
      if (!client) throw new ApiFailure('INTERNAL_ERROR', 500, '서버 연결 설정이 필요합니다.', false, { reason: 'NOT_CONFIGURED' });
      return authenticateCurrentUser(client, token);
    },
    async execute(functionName, input, user, deadlineAt) {
      if (!execute) throw new ApiFailure('INTERNAL_ERROR', 500, '서버 연결 설정이 필요합니다.', false, { reason: 'NOT_CONFIGURED' });
      return execute(functionName, input, user, deadlineAt);
    },
  });
}
export function serve(endpoint: Endpoint): void {
  const deno = (globalThis as unknown as { Deno?: EdgeRuntime }).Deno;
  if (deno) deno.serve(makeRuntimeHandler(endpoint));
}
