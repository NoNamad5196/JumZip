import { chromium, expect } from '@playwright/test';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, sep } from 'node:path';

const ORIGIN = 'https://jumzip.pages.dev';
const PROJECT_REF = 'klhoarharlmliuynoezq';
const DEFAULT_REPORT = 'docs/evidence/frontend-hosted-readonly.json';
const KINDS = ['tarot', 'sajuKnown', 'sajuUnknown', 'compatibility'];
const BROWSER_ENV_KEYS = new Set(['SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'PATH', 'PATHEXT', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'PROGRAMDATA', 'ALLUSERSPROFILE', 'OS']);
const sha = value => createHash('sha256').update(value).digest('hex');
const check = (condition, code) => { if (!condition) throw Error(code); };

async function main() {
  const args = process.argv.slice(2);
  check(args.every(arg => arg === '--run' || arg.startsWith('--report=')) && args.filter(arg => arg.startsWith('--report=')).length <= 1, 'INVALID_ARGUMENTS');
  const output = args.find(arg => arg.startsWith('--report='))?.slice(9) || DEFAULT_REPORT;
  const relativeOutput = relative(resolve('docs/evidence'), resolve(output));
  check(relativeOutput && !relativeOutput.startsWith(`..${sep}`) && relativeOutput !== '..' && !isAbsolute(relativeOutput) && output.endsWith('.json'), 'REPORT_OUTSIDE_EVIDENCE');
  const plan = {
    mode: 'PLAN_ONLY', target: ORIGIN, projectRef: PROJECT_REF,
    setup: 'Backend-owned helper provisions two synthetic hosted Auth identities and engine/RPC-generated fixtures; sessions remain only in callback memory.',
    browser: 'Fresh contexts allow same-origin GET assets and hosted Auth/REST GET/HEAD/OPTIONS only. RPC, Edge/model endpoints and all mutations are aborted.',
    views: { ownerA: 'history plus Tarot, known Saju, unknown Saju and compatibility at 360 and 1440 px', ownerB: 'empty history and denied access to all four owner A records at 1440 px' },
    exports: 'Four actual PNG downloads at 360 px, default birth data hidden. Top/middle/bottom captures require separate direct AI visual review.',
    output, invocation: 'node --experimental-transform-types tests/ui/hosted-readonly-check.mjs --run',
    requirements: ['Explicit Main execution GO', '--run', 'JUMZIP_RUN_HOSTED_PUBLIC_UI_FIXTURE=HOSTED_APPROVED', 'Current local dist must exactly match public index and all JS/CSS assets'],
    prohibited: ['User browser/IAB or existing user account', 'CAPTCHA/OAuth/signup UI', 'Model/Edge execution', 'Browser mutations/RPC', 'Token/account logs, trace, HAR or video'],
    networkRequests: 0,
  };
  if (!args.includes('--run')) { console.log(JSON.stringify(plan, null, 2)); return; }
  check(process.env.JUMZIP_RUN_HOSTED_PUBLIC_UI_FIXTURE === 'HOSTED_APPROVED', 'HOSTED_OPT_IN_REQUIRED');
  try { await access(output); throw Error('EXISTING_REPORT_PRESERVED'); } catch (error) { if (error.code !== 'ENOENT') throw error; }

  // Importing the credential-owning provisioner is itself deferred until opt-in.
  const { withHostedPublicUIFixture, HOSTED_UI_EXPECTATIONS, HOSTED_UI_FIXTURE_REPORT } = await import('../backend/hosted-public-ui-fixture.mjs');
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const artifactPath = `tests/ui/artifacts/hosted-readonly-${stamp}`;
  await mkdir(artifactPath, { recursive: true });
  const report = {
    checkedAt: new Date().toISOString(), mode: 'PUBLIC_AUTHENTICATED_SYNTHETIC_FIXTURE_READ_ONLY', origin: ORIGIN,
    publicSignupTested: false, captchaTested: false, oauthTested: false, credentialsRecorded: false,
    dataProvenance: 'Backend helper: synthetic identities, deterministic engine/RPC records and TEST_DOUBLE interpretation text. No Persona quality claim.',
    modelCalls: 0, browserMutationsSent: 0, build: [], views: [], exports: [],
    network: { allowedRestReads: 0, allowedAuthReads: 0, preflightRequests: 0, blockedRpc: 0, blockedEdge: 0, blockedMutations: 0, blockedExternal: 0, failedReads: 0 },
    passed: false, visualReview: { status: 'PENDING', required: true },
  };
  let phase = 'public-build-comparison';
  try {
    // Never provision accounts against an unexpected public build.
    const assetNames = (await readdir('dist/assets')).filter(name => /\.(js|css)$/.test(name)).sort();
    for (const path of ['/index.html', ...assetNames.map(name => `/assets/${name}`)]) {
      const local = await readFile(`dist${path}`), response = await fetch(ORIGIN + path, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      const bytes = Buffer.from(await response.arrayBuffer());
      report.build.push({ path, status: response.status, localSha256: sha(local), publicSha256: sha(bytes), match: local.equals(bytes) });
    }
    check(report.build.every(row => row.status === 200 && row.match), 'PUBLIC_BUILD_MISMATCH');
    phase = 'fixture-setup';
    await withHostedPublicUIFixture(async ({ apiUrl, anonKey, sessions, ids }) => {
      check(apiUrl === `https://${PROJECT_REF}.supabase.co` && typeof anonKey === 'string' && anonKey.length > 20, 'UNEXPECTED_FIXTURE_TARGET');
      check(sessions.A.user.id === ids.ownerA && sessions.B.user.id === ids.ownerB && ids.ownerA !== ids.ownerB, 'FIXTURE_IDENTITY_MISMATCH');
      check(KINDS.every(kind => typeof ids[kind]?.consultationId === 'string'), 'FIXTURE_RECORDS_MISSING');
      // The provisioner's private configuration must never reach child browser processes.
      const browserEnv = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => BROWSER_ENV_KEYS.has(key.toUpperCase()) && typeof value === 'string'));
      const browser = await chromium.launch({ channel: 'msedge', headless: true, env: browserEnv });
      try {
        for (const owner of ['A', 'B']) for (const width of owner === 'A' ? [360, 1440] : [1440]) {
          phase = `owner-${owner}-${width}-context`;
          const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true, serviceWorkers: 'block' });
          try {
            const storageKey = `sb-${PROJECT_REF}-auth-token`;
            await context.addInitScript(({ storageKey, session }) => {
              localStorage.setItem(storageKey, JSON.stringify(session));
              window.__qaCsp = [];
              document.addEventListener('securitypolicyviolation', event => window.__qaCsp.push(event.effectiveDirective));
            }, { storageKey, session: sessions[owner] });
            await context.route('**/*', async route => {
              const request = route.request(), url = new URL(request.url()), read = ['GET', 'HEAD', 'OPTIONS'].includes(request.method());
              if (url.origin === ORIGIN && read) { await route.continue(); return; }
              if (url.origin === apiUrl) {
                if (url.pathname.startsWith('/functions/')) { report.network.blockedEdge++; await route.abort('blockedbyclient'); return; }
                if (url.pathname.startsWith('/rest/v1/rpc/')) { report.network.blockedRpc++; await route.abort('blockedbyclient'); return; }
                if (read && /^\/(auth|rest)\/v1(?:\/|$)/.test(url.pathname)) {
                  if (request.method() === 'OPTIONS') report.network.preflightRequests++;
                  else report.network[url.pathname.startsWith('/rest/') ? 'allowedRestReads' : 'allowedAuthReads']++;
                  await route.continue(); return;
                }
              }
              report.network[read ? 'blockedExternal' : 'blockedMutations']++; await route.abort('blockedbyclient');
            });
            await context.routeWebSocket('**/*', websocket => { report.network.blockedExternal++; websocket.close(); });
            const page = await context.newPage();
            let pageErrors = [], failedReads = [], apiResponses = [];
            page.on('pageerror', () => pageErrors.push('PAGE_ERROR'));
            page.on('requestfailed', request => {
              const url = new URL(request.url());
              if (url.origin === apiUrl && ['GET', 'HEAD'].includes(request.method()) && !url.pathname.startsWith('/rest/v1/rpc/')) {
                failedReads.push({ type: url.pathname.startsWith('/rest/') ? 'REST' : 'AUTH', error: request.failure()?.errorText || 'FAILED' }); report.network.failedReads++;
              }
            });
            page.on('response', response => {
              const url = new URL(response.url());
              if (url.origin === apiUrl && url.pathname.startsWith('/rest/v1/') && !url.pathname.includes('/rpc/')) apiResponses.push({ type: 'REST', status: response.status(), corsOrigin: response.headers()['access-control-allow-origin'] || null });
            });
            for (const kind of ['history', ...KINDS]) {
              phase = `owner-${owner}-${width}-${kind}`;
              pageErrors = []; failedReads = []; apiResponses = [];
              const path = kind === 'history' ? '/history' : `/reading/${ids[kind].consultationId}`;
              const first = await page.goto(ORIGIN + path, { waitUntil: 'networkidle' });
              await page.locator('main:not([role="status"])').waitFor();
              const reload = await page.reload({ waitUntil: 'networkidle' });
              await page.locator('main:not([role="status"])').waitFor(); await page.evaluate(() => document.fonts.ready);
              if (owner === 'B') {
                await expect(page.getByText(kind === 'history' ? '아직, 쓰이지 않은 이야기' : '이 이야기를 찾을 수 없어요', { exact: true })).toBeVisible();
                await expect(page.locator('.record-row, .reading-export')).toHaveCount(0);
              } else if (kind === 'history') {
                await expect(page.locator('article.record-row')).toHaveCount(4);
                for (const recordKind of KINDS) await expect(page.getByRole('heading', { name: titleFor(HOSTED_UI_EXPECTATIONS, recordKind), exact: true })).toBeVisible();
              } else {
                await expect(page.locator('.reading-export')).toBeVisible();
                await expect(page.getByRole('button', { name: '결과 이미지 저장', exact: true })).toBeEnabled({ timeout: 20000 });
                await expect(page.locator('.reading-export .reading-hero h2')).toHaveText(titleFor(HOSTED_UI_EXPECTATIONS, kind));
                const content = await page.locator('.reading-export').innerText();
                check(content.includes(HOSTED_UI_EXPECTATIONS.interpretationPrefix), 'PERSISTED_TEST_DOUBLE_INTERPRETATION_MISSING');
                for (const canary of birthCanaries(HOSTED_UI_EXPECTATIONS)) check(!content.includes(canary), 'DEFAULT_BIRTH_CANARY_VISIBLE');
                await expect(page.getByRole('switch', { name: /이미지에 상세 출생 정보 포함/ })).not.toBeChecked();
                if (width === 360) {
                  const started = Date.now(), downloadPromise = page.waitForEvent('download', { timeout: 120000 });
                  await page.getByRole('button', { name: '결과 이미지 저장', exact: true }).click();
                  const download = await downloadPromise, pngPath = `${artifactPath}/export-${kind}.png`; await download.saveAs(pngPath);
                  const png = await readFile(pngPath); check(png.subarray(1, 4).toString() === 'PNG', 'PNG_INVALID');
                  report.exports.push({ kind, path: pngPath, width: png.readUInt32BE(16), height: png.readUInt32BE(20), bytes: png.length, sha256: sha(png), generationMs: Date.now() - started, structuredBirthHiddenInExportDOM: true, reviewCaptures: await inspectPng(browser, pngPath, artifactPath, kind) });
                }
              }
              const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, csp: window.__qaCsp, brokenImages: [...document.images].filter(image => image.complete && !image.naturalWidth).length }));
              const screenshot = `${artifactPath}/${owner}-${kind}-${width}.png`; await page.screenshot({ path: screenshot, fullPage: true });
              const view = { owner, kind, width, status: first.status(), reloadStatus: reload.status(), ...geometry, pageErrors: [...pageErrors], failedReads: [...failedReads], apiResponses: [...apiResponses], screenshot };
              report.views.push(view);
              check(first.status() === 200 && reload.status() === 200 && geometry.scrollWidth === width && !geometry.csp.length && !geometry.brokenImages && !pageErrors.length && !failedReads.length, 'READ_ONLY_VIEW_FAILED');
              check(apiResponses.length > 0 && apiResponses.every(response => response.status < 400 && [ORIGIN, '*'].includes(response.corsOrigin)), 'REST_READ_OR_CORS_FAILED');
            }
          } finally { await context.close(); }
        }
        report.passed = report.views.length === 15 && report.exports.length === 4 && !report.network.blockedRpc && !report.network.blockedEdge && !report.network.blockedMutations && !report.network.blockedExternal && !report.network.failedReads;
      } finally { await browser.close(); }
    }, { expectedProjectRef: PROJECT_REF });
    const cleanup = JSON.parse(await readFile(HOSTED_UI_FIXTURE_REPORT, 'utf8'));
    report.cleanup = safeCleanup(cleanup);
    check(report.cleanup.status === 'PASS' && report.cleanup.sourceFrozen && report.cleanup.credentialsPersisted === false && report.cleanup.pendingCleanupCount === 0 && report.cleanup.identities.length === 2 && report.cleanup.identities.every(row => row.authAbsent && row.emptyOwnedTables === 15), 'FIXTURE_CLEANUP_NOT_CONFIRMED');
  } catch (error) {
    report.passed = false;
    // Report only this script's constant codes. Never serialize request/session data
    // or a provider/SDK error body, assertion dump, account ID or email.
    const message = String(error?.message || '');
    report.failure = { phase, code: /^[A-Z][A-Z0-9_]{2,80}$/.test(message) ? message : 'CHECK_FAILED' };
    try { report.cleanup = safeCleanup(JSON.parse(await readFile(HOSTED_UI_FIXTURE_REPORT, 'utf8'))); } catch { report.cleanup = { confirmed: false }; }
    process.exitCode = 1;
  } finally {
    report.passScope = 'AUTOMATED_READ_ONLY_CHECKS_ONLY_UNTIL_SEPARATE_VISUAL_REVIEW';
    report.limits = ['Synthetic hosted Auth identities and admin-seeded test records; not public signup, anonymous signup, CAPTCHA or OAuth validation.', 'Browser GET responses came from the actual hosted service with RLS and CORS. No fixture API response interception; forbidden writes/Edge requests were aborted.', 'PNG birth privacy assertions cover structured fixture fields. User-authored titles/interpretation may contain personal information and are not automatically scrubbed.', 'Raw session/credentials/account identifiers and traces/HAR/video are never written to reports. Only synthetic page screenshots and exports are saved.'];
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ output, passed: report.passed, views: report.views.length, exports: report.exports.length, network: report.network, failure: report.failure || null }));
    if (!report.passed) process.exitCode = 1;
  }
}

