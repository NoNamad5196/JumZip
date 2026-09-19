import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { calculateFullSajuWithTiming } from '../../supabase/functions/_shared/domain/fortune-timing.ts';
import { calculateSajuCompatibility } from '../../supabase/functions/_shared/domain/saju-compatibility.ts';

// Project development test only. The browser runs the actual production bundle;
// all Auth/PostgREST/Edge responses are synthetic and external requests are blocked.
const artifacts = 'tests/ui/artifacts/acceptance-v1';
const viewportReportPath = 'docs/evidence/frontend-authenticated-viewport-fixture.json';
const exportReportPath = 'docs/evidence/frontend-complete-export-fixture.json';
const sha = value => createHash('sha256').update(value).digest('hex');
const dist = resolve('dist');
const index = await readFile('dist/index.html');
const scriptNames = (await readdir('dist/assets')).filter(name => name.endsWith('.js'));
let publicUrl;
for (const name of scriptNames) {
  const js = await readFile(`dist/assets/${name}`, 'utf8');
  publicUrl ??= js.match(/https:\/\/[a-z0-9-]+\.supabase\.co/)?.[0];
}
if (!publicUrl) throw Error('Built public Supabase URL missing; build the configured frontend first.');
const csp = (await readFile('public/_headers', 'utf8')).match(/Content-Security-Policy:\s*(.+)/)?.[1];
if (!csp || csp.includes('unsafe-eval')) throw Error('Strict CSP missing');
await mkdir(artifacts, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const image = path.startsWith('/__qa_images/');
    const root = image ? resolve(artifacts) : dist;
    let target = resolve(root, `.${image ? path.slice('/__qa_images'.length) : path}`);
    if (target !== root && !target.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    if (!extname(target)) target = resolve(dist, 'index.html');
    const bytes = await readFile(target);
    response.writeHead(200, { 'content-type': mime[extname(target)] || 'application/octet-stream', 'content-security-policy': csp, 'cache-control': 'no-store' }).end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
const baseURL = `http://127.0.0.1:${server.address().port}`;
const uid = '11111111-1111-4111-8111-111111111111';
const id = number => `22222222-2222-4222-8222-${String(number).padStart(12, '0')}`;
const conversationId = id(9001), tarotId = id(9002), knownId = id(9003), unknownId = id(9004), compatibilityId = id(9005);
const user = { id: uid, aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: { provider: 'anonymous', providers: ['anonymous'] }, user_metadata: {}, created_at: '2026-09-20T00:00:00Z' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const expires = Math.floor(Date.now() / 1000) + 3600;
const syntheticSession = { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: uid, aud: 'authenticated', exp: expires, role: 'authenticated' })}.fixture-only`, refresh_token: 'fixture-only', token_type: 'bearer', expires_in: 3600, expires_at: expires, user };
const birth = { calendarType: 'SOLAR', leapMonth: false, birthDate: '1992-10-24', birthTime: '05:30', birthTimeUnknown: false, location: { name: 'QA_PRIVATE_CITY', latitude: 37.5665, longitude: 126.978, timezone: 'Asia/Seoul' }, gender: 'MALE', trueSolarTime: false };
const asOf = new Date('2026-09-20T00:00:00Z');
const known = calculateFullSajuWithTiming(birth, asOf);
const unknown = calculateFullSajuWithTiming({ ...birth, birthDate: '2024-02-04', birthTime: null, birthTimeUnknown: true, gender: 'FEMALE' }, asOf);
const compatibility = calculateSajuCompatibility({ personA: known, personB: unknown });
const now = '2026-09-20T00:00:00Z';
const common = { conversation_id: conversationId, character_id: 'SANI', created_at: now, question: '합성 UI 검증용 질문입니다.', result_summary: null, tarot_draw_groups: [], saju_readings: [], saju_compatibility_readings: [] };
const groups = [6, 9, 14].map((card, position) => ({ id: id(9100 + position), mode: 'NORMAL', spread_type: 'ONE_CARD', created_at: new Date(Date.parse(now) + position * 1000).toISOString(), tarot_draws: [{ card_id: card, orientation: position === 1 ? 'REVERSED' : 'UPRIGHT', position_index: 0, position_name: 'ADVICE' }] }));
const rows = {
  [tarotId]: { ...common, id: tarotId, title: '여러 페이지에서 복원한 세 번의 카드', fortune_type: 'TAROT', tarot_draw_groups: groups },
  [knownId]: { ...common, id: knownId, title: '시간을 알고 있는 나의 흐름', fortune_type: 'SAJU', saju_readings: [{ id: id(9200), result_snapshot: known, birth_profile_snapshot: birth }] },
  [unknownId]: { ...common, id: unknownId, title: '경계와 시간 미상을 함께 살펴보기', fortune_type: 'SAJU', saju_readings: [{ id: id(9201), result_snapshot: unknown }] },
  [compatibilityId]: { ...common, id: compatibilityId, title: '서로 다른 두 원국의 가능한 만남', fortune_type: 'COMPATIBILITY', saju_compatibility_readings: [{ id: id(9202), result_snapshot: compatibility }] },
};
const conversation = { id: conversationId, character_id: 'SANI', title: '검증용 합성 이야기', created_at: now, last_message_at: now, relationship_state: {}, summary: null };
const responseText = '검증용 첫 문장이에요. 두 번째 문장도 끝까지 보여요. 세 번째 문장을 함께 확인해요. 마지막 문장이 사라지지 않아요.';
const snapshot = (group, content = null) => ({ executionStatus: content ? 'SUCCEEDED' : 'PARTIAL', conversationId, consultationId: tarotId, drawGroupId: group.id, spreadType: 'ONE_CARD', mode: 'NORMAL', cards: group.tarot_draws.map(card => ({ cardId: card.card_id, orientation: card.orientation, positionIndex: card.position_index, positionKey: card.position_name })), interpretation: content ? { messageId: id(9300), content } : null });
const message = (index, consultation, content = `내보내지 않는 대화 ${index}`, metadata = {}, sender = 'USER') => ({ id: id(index + 1), conversation_id: conversationId, consultation_id: consultation, created_at: new Date(Date.parse(now) + index * 1000).toISOString(), sender, type: 'TEXT', content, metadata });
const chatInitial = [message(1, tarotId, '모션을 확인하는 합성 질문'), { ...message(2, tarotId, '', { tarot: snapshot(groups[0]) }, 'SYSTEM'), type: 'TAROT_DRAW' }];
const sentinels = ['PAGE_FIRST_LATEST', 'PAGE_MIDDLE_LATEST', 'PAGE_LAST_LATEST'];
const exportMessages = Array.from({ length: 1005 }, (_, i) => message(i, tarotId));
for (const [index, groupIndex, sentinel] of [[1000, 0, sentinels[0]], [500, 1, sentinels[1]], [5, 2, sentinels[2]], [100, 0, 'OBSOLETE_INTERPRETATION']]) {
  const content = `${sentinel}\n이 문단은 실제 모델 응답이 아닌 브라우저 내보내기 검증 자료예요. 저장된 카드의 최신 해석만 한 번 포함되는지 확인합니다.\n본문의 마지막까지 읽을 수 있어야 해요.`;
  exportMessages[index] = message(index, tarotId, content, { tarot: snapshot(groups[groupIndex], content) }, 'ASSISTANT');
}
const sajuMessages = consultation => Array.from({ length: 1005 }, (_, i) => message(i, consultation, i === 1004 ? 'LATEST_SAJU_INTERPRETATION\n마지막 페이지까지 취득한 뒤 최신 저장 해석을 확인해요.' : `오래된 합성 이야기 ${i}`, {}, i === 1004 ? 'ASSISTANT' : 'USER'));
const initial = { checkedAt: new Date().toISOString(), mode: 'LOCAL_PRODUCTION_BUILD_INTERCEPTED_FIXTURE', realAuth: false, realBackendWrites: false, modelCalls: 0, externalRequestsAllowed: false, indexSha256: sha(index), csp };
const exportsOnly = process.argv.includes('--exports-only');
const viewportReport = exportsOnly ? JSON.parse(await readFile(viewportReportPath, 'utf8')) : { ...initial, viewports: [[1440, 900], [1280, 800], [390, 844], [360, 800]], motionModes: ['no-preference', 'reduce'], views: [], unexpectedRequests: [] };
if (exportsOnly && (!viewportReport.passed || viewportReport.indexSha256 !== initial.indexSha256)) throw Error('Exports-only requires passed viewport evidence for this build.');
const exportReport = { ...initial, messageCount: 1005, cases: [], unexpectedRequests: [] };
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
let currentPhase = 'viewport';

async function fixtureContext(viewport, reducedMotion, options = {}) {
  const context = await browser.newContext({ viewport, reducedMotion, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const state = { chatMessages: [...chatInitial], requests: [], unexpected: [], pages: [], failurePhase: options.failPage ? 'hold' : 'none', holdReached: false, release: null };
  await context.addInitScript(({ key, session }) => { localStorage.setItem(key, JSON.stringify(session)); window.__qaCsp = []; document.addEventListener('securitypolicyviolation', event => window.__qaCsp.push({ directive: event.effectiveDirective, resource: event.blockedURI === 'eval' ? 'eval' : 'resource' })); }, { key: `sb-${new URL(publicUrl).hostname.split('.')[0]}-auth-token`, session: syntheticSession });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), table = url.pathname.split('/').pop();
    if (url.origin === baseURL) return route.continue();
    if (url.origin !== publicUrl) { state.unexpected.push({ method: request.method(), origin: url.origin, path: url.pathname }); return route.abort('blockedbyclient'); }
    const json = body => route.fulfill({ status: 200, json: body });
    if (table === 'touch_activity') return json(null);
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/functions/v1/chat' && options.allowChat) {
      const body = request.postDataJSON(); state.requests.push({ endpoint: 'chat', action: body.action });
      const answer = message(4, tarotId, responseText, {}, 'ASSISTANT');
      state.chatMessages = [...state.chatMessages, message(3, tarotId, body.message), answer];
      return json({ ok: true, meta: { schemaVersion: 1, requestId: body.requestId, createdAt: now }, data: { conversationId, consultationId: tarotId, assistantMessage: { id: answer.id, characterId: 'SANI', content: responseText } } });
    }
    if (request.method() !== 'GET') { state.unexpected.push({ method: request.method(), path: url.pathname }); return route.fulfill({ status: 400, json: { message: 'Unexpected fixture mutation' } }); }
    if (table === 'profiles') return json({ id: uid, display_name: '검증 친구', memory_enabled: true, preferred_character: 'SANI' });
    if (table === 'conversations') return json(url.searchParams.has('id') ? conversation : [conversation]);
    if (table === 'consultations') return json(rows[url.searchParams.get('id')?.replace(/^eq\./, '')] || Object.values(rows));
    if (table === 'messages') {
      const consultation = url.searchParams.get('consultation_id')?.replace(/^eq\./, '');
      const all = consultation ? (options.longMessages ? consultation === tarotId ? exportMessages : sajuMessages(consultation) : []) : state.chatMessages;
      const before = url.searchParams.get('or')?.match(/created_at\.lt\."?([^",)]+)/)?.[1];
      const eligible = all.filter(item => !before || item.created_at < before).slice().reverse();
      state.pages.push({ consultation, remaining: eligible.length, phase: state.failurePhase });
      if (consultation === tarotId && eligible.length === 605 && ['hold', 'fail'].includes(state.failurePhase)) {
        if (state.failurePhase === 'hold') { state.holdReached = true; await new Promise(done => { state.release = done; }); }
        if (state.failurePhase === 'fail') return route.fulfill({ status: 503, json: { message: 'Expected fixture middle-page failure' } });
      }
      return json(eligible.slice(0, Number(url.searchParams.get('limit') || 201)));
    }
    if (['birth_profiles', 'related_people', 'memories'].includes(table)) return json([]);
    state.unexpected.push({ method: request.method(), path: url.pathname }); return json([]);
  });
  return { context, state };
}
async function prepare(page, path) {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL + path, { waitUntil: 'networkidle' });
  await page.locator('main').waitFor(); await page.evaluate(() => document.fonts.ready);
  return errors;
}
async function geometry(page) {
  return page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, csp: window.__qaCsp || [], brokenImages: [...document.images].filter(image => image.complete && !image.naturalWidth).length, clippedCells: [...document.querySelectorAll('.snapshot-cell, .structured-list dd, .current-luck, .luck-period')].filter(el => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'auto').map(el => ({ className: el.className, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth })) }));
}
async function screenshot(page, name) { const path = `${artifacts}/${name}.png`; await page.screenshot({ path, fullPage: true }); return path; }
async function download(page, name) {
  const started = Date.now(); const waiting = page.waitForEvent('download', { timeout: 120000 });
  await page.getByRole('button', { name: '결과 이미지 저장', exact: true }).click();
  let saved; try { saved = await waiting; } catch (error) { await screenshot(page, `${name}-timeout`); console.log(JSON.stringify({ exportFailure: name, button: await page.getByRole('button', { name: /이미지.*저장|이미지를 준비/ }).allTextContents(), notices: await page.locator('.notice').allTextContents(), resources: await page.evaluate(() => performance.getEntriesByType('resource').map(row => ({ name: row.name.startsWith('data:') ? 'data-resource' : new URL(row.name).pathname, duration: row.duration, size: row.transferSize })).filter(row => row.name.includes('woff') || row.name === 'data-resource')) })); throw error; } const path = `${artifacts}/${name}.png`; await saved.saveAs(path);
  const bytes = await readFile(path); expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  return { path, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length, sha256: sha(bytes), generationMs: Date.now() - started };
}
async function inspectImage(context, image, name) {
  const page = await context.newPage(); await page.setViewportSize({ width: 640, height: 900 });
  await page.goto(`${baseURL}/__qa_images/${name}.png`);
  await page.locator('img').evaluate(image => { document.body.style.margin = '0'; image.style.cssText = 'display:block;width:640px;height:auto;max-width:none;max-height:none;margin:0;'; });
  const height = await page.locator('img').evaluate(image => image.getBoundingClientRect().height), captures = [];
  for (const [position, top] of [['top', 0], ['middle', Math.max(0, height / 2 - 450)], ['bottom', Math.max(0, height - 900)]]) {
    await page.evaluate(top => scrollTo(0, top), top); const path = `${artifacts}/${name}-${position}.png`; await page.screenshot({ path }); captures.push(path);
  }
  await page.close(); image.reviewCaptures = captures;
}

try {
  for (const [width, height] of exportsOnly ? [] : viewportReport.viewports) for (const motion of viewportReport.motionModes) {
    const { context, state } = await fixtureContext({ width, height }, motion, { allowChat: true });
    for (const [name, path] of [['chat', `/chat/sani?conversation=${conversationId}`], ['saju-known', `/reading/${knownId}`], ['saju-unknown', `/reading/${unknownId}`], ['compatibility', `/reading/${compatibilityId}`]]) {
      const page = await context.newPage(), errors = await prepare(page, path);
      let checks = {};
      if (name === 'chat') {
        await expect(page.getByText('카드는 안전하게 저장됐어요. 해석을 다시 받아도 같은 카드를 사용해요.')).toBeVisible();
        const retry = page.getByRole('button', { name: '해석 다시 받기', exact: true }); await expect(retry).toBeEnabled();
        const input = page.getByRole('textbox', { name: '산이에게 보낼 이야기' }); await input.fill('합성 응답 모션 검사'); await page.getByRole('button', { name: '이야기 보내기' }).click();
        const visible = page.locator('.message-assistant .message-text').last().locator('[aria-hidden="true"]');
        await expect.poll(async () => (await visible.allTextContents()).join('')).toBe(responseText);
        const trigger = page.getByRole('button', { name: '타로', exact: true }); await trigger.focus(); await trigger.press('Enter');
        await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
        await expect(page.getByRole('link', { name: '결과 자세히 보기' })).toHaveAttribute('href', `/reading/${tarotId}`);
        checks = { completeVisibleReply: true, partialRetryAvailable: true, detailLink: true, keyboardEscapeFocusReturn: true, syntheticChatRequests: state.requests.length };
      } else if (name === 'saju-unknown') {
        await expect(page.getByLabel('시주 미확정', { exact: true }).first()).toBeVisible();
        await page.locator('.candidate-charts summary').click(); await page.getByRole('combobox', { name: '살펴볼 가능성' }).selectOption('1');
        checks = { unknownHourPreserved: true, candidateSelectionUsable: true };
      } else if (name === 'compatibility') {
        await expect(page.getByRole('heading', { name: '나의 원국', exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: '상대의 원국', exact: true })).toBeVisible();
        await page.locator('.candidate-charts summary').click(); await page.getByRole('combobox', { name: '살펴볼 원국 조합' }).selectOption('1');
        checks = { bothPeopleVisible: true, uncertainPairSelectionUsable: true };
      } else { await expect(page.getByRole('heading', { name: '나를 이루는 네 기둥' })).toBeVisible(); checks = { knownPillarsVisible: true }; }
      const metrics = await geometry(page), capture = await screenshot(page, `${name}-${width}x${height}-${motion}`);
      viewportReport.views.push({ name, motion, ...metrics, checks, errors, screenshot: capture });
      expect(metrics.scrollWidth).toBeLessThanOrEqual(width); expect(metrics.clippedCells).toEqual([]); expect(metrics.csp).toEqual([]); expect(errors).toEqual([]); expect(metrics.brokenImages).toBe(0);
      await page.close();
    }
    viewportReport.unexpectedRequests.push(...state.unexpected); await context.close();
    console.log(JSON.stringify({ completedViewport: `${width}x${height}`, motion, views: viewportReport.views.length }));
  }
  currentPhase = 'export';
  for (const kind of ['tarot', 'saju', 'compatibility']) {
    const consultation = kind === 'tarot' ? tarotId : kind === 'saju' ? knownId : compatibilityId;
    const { context, state } = await fixtureContext({ width: 360, height: 800 }, 'reduce', { longMessages: true, failPage: kind === 'tarot' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message)); await page.goto(`${baseURL}/reading/${consultation}`, { waitUntil: 'domcontentloaded' });
    const copy = page.getByRole('button', { name: '텍스트 복사', exact: true }), image = page.getByRole('button', { name: '결과 이미지 저장', exact: true });
    const record = { kind, messageCount: 1005, completeOnly: true, failedPageThenRecovered: false, errors };
    if (kind === 'tarot') {
      await expect.poll(() => state.holdReached).toBe(true); await expect(copy).toBeDisabled(); await expect(image).toBeDisabled();
      state.failurePhase = 'fail'; state.release();
      const recovery = page.getByRole('button', { name: '저장된 해석 다시 불러오기' }); await expect(recovery).toBeVisible({ timeout: 20000 });
      await expect(copy).toBeDisabled(); await expect(image).toBeDisabled();
      record.failureScreenshot = await screenshot(page, 'export-tarot-middle-page-error');
      state.failurePhase = 'success'; await recovery.click(); record.failedPageThenRecovered = true;
    }
    await expect(copy).toBeEnabled({ timeout: 20000 }); await expect(image).toBeEnabled(); await page.evaluate(() => document.fonts.ready);
    const visibleText = await page.locator('.reading-export').innerText();
    record.domScreenshot = await screenshot(page, `export-${kind}-source-dom`);
    record.heroScreenshot = `${artifacts}/export-${kind}-source-hero.png`; await page.locator('.reading-hero').screenshot({ path: record.heroScreenshot });
    if (kind === 'saju') {
      record.shinsalDomScreenshot = `${artifacts}/export-saju-shinsal-source-dom.png`;
      await page.locator('.shinsal-list').screenshot({ path: record.shinsalDomScreenshot });
      record.shinsalGeometry = await page.locator('.shinsal-list').evaluate(list => [...list.querySelectorAll('article')].map(article => ({ heading: article.querySelector('strong').getBoundingClientRect().toJSON(), badge: article.querySelector('span').getBoundingClientRect().toJSON(), paragraph: article.querySelector('p').getBoundingClientRect().toJSON() })));
    }
    for (const canary of [birth.birthDate, birth.birthTime, birth.location.name, String(birth.location.latitude), String(birth.location.longitude)]) expect(visibleText).not.toContain(canary);
    if (kind === 'tarot') { for (const sentinel of sentinels) expect(visibleText.split(sentinel)).toHaveLength(2); expect(visibleText).not.toContain('OBSOLETE_INTERPRETATION'); }
    else expect(visibleText).toContain('LATEST_SAJU_INTERPRETATION');
    await copy.click(); const copied = await page.evaluate(() => navigator.clipboard.readText()); expect(copied.replaceAll('\r\n', '\n')).toBe(visibleText.replaceAll('\r\n', '\n'));
    record.clipboardEqualsExportDOMAfterPlatformNewlineNormalization = true; record.birthCanariesHiddenByDefault = true; record.latestInterpretationsComplete = true;
    const filename = `export-${kind}-default`; record.image = await download(page, filename); await inspectImage(context, record.image, filename);
    if (kind === 'saju') {
      await page.getByRole('switch', { name: /이미지에 상세 출생 정보 포함/ }).click(); const included = await page.locator('.reading-export').innerText();
      for (const canary of [birth.birthDate, birth.birthTime, birth.location.name]) expect(included).toContain(canary);
      for (const canary of [String(birth.location.latitude), String(birth.location.longitude)]) expect(included).not.toContain(canary);
      record.explicitBirthOnly = true; record.includingBirthImage = await download(page, 'export-saju-explicit-birth');
    }
    record.pages = state.pages; record.geometry = await geometry(page); expect(record.geometry.csp).toEqual([]); expect(errors).toEqual([]); expect(record.geometry.scrollWidth).toBe(360);
    expect(state.pages.some(item => item.remaining === 5)).toBe(true);
    exportReport.cases.push(record); exportReport.unexpectedRequests.push(...state.unexpected); await context.close();
    console.log(JSON.stringify({ completedExport: kind, png: record.image, pages: state.pages.length }));
  }
} catch (error) {
  (currentPhase === 'viewport' ? viewportReport : exportReport).failure = String(error?.stack || error);
  process.exitCode = 1;
} finally {
  await browser.close(); await new Promise(done => server.close(done));
  viewportReport.passed = viewportReport.views.length === 32 && !viewportReport.failure && !viewportReport.unexpectedRequests.length;
  exportReport.passed = exportReport.cases.length === 3 && !exportReport.failure && !exportReport.unexpectedRequests.length;
  viewportReport.passScope = exportReport.passScope = 'AUTOMATED_CHECKS_ONLY_UNTIL_SEPARATE_VISUAL_REVIEW';
  exportReport.visualReview = { status: 'PENDING', required: true };
  exportReport.diagnosticHistory = [{ issue: 'Variable-font src removed by preferredFontFormat woff2, causing fallback-font wrapping and overlap in exported PNG only.', correction: 'Removed exact-format restriction in Reading.tsx download; woff2-variations sources are embedded.' }, { issue: 'One initial full-batch export timed out after 120000 ms following the font correction.', reproduction: 'Subsequent isolated exports completed. Intermittent delay cause not established; rerun durations are recorded without claiming the initial timeout did not occur.' }];
  const limits = ['Synthetic authenticated state and mocked backend only; no public Auth, OAuth, CAPTCHA, real DB mutation or model inference was exercised.', 'This test does not replace original full Persona benchmark or authenticated public end-to-end acceptance.', 'Only public build files, synthetic test data and local screenshots/downloads are recorded; no real credential or session is used.'];
  viewportReport.limits = exportReport.limits = limits;
  await writeFile(viewportReportPath, JSON.stringify(viewportReport, null, 2) + '\n');
  await writeFile(exportReportPath, JSON.stringify(exportReport, null, 2) + '\n');
  console.log(JSON.stringify({ viewportReportPath, viewportPass: viewportReport.passed, views: viewportReport.views.length, exportReportPath, exportPass: exportReport.passed, exports: exportReport.cases.length, failure: viewportReport.failure || null }));
}
