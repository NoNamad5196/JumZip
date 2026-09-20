import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const invoke = (args: string[]) => execFileSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
const checker = resolve('scripts/openai-fallback-release/check-stage.mjs');

describe('isolated deployed-v4.2 OpenAI budgeted fallback release', () => {
  it('validates exact scope, actual staged replies and paid-transport guards without a network', () => {
    const prepared = JSON.parse(invoke(['scripts/prepare-openai-fallback-release.mjs']));
    const manifest = JSON.parse(readFileSync(resolve(prepared.stage, 'release-manifest.json'), 'utf8'));
    expect(prepared.files).toBe(54);
    expect(prepared.promptVersion).toBe('JumZipPersona-v4.2');
    expect(manifest).toMatchObject({ unchangedFiles: 47, secondaryModel: 'gpt-5.6-luna', paidScope: 'USER_FACING_REPLY_ONLY' });
    expect(manifest.files.filter((file: { added: boolean }) => file.added).map((file: { path: string }) => file.path)).toEqual(['supabase/functions/_shared/llm/budget.ts']);
    const checked = JSON.parse(invoke(['--experimental-transform-types', checker, prepared.stage]));
    expect(checked).toMatchObject({ status: 'OFFLINE_CHECKS_PASSED', stagedTypecheckPassed: true, verifiedFiles: 54, unchangedFiles: 47, sourceFrozen: true, networkRequests: 0, modelRequests: 0, promptVersion: 'JumZipPersona-v4.2', intentVersion: 'JumZipIntent-v1', semanticQuality: 'NOT_EVALUATED', deployed: false });
    expect(checked.checksPassed).toBeGreaterThanOrEqual(16);
    expect(checked.mockRequests).toBeGreaterThan(40);
    // This disposable stage gets no pass report because this test corrupts it deliberately.
    appendFileSync(resolve(prepared.stage, 'supabase/functions/_shared/persona/prompt.ts'), '\n// synthetic integrity mutation\n');
    try {
      invoke(['--experimental-transform-types', checker, prepared.stage]);
      throw Error('TAMPERED_STAGE_ACCEPTED');
    } catch (error) {
      expect(String((error as { stderr?: unknown }).stderr)).toContain('STAGE_HASH_MISMATCH');
    }
  }, 90_000);

  it('rejects non-stage directories before reading staged modules', () => {
    try {
      invoke(['--experimental-transform-types', checker, resolve('.')]);
      throw Error('NON_STAGE_ACCEPTED');
    } catch (error) {
      expect(String((error as { stderr?: unknown }).stderr)).toContain('UNSAFE_STAGE_PATH');
    }
  });
});
