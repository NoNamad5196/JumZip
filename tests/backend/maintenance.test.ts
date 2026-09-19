import { describe, expect, it, vi } from 'vitest';
import { scheduleReplyMaintenance, runReplyMaintenance, type MaintenanceEvent } from '../../supabase/functions/_shared/orchestration/maintenance.ts';

describe('background maintenance execution and safe diagnostics', () => {
  it('registers pending work with waitUntil and lets an independent task finish first', async () => {
    let rejectMemory!: (error: unknown) => void;
    const pendingMemory = new Promise((_resolve, reject) => { rejectMemory = reject; });
    const waitUntil = vi.fn(); const report = vi.fn();
    scheduleReplyMaintenance({ waitUntil }, [
      { task: 'MEMORY', run: () => pendingMemory },
      { task: 'TITLE', run: async () => undefined },
    ], report);
    expect(waitUntil).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ task: 'TITLE', outcome: 'COMPLETED' }));
    rejectMemory({ code: 'LLM_INVALID_RESPONSE', message: 'private model output', cause: 'private key' });
    await expect(waitUntil.mock.calls[0]![0]).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ task: 'MEMORY', outcome: 'FAILED', code: 'LLM_INVALID_RESPONSE' }));
    expect(JSON.stringify(report.mock.calls)).not.toContain('private');
  });
  it('reports only allowlisted failure codes and bounded timing, never arbitrary exception fields', async () => {
    const events: MaintenanceEvent[] = [];
    const error = new Error('bearer=private-token user=private-id', { cause: 'sensitive content' });
    await runReplyMaintenance([{ task: 'MEMORY', run: async () => { throw error; } }], event => events.push(event), () => Number.POSITIVE_INFINITY);
    expect(events).toEqual([{ event: 'reply_maintenance', task: 'MEMORY', outcome: 'FAILED', code: 'MAINTENANCE_UNAVAILABLE', durationMs: 0 }]);
  });
  it('isolates synchronous provider setup failure and diagnostic sink failure from other work', async () => {
    const title = vi.fn().mockResolvedValue(undefined), report = vi.fn(() => { throw new Error('log sink down'); });
    await expect(runReplyMaintenance([
      { task: 'MEMORY', run: () => { throw { code: 'LLM_NOT_CONFIGURED' }; } },
      { task: 'TITLE', run: title },
    ], report)).resolves.toBeUndefined();
    expect(title).toHaveBeenCalledOnce(); expect(report).toHaveBeenCalledTimes(2);
  });
  it('never starts provider work where the background runtime is absent', () => {
    const run = vi.fn(), report = vi.fn();
    scheduleReplyMaintenance(undefined, [{ task: 'MEMORY', run }], report);
    expect(run).not.toHaveBeenCalled(); expect(report).not.toHaveBeenCalled();
  });
  it('does not evaluate a throwing exception accessor outside its safe boundary', async () => {
    const report = vi.fn();
    await expect(runReplyMaintenance([{ task: 'MEMORY', run: async () => { throw { get code() { throw new Error('private'); } }; } }], report)).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ code: 'MAINTENANCE_UNAVAILABLE' }));
  });
});
