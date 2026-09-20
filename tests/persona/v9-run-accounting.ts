/** Runner bookkeeping only. A prepared request is not an actual HTTP attempt. */
export interface MicroEntryProgress {
  id: string;
  actualHTTPAttempts: number;
  completionStatus: 'VALID' | 'INVALID' | 'INTERRUPTED';
}
export function summarizeMicroProgress(order: readonly string[], entries: readonly MicroEntryProgress[]) {
  const attemptedIds = order.filter(id => entries.some(entry => entry.id === id && entry.actualHTTPAttempts > 0));
  const completedIds = order.filter(id => entries.some(entry => entry.id === id && entry.actualHTTPAttempts > 0 && entry.completionStatus !== 'INTERRUPTED'));
  return {
    attemptedIds, completedIds,
    pendingIds: order.filter(id => !completedIds.includes(id)),
    neverAttemptedIds: order.filter(id => !attemptedIds.includes(id)),
  };
}
