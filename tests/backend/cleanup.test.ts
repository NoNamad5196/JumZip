import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanupInactiveAnonymous } from '../../supabase/functions/_shared/persistence/cleanup.ts';

describe('anonymous account retention maintenance boundary', () => {
  it('lets the database calculate the retention cutoff and returns only aggregate counts', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 2, error: null });
    expect(await cleanupInactiveAnonymous({ rpc } as unknown as SupabaseClient)).toEqual({ deletedCount: 2 });
    expect(rpc).toHaveBeenCalledWith('cleanup_inactive_anonymous', { p_limit: 100 });
  });
  it('rejects unsafe batch sizes before calling the destructive RPC', async () => {
    const rpc = vi.fn();
    for (const limit of [0, 1001, 1.5, NaN]) await expect(cleanupInactiveAnonymous({ rpc } as unknown as SupabaseClient, limit)).rejects.toThrow('CLEANUP_LIMIT_INVALID');
    expect(rpc).not.toHaveBeenCalled();
  });
});
