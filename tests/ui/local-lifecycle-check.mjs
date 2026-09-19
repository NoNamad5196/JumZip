import { chromium, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { withLocalUILifecycleFixture } from '../backend/local-ui-lifecycle-fixture.mjs';

// Real local Auth/PostgREST only. The controlled slow/404 Edge responses below
// are explicitly synthetic; no Edge or model request leaves this browser.
const reportPath = 'docs/evidence/frontend-local-authenticated-lifecycle.json';
const artifacts = 'tests/ui/artifacts/local-lifecycle';
const output = resolve('test-results/local-ui-lifecycle-dist');
const report = { checkedAt: new Date().toISOString(), mode: 'LOCAL_SYNTHETIC_IDENTITIES_REAL_AUTH_REST_WITH_SEPARATE_MOCK_EDGE', publicSignupTested: false, oauthTested: false, captchaTested: false, modelCalls: 0, credentialsRecorded: false, actualDatabaseChecks: [], mockedTransportChecks: [], errors: [], network: { localAuth: 0, localRest: 0, mockedEdge: 0, blockedExternal: 0 }, passed: false };
const ensure = (condition, message) => { if (!condition) throw Error(message); };
await mkdir(artifacts, { recursive: true });
let phase = 'setup';
try {
  await withLocalUILifecycleFixture(async ({ apiUrl, anonKey, sessions, ids, inspectOwner }) => {
    ensure(apiUrl === 'http://127.0.0.1:54321', 'LOCAL_URL_REQUIRED');
    const built = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'ui-lifecycle', '--outDir', output, '--logLevel', 'error'], { windowsHide: true, encoding: 'utf8', env: { ...process.env, VITE_SUPABASE_URL: apiUrl, VITE_SUPABASE_ANON_KEY: anonKey, VITE_TURNSTILE_SITE_KEY: '', VITE_AUTH_GOOGLE_ENABLED: 'false', VITE_AUTH_EMAIL_ENABLED: 'false' } });
    ensure(built.status === 0, 'SEPARATE_LOCAL_BUILD_FAILED');
    const index = await readFile(resolve(output, 'index.html'));
    report.localBuildIndexSha256 = createHash('sha256').update(index).digest('hex');
    report.buildOutput = 'test-results/local-ui-lifecycle-dist';
    const publicCsp = (await readFile('public/_headers', 'utf8')).match(/Content-Security-Policy:\s*(.+)/)?.[1];
    ensure(publicCsp && !publicCsp.includes('unsafe-eval'), 'STRICT_CSP_REQUIRED');
    const localCsp = publicCsp.replace(/connect-src[^;]+/, `connect-src 'self' ${apiUrl}`);
    report.cspNote = 'Production directives preserved except connect-src restricted to self and the actual local Auth/REST origin.';
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
    const server = createServer(async (request, response) => {
      try {
        const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        let file = resolve(output, `.${path}`);
        if (!file.startsWith(output + sep) && file !== output) { response.writeHead(403).end(); return; }
        if (!extname(file)) file = resolve(output, 'index.html');
        response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'content-security-policy': localCsp, 'cache-control': 'no-store' }).end(await readFile(file));
      } catch { response.writeHead(404).end(); }
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const baseURL = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    let mode = 'deny';
    const held = [];
    const mockedBodies = [];
    const key = 'sb-127-auth-token';
    try {
      await context.addInitScript(({ key, session }) => {
        if (!sessionStorage.getItem('jumzip-ui-fixture-seeded')) {
          localStorage.setItem(key, JSON.stringify(session));
          sessionStorage.setItem('jumzip-ui-fixture-seeded', 'true');
        }
        window.__qaCsp = [];
        document.addEventListener('securitypolicyviolation', event => window.__qaCsp.push(event.effectiveDirective));
      }, { key, session: sessions.A });
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === baseURL || ['data:', 'blob:'].includes(url.protocol)) { await route.continue(); return; }
        if (url.origin === apiUrl && /^\/(auth|rest)\/v1(?:\/|$)/.test(url.pathname)) {
          report.network[url.pathname.startsWith('/auth/') ? 'localAuth' : 'localRest'] += 1;
          await route.continue(); return;
        }
        if (url.origin === apiUrl && url.pathname.startsWith('/functions/v1/')) {
          report.network.mockedEdge += 1;
          const body = request.postDataJSON(); mockedBodies.push(body);
          const meta = { schemaVersion: 1, requestId: body.requestId, createdAt: new Date().toISOString() };
          if (mode === 'not-found') {
            await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: '삭제된 합성 상담입니다.', retryable: false }, meta }) }); return;
          }
          if (mode === 'hold') {
            let release; const waiting = new Promise(done => { release = done; }); held.push({ release, body });
            await waiting;
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { conversationId: ids.conversation, consultationId: ids.sibling, assistantMessage: { id: randomUUID(), characterId: 'ARANG', content: 'MOCK_LATE_RESPONSE_MUST_NOT_APPEAR' } }, meta }) }).catch(() => {});
            return;
          }
          report.errors.push('UNEXPECTED_EDGE_REQUEST'); await route.abort(); return;
        }
        report.network.blockedExternal += 1; await route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', () => report.errors.push('PAGE_ERROR'));
      const goto = path => page.goto(`${baseURL}${path}`, { waitUntil: 'networkidle' });
      const photo = async name => { const path = `${artifacts}/${name}.png`; await page.screenshot({ path, fullPage: true }); return path; };
      const switchIdentity = async session => {
        // Simulates the SDK's documented cross-tab notification transport using
        // a real local session. It is not an OAuth, signup or login UI test.
        await page.evaluate(({ key, session }) => {
          localStorage.setItem(key, JSON.stringify(session));
          const channel = new BroadcastChannel(key);
          channel.postMessage({ event: 'SIGNED_IN', session }); channel.close();
        }, { key, session });
      };
      const stateA = () => inspectOwner('A');
      const row = title => page.locator('article.record-row').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
      const memoryCheck = async (selector, check) => {
        await page.getByRole('dialog').getByRole('checkbox', { name: selector }).waitFor();
        const checkboxes = page.getByRole('dialog').getByRole('checkbox');
        for (const checkbox of await checkboxes.all()) await expect(checkbox).not.toBeChecked();
        if (check) await page.getByRole('dialog').getByRole('checkbox', { name: selector }).check();
      };

      phase = 'real-default-consultation-deletion';
      await goto('/history'); await expect(row('기록만 삭제할 상담')).toBeVisible();
      await row('기록만 삭제할 상담').getByRole('button', { name: '이 상담 삭제' }).click();
      await memoryCheck(/소나무 산책/, false);
      await page.getByRole('button', { name: '기록만 삭제', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0); await expect(row('기록만 삭제할 상담')).toHaveCount(0);
      let state = await stateA(); ensure(!state.consultations.some(row => row.id === ids.recordOnly) && state.memories.length === 4 && state.consultations.length === 3, 'DEFAULT_DELETE_PRESERVATION_FAILED');
      report.actualDatabaseChecks.push({ name: 'consultation-default-selection-zero-and-record-only-delete', memoriesRetained: 4, consultationsRetained: 3 });

      phase = 'real-selected-consultation-deletion';
      await row('기억을 선택해 삭제할 상담').getByRole('button', { name: '이 상담 삭제' }).click();
      await memoryCheck(/별빛 도예/, true);
      await page.getByRole('button', { name: '기록과 기억 1개 삭제' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
      state = await stateA(); ensure(state.consultations.length === 2 && !state.memories.some(row => row.id === ids.memories.removeSelected) && state.memories.some(row => row.id === ids.memories.keep), 'SELECTED_DELETE_FAILED');
      await page.reload({ waitUntil: 'networkidle' }); await expect(row('남겨둘 형제 상담')).toBeVisible(); await expect(row('기억을 선택해 삭제할 상담')).toHaveCount(0);
      report.actualDatabaseChecks.push({ name: 'consultation-selected-memory-only-delete-and-reload', memoriesRetained: 3, siblingRetained: true, screenshot: await photo('consultation-after-deletion') });

      phase = 'real-conversation-deletion';
      await page.getByRole('button', { name: '전체 대화', exact: true }).click();
      await row('실제 로컬 DB 대화 삭제 확인').getByRole('button', { name: '상담 기록 삭제' }).click();
      await memoryCheck(/달빛 공예/, true); await page.getByRole('button', { name: '기록과 기억 1개 삭제' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
      state = await stateA(); ensure(state.conversations.length === 1 && state.consultations.length === 1 && state.messages.length === 1 && state.memories.length === 2, 'CONVERSATION_CASCADE_FAILED');
      ensure(state.memories.some(row => row.id === ids.memories.keepIndependent && row.source_conversation_id === null), 'INDEPENDENT_MEMORY_NOT_RETAINED');
      await page.getByRole('button', { name: '기억하고 있는 이야기', exact: true }).click();
      await expect(page.getByText('소나무 산책이라는 합성 취향은 보존합니다.', { exact: true })).toBeVisible();
      await expect(page.getByText('해솔 그림이라는 독립 합성 기억은 보존합니다.', { exact: true })).toBeVisible();
      await expect(page.getByText(/별빛 도예|달빛 공예/)).toHaveCount(0);
      report.actualDatabaseChecks.push({ name: 'conversation-selected-memory-delete-cascade-and-unselected-memory-detachment', conversationsRetained: 1, consultationsRetained: 1, messagesRetained: 1, memoriesRetained: 2, screenshot: await photo('memory-after-deletion') });

      phase = 'actual-deleted-detail-and-mock-terminal-response';
      await goto(`/reading/${ids.selected}`); await expect(page.getByText('이 이야기를 찾을 수 없어요', { exact: true })).toBeVisible();
      report.actualDatabaseChecks.push({ name: 'deleted-reading-reload-does-not-reappear', screenshot: await photo('deleted-reading') });
      mode = 'not-found'; await goto(`/chat/arang?conversation=${ids.conversation}&consultation=${ids.selected}`);
      const composer = page.getByRole('textbox', { name: '아랑에게 보낼 이야기' });
      await composer.fill('삭제 이후에도 보존할 합성 초안'); await page.getByRole('button', { name: '이야기 보내기' }).click();
      await expect(page.getByRole('button', { name: '새 이야기로 이어가기' })).toBeVisible(); await expect(composer).toHaveValue('삭제 이후에도 보존할 합성 초안');
      const terminalCount = mockedBodies.length; await composer.press('Enter'); await expect(page.getByRole('button', { name: '이야기 보내기' })).toBeDisabled();
      await expect(page.getByRole('button', { name: '타로', exact: true })).toBeDisabled(); ensure(mockedBodies.length === terminalCount, 'TERMINAL_REQUEST_REPEATED');
      await page.getByRole('button', { name: '새 이야기로 이어가기' }).click(); await expect(page).toHaveURL(`${baseURL}/chat/arang`); await expect(composer).toHaveValue('삭제 이후에도 보존할 합성 초안');
      report.mockedTransportChecks.push({ name: 'terminal-404-retains-draft-blocks-retry-and-explicit-new-context', response: 'synthetic NOT_FOUND, not an Edge/model call' });

      phase = 'mock-late-navigation';
      mode = 'hold'; await goto(`/chat/arang?conversation=${ids.conversation}&consultation=${ids.sibling}`);
      await composer.fill('이동 전 지연 응답 합성 요청'); await page.getByRole('button', { name: '이야기 보내기' }).click(); await expect.poll(() => held.length).toBe(1);
      await page.getByRole('link', { name: '나의 기록', exact: true }).click(); await expect(row('남겨둘 형제 상담')).toBeVisible(); held[0].release();
      await page.waitForLoadState('networkidle'); await expect(page).toHaveURL(`${baseURL}/history`); await expect(page.getByText('MOCK_LATE_RESPONSE_MUST_NOT_APPEAR')).toHaveCount(0);
      report.mockedTransportChecks.push({ name: 'late-response-after-unmount-does-not-navigate-back', response: 'held synthetic success; no persisted assistant message' });

      phase = 'mock-late-account-switch-real-rls';
      await goto(`/chat/arang?conversation=${ids.conversation}&consultation=${ids.sibling}`); await composer.fill('계정 가의 비공개 합성 초안'); await page.getByRole('button', { name: '이야기 보내기' }).click(); await expect.poll(() => held.length).toBe(2);
      await switchIdentity(sessions.B); await expect(composer).toHaveValue('');
      await expect(page.getByText('남겨둘 형제 상담: 합성 사용자 기록이며 모델 응답이 아닙니다.', { exact: true })).toHaveCount(0);
      held[1].release(); await page.waitForLoadState('networkidle'); await expect(page.getByText('MOCK_LATE_RESPONSE_MUST_NOT_APPEAR')).toHaveCount(0);
      ensure(await page.evaluate(userId => !Object.keys(sessionStorage).some(key => (key.startsWith('jumzip-draft:') || key.startsWith('jumzip-request-intent:')) && key.includes(userId)), ids.ownerA), 'OLD_ACCOUNT_PRIVATE_STORAGE_REMAINS');
      await page.getByRole('link', { name: '나의 기록', exact: true }).click(); await expect(page.getByText('아직, 쓰이지 않은 이야기', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '기억하고 있는 이야기', exact: true }).click(); await expect(page.getByText(/소나무 산책|해솔 그림/)).toHaveCount(0);
      const b = await inspectOwner('B'); ensure(Object.values(b).every(rows => rows.length === 0), 'OWNER_B_HAS_FOREIGN_ROWS');
      report.mockedTransportChecks.push({ name: 'A-to-B-sdk-event-during-held-request-clears-draft-intent-and-late-response', authTransition: 'synthetic SDK cross-tab event with actual local B session' });
      report.actualDatabaseChecks.push({ name: 'owner-B-real-rls-history-memory-empty-after-sdk-transition', foreignRows: 0, screenshot: await photo('owner-B-empty-history') });

      phase = 'profile-form-account-reset';
      await goto('/profile'); const nickname = page.getByRole('textbox', { name: '이름 또는 닉네임' }); await expect(nickname).toHaveValue('검증나');
      await switchIdentity(sessions.A); await expect(nickname).toHaveValue('검증가'); await nickname.fill('저장하지 않은 계정 가 이름');
      await switchIdentity(sessions.B); await expect(nickname).toHaveValue('검증나');
      report.mockedTransportChecks.push({ name: 'unsaved-profile-form-resets-on-UID-change', authTransition: 'synthetic SDK event; profiles loaded from actual local RLS' });
      report.actualDatabaseChecks.push({ name: 'profile-owner-B-retrieved-after-A-unsaved-form', screenshot: await photo('owner-B-profile') });
      ensure((await page.evaluate(() => window.__qaCsp)).length === 0, 'LOCAL_CSP_VIOLATION');
      ensure(!report.errors.length && report.network.blockedExternal === 0, 'BROWSER_ERRORS_OR_EXTERNAL_ATTEMPTS');
      report.passed = true;
    } finally {
      held.forEach(item => item.release()); await context.close(); await browser.close(); await new Promise(done => server.close(done));
    }
  });
} catch (error) {
  report.passed = false;
  // Keep assertions useful without writing request bodies, sessions or credentials.
  report.failure = { phase, message: String(error?.message || error).replace(/eyJ[A-Za-z0-9_.-]+/g, '[redacted-token]').slice(0, 1800) };
  process.exitCode = 1;
} finally {
  const cleanup = JSON.parse(await readFile('test-results/local-ui-lifecycle-fixture-report.json', 'utf8'));
  report.cleanup = { callbackCompleted: cleanup.callbackCompleted, pendingCleanupCount: cleanup.pendingCleanupCount, identities: cleanup.cleanup, credentialsPersisted: cleanup.credentialsPersisted };
  report.passed &&= cleanup.callbackCompleted && cleanup.pendingCleanupCount === 0 && cleanup.cleanup.length >= 2;
  report.limits = ['Actual local synthetic Auth/RLS/database UI only; no public signup, CAPTCHA or OAuth approval exercised.', 'Slow success and terminal 404 branches are explicitly mocked Edge transport, never counted as real backend/model execution.', 'The source .env.local and public dist were not overwritten; separate temporary build and independent browser context were used.'];
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ reportPath, passed: report.passed, actualDatabaseChecks: report.actualDatabaseChecks.length, mockedTransportChecks: report.mockedTransportChecks.length, pendingCleanup: report.cleanup.pendingCleanupCount, failure: report.failure || null }));
}
