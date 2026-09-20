/** Production service + installed SDK in two fresh Edge tabs. All Auth/Edge
 * responses are synthetic route fulfillments; default invocation is plan only. */
import { chromium } from '@playwright/test';
import { build } from 'vite';
import { createServer } from 'node:http';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join, basename } from 'node:path';

const REPORT = 'docs/evidence/frontend-local-auth-identity-race.json';
const FILES = ['src/lib/service.ts', 'src/lib/auth-identity.ts', 'pnpm-lock.yaml', 'tests/ui/local-auth-identity-race-check.mjs'];
const ENV_KEYS = new Set(['SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'PATH', 'PATHEXT', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'PROGRAMDATA', 'ALLUSERSPROFILE', 'OS']);
const sha = value => createHash('sha256').update(value).digest('hex');
const hashes = async () => Object.fromEntries(await Promise.all(FILES.map(async file => [file, sha((await readFile(file, 'utf8')).replaceAll('\r\n', '\n'))])));
const check = (condition, code) => { if (!condition) throw Error(code); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002';
const user = id => ({ id, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
const token = id => [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url'), 'c3ludGhldGlj'].join('.');
const session = id => ({ access_token: token(id), refresh_token: `synthetic-${id}`, expires_in: 3600, token_type: 'bearer', user: user(id) });

async function main() {
  const args = process.argv.slice(2); check(args.length <= 1 && args.every(arg => arg === '--run'), 'ARGUMENTS_INVALID');
  if (!args.includes('--run')) {
    console.log(JSON.stringify({ mode: 'PLAN_ONLY', browser: 'Fresh headless Edge context; actual Web Locks; same-origin two-tab race plus third-tab initialization', runtime: 'Production service.ts/auth-identity.ts bundled in an isolated ignored Vite fixture; envDir/configFile disabled', network: 'Only owned 127.0.0.1 static server; every Auth/Edge endpoint fulfilled synthetically', checks: ['held A logout queues B service.verifyOtp', 'initialization also queues', 'B remains in both tabs', 'B-first rejects stale A without deletion/logout HTTP', 'missing Web Locks fails closed'], realAuth: 0, realDB: 0, realEdge: 0, modelCalls: 0, externalCalls: 0, report: REPORT }, null, 2)); return;
  }
  try { await access(REPORT); throw Error('EXISTING_EVIDENCE_PRESERVED'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const runId = randomUUID(), root = resolve('test-results/auth-identity-browser', runId), dist = join(root, 'bundle');
  await mkdir(root, { recursive: true });
  const before = await hashes();
  const report = { schemaVersion: 1, runId, startedAt: new Date().toISOString(), mode: 'LOCAL_BROWSER_PRODUCTION_SERVICE_SYNTHETIC_TRANSPORT', passed: false, sourceHashes: before, sourceFrozen: false,
    realWebLocks: false, browserContexts: 0, checks: [], network: { localStatic: 0, syntheticUser: 0, syntheticDelete: 0, syntheticLogout: 0, syntheticOtp: 0, blockedUnexpected: 0, pendingSynthetic: 0 },
    realAuthCalls: 0, realDatabaseCalls: 0, realEdgeCalls: 0, modelCalls: 0, externalCalls: 0, credentialsRecorded: false,
    limits: ['Synthetic Auth/Edge transport; no public signup, CAPTCHA, OAuth provider or Persona quality claim.', 'Actual browser Web Locks, shared localStorage and installed SDK; no user browser profile accessed.'] };
  const record = (condition, name) => { report.checks.push({ name, passed: !!condition }); check(condition, name); };
  let browser, server, phase = 'isolated-build', holding;
  const releaseLogout = deferred(), logoutStarted = deferred();
  try {
    server = createServer(async (req, res) => {
      try {
        const path = new URL(req.url, 'http://127.0.0.1').pathname;
        if (path === '/' || path === '/init') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Isolated identity test</title><script type="module" src="/fixture.js"></script>'); return; }
        if (path.startsWith('/synthetic-api/')) { res.writeHead(500); res.end('UNINTERCEPTED_SYNTHETIC_ROUTE'); return; }
        if (!/^\/[A-Za-z0-9_.-]+\.js$/.test(path)) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(await readFile(join(dist, basename(path))));
      } catch { res.writeHead(500); res.end('LOCAL_FIXTURE_ASSET_ERROR'); }
    });
    await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
    const origin = `http://127.0.0.1:${server.address().port}`, apiUrl = `${origin}/synthetic-api`;
    const entry = join(root, 'entry.js');
    await writeFile(entry, `import { service, supabase } from ${JSON.stringify(resolve('src/lib/service.ts').replaceAll('\\', '/'))};
window.fixture = { states: {}, observed: [],
  ready: async () => { const value = await service.getSession(); service.onAuthStateChange(s => window.fixture.observed.push(s?.user.id ?? null)); return value?.user.id ?? null; },
  uid: async () => (await service.getSession())?.user.id ?? null,
  seed: async value => { const result = await supabase.auth.setSession(value); if (result.error) throw Error('SEED_FAILED'); },
  start: (name, action, owner) => { window.fixture.states[name] = { status: 'PENDING' }; const work = action === 'DELETE' ? service.execute('account', { action: 'DELETE_ACCOUNT', confirmation: 'DELETE' }, { expectedUserId: owner }) : action === 'OTP' ? service.verifyOtp('synthetic@example.invalid', '123456') : service.getSession(); Promise.resolve(work).then(() => { window.fixture.states[name] = { status: 'DONE' }; }, error => { window.fixture.states[name] = { status: 'ERROR', code: error.code ?? 'UNEXPECTED' }; }); }
};
`);
    await build({ configFile: false, envDir: false, publicDir: false, root, logLevel: 'silent',
      define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(apiUrl), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('public-synthetic-only'), 'import.meta.env.VITE_TURNSTILE_SITE_KEY': '""', 'import.meta.env.VITE_AUTH_GOOGLE_ENABLED': '"false"', 'import.meta.env.VITE_AUTH_EMAIL_ENABLED': '"true"' },
      build: { outDir: dist, emptyOutDir: false, sourcemap: false, minify: false, lib: { entry, formats: ['es'], fileName: () => 'fixture.js' } } });
    report.bundleSha256 = sha(await readFile(join(dist, 'fixture.js')));
    phase = 'browser-start';
    browser = await chromium.launch({ channel: 'msedge', headless: true, env: Object.fromEntries(Object.entries(process.env).filter(([key, value]) => ENV_KEYS.has(key.toUpperCase()) && typeof value === 'string')) });
    report.browserVersion = browser.version();
    async function makeContext(noLocks = false) {
      const context = await browser.newContext({ serviceWorkers: 'block' }); report.browserContexts++;
      if (noLocks) await context.addInitScript(() => { Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }); });
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) { report.network.blockedUnexpected++; await route.abort(); return; }
        if (!url.pathname.startsWith('/synthetic-api/')) { report.network.localStatic++; await route.continue(); return; }
        const fulfill = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
        if (url.pathname.endsWith('/auth/v1/user') && request.method() === 'GET') {
          report.network.syntheticUser++; const jwt = request.headers().authorization?.slice(7); const id = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).sub;
          check([A, B].includes(id), 'UNEXPECTED_SYNTHETIC_USER'); await fulfill(user(id)); return;
        }
        if (url.pathname.endsWith('/functions/v1/account') && request.method() === 'POST') {
          report.network.syntheticDelete++; const body = request.postDataJSON(); check(body.action === 'DELETE_ACCOUNT' && body.confirmation === 'DELETE', 'DELETE_PAYLOAD_CHANGED');
          const jwt = request.headers().authorization?.slice(7); check(JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).sub === A, 'WRONG_DELETE_OWNER');
          await fulfill({ ok: true, data: { deleted: true }, meta: { schemaVersion: 1, requestId: body.requestId, createdAt: new Date().toISOString() } }); return;
        }
        if (url.pathname.endsWith('/auth/v1/logout') && request.method() === 'POST') {
          report.network.syntheticLogout++; report.network.pendingSynthetic++; logoutStarted.resolve();
          holding = (async () => { try { await releaseLogout.promise; await route.fulfill({ status: 204, body: '' }); } finally { report.network.pendingSynthetic--; } })(); await holding; return;
        }
        if (url.pathname.endsWith('/auth/v1/verify') && request.method() === 'POST') {
          report.network.syntheticOtp++; check(request.postDataJSON().type === 'email', 'OTP_TYPE_CHANGED'); await fulfill(session(B)); return;
        }
        report.network.blockedUnexpected++; await route.abort();
      });
      return context;
    }
    const context = await makeContext();
    const tabA = await context.newPage(), tabB = await context.newPage();
    await Promise.all([tabA.goto(origin), tabB.goto(origin)]);
    await Promise.all([tabA.waitForFunction(() => !!window.fixture), tabB.waitForFunction(() => !!window.fixture)]);
    report.realWebLocks = await tabA.evaluate(() => typeof navigator.locks?.request === 'function'); record(report.realWebLocks, 'actual_browser_Web_Locks_available');
    await Promise.all([tabA.evaluate(() => window.fixture.ready()), tabB.evaluate(() => window.fixture.ready())]);
    await tabA.evaluate(value => window.fixture.seed(value), session(A));
    record(await tabB.evaluate(() => window.fixture.uid()) === A, 'seed_A_shared_with_second_tab');
    phase = 'held-logout-race';
    await tabA.evaluate(owner => window.fixture.start('deleteA', 'DELETE', owner), A);
    await Promise.race([logoutStarted.promise, new Promise((_, reject) => { const timeout = setTimeout(() => reject(Error('LOGOUT_NOT_REACHED')), 8000); timeout.unref(); })]);
    await tabB.evaluate(() => window.fixture.start('loginB', 'OTP'));
    await tabA.waitForFunction(async () => (await navigator.locks.query()).pending.length >= 1, undefined, { timeout: 8000 });
    record(report.network.syntheticOtp === 0, 'B_OTP_network_waits_while_A_logout_is_held');
    const tabC = await context.newPage(); await tabC.goto(`${origin}/init`); await tabC.waitForFunction(() => !!window.fixture);
    await tabC.evaluate(() => window.fixture.start('initialization', 'INIT'));
    await tabA.waitForFunction(async () => (await navigator.locks.query()).pending.length >= 2, undefined, { timeout: 8000 });
    const locks = await tabA.evaluate(async () => { const state = await navigator.locks.query(); return { held: state.held.length, pending: state.pending.length, exclusive: state.held.every(lock => lock.mode === 'exclusive') }; });
    record(locks.held === 1 && locks.pending >= 2 && locks.exclusive, 'real_cross_tab_gate_queues_OTP_and_initialization');
    record(await tabC.evaluate(() => window.fixture.states.initialization.status) === 'PENDING', 'third_tab_initialization_not_completed_outside_gate');
    releaseLogout.resolve(); if (holding) await holding;
    for (const [page, name] of [[tabA, 'deleteA'], [tabB, 'loginB'], [tabC, 'initialization']]) {
      await page.waitForFunction(name => window.fixture.states[name]?.status !== 'PENDING', name, { timeout: 8000 });
      record(await page.evaluate(name => window.fixture.states[name].status === 'DONE', name), `${name}_completed`);
    }
    record(await tabA.evaluate(() => window.fixture.uid()) === B, 'tab_A_retains_B_after_old_A_logout');
    record(await tabB.evaluate(() => window.fixture.uid()) === B, 'tab_B_retains_B_after_old_A_logout');
    await tabA.waitForFunction(owner => window.fixture.observed.at(-1) === owner, B, { timeout: 8000 });
    record(await tabA.evaluate(owner => window.fixture.observed.at(-1) === owner, B), 'cross_tab_Auth_observer_finishes_at_B');
    phase = 'B-first-stale-guard'; const countsBefore = { delete: report.network.syntheticDelete, logout: report.network.syntheticLogout };
    await tabA.evaluate(owner => window.fixture.start('staleA', 'DELETE', owner), A);
    await tabA.waitForFunction(() => window.fixture.states.staleA?.status === 'ERROR', undefined, { timeout: 8000 });
    record(await tabA.evaluate(() => window.fixture.states.staleA.code) === 'SESSION_CHANGED', 'B_first_rejects_A_confirmation');
    record(report.network.syntheticDelete === countsBefore.delete && report.network.syntheticLogout === countsBefore.logout, 'B_first_sends_no_DELETE_or_logout');
    record(await tabA.evaluate(() => window.fixture.uid()) === B && await tabB.evaluate(() => window.fixture.uid()) === B, 'B_preserved_in_both_tabs_after_stale_A_action');
    phase = 'no-WebLocks'; const noLocks = await makeContext(true), unsupported = await noLocks.newPage(); await unsupported.goto(origin); await unsupported.waitForFunction(() => !!window.fixture);
    const requestsBefore = report.network.syntheticOtp + report.network.syntheticDelete + report.network.syntheticLogout + report.network.syntheticUser;
    await unsupported.evaluate(() => window.fixture.start('unsupported', 'OTP'));
    await unsupported.waitForFunction(() => window.fixture.states.unsupported?.status === 'ERROR', undefined, { timeout: 8000 });
    record(await unsupported.evaluate(() => window.fixture.states.unsupported.code) === 'AUTH_LOCK_UNAVAILABLE', 'browser_missing_WebLocks_fails_closed');
    record(requestsBefore === report.network.syntheticOtp + report.network.syntheticDelete + report.network.syntheticLogout + report.network.syntheticUser, 'unsupported_browser_sends_no_Auth_or_Edge_request');
    record(report.network.blockedUnexpected === 0 && report.network.pendingSynthetic === 0, 'no_unexpected_or_pending_network');
    report.passed = true;
  } catch (error) { report.failure = { phase, code: /^[A-Za-z0-9_]+$/.test(error.message) ? error.message : error.name || 'BROWSER_CHECK_FAILED' }; }
  finally {
    releaseLogout.resolve(); if (holding) await holding.catch(() => {});
    if (browser) await browser.close();
    if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
    const after = await hashes(); report.sourceFrozen = JSON.stringify(before) === JSON.stringify(after); report.afterSourceHashes = after;
    if (!report.sourceFrozen) { report.passed = false; report.failure ??= { phase: 'source-freeze', code: 'SOURCE_CHANGED' }; }
    report.finishedAt = new Date().toISOString(); report.cleanup = { browserClosed: true, localServerClosed: true, pendingSynthetic: report.network.pendingSynthetic, realAccountsCreated: 0 };
    await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    if (report.passed) await writeFile(REPORT, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, sourceFrozen: report.sourceFrozen, network: report.network, failure: report.failure ?? null, immutableReport: join(root, 'report.json'), finalEvidence: report.passed ? REPORT : null }));
    if (!report.passed) process.exitCode = 1;
  }
}
await main();
