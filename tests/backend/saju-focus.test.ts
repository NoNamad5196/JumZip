import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createSajuRepository } from '../../supabase/functions/_shared/persistence/saju.ts';

const userId = '11111111-1111-4111-8111-111111111111';
const snapshot = { consultationId: '22222222-2222-4222-8222-222222222222', conversationId: '33333333-3333-4333-8333-333333333333' };
function fixture(rows: unknown, status = 200) {
  const requests: URL[] = [];
  const fetcher = vi.fn<typeof fetch>(async input => {
    requests.push(new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url));
    return new Response(JSON.stringify(rows), { status, headers: { 'content-type': 'application/json' } });
  });
  const client = createClient('https://synthetic.invalid', 'synthetic-test-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher },
  });
  return { readings: createSajuRepository(client), requests, fetcher };
}

describe('stored Saju retry focus repository boundary', () => {
  it.each(['GENERAL', 'CAREER', 'RELATIONSHIP', 'YEAR_FLOW', 'MONTH_FLOW'] as const)('restores exact stored %s without model inference', async focus => {
    const { readings, requests, fetcher } = fixture([{ question: focus }]);
    expect(await readings.readFocus(userId, snapshot)).toBe(focus);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = requests[0]!;
    expect(url.pathname).toBe('/rest/v1/consultations');
    expect(Object.fromEntries(url.searchParams)).toEqual({ select: 'question', id: `eq.${snapshot.consultationId}`,
      user_id: `eq.${userId}`, conversation_id: `eq.${snapshot.conversationId}`, fortune_type: 'eq.SAJU' });
  });

  it('rejects an absent or filtered-out parent instead of inventing GENERAL', async () => {
    const { readings } = fixture([]);
    await expect(readings.readFocus(userId, snapshot)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404, retryable: false });
  });

  it.each([null, undefined, '', 'year_flow', ' YEAR_FLOW', 'YEAR_FLOW ', 'PERSONALITY', 'PRIVATE_INVALID_CONTEXT', 123, {}])('rejects corrupt context %# without coercion or content disclosure', async question => {
    const { readings } = fixture([{ question }]);
    const failure = await readings.readFocus(userId, snapshot).catch(error => error);
    expect(failure).toMatchObject({ code: 'SAJU_INPUT_INCOMPLETE', status: 422, retryable: false });
    expect(failure.toJSON()).toEqual({ code: 'SAJU_INPUT_INCOMPLETE', message: '저장된 사주 상담의 질문 유형을 확인하지 못했습니다.', retryable: false });
  });

  it('sanitizes database failures rather than treating them as missing context', async () => {
    const { readings } = fixture({ code: 'XX000', message: 'PRIVATE_DATABASE_DIAGNOSTIC' }, 500);
    const failure = await readings.readFocus(userId, snapshot).catch(error => error);
    expect(failure.status).toBe(500);
    expect(JSON.stringify(failure.toJSON())).not.toContain('PRIVATE_DATABASE_DIAGNOSTIC');
    expect(failure.code).not.toBe('SAJU_INPUT_INCOMPLETE');
  });
});
