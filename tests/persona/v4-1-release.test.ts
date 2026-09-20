import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('isolated deployed-v4 TEXT_ONLY release', () => {
  it('reconstructs the exact base then validates all staged modules without a network', () => {
    const prepared = JSON.parse(execFileSync(process.execPath, ['scripts/prepare-chat-reliability-release.mjs'], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    expect(prepared.files).toBe(54);
    expect(prepared.promptVersion).toBe('JumZipPersona-v4.1');
    expect(prepared.intentVersion).toBe('JumZipIntent-v1');
    const checked = JSON.parse(execFileSync(process.execPath, ['--experimental-transform-types', resolve('scripts/chat-reliability-release/check-stage.mjs'), prepared.stage, '--save-report'], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }));
    expect(checked).toMatchObject({ status: 'OFFLINE_CHECKS_PASSED', stagedTypecheckPassed: true, verifiedFiles: 54, sourceFrozen: true, networkRequests: 0, modelRequests: 0, capturedResponses: 2, semanticQuality: 'NOT_EVALUATED', deployed: false });
    expect(checked.checksPassed).toBeGreaterThanOrEqual(15);
  }, 90_000);
});
