import type { SupabaseClient } from '@supabase/supabase-js';

/** Administrative maintenance only. The RPC owns the 90-day cutoff, identity recheck,
 * server activity timestamp and cascading deletion. Never expose through a user action. */
export async function cleanupInactiveAnonymous(client: SupabaseClient, limit = 100): Promise<{ deletedCount: number }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new RangeError('CLEANUP_LIMIT_INVALID');
  const { data, error } = await client.rpc('cleanup_inactive_anonymous', { p_limit: limit });
  if (error || !Number.isInteger(data) || data < 0) throw new Error('ACCOUNT_CLEANUP_FAILED');
  return { deletedCount: data };
}
