/** Default: local-only plan, no CLI/Auth/DB/network. Main GO + explicit opt-in
 * required for disposable identities and actual production-service verification. */
import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const TARGET = 'http://127.0.0.1:54321';
const MARKER = 'JumZip local memory pagination integration';
const LEDGER = 'test-results/pending-local-memory-pagination-cleanup.json';
const REPORT = 'test-results/local-memory-pagination-report.json';
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const TABLES = ['profiles', 'conversations', 'consultations', 'messages', 'tarot_draw_groups', 'tarot_draws', 'birth_profiles', 'saju_readings', 'saju_compatibility_readings', 'related_people', 'memories', 'memory_suppressions', 'request_executions', 'rate_limit_buckets', 'daily_draw_claims'];
const SOURCE_FILES = ['src/lib/service.ts', 'src/lib/auth-identity.ts', 'tests/service/memory-pagination.test.ts', 'tests/backend/local-memory-pagination-smoke.mjs', 'supabase/config.toml'];
const hashes = () => Object.fromEntries([...SOURCE_FILES, ...readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).sort().map(name => `supabase/migrations/${name}`)]
  .map(path => [path, createHash('sha256').update(readFileSync(path, 'utf8').replaceAll('\r\n', '\n')).digest('hex')]));
const safeError = error => ({ code: /^[A-Z0-9_]{1,90}$/.test(error?.code ?? '') ? error.code : /^[A-Z0-9_]{1,90}$/.test(error?.message ?? '') ? error.message : 'LOCAL_MEMORY_SMOKE_FAILED' });
const plan = {
  target: TARGET, mode: 'LOCAL_AUTH_REST_PRODUCTION_SERVICE', identities: 2, memoryRows: { ownerA: 1005, ownerB: 3 },
  actual: ['admin-created synthetic Auth sessions', 'local PostgREST row cap and RLS', 'production service.listMemories', '6-page keyset at one microsecond timestamp'],
  controlledFaults: ['one page2 URI remains HTTP503 for initial plus3 SDK retries; Retry-After0', 'real session switches to owned B after page2 response'],
  serviceLoading: 'TypeScript transpilation of production service and auth-identity helper in memory; replace only build-time public env and module import resolution. Node helper queue is not browser cross-tab evidence. No source or server configuration changes.',
  modelRequests: 0, externalRequests: 0, edgeRequests: 0, publicSignupTested: false,
  cleanup: 'Immediate marked-ID ledger; finally delete only owned synthetic users, then verify Auth404 and all15 owned tables empty.',
  runCommand: 'JUMZIP_RUN_LOCAL_MEMORY_PAGINATION=LOCAL node tests/backend/local-memory-pagination-smoke.mjs --run',
  permission: 'Main local execution GO required; never load hosted environment files or restart services.', report: REPORT,
};
if (!process.argv.includes('--run')) console.log(JSON.stringify({ ...plan, sourceHashes: hashes(), networkRequests: 0 }, null, 2));
else if (process.env.JUMZIP_RUN_LOCAL_MEMORY_PAGINATION !== 'LOCAL') {
  console.log(JSON.stringify({ status: 'NOT_RUN', code: 'EXPLICIT_LOCAL_OPT_IN_REQUIRED' })); process.exitCode = 1;
} else {
  try { await live(); } catch (error) { console.log(JSON.stringify({ status: 'FAILED', ...safeError(error), report: REPORT })); process.exitCode = 1; }
}