function titleFor(expected, kind) {
  const value = expected.titles?.[kind] ?? expected[kind]?.title;
  check(typeof value === 'string' && value.length > 0, 'EXPECTED_TITLE_MISSING'); return value;
}
function birthCanaries(expected) {
  const values = expected.birthCanaries;
  check(Array.isArray(values) && values.length >= 3 && values.every(value => typeof value === 'string' && value.length > 0), 'EXPECTED_BIRTH_CANARIES_MISSING'); return values;
}
function safeCleanup(value) {
  return { status: value.status, sourceFrozen: value.sourceFrozen, pendingCleanupCount: value.pendingCleanupCount, callbackCompleted: value.callbackCompleted, credentialsPersisted: value.credentialsPersisted,
    identities: Array.isArray(value.cleanup) ? value.cleanup.map(row => ({ authAbsent: row.authAbsent, emptyOwnedTables: row.emptyOwnedTables })) : [] };
}
async function inspectPng(browser, path, directory, kind) {
  // Separate file-only image inspection context cannot reuse a hosted session.
  const context = await browser.newContext({ viewport: { width: 640, height: 900 } });
  try {
    await context.route('**/*', route => new URL(route.request().url()).protocol === 'file:' ? route.continue() : route.abort());
    const page = await context.newPage(); await page.goto(`file:///${resolve(path).replaceAll('\\', '/')}`);
    await page.locator('img').evaluate(image => { document.body.style.margin = '0'; image.style.cssText = 'display:block;width:640px;height:auto;max-width:none;max-height:none;'; });
    const height = await page.locator('img').evaluate(image => image.getBoundingClientRect().height), captures = [];
    for (const [name, top] of [['top', 0], ['middle', Math.max(0, height / 2 - 450)], ['bottom', Math.max(0, height - 900)]]) {
      await page.evaluate(top => scrollTo(0, top), top); const capture = `${directory}/export-${kind}-${name}.png`; await page.screenshot({ path: capture }); captures.push(capture);
    }
    return captures;
  } finally { await context.close(); }
}

await main();
