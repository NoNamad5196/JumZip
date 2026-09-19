export interface MaintenanceTask { task: 'MEMORY' | 'TITLE'; run(): Promise<unknown> }
export interface MaintenanceEvent {
  event: 'reply_maintenance'; task: MaintenanceTask['task']; outcome: 'COMPLETED' | 'FAILED';
  code: string | null; durationMs: number;
}
export interface BackgroundRuntime { waitUntil(promise: Promise<unknown>): void }
const allowedCodes = new Set([
  'LLM_NOT_CONFIGURED', 'LLM_TIMEOUT', 'LLM_UNAVAILABLE', 'LLM_AUTH_FAILED', 'LLM_RATE_LIMITED', 'LLM_INVALID_RESPONSE',
  'MEMORY_STATE_UNAVAILABLE', 'MEMORY_SOURCE_UNAVAILABLE', 'SUMMARY_SOURCE_UNAVAILABLE', 'MEMORY_WRITE_UNAVAILABLE',
  'MEMORY_FORMAT_INVALID', 'SUMMARY_INVALID', 'TITLE_INVALID', 'INTERNAL_ERROR', 'NOT_FOUND',
]);
function safeCode(error: unknown): string {
  // Accessors are untrusted too. Never serialize an exception, cause, body, or stack.
  try {
    if (error && typeof error === 'object') {
      const code = 'code' in error ? error.code : error instanceof Error ? error.message : undefined;
      if (typeof code === 'string' && allowedCodes.has(code)) return code;
    }
  } catch { /* Use a constant diagnostic if even reading the code fails. */ }
  return 'MAINTENANCE_UNAVAILABLE';
}
export async function runReplyMaintenance(tasks: readonly MaintenanceTask[], report: (event: MaintenanceEvent) => void,
  now: () => number = Date.now): Promise<void> {
  await Promise.all(tasks.map(async ({ task, run }) => {
    const started = now();
    let code: string | null = null;
    try { await run(); } catch (error) { code = safeCode(error); }
    const elapsed = now() - started;
    const durationMs = Number.isFinite(elapsed) ? Math.max(0, Math.min(86_400_000, Math.round(elapsed))) : 0;
    // COMPLETED means the optional task settled normally, not that it necessarily inserted a row.
    // Identifiers and content are deliberately absent; the platform supplies invocation metadata.
    try { report({ event: 'reply_maintenance', task, outcome: code ? 'FAILED' : 'COMPLETED', code, durationMs }); }
    catch { /* Diagnostics cannot turn committed Chat success into failure. */ }
  }));
}
export function scheduleReplyMaintenance(runtime: BackgroundRuntime | undefined, tasks: readonly MaintenanceTask[],
  report: (event: MaintenanceEvent) => void = event => console.info(JSON.stringify(event))): void {
  if (!runtime) return;
  runtime.waitUntil(runReplyMaintenance(tasks, report));
}
