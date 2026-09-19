// Explicit hosted synthetic fixture preparation. Default invocation is a read-only plan.
// No browser, user profile, hosted env file, model endpoint or Edge Function is opened here.
import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROJECT_REF = 'klhoarharlmliuynoezq';
const API_URL = `https://${PROJECT_REF}.supabase.co`;
const MARKER = 'JumZip hosted public UI read-only fixture';
const LEDGER = 'test-results/pending-hosted-public-ui-cleanup.json';
const TABLES = ['profiles', 'conversations', 'consultations', 'messages', 'tarot_draw_groups', 'tarot_draws', 'birth_profiles', 'saju_readings',
  'saju_compatibility_readings', 'related_people', 'memories', 'memory_suppressions', 'request_executions', 'rate_limit_buckets', 'daily_draw_claims'];
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const MODEL = 'TEST_DOUBLE_HOSTED_PUBLIC_UI';
const PROMPT = 'TEST_DOUBLE_UI_FIXTURE_V1';
const AS_OF = '2026-09-20T00:00:00.000Z';
export const HOSTED_UI_FIXTURE_REPORT = 'test-results/hosted-public-ui-fixture-report.json';
export const HOSTED_UI_EXPECTATIONS = Object.freeze({
  titles: Object.freeze({ tarot: '합성 타로 세 장', sajuKnown: '합성 사주 · 시간 확인', sajuUnknown: '합성 사주 · 시간 미상', compatibility: '합성 사주 궁합' }),
  knownBirthCanaries: Object.freeze(['1992-10-24', '05:30', 'QA_PRIVATE_CITY']),
  unknownBirthCanaries: Object.freeze(['2024-02-04', 'QA_PRIVATE_CITY']),
  partnerBirthCanaries: Object.freeze(['1995-08-21', '09:45', 'QA_PARTNER_PRIVATE_CITY']),
  birthCanaries: Object.freeze(['1992-10-24', '05:30', 'QA_PRIVATE_CITY', '2024-02-04', '1995-08-21', '09:45', 'QA_PARTNER_PRIVATE_CITY']),
  interpretationPrefix: 'TEST_DOUBLE:',
});
export const HOSTED_PUBLIC_UI_PLAN = Object.freeze({
  target: API_URL, publicSite: 'https://jumzip.pages.dev', expectedProjectRef: PROJECT_REF,
  authScope: 'Admin-created synthetic accounts and generated-link verifyOtp sessions. Not public signup, CAPTCHA, email delivery or OAuth evidence.',
  records: ['three-card Tarot', 'known-time Saju', 'unknown-boundary Saju', 'derived A/B compatibility'], identities: 2,
  actualComponents: ['hosted Auth', 'hosted PostgREST and RLS', 'service-only begin/save/complete RPCs', 'pure domain calculations'],
  testDoubles: ['Interpretation text and model/prompt provenance explicitly identify TEST_DOUBLE; no model inference.'],
  sourceLimitations: ['Synthetic coordinates bypass external location resolution.', 'Pure domain outputs are not an independent traditional or astronomical oracle.'],
  maximumSeedRPC: 12, edgeRequests: 0, modelRequests: 0,
  callbackFields: ['apiUrl', 'anonKey', 'sessions.A', 'sessions.B', 'ids'], serviceKeyLeavesNode: false,
  browserContract: 'Fresh isolated contexts only; public same-origin assets plus exact hosted Auth/REST GET/HEAD/OPTIONS. Abort mutations, RPCs, Edge and model requests. No trace/HAR/video/token logging.',
  cleanup: 'Immediate marked-ID ledger; finally independently verify Auth404 and zero rows in fifteen tables, including after callback failure.',
  optIn: 'JUMZIP_RUN_HOSTED_PUBLIC_UI_FIXTURE=HOSTED_APPROVED and explicit expectedProjectRef argument after Main GO.',
});
const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const safeCode = error => error instanceof Error && /^[A-Z0-9_]{3,100}$/.test(error.message) ? error.message : 'HOSTED_UI_FIXTURE_OR_CALLBACK_FAILED';
const assert = (condition, code) => { if (!condition) throw Error(code); };
function sourceHashes() {
  const files = ['tests/backend/hosted-public-ui-fixture.mjs'];
  const walk = directory => { for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name); if (entry.isDirectory()) walk(file); else if (file.endsWith('.ts')) files.push(file);
  } };
  walk('supabase/functions/_shared/domain');
  files.push(...readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).map(name => 'supabase/migrations/' + name));
  return Object.fromEntries(files.sort().map(file => [file.replaceAll('\\', '/'), sha(readFileSync(file, 'utf8').replaceAll('\r\n', '\n'))]));
}
function privateConfiguration(expectedProjectRef) {
  assert(process.env.JUMZIP_RUN_HOSTED_PUBLIC_UI_FIXTURE === 'HOSTED_APPROVED', 'EXPLICIT_HOSTED_UI_OPT_IN_REQUIRED');
  assert(expectedProjectRef === PROJECT_REF, 'EXPLICIT_EXPECTED_PROJECT_REQUIRED');
  const { SUPABASE_URL: configured, SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: serviceKey } = process.env;
  let url; try { url = new URL(configured); } catch { throw Error('HOSTED_PROJECT_URL_REQUIRED'); }
  assert(url.origin === API_URL && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash, 'HOSTED_PROJECT_MISMATCH');
  assert(typeof anonKey === 'string' && typeof serviceKey === 'string' && anonKey !== serviceKey, 'PRIVATE_AUTH_CONFIGURATION_REQUIRED');
  let anonRole;
  try { anonRole = JSON.parse(Buffer.from(anonKey.split('.')[1] ?? '', 'base64url').toString()).role; } catch { /* A public publishable key has no JWT payload. */ }
  assert(anonRole === 'anon' || /^sb_publishable_[A-Za-z0-9_-]+$/.test(anonKey), 'PUBLIC_ANON_KEY_REQUIRED');
  return { anonKey, serviceKey };
}

