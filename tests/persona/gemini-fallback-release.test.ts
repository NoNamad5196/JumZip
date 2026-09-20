import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const invoke = (args: string[]) => execFileSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
const checker = resolve('scripts/gemini-fallback-release/check-stage.mjs');

describe('isolated deployed-v4 Gemini HTTP429 fallback release', () => {
  it('reconstructs all 53 deployed files and validates actual staged reply/transport without a network', () => {
    const prepared = JSON.parse(invoke(['scripts/prepare-gemini-fallback-release.mjs']));
    expect(prepared.files).toBe(53);
    expect(prepared.promptVersion).toBe('JumZipPersona-v4');
    expect(prepared.secondaryModel).toBe('gemini-3.5-flash');
    expect(prepared.changedFiles).toEqual(['supabase/functions/_shared/llm/provider.ts', 'supabase/functions/_shared/orchestration/execute.ts']);
    // This disposable stage is deliberately corrupted below; do not leave a pass report beside it.
    const checked = JSON.parse(invoke(['--experimental-transform-types', checker, prepared.stage]));
    expect(checked).toMatchObject({ status: 'OFFLINE_CHECKS_PASSED', stagedTypecheckPassed: true, verifiedFiles: 53, unchangedFiles: 51, sourceFrozen: true, networkRequests: 0, modelRequests: 0, promptVersion: 'JumZipPersona-v4', intentVersion: 'JumZipIntent-v1', semanticQuality: 'NOT_EVALUATED', deployed: false });
    expect(checked.checksPassed).toBeGreaterThanOrEqual(10);
    expect(checked.mockRequests).toBeGreaterThan(20);
    // A manifest must not bless a changed deployed prompt merely because it typechecks.
    appendFileSync(resolve(prepared.stage, 'supabase/functions/_shared/persona/prompt.ts'), '\n// synthetic integrity mutation\n');
    try {
      invoke(['--experimental-transform-types', checker, prepared.stage]);
      throw Error('TAMPERED_STAGE_ACCEPTED');
    } catch (error) {
      expect(String((error as { stderr?: unknown }).stderr)).toContain('STAGE_HASH_MISMATCH');
    }
  }, 90_000);

  it('rejects a non-stage directory before module imports', () => {
    try {
      invoke(['--experimental-transform-types', checker, resolve('.')]);
      throw Error('NON_STAGE_ACCEPTED');
    } catch (error) {
      expect(String((error as { stderr?: unknown }).stderr)).toContain('UNSAFE_STAGE_PATH');
    }
  });
});