async function live() {
  const before = hashes(), runId = randomUUID();
  // CLI stdout contains local credentials. Never print or persist it, even on failure.
  const status = spawnSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'json'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (status.status !== 0) throw Error('LOCAL_STATUS_UNAVAILABLE');
  let config; try { config = JSON.parse(status.stdout); } catch { throw Error('LOCAL_STATUS_INVALID'); }
  if (config.API_URL !== TARGET || typeof config.ANON_KEY !== 'string' || typeof config.SERVICE_ROLE_KEY !== 'string') throw Error('LOCAL_TARGET_REQUIRED');
  const nativeFetch = globalThis.fetch;
  const counts = { authRequests: 0, restRequests: 0, injectedHttpErrors: 0, sdkRetryAttempts: 0, blockedDestinations: 0, modelRequests: 0, externalRequests: 0, edgeRequests: 0 };
  let phase = 'SETUP', memoryUrls = [], switchSession, faultTarget;
  const faultRetryHeaders = [];
  const guardedFetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== TARGET || url.username || url.password || !/^\/(auth|rest)\/v1(?:\/|$)/.test(url.pathname)) {
      counts.blockedDestinations++; throw Error('NONLOCAL_OR_EDGE_REQUEST_BLOCKED');
    }
    const tracked = ['READ_A', 'FAULT_PAGE2', 'SWITCH_PAGE2', 'READ_B'].includes(phase) && url.pathname === '/rest/v1/memories' && (init?.method ?? 'GET') === 'GET';
    if (tracked) memoryUrls.push(url);
    if (phase === 'FAULT_PAGE2' && tracked && memoryUrls.length === 2) faultTarget = url.href;
    if (phase === 'FAULT_PAGE2' && tracked && url.href === faultTarget) {
      // Installed postgrest-js2.116.0 retries GET503 up to3 times. Keep the same
      // page unavailable across those attempts; never disable production retries.
      const retryCount = new Headers(init?.headers).get('x-retry-count');
      faultRetryHeaders.push(retryCount); if (retryCount !== null) counts.sdkRetryAttempts++;
      if (++counts.injectedHttpErrors > 4) throw Error('LOCAL_FIXTURE_RETRY_LIMIT');
      return new Response(JSON.stringify({ code: 'XXFIXTURE', message: 'Synthetic page2 failure' }), { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '0' } });
    }
    counts[url.pathname.startsWith('/auth/') ? 'authRequests' : 'restRequests']++;
    if (phase !== 'CLEANUP' && counts.authRequests + counts.restRequests > 180) throw Error('LOCAL_REQUEST_LIMIT');
    const timeout = AbortSignal.timeout(20_000);
    const response = await nativeFetch(input, { ...init, redirect: 'error', signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
    if (phase === 'SWITCH_PAGE2' && tracked && memoryUrls.length === 2) await switchSession();
    return response;
  };
  globalThis.fetch = guardedFetch;
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: guardedFetch } };
  const admin = createClient(TARGET, config.SERVICE_ROLE_KEY, options), pending = new Set(), cleanup = [], checks = [];
  let productionClient, failure = null, completed = false, cleanupFailed = false;
  const ledger = () => { mkdirSync('test-results', { recursive: true }); writeFileSync(LEDGER, JSON.stringify({ target: TARGET, marker: MARKER, ids: [...pending] }, null, 2) + '\n'); };
  const requireCheck = (condition, name) => { checks.push({ name, passed: Boolean(condition) }); if (!condition) throw Error('LOCAL_ASSERTION_FAILED'); };
  const read = async query => { const value = await query; if (value.error || value.data === null) throw Error('LOCAL_DATABASE_QUERY_FAILED'); return value.data; };
  const mutate = async query => { if ((await query).error) throw Error('LOCAL_DATABASE_WRITE_FAILED'); };
  async function remove(id) {
    const found = await admin.auth.admin.getUserById(id);
    if (!found.error) {
      if (found.data.user?.user_metadata?.test_run !== MARKER || !/^jumzip-local-memory-page-[0-9a-f-]+@example\.com$/i.test(found.data.user?.email ?? '')) throw Error('CLEANUP_OWNERSHIP_GUARD');
      if ((await admin.auth.admin.deleteUser(id, false)).error) throw Error('LOCAL_CLEANUP_DELETE_FAILED');
    } else if (found.error.status !== 404) throw Error('LOCAL_CLEANUP_AUTH_LOOKUP_FAILED');
    const absent = await admin.auth.admin.getUserById(id);
    if (absent.error?.status !== 404 || absent.data.user) throw Error('LOCAL_CLEANUP_AUTH_REMAINS');
    for (const table of TABLES) {
      const column = table === 'profiles' ? 'id' : 'user_id';
      const foundRows = await admin.from(table).select(column, { head: true, count: 'exact' }).eq(column, id);
      if (foundRows.error || foundRows.count !== 0) throw Error('LOCAL_CLEANUP_ROWS_REMAIN');
    }
    pending.delete(id); ledger(); cleanup.push({ authAbsent: true, emptyOwnedTables: TABLES.length });
  }
  async function identity() {
    const email = `jumzip-local-memory-page-${randomUUID()}@example.com`;
    const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { test_run: MARKER } });
    if (created.error || !created.data.user) throw Error('LOCAL_IDENTITY_CREATE_FAILED');
    const id = created.data.user.id; pending.add(id); ledger();
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error || link.data.user?.id !== id || !link.data.properties?.hashed_token) throw Error('LOCAL_IDENTITY_LINK_FAILED');
    const client = createClient(TARGET, config.ANON_KEY, options);
    const verified = await client.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token });
    if (verified.error || verified.data.user?.id !== id || !verified.data.session) throw Error('LOCAL_IDENTITY_SESSION_FAILED');
    const user = await client.auth.getUser();
    if (user.error || user.data.user?.id !== id) throw Error('LOCAL_IDENTITY_VERIFY_FAILED');
    return { id, session: verified.data.session, client };
  }
  async function seed(owner, count) {
    const ids = Array.from({ length: count }, () => randomUUID()).sort().reverse();
    for (let offset = 0; offset < count; offset += 200) await mutate(admin.from('memories').insert(ids.slice(offset, offset + 200).map(id => ({
      id, user_id: owner.id, scope: 'GLOBAL', character_id: null, category: 'PREFERENCE', subject: 'USER',
      content: '합성 페이지 검증 기억이며 실제 사용자 정보가 아닙니다.', created_at: '2026-09-20T00:00:00.123456+00:00',
    }))));
    const countRead = await admin.from('memories').select('id', { count: 'exact', head: true }).eq('user_id', owner.id);
    requireCheck(!countRead.error && countRead.count === count, `admin confirmed seeded row count ${count}`); return ids;
  }
  const begin = next => { phase = next; memoryUrls = []; faultTarget = undefined; };
  const assertQueries = (owner, count) => {
    requireCheck(new Set(memoryUrls.map(url => url.href)).size === count, `${phase} expected distinct page count ${count}`);
    requireCheck(memoryUrls.length === count + (phase === 'FAULT_PAGE2' ? 3 : 0), `${phase} expected HTTP attempts including SDK retries`);
    requireCheck(memoryUrls.every(url => url.searchParams.get('user_id') === `eq.${owner}`), `${phase} fixed original owner filter`);
    requireCheck(memoryUrls.every(url => url.searchParams.get('limit') === '201' && url.searchParams.get('order') === 'created_at.desc,id.desc'), `${phase} bounded deterministic keyset queries`);
  };
  try {
    if (existsSync(LEDGER)) {
      const old = JSON.parse(readFileSync(LEDGER, 'utf8'));
      if (old.target !== TARGET || old.marker !== MARKER || !Array.isArray(old.ids) || old.ids.some(id => typeof id !== 'string' || !UUID.test(id))) throw Error('CLEANUP_LEDGER_MISMATCH');
      old.ids.forEach(id => pending.add(id)); phase = 'CLEANUP'; for (const id of [...pending]) await remove(id); phase = 'SETUP';
    }
    const ownerA = await identity(), ownerB = await identity();
    const expectedA = await seed(ownerA, 1005), expectedB = await seed(ownerB, 3);
    const capped = await read(ownerA.client.from('memories').select('id').eq('user_id', ownerA.id));
    requireCheck(capped.length === 1000, 'actual unpaginated local REST response demonstrates1000 row cap');
    requireCheck((await read(ownerA.client.from('memories').select('id').eq('user_id', ownerB.id))).length === 0, 'actual ownerA RLS cannot read B memories');
    requireCheck((await read(ownerB.client.from('memories').select('id').eq('user_id', ownerA.id))).length === 0, 'actual ownerB RLS cannot read A memories');

    const ts = await import('typescript');
    const original = readFileSync('src/lib/service.ts', 'utf8');
    const built = ts.transpileModule(original, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const packageImport = /from (['"])@supabase\/supabase-js\1/g;
    const helperImport = /from (['"])\.\/auth-identity\1/g;
    if ([...built.matchAll(packageImport)].length !== 1 || [...built.matchAll(helperImport)].length !== 1 || !built.includes('import.meta.env')) throw Error('SERVICE_TRANSPILE_IMPORT_CONTRACT_CHANGED');
    const helperBuilt = ts.transpileModule(readFileSync('src/lib/auth-identity.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const helperUrl = `data:text/javascript;base64,${Buffer.from(helperBuilt).toString('base64')}`;
    const publicEnv = JSON.stringify({ VITE_SUPABASE_URL: TARGET, VITE_SUPABASE_ANON_KEY: config.ANON_KEY });
    const executable = built.replace(packageImport, `from ${JSON.stringify(import.meta.resolve('@supabase/supabase-js'))}`)
      .replace(helperImport, `from ${JSON.stringify(helperUrl)}`).replaceAll('import.meta.env', publicEnv);
    const module = await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
    const service = module.service; productionClient = module.supabase;
    if (!productionClient) throw Error('PRODUCTION_SERVICE_NOT_CONFIGURED');
    productionClient.auth.stopAutoRefresh();
    const signIn = async owner => {
      const signed = await productionClient.auth.setSession({ access_token: owner.session.access_token, refresh_token: owner.session.refresh_token });
      requireCheck(!signed.error && signed.data.user?.id === owner.id, 'production client has selected owned synthetic session');
    };
    await signIn(ownerA); begin('READ_A');
    const loaded = await service.listMemories();
    requireCheck(JSON.stringify(loaded.map(row => row.id)) === JSON.stringify(expectedA), 'all1005 same-timestamp IDs returned in exact descending order');
    requireCheck(new Set(loaded.map(row => row.id)).size === 1005, 'no duplicate IDs across200-row boundaries'); assertQueries(ownerA.id, 6);
    requireCheck(memoryUrls.slice(1).every(url => url.searchParams.get('or')?.includes('.123456')), 'microsecond precision retained in actual cursors');

    begin('FAULT_PAGE2'); let caught;
    try { await service.listMemories(); } catch (error) { caught = error; }
    requireCheck(caught?.code === 'XXFIXTURE', 'injected page2 HTTP failure rejects the complete load'); assertQueries(ownerA.id, 2);
    begin('SWITCH_PAGE2'); caught = undefined; switchSession = () => signIn(ownerB);
    try { await service.listMemories(); } catch (error) { caught = error; }
    requireCheck(caught?.code === 'SESSION_CHANGED', 'real session switch after page2 rejects partial or mixed result'); assertQueries(ownerA.id, 2);
    begin('READ_B'); const ownB = await service.listMemories();
    requireCheck(JSON.stringify(ownB.map(row => row.id)) === JSON.stringify(expectedB), 'subsequent B load contains only its three memories'); assertQueries(ownerB.id, 1);
    requireCheck(counts.injectedHttpErrors === 4 && counts.sdkRetryAttempts === 3, 'one page fault exhausted exactly3 existing SDK retries');
    requireCheck(JSON.stringify(faultRetryHeaders) === JSON.stringify([null, '1', '2', '3']), 'SDK emitted expected retry attempt headers without disabling retry');
    completed = true;
  } catch (error) { failure = safeError(error); }
  finally {
    phase = 'CLEANUP';
    try { await productionClient?.auth.signOut({ scope: 'local' }); productionClient?.auth.stopAutoRefresh(); } catch { /* Account cleanup is independent. */ }
    for (const id of [...pending]) { try { await remove(id); } catch { cleanupFailed = true; } }
    globalThis.fetch = nativeFetch;
    const sourceFrozen = JSON.stringify(before) === JSON.stringify(hashes());
    const report = { at: new Date().toISOString(), runId, status: completed && !failure && !cleanupFailed && !pending.size && sourceFrozen ? 'PASSED' : 'FAILED',
      scope: plan, checks, counts, faultRetryHeaders, failure, sourceFrozen, sourceHashes: before, cleanup, pendingCleanupCount: pending.size,
      credentialsPersisted: false, rawUserDataPersisted: false, publicSignupTested: false };
    mkdirSync('test-results/local-memory-pagination-runs', { recursive: true });
    writeFileSync(`test-results/local-memory-pagination-runs/${runId}.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, checks: checks.length, passed: checks.filter(check => check.passed).length, counts, cleanup, pendingCleanupCount: pending.size, report: REPORT }));
    if (report.status !== 'PASSED') process.exitCode = 1;
  }
}