/** Callback gets only owned sessions, public config and record IDs. It must close
 * isolated browser contexts in its own finally block before resolving/rejecting.
 * Never serialize the callback arguments or pass them to an existing user browser.
 * The helper's network guard covers its own SDK requests; the browser has its own
 * explicit read-only guard and evidence. No admin inspection function is exposed. */
export async function withHostedPublicUIFixture(run, { expectedProjectRef, cleanupOnly = false } = {}) {
  assert(typeof run === 'function', 'FIXTURE_CALLBACK_REQUIRED');
  const config = privateConfiguration(expectedProjectRef), runId = randomUUID(), before = sourceHashes();
  const nativeFetch = globalThis.fetch;
  const counts = { authRequests: 0, restRequests: 0, seedRPC: 0, blockedDestinations: 0, workRequests: 0, cleanupRequests: 0 };
  const pending = new Set(), cleanup = [], checks = [];
  let phase = 'SETUP', failure = null, cleanupFailed = false, callbackCompleted = false, result;
  const reportDirectory = 'test-results/hosted-public-ui-fixture-runs';
  const ledger = () => {
    mkdirSync('test-results', { recursive: true });
    writeFileSync(LEDGER, JSON.stringify({ target: API_URL, marker: MARKER, ids: [...pending] }, null, 2) + '\n');
  };
  const guardedFetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== API_URL || url.username || url.password || url.hash || !/^\/(auth|rest)\/v1(?:\/|$)/.test(url.pathname)) {
      counts.blockedDestinations++; throw Error('OUT_OF_SCOPE_NETWORK_BLOCKED');
    }
    counts[url.pathname.startsWith('/auth/') ? 'authRequests' : 'restRequests']++;
    if (phase === 'CLEANUP') counts.cleanupRequests++;
    else if (++counts.workRequests > 100) throw Error('FIXTURE_WORK_REQUEST_CAP');
    const timeout = AbortSignal.timeout(30_000);
    return nativeFetch(input, { ...init, redirect: 'error', signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  };
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: guardedFetch } };
  const admin = createClient(API_URL, config.serviceKey, options);
  const read = async query => { const response = await query; if (response.error || response.data === null) throw Error('HOSTED_FIXTURE_DATABASE_FAILED'); return response.data; };
  const mutate = async query => { if ((await query).error) throw Error('HOSTED_FIXTURE_DATABASE_WRITE_FAILED'); };
  const check = (name, condition) => { checks.push({ name, passed: Boolean(condition) }); assert(condition, 'HOSTED_FIXTURE_ASSERTION_FAILED'); };
  const rpc = async (name, parameters) => {
    if (++counts.seedRPC > 12) throw Error('FIXTURE_SEED_RPC_CAP');
    return read(admin.rpc(name, parameters));
  };
  async function remove(id) {
    const previous = phase; phase = 'CLEANUP';
    try {
      const found = await admin.auth.admin.getUserById(id);
      if (!found.error) {
        assert(found.data.user?.user_metadata?.test_run === MARKER && /^jumzip-hosted-ui-[a-f0-9-]+@example\.com$/i.test(found.data.user?.email ?? ''), 'CLEANUP_OWNERSHIP_GUARD');
        if ((await admin.auth.admin.deleteUser(id, false)).error) throw Error('HOSTED_FIXTURE_CLEANUP_FAILED');
      } else if (found.error.status !== 404) throw Error('HOSTED_FIXTURE_AUTH_LOOKUP_FAILED');
      const absent = await admin.auth.admin.getUserById(id);
      assert(!absent.data.user && absent.error?.status === 404, 'HOSTED_FIXTURE_AUTH_REMAINS');
      for (const table of TABLES) {
        const column = table === 'profiles' ? 'id' : 'user_id';
        const rows = await admin.from(table).select(column, { head: true, count: 'exact' }).eq(column, id);
        assert(!rows.error && rows.count === 0, 'HOSTED_FIXTURE_ROWS_REMAIN');
      }
      pending.delete(id); ledger(); cleanup.push({ authAbsent: true, emptyOwnedTables: TABLES.length });
    } finally { phase = previous; }
  }
  async function identity(label) {
    const email = `jumzip-hosted-ui-${randomUUID()}@example.com`;
    const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { test_run: MARKER } });
    if (created.error || !created.data.user) throw Error('HOSTED_FIXTURE_IDENTITY_FAILED');
    const id = created.data.user.id; pending.add(id); ledger();
    await mutate(admin.from('profiles').update({ display_name: `합성검증${label}`, preferred_character: 'SANI', memory_enabled: false }).eq('id', id));
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    assert(!link.error && link.data.user?.id === id && link.data.properties?.hashed_token, 'HOSTED_FIXTURE_LINK_FAILED');
    const client = createClient(API_URL, config.anonKey, options);
    const signed = await client.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token });
    assert(!signed.error && signed.data.user?.id === id && signed.data.session, 'HOSTED_FIXTURE_SESSION_FAILED');
    const verified = await client.auth.getUser(signed.data.session.access_token);
    check(`synthetic ${label} session verified by actual hosted Auth`, !verified.error && verified.data.user?.id === id);
    return { id, session: signed.data.session, client };
  }
  try {
    if (existsSync(LEDGER)) {
      const old = JSON.parse(readFileSync(LEDGER, 'utf8'));
      assert(old.target === API_URL && old.marker === MARKER && Array.isArray(old.ids)
        && old.ids.every(id => typeof id === 'string' && UUID.test(id)), 'CLEANUP_LEDGER_MISMATCH');
      old.ids.forEach(id => pending.add(id)); for (const id of [...pending]) await remove(id);
    }
    if (cleanupOnly) callbackCompleted = true;
    else {
    // Domain modules load only after explicit hosted opt-in. They perform no I/O.
    const [{ drawTarot }, { calculateFullSajuWithTiming }, { calculateSajuCompatibility }] = await Promise.all([
      import('../../supabase/functions/_shared/domain/tarot.ts'), import('../../supabase/functions/_shared/domain/fortune-timing.ts'),
      import('../../supabase/functions/_shared/domain/saju-compatibility.ts'),
    ]);
    const birth = { calendarType: 'SOLAR', leapMonth: false, birthDate: '1992-10-24', birthTime: '05:30', birthTimeUnknown: false, gender: 'MALE',
      location: { name: 'QA_PRIVATE_CITY', country: 'South Korea', latitude: 37.5665, longitude: 126.978, timezone: 'Asia/Seoul' } };
    const unknownBirth = { ...birth, birthDate: '2024-02-04', birthTime: null, birthTimeUnknown: true, gender: 'FEMALE' };
    const partnerBirth = { ...birth, birthDate: '1995-08-21', birthTime: '09:45', gender: 'FEMALE', location: { ...birth.location, name: 'QA_PARTNER_PRIVATE_CITY' } };
    const known = calculateFullSajuWithTiming(birth, new Date(AS_OF));
    const unknown = calculateFullSajuWithTiming(unknownBirth, new Date(AS_OF));
    const partner = calculateFullSajuWithTiming(partnerBirth, new Date(AS_OF));
    const compatibility = calculateSajuCompatibility({ personA: known, personB: partner });
    check('compatibility domain output contains no raw partner birth canaries', HOSTED_UI_EXPECTATIONS.partnerBirthCanaries.every(value => !JSON.stringify(compatibility).includes(value)));
    const ownerA = await identity('가'), ownerB = await identity('나');
    const conversation = await read(admin.from('conversations').insert({ user_id: ownerA.id, character_id: 'SANI', title: '공개 화면 합성 기록', title_custom: true }).select('id').single());
    const beginParams = (operation, label) => ({ user_id: ownerA.id, operation, request_id: randomUUID(), payload_hash: sha({ fixture: MARKER, runId, label }),
      conversation_id: conversation.id, consultation_id: null });
    async function finish(claim, label) {
      const title = HOSTED_UI_EXPECTATIONS.titles[label];
      const content = `TEST_DOUBLE: ${title}의 공개 화면 연결 검증용 합성 해석입니다. 실제 모델 응답이 아닙니다.\n저장된 결과와 마지막 문장이 이미지에서도 유지되는지 확인합니다.`;
      const complete = await rpc('complete_execution', { p_execution_id: claim.executionId, p_assistant_content: content, p_segments: content.split('\n'),
        p_model_id: MODEL, p_prompt_version: PROMPT, p_data: { executionStatus: 'SUCCEEDED' } });
      await mutate(admin.from('consultations').update({ title, title_custom: true }).eq('id', complete.consultationId).eq('user_id', ownerA.id));
      return complete;
    }
    phase = 'TAROT_SEED';
    const cards = drawTarot('GENERAL_3');
    const question = '합성 기록: 현재 상황과 작은 행동을 살펴봅니다.';
    const tarotClaim = await rpc('begin_fortune_request', { p_params: { ...beginParams('tarot.DRAW', 'tarot'), question, spread_type: 'GENERAL_3', mode: 'NORMAL', local_date: null } });
    const tarotSaved = await rpc('save_tarot_draw', { p_execution_id: tarotClaim.executionId, p_cards: cards, p_spread_type: 'GENERAL_3', p_mode: 'NORMAL',
      p_local_date: null, p_question: question, p_source_draw_group_id: null });
    const tarot = await finish(tarotClaim, 'tarot');
    check('real Tarot RPC snapshot retains three distinct domain cards', tarot.cards.length === 3 && new Set(tarot.cards.map(card => card.cardId)).size === 3
      && JSON.stringify(tarot.cards) === JSON.stringify(tarotSaved.cards));
    async function seedSaju(label, input, calculated) {
      phase = label;
      const claim = await rpc('begin_saju_request', { p_params: { ...beginParams('saju.CALCULATE', label), target_type: 'SAJU', focus: 'GENERAL' } });
      await rpc('save_saju_reading', { p_execution_id: claim.executionId, p_result: calculated, p_birth_profile_snapshot: input, p_profile_input: null });
      return finish(claim, label);
    }
    const sajuKnown = await seedSaju('sajuKnown', birth, known), sajuUnknown = await seedSaju('sajuUnknown', unknownBirth, unknown);
    phase = 'COMPATIBILITY_SEED';
    const compatibilityClaim = await rpc('begin_saju_compatibility_request', { p_params: beginParams('compatibility.CALCULATE_SAJU', 'compatibility') });
    await rpc('save_saju_compatibility', { p_execution_id: compatibilityClaim.executionId, p_result: compatibility,
      p_person_a_profile_input: null, p_person_b_profile_input: null, p_person_b_alias: null, p_related_person_id: null });
    const compatibilitySaved = await finish(compatibilityClaim, 'compatibility');
    const ids = { ownerA: ownerA.id, ownerB: ownerB.id, conversation: conversation.id,
      tarot: { consultationId: tarot.consultationId, drawGroupId: tarot.drawGroupId },
      sajuKnown: { consultationId: sajuKnown.consultationId, readingId: sajuKnown.readingId },
      sajuUnknown: { consultationId: sajuUnknown.consultationId, readingId: sajuUnknown.readingId },
      compatibility: { consultationId: compatibilitySaved.consultationId, compatibilityReadingId: compatibilitySaved.compatibilityReadingId } };
    check('all four completed records have canonical UUIDs', Object.values(ids).every(value => typeof value === 'string' ? UUID.test(value) : Object.values(value).every(id => UUID.test(id))));
    check('owner can read all four records through hosted authenticated RLS', (await read(ownerA.client.from('consultations').select('id').eq('conversation_id', conversation.id))).length === 4);
    check('second owner cannot read the first owner records through hosted RLS', (await read(ownerB.client.from('consultations').select('id').eq('conversation_id', conversation.id))).length === 0);
    const messages = await read(admin.from('messages').select('model_id,prompt_version,content').eq('user_id', ownerA.id).eq('sender', 'ASSISTANT'));
    check('all interpretation records explicitly declare TEST_DOUBLE provenance', messages.length === 4
      && messages.every(row => row.model_id === MODEL && row.prompt_version === PROMPT && row.content.startsWith('TEST_DOUBLE:')));
    for (const table of ['birth_profiles', 'related_people', 'memories']) check(`no separate ${table} fixture was stored`, (await read(admin.from(table).select('id').eq('user_id', ownerA.id))).length === 0);
    const compatibilityRow = await read(admin.from('saju_compatibility_readings').select('result_snapshot,a_chart_snapshot,b_chart_snapshot').eq('id', ids.compatibility.compatibilityReadingId).single());
    check('persisted compatibility has derived snapshots without raw partner birth', HOSTED_UI_EXPECTATIONS.partnerBirthCanaries.every(value => !JSON.stringify(compatibilityRow).includes(value)));
    phase = 'BROWSER_CALLBACK';
    // Deliberately no service client, service key, privileged callback or raw birth input.
    result = await run({ apiUrl: API_URL, anonKey: config.anonKey, sessions: { A: ownerA.session, B: ownerB.session }, ids });
    callbackCompleted = true;
    }
  } catch (error) { failure = { phase, code: safeCode(error) }; }
  finally {
    for (const id of [...pending]) { try { await remove(id); } catch { cleanupFailed = true; } }
    const frozen = sha(sourceHashes()) === sha(before);
    const report = { runId, at: new Date().toISOString(), mode: 'HOSTED_ADMIN_SYNTHETIC_UI_FIXTURE_SETUP_AND_CLEANUP', target: API_URL,
      status: callbackCompleted && !failure && !cleanupFailed && pending.size === 0 && frozen ? 'PASS' : 'FAIL',
      authScope: HOSTED_PUBLIC_UI_PLAN.authScope, callbackCompleted, cleanupOnly, sourceHashes: before, sourceFrozen: frozen,
      counts, checks, cleanup, pendingCleanupCount: pending.size, failure, cleanupFailed,
      credentialsPersisted: false, sessionsOrCredentialsPersisted: false, serviceKeyPassedToCallback: false, publicSignupTested: false, captchaTested: false, oauthTested: false,
      fixtureEdgeRequests: 0, fixtureModelRequests: 0, browserModelRequests: 'Caller must separately report its browser network guard.',
      modelProvenance: MODEL, promptProvenance: PROMPT, deterministicAsOf: AS_OF,
      limitations: ['The admin-created sessions bypass the public entry flow; signup/CAPTCHA/OAuth remain outside scope.',
        'The helper seeds actual engine results with synthetic interpretation text; no real model or independent astronomical oracle was tested.',
        'Only separate browser evidence can establish public render/CORS/History/Reading/PNG success.',
        'Own synthetic Saju birth snapshots exist for the default-hidden export check; no partner raw birth or standalone profile is saved.'] };
    mkdirSync(reportDirectory, { recursive: true });
    writeFileSync(`${reportDirectory}/${runId}.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    writeFileSync(HOSTED_UI_FIXTURE_REPORT, JSON.stringify(report, null, 2) + '\n');
    if (!frozen) failure ??= { phase: 'SOURCE_FREEZE', code: 'FIXTURE_SOURCE_CHANGED' };
  }
  if (cleanupFailed || pending.size) throw Error('HOSTED_UI_FIXTURE_CLEANUP_INCOMPLETE');
  if (failure) throw Error(failure.code);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes('--cleanup-only')) {
    const expectedProjectRef = process.argv.find(value => value.startsWith('--expected-project-ref='))?.split('=')[1];
    try { await withHostedPublicUIFixture(async () => undefined, { expectedProjectRef, cleanupOnly: true }); console.log('OWNED_FIXTURE_CLEANUP_VERIFIED'); }
    catch (error) { console.log(JSON.stringify({ status: 'NOT_COMPLETED', code: safeCode(error) })); process.exitCode = 1; }
  } else {
    console.log(JSON.stringify({ ...HOSTED_PUBLIC_UI_PLAN, invocation: 'Import withHostedPublicUIFixture from an approved read-only browser runner. Use Node --experimental-transform-types for actual seeding.',
      report: HOSTED_UI_FIXTURE_REPORT, actualRequests: 0 }, null, 2));
  }
}
