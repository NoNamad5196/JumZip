import { chromium, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { access, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname, sep } from 'node:path';

const DEFAULT_REPORT = 'docs/evidence/frontend-local-account-boundary.json';
const ENV_KEYS = new Set(['SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'PATH', 'PATHEXT', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'PROGRAMDATA', 'ALLUSERSPROFILE', 'OS']);
const check = (condition, code) => { if (!condition) throw Error(code); };
const hash = value => createHash('sha256').update(value).digest('hex');

async function main() {
  const args = process.argv.slice(2);
  check(args.every(arg => arg === '--run' || arg.startsWith('--report=')) && args.filter(arg => arg.startsWith('--report=')).length <= 1, 'INVALID_ARGUMENTS');
  const reportPath = args.find(arg => arg.startsWith('--report='))?.slice(9) || DEFAULT_REPORT;
  const reportRelative = relative(resolve('docs/evidence'), resolve(reportPath));
  check(reportRelative && !reportRelative.startsWith(`..${sep}`) && reportRelative !== '..' && !isAbsolute(reportRelative) && reportPath.endsWith('.json'), 'REPORT_OUTSIDE_EVIDENCE');
  if (!args.includes('--run')) {
    console.log(JSON.stringify({
      mode: 'PLAN_ONLY', networkRequests: 0, reportPath,
      invocation: 'JUMZIP_RUN_LOCAL_ACCOUNT_BOUNDARY=LOCAL_APPROVED node tests/ui/local-account-boundary-check.mjs --run',
      requirements: ['Main execution GO', 'Local Supabase at http://127.0.0.1:54321', 'Fresh synthetic fixture setup and verified cleanup'],
      checks: ['DELETE confirmation A → B → A reset without submitting', 'Same UID TOKEN_REFRESHED and synthetic anonymous/linked metadata preserve confirmation', 'Memory editing and selected deletion state do not survive identity switches', 'Actual local Auth sessions, browser SDK storage/channel transport and REST/RLS reads'],
      browserWrites: 'Only fixture A/B touch_activity may mutate activity. history_deletion_memories permits only read-only fixture kind/record pairs with fixture bearer; all other RPC/Edge/data mutations are blocked.',
      limits: ['Auth notifications are synthetic cross-tab events using actual local sessions, not signup or Google OAuth.', 'A bridge tab writes localStorage, producing a real storage event, then publishes the SDK BroadcastChannel notification; no React state injection.', 'No CAPTCHA, model, user browser, actual account deletion, trace, HAR, video, credential logging or public dist changes.'],
    }, null, 2)); return;
  }
  check(process.env.JUMZIP_RUN_LOCAL_ACCOUNT_BOUNDARY === 'LOCAL_APPROVED', 'LOCAL_OPT_IN_REQUIRED');
  try { await access(reportPath); throw Error('EXISTING_REPORT_PRESERVED'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const { withLocalUILifecycleFixture } = await import('../backend/local-ui-lifecycle-fixture.mjs');
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const output = resolve(`test-results/local-account-boundary-dist-${stamp}`);
  const artifacts = `tests/ui/artifacts/local-account-boundary-${stamp}`;
  await mkdir(artifacts, { recursive: true });
  const report = {
    checkedAt: new Date().toISOString(), mode: 'LOCAL_AUTH_REST_WITH_SYNTHETIC_AUTH_NOTIFICATION',
    publicSignupTested: false, oauthTested: false, captchaTested: false, modelCalls: 0, accountDeletionSubmitted: false,
    credentialsRecorded: false, reactStateInjected: false, browserProcessEnvironment: 'OS allowlist only',
    actualReadChecks: [], syntheticNotificationChecks: [], errors: [],
    network: { localAuthReads: 0, localRestReads: 0, localHistoryCandidateReads: 0, preflights: 0, localActivityWrites: 0, blockedEdge: 0, blockedMutationOrRpc: 0, blockedExternal: 0, failedReads: 0 },
    passed: false,
  };
  let phase = 'fixture-setup';
  let fixtureStarted = false;
  try {
    fixtureStarted = true;
    await withLocalUILifecycleFixture(async ({ apiUrl, anonKey, sessions, ids, inspectOwner }) => {
      check(apiUrl === 'http://127.0.0.1:54321', 'LOCAL_URL_REQUIRED');
      check(sessions.A.user.id === ids.ownerA && sessions.B.user.id === ids.ownerB && ids.ownerA !== ids.ownerB, 'FIXTURE_IDENTITY_MISMATCH');
      const initialA = await inspectOwner('A'); const initialB = await inspectOwner('B');
      const osEnv = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => ENV_KEYS.has(key.toUpperCase()) && typeof value === 'string'));
      phase = 'separate-local-build';
      const built = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'account-boundary', '--outDir', output, '--logLevel', 'error'], { windowsHide: true, encoding: 'utf8', env: { ...osEnv, VITE_SUPABASE_URL: apiUrl, VITE_SUPABASE_ANON_KEY: anonKey, VITE_TURNSTILE_SITE_KEY: '', VITE_AUTH_GOOGLE_ENABLED: 'false', VITE_AUTH_GITHUB_ENABLED: 'false', VITE_AUTH_EMAIL_ENABLED: 'false' } });
      check(built.status === 0, 'SEPARATE_LOCAL_BUILD_FAILED');
      report.buildOutput = relative(process.cwd(), output).replaceAll('\\', '/');
      report.indexSha256 = hash(await readFile(resolve(output, 'index.html')));
      const publicCsp = (await readFile('public/_headers', 'utf8')).match(/Content-Security-Policy:\s*(.+)/)?.[1];
      check(publicCsp && !publicCsp.includes('unsafe-eval'), 'STRICT_CSP_REQUIRED');
      const localCsp = publicCsp.replace(/connect-src[^;]+/, `connect-src 'self' ${apiUrl}`);
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
      const server = createServer(async (request, response) => {
        try {
          const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
          if (path === '/__qa-auth-bridge') { response.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': localCsp }).end('<!doctype html><title>Local SDK test bridge</title>'); return; }
          let file = resolve(output, `.${path}`);
          if (!file.startsWith(output + sep) && file !== output) { response.writeHead(403).end(); return; }
          if (!extname(file)) file = resolve(output, 'index.html');
          const body = await readFile(file);
          response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'content-security-policy': localCsp, 'cache-control': 'no-store' }).end(body);
        } catch { response.writeHead(404).end(); }
      });
      await new Promise(done => server.listen(0, '127.0.0.1', done));
      const baseURL = `http://127.0.0.1:${server.address().port}`;
      let browser;
      try {
        browser = await chromium.launch({ channel: 'msedge', headless: true, env: osEnv });
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
        const key = 'sb-127-auth-token';
        const fixtureAuthorization = new Set([sessions.A, sessions.B].map(session => 'Bearer ' + session.access_token));
        await context.addInitScript(({ key }) => {
          window.__qaCsp = []; window.__qaStorageChanges = 0; window.__qaAuthNotices = 0;
          document.addEventListener('securitypolicyviolation', event => window.__qaCsp.push(event.effectiveDirective));
          window.addEventListener('storage', event => { if (event.key === key) window.__qaStorageChanges++; });
          const channel = new BroadcastChannel(key); channel.addEventListener('message', () => { window.__qaAuthNotices++; });
        }, { key });
        await context.route('**/*', async route => {
          const request = route.request(), url = new URL(request.url()), method = request.method();
          const read = ['GET', 'HEAD', 'OPTIONS'].includes(method);
          if (url.origin === baseURL && read || ['data:', 'blob:'].includes(url.protocol)) { await route.continue(); return; }
          if (url.origin === apiUrl && url.pathname === '/rest/v1/rpc/touch_activity' && method === 'POST' && fixtureAuthorization.has(request.headers().authorization)) {
            report.network.localActivityWrites++; await route.continue(); return;
          }
          if (url.origin === apiUrl && url.pathname === '/rest/v1/rpc/history_deletion_memories' && method === 'POST' && fixtureAuthorization.has(request.headers().authorization)) {
            let body; try { body = request.postDataJSON(); } catch { /* Reject malformed parameters. */ }
            const permitted = body?.p_kind === 'CONSULTATION' ? [ids.recordOnly, ids.selected, ids.sibling, ids.child] : body?.p_kind === 'CONVERSATION' ? [ids.conversation, ids.disposableConversation] : [];
            if (body && Object.keys(body).length === 2 && permitted.includes(body.p_record_id)) { report.network.localHistoryCandidateReads++; await route.continue(); return; }
          }
          if (url.origin === apiUrl && url.pathname.startsWith('/functions/v1/')) { report.network.blockedEdge++; await route.abort('blockedbyclient'); return; }
          if (url.origin === apiUrl && (url.pathname.startsWith('/rest/v1/rpc/') || !read)) { report.network.blockedMutationOrRpc++; await route.abort('blockedbyclient'); return; }
          if (url.origin === apiUrl && /^\/(auth|rest)\/v1(?:\/|$)/.test(url.pathname) && read) {
            report.network[method === 'OPTIONS' ? 'preflights' : url.pathname.startsWith('/auth/') ? 'localAuthReads' : 'localRestReads']++;
            await route.continue(); return;
          }
          report.network.blockedExternal++; await route.abort('blockedbyclient');
        });
        await context.routeWebSocket('**/*', socket => { report.network.blockedExternal++; socket.close(); });
        const bridge = await context.newPage(); await bridge.goto(`${baseURL}/__qa-auth-bridge`);
        await bridge.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key, session: sessions.A });
        const page = await context.newPage();
        page.on('pageerror', () => report.errors.push('PAGE_ERROR'));
        page.on('requestfailed', request => { const url = new URL(request.url()); if (url.origin === apiUrl && ['GET', 'HEAD'].includes(request.method())) report.network.failedReads++; });
        const goto = path => page.goto(baseURL + path, { waitUntil: 'networkidle' });
        const photo = async name => { const path = `${artifacts}/${name}.png`; await page.screenshot({ path, fullPage: true }); return path; };
        const notify = async (session, event = 'SIGNED_IN') => {
          const previous = await page.evaluate(() => ({ notices: window.__qaAuthNotices, storage: window.__qaStorageChanges }));
          await bridge.evaluate(({ key, session, event }) => {
            // The real storage mutation in another tab generates the native storage event.
            // Auth-js receives the explicit synthetic cross-tab SDK notification.
            localStorage.setItem(key, JSON.stringify(session));
            const channel = new BroadcastChannel(key); channel.postMessage({ event, session }); channel.close();
          }, { key, session, event });
          await expect.poll(() => page.evaluate(() => window.__qaAuthNotices)).toBe(previous.notices + 1);
          return previous.storage;
        };
        const openDelete = async () => { await page.getByRole('button', { name: '계정과 모든 데이터 삭제', exact: true }).click(); return page.getByRole('dialog').getByRole('textbox'); };

        phase = 'settings-confirmation-same-uid';
        await goto('/settings'); await expect(page.getByRole('switch')).toBeEnabled();
        let confirmation = await openDelete(); await confirmation.fill('DELETE');
        await notify(sessions.A, 'TOKEN_REFRESHED'); await expect(confirmation).toHaveValue('DELETE');
        report.syntheticNotificationChecks.push({ name: 'same-UID-TOKEN_REFRESHED-preserves-confirmation', tokenRefreshPerformed: false });
        await notify({ ...sessions.A, user: { ...sessions.A.user, is_anonymous: true } });
        await expect(page.locator('a.settings-link[href="/auth"]')).toHaveCount(1); await expect(confirmation).toHaveValue('DELETE');
        await notify(sessions.A); await expect(page.locator('a.settings-link[href="/auth"]')).toHaveCount(0); await expect(confirmation).toHaveValue('DELETE');
        report.syntheticNotificationChecks.push({ name: 'same-UID-anonymous-to-linked-metadata-preserves-confirmation', serverIdentityLinked: false, screenshot: await photo('same-uid-confirmation') });

        phase = 'settings-A-B-A';
        const storageBeforeB = await notify(sessions.B);
        await expect.poll(() => page.evaluate(() => window.__qaStorageChanges)).toBeGreaterThan(storageBeforeB);
        await expect(page.getByRole('dialog')).toHaveCount(0); confirmation = await openDelete(); await expect(confirmation).toHaveValue('');
        const bPhoto = await photo('owner-B-empty-confirmation');
        await notify(sessions.A); await expect(page.getByRole('dialog')).toHaveCount(0); confirmation = await openDelete(); await expect(confirmation).toHaveValue('');
        report.syntheticNotificationChecks.push({ name: 'real-local-session-A-B-A-SDK-transition-clears-DELETE-and-modal', nativeCrossTabStorageEventObserved: true, accountDeletionSubmitted: false, screenshot: bPhoto });

        phase = 'memory-edit-identity';
        await goto('/history?tab=memory'); await expect(page.locator('article.memory-row')).toHaveCount(4);
        await page.getByRole('button', { name: '기억 수정', exact: true }).first().click();
        const editor = page.getByRole('dialog').getByRole('textbox'); await editor.fill('ACCOUNT_A_UNSAVED_MEMORY_CANARY');
        await notify(sessions.A, 'TOKEN_REFRESHED'); await expect(editor).toHaveValue('ACCOUNT_A_UNSAVED_MEMORY_CANARY');
        await notify(sessions.B); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('article.memory-row')).toHaveCount(0);
        await expect(page.getByText('기억은 천천히 쌓여가요', { exact: true })).toBeVisible(); await expect(page.getByText('ACCOUNT_A_UNSAVED_MEMORY_CANARY', { exact: true })).toHaveCount(0);
        const memoryPhoto = await photo('owner-B-no-memory-draft');
        await notify(sessions.A); await expect(page.locator('article.memory-row')).toHaveCount(4); await expect(page.getByRole('dialog')).toHaveCount(0);
        await page.getByRole('button', { name: '기억 수정', exact: true }).first().click(); await expect(editor).not.toHaveValue('ACCOUNT_A_UNSAVED_MEMORY_CANARY');
        report.syntheticNotificationChecks.push({ name: 'memory-same-UID-preserves-draft-and-A-B-A-discards-it', screenshot: memoryPhoto });
        report.actualReadChecks.push({ name: 'memory-RLS-A-four-B-zero-A-four', actualRestReads: true });

        phase = 'history-selection-identity';
        await goto('/history');
        const row = page.locator('article.record-row').filter({ has: page.getByRole('heading', { name: '기록만 삭제할 상담', exact: true }) });
        await row.getByRole('button', { name: '이 상담 삭제' }).click();
        const memoryChoice = page.getByRole('dialog').getByRole('checkbox', { name: /소나무 산책/ }); await memoryChoice.check();
        await notify(sessions.A, 'TOKEN_REFRESHED'); await expect(memoryChoice).toBeChecked();
        await notify(sessions.B); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByText('아직, 쓰이지 않은 이야기', { exact: true })).toBeVisible();
        await notify(sessions.A); await expect(row).toBeVisible(); await row.getByRole('button', { name: '이 상담 삭제' }).click(); await expect(memoryChoice).not.toBeChecked();
        report.syntheticNotificationChecks.push({ name: 'selected-history-memory-cleared-A-B-A', recordDeletionSubmitted: false, screenshot: await photo('owner-A-return-zero-selection') });
        report.actualReadChecks.push({ name: 'history-and-deletion-candidate-reads-through-current-UID-RLS' });

        phase = 'readonly-and-cleanup-preconditions';
        check(JSON.stringify(await inspectOwner('A')) === JSON.stringify(initialA) && JSON.stringify(await inspectOwner('B')) === JSON.stringify(initialB), 'READONLY_FIXTURE_ROWS_CHANGED');
        report.actualReadChecks.push({ name: 'all-seeded-conversations-consultations-messages-memories-unchanged' });
        check((await page.evaluate(() => window.__qaCsp)).length === 0, 'CSP_VIOLATION');
        check(!report.errors.length && !report.network.failedReads && !report.network.blockedEdge && !report.network.blockedMutationOrRpc && !report.network.blockedExternal, 'UNEXPECTED_BROWSER_REQUEST_OR_ERROR');
        report.passed = true;
        await context.close();
      } finally { if (browser) await browser.close(); await new Promise(done => server.close(done)); }
    });
  } catch {
    // Do not serialize Playwright messages, sessions, request bodies or account IDs.
    report.passed = false; report.failure = { phase, code: 'CHECK_FAILED_SEE_PHASE' }; process.exitCode = 1;
  } finally {
    if (fixtureStarted) {
      try {
        const cleanup = JSON.parse(await readFile('test-results/local-ui-lifecycle-fixture-report.json', 'utf8'));
        check(Date.parse(cleanup.at) >= Date.parse(report.checkedAt), 'STALE_CLEANUP_REPORT');
        report.cleanup = { callbackCompleted: cleanup.callbackCompleted, pendingCleanupCount: cleanup.pendingCleanupCount, identities: cleanup.cleanup, credentialsPersisted: cleanup.credentialsPersisted };
        report.passed &&= cleanup.callbackCompleted && cleanup.pendingCleanupCount === 0 && cleanup.cleanup.length >= 2 && cleanup.cleanup.every(row => row.authAbsent && row.emptyOwnedTables === 15);
      } catch { report.passed = false; report.cleanup = { verified: false }; }
    }
    report.limits = ['Actual local synthetic Auth identities and REST/RLS reads; no public signup, CAPTCHA or OAuth verified.', 'SDK cross-tab notifications and anonymous/linked metadata transitions are explicitly synthetic; no token refresh or identity-link server request.', 'The sole browser mutation exception is actual local touch_activity for fixture A/B; it updates account activity only. The read-only history_deletion_memories RPC additionally requires fixture bearer and kind/record ID. Product data changes, account deletion, all other RPCs, Edge and model calls are blocked.', 'Fixture setup/cleanup uses the Node-only local admin helper; .env files and public dist remain unchanged.'];
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    if (!report.passed) process.exitCode = 1;
    console.log(JSON.stringify({ reportPath, passed: report.passed, actualReadChecks: report.actualReadChecks.length, syntheticNotificationChecks: report.syntheticNotificationChecks.length, pendingCleanup: report.cleanup?.pendingCleanupCount ?? null, failure: report.failure || null }));
  }
}
main().catch(error => { console.error(/^[A-Z_]+$/.test(error.message) ? error.message : 'LOCAL_ACCOUNT_BOUNDARY_FAILED'); process.exitCode = 1; });
