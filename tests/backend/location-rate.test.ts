import { describe, expect, it, vi } from 'vitest';
import { createActionExecutor } from '../../supabase/functions/_shared/orchestration/execute.ts';
import { ApiFailure } from '../../supabase/functions/_shared/http/errors.ts';
import type { Repository } from '../../supabase/functions/_shared/persistence/repository.ts';

const request = { schemaVersion: 1 as const, requestId: '50000000-0000-4000-8000-000000000001', action: 'RESOLVE_LOCATION' as const, query: '서울', limit: 8 };
describe('location autocomplete abuse boundary', () => {
  it('charges the authenticated user before any upstream lookup without claiming a mutation', async () => {
    const consumeLocationRateLimit = vi.fn().mockResolvedValue(undefined); const resolveLocation = vi.fn().mockResolvedValue({ locations: [] });
    const repository = { beginChat: vi.fn(), beginFortune: vi.fn() } as unknown as Repository;
    const execute = createActionExecutor({ repository, generate: vi.fn(), consumeLocationRateLimit, resolveLocation });
    await execute('saju', request, { id: 'verified-owner', isAnonymous: true });
    expect(consumeLocationRateLimit).toHaveBeenCalledWith('verified-owner');
    expect(consumeLocationRateLimit.mock.invocationCallOrder[0]).toBeLessThan(resolveLocation.mock.invocationCallOrder[0]!);
    expect(repository.beginChat).not.toHaveBeenCalled(); expect(repository.beginFortune).not.toHaveBeenCalled();
  });
  it('does not call the upstream service after a rate-limit denial or missing limiter configuration', async () => {
    const resolveLocation = vi.fn(); const repository = {} as Repository;
    const execute = createActionExecutor({ repository, generate: vi.fn(), resolveLocation, consumeLocationRateLimit: vi.fn().mockRejectedValue(new ApiFailure('RATE_LIMITED', 429, '잠시 후', true, { retryAfterSeconds: 30 })) });
    await expect(execute('saju', request, { id: 'owner', isAnonymous: true })).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    await expect(createActionExecutor({ repository, generate: vi.fn(), resolveLocation })('saju', request, { id: 'owner', isAnonymous: true })).rejects.toMatchObject({ status: 503 });
    expect(resolveLocation).not.toHaveBeenCalled();
  });
});
