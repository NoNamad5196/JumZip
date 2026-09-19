/** Opt-in integration probe. No network occurs without JUMZIP_RUN_LIVE_SAJU_SMOKE=1.
 * Uses synthetic dates and disposable admin-created users, cleans up only its tracked
 * IDs, and never prints credentials, passwords, tokens, emails or user IDs.
 * The caller must confirm the remote LLM key is unset before running this probe. */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

if (process.env.JUMZIP_RUN_LIVE_SAJU_SMOKE !== '1') {
  console.log('SKIPPED: opt-in live Edge Saju probe; no network requested.');
  process.exit(0);
}
const environment = Object.fromEntries((await readFile(resolve('.env.server.local'), 'utf8')).split(/\r?\n/)
  .flatMap(line => { const match = /^([A-Z_]+)\s*=\s*(.*)$/.exec(line); return match ? [[match[1], match[2].trim().replace(/^(["'])(.*)\1$/, '$2')]] : []; }));
const url = environment.SUPABASE_URL?.replace(/\/+$/, '');
if (url !== 'https://klhoarharlmliuynoezq.supabase.co' || !environment.SUPABASE_ANON_KEY || !environment.SUPABASE_SERVICE_ROLE_KEY || environment.LLM_API_KEY) {
  console.error('REFUSED: expected target, keys, and locally unset LLM key required.'); process.exit(1);
}
const directory = resolve('test-results'); await mkdir(directory, { recursive: true });
const ledgerPath = resolve(directory, 'live-saju-smoke-cleanup.json');
const reportPath = resolve(directory, 'live-saju-smoke-report.json');
const userIds = [];
const report = { startedAt: new Date().toISOString(), target: 'klhoarharlmliuynoezq', purpose: 'Actual Edge Full Saju synthetic smoke; wall time is not CPU time',
  expectedLLM: 'UNCONFIGURED_REMOTE_CONFIRMED_BY_OPERATOR', cases: [], cleanup: { created: 0, deleted: 0, cascadeVerified: false }, passed: false };
const persistLedger = () => writeFile(ledgerPath, JSON.stringify({ purpose: 'JumZip live Saju smoke cleanup only', userIds }), { mode: 0o600 });
const serviceHeaders = { apikey: environment.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${environment.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
const clientHeaders = token => ({ apikey: environment.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
async function request(path, { method = 'GET', headers = serviceHeaders, body, timeoutMs = 25_000 } = {}) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
    const text = await response.text(); let value; try { value = JSON.parse(text); } catch { value = null; }
    return { status: response.status, value };
  } finally { clearTimeout(timer); }
}
function check(condition, code) { if (!condition) throw new Error(code); }
const errorCode = error => error instanceof Error && /^[A-Z0-9_]{1,90}$/.test(error.message) ? error.message : 'NETWORK_OR_UNEXPECTED_FAILURE';
const pillar = value => value ? value.heavenlyStem + value.earthlyBranch : null;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cases = [
  { id: 'ORDINARY_UNKNOWN', date: '1992-10-24', time: null, gender: 'MALE', expectedUnknown: true },
  { id: 'IPCHUN_UNKNOWN_CORRELATED', date: '2024-02-04', time: null, gender: 'FEMALE', expectedUnknown: true },
  { id: 'KOREA_DST_GAP', date: '1988-05-08', time: '02:30', expectedError: 'SAJU_CONVENTION_UNSUPPORTED' },
  { id: 'KOREA_DST_FOLD', date: '1988-10-09', time: '02:30', expectedFlag: 'DST_AMBIGUOUS_TIME' },
  { id: 'LUNAR_LEAP', date: '2020-04-01', time: '12:00', lunar: true, leap: true, expectedDay: '丙寅' },
  { id: 'LUNAR_REGULAR', date: '1992-09-29', time: '12:00', lunar: true, expectedDay: '癸酉' },
  { id: 'IPCHUN_BEFORE', date: '2024-02-04', time: '17:26', expectedYear: '癸卯' },
  { id: 'IPCHUN_AFTER', date: '2024-02-04', time: '17:28', expectedYear: '甲辰' },
  { id: 'MONTH_TERM_BEFORE', date: '2024-03-05', time: '11:22', expectedMonth: '丙寅' },
  { id: 'MONTH_TERM_AFTER', date: '2024-03-05', time: '11:24', expectedMonth: '丁卯' },
  { id: 'JASI_LATE_CIVIL', date: '2024-02-10', time: '23:30', expectedFlag: 'JASI_CONVENTION_BOUNDARY' },
  { id: 'JASI_EARLY_CIVIL', date: '2024-02-11', time: '00:30', expectedFlag: 'JASI_CONVENTION_BOUNDARY' },
  { id: 'TRUE_SOLAR_MALE', date: '2024-02-10', time: '07:05', gender: 'MALE', expectedHourBranch: '卯', expectedForward: true },
  { id: 'OVERSEAS_DST_FOLD', date: '2024-11-03', time: '01:30', location: 'NEW_YORK', expectedFlag: 'DST_AMBIGUOUS_TIME' },
  { id: 'TRUE_SOLAR_FEMALE', date: '2024-02-10', time: '07:05', gender: 'FEMALE', expectedHourBranch: '卯', expectedForward: false },
];
try {
  // Never overwrite a previous interrupted run's cleanup ledger.
  const previous = await readFile(ledgerPath, 'utf8').catch(() => null);
  check(!previous, 'PREVIOUS_CLEANUP_LEDGER_REQUIRES_REVIEW');
  const sessions = [];
  for (let index = 0; index < 3; index++) {
    const email = `jumzip-saju-smoke-${randomUUID()}@example.invalid`;
    const password = randomBytes(32).toString('base64url') + 'aA1!';
    const created = await request('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true, user_metadata: { purpose: 'disposable-saju-edge-smoke' } } });
    check(created.status >= 200 && created.status < 300 && created.value?.id, 'TEST_USER_CREATE_FAILED');
    userIds.push(created.value.id); report.cleanup.created++; await persistLedger();
    const signedIn = await request('/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: environment.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: { email, password } });
    check(signedIn.status === 200 && signedIn.value?.access_token, 'TEST_USER_SIGNIN_FAILED');
    const token = signedIn.value.access_token;
    const conversation = await request('/rest/v1/conversations', { method: 'POST', headers: { ...clientHeaders(token), Prefer: 'return=representation' }, body: { user_id: created.value.id, character_id: 'SANI', title: 'Disposable Saju engine smoke' } });
    check(conversation.status === 201 && conversation.value?.[0]?.id, 'TEST_CONVERSATION_CREATE_FAILED');
    sessions.push({ token, userId: created.value.id, conversationId: conversation.value[0].id });
  }
  const locations = {};
  for (const [key, query, timezone] of [['SEOUL', 'Seoul', 'Asia/Seoul'], ['NEW_YORK', 'New York City', 'America/New_York']]) {
    const found = await request('/functions/v1/saju', { method: 'POST', headers: clientHeaders(sessions[0].token), body: { schemaVersion: 1, requestId: randomUUID(), action: 'RESOLVE_LOCATION', query, limit: 8 } });
    const location = found.value?.data?.locations?.find(item => item.timezone === timezone);
    if (!found.value?.ok || !location) report.locationFailure = { cityKey: key, httpStatus: found.status,
      code: /^[A-Z_]+$/.test(found.value?.error?.code ?? '') ? found.value.error.code : 'NO_ENVELOPE_ERROR',
      hasLocations: Array.isArray(found.value?.data?.locations), locationCount: found.value?.data?.locations?.length ?? 0 };
    check(found.value?.ok && location, 'TEST_LOCATION_RESOLUTION_FAILED'); locations[key] = location;
  }
  for (let index = 0; index < cases.length; index++) {
    const fixture = cases[index]; const session = sessions[Math.floor(index / 5)];
    const entry = { id: fixture.id, passed: false }; const started = performance.now();
    try {
      const response = await request('/functions/v1/saju', { method: 'POST', timeoutMs: 110_000, headers: clientHeaders(session.token), body: {
        schemaVersion: 1, requestId: randomUUID(), action: 'CALCULATE', conversationId: session.conversationId, consultationId: null,
        subject: { saveProfile: false, input: { calendarType: fixture.lunar ? 'LUNAR' : 'SOLAR', leapMonth: Boolean(fixture.leap), birthDate: fixture.date,
          birthTime: fixture.time, birthTimeUnknown: fixture.time === null, location: locations[fixture.location ?? 'SEOUL'], gender: fixture.gender ?? 'MALE' } }, focus: 'GENERAL',
      } });
      entry.wallTimeMs = Math.round(performance.now() - started); entry.httpStatus = response.status;
      const envelope = response.value;
      if (fixture.expectedError) {
        entry.errorCode = envelope?.error?.code ?? 'NO_ERROR_CODE';
        check(envelope?.ok === false && entry.errorCode === fixture.expectedError, 'EXPECTED_CONVENTION_REJECTION_MISSING');
        check(envelope.error.details?.reason === 'NONEXISTENT_CIVIL_TIME', 'EXPECTED_GAP_REASON_MISSING');
        entry.passed = true;
      } else {
        check(envelope?.ok === true, `EDGE_${/^[A-Z_]+$/.test(envelope?.error?.code ?? '') ? envelope.error.code : 'CALCULATION_FAILED'}`);
        const data = envelope.data; entry.executionStatus = data.executionStatus; entry.partialReason = data.partialError?.details?.reason ?? null;
        check(data.executionStatus === 'PARTIAL' && data.interpretation === null && data.partialError?.code === 'SAJU_INTERPRETATION_FAILED', 'EXPECTED_UNCONFIGURED_LLM_PARTIAL_MISSING');
        const stored = await request(`/rest/v1/saju_readings?id=eq.${encodeURIComponent(data.readingId)}&select=result_snapshot,engine_version,rule_version,convention_version`, { headers: clientHeaders(session.token) });
        check(stored.status === 200 && stored.value?.length === 1, 'SAVED_SNAPSHOT_MISSING');
        const row = stored.value[0]; const snapshot = row.result_snapshot;
        check(snapshot?.fullCalculationReady === true && ['COMPLETE', 'LIMITED', 'UNCERTAIN'].includes(snapshot.status), 'FULL_ENGINE_STATUS_INVALID');
        for (const [field, column, expected] of [['engineVersion', 'engine_version', 'manseryeok-2.0.0'], ['ruleVersion', 'rule_version', 'JumZipSajuRules-v1'], ['conventionVersion', 'convention_version', 'JumZipSajuConvention-v1']]) {
          check(snapshot[field] === expected && row[column] === expected && data[field] === expected, 'VERSION_SNAPSHOT_MISMATCH');
        }
        const charts = snapshot.possible_values?.charts; check(Array.isArray(charts) && charts.length > 0, 'CORRELATED_CHARTS_MISSING');
        for (const position of ['year', 'month', 'day', 'hour']) {
          const options = [...new Set(charts.map(chart => JSON.stringify(chart.pillars[position])))];
          check(same(snapshot.pillars[position], options.length === 1 ? JSON.parse(options[0]) : null), 'CONFIRMED_PILLAR_MISMATCH');
        }
        const tuples = charts.map(chart => ['year', 'month', 'day', 'hour'].map(position => pillar(chart.pillars[position])).join('/'));
        check(new Set(tuples).size === tuples.length, 'DUPLICATE_CORRELATED_CHARTS');
        if (fixture.expectedUnknown) {
          check(snapshot.pillars.hour === null && snapshot.tenGods.hour === null && charts.every(chart => chart.pillars.hour === null), 'FAKE_UNKNOWN_HOUR');
          check(snapshot.uncertaintyFlags.includes('BIRTH_TIME_UNKNOWN'), 'UNKNOWN_FLAG_MISSING');
        }
        if (fixture.id === 'IPCHUN_UNKNOWN_CORRELATED') {
          check(same([...tuples].sort(), ['癸卯/乙丑/丁酉/', '癸卯/乙丑/戊戌/', '甲辰/丙寅/戊戌/'].sort()), 'IPCHUN_CORRELATION_MISMATCH');
          check(snapshot.pillars.year === null && snapshot.pillars.month === null, 'IPCHUN_UNCERTAINTY_LOST');
        }
        if (fixture.expectedDay) check(pillar(snapshot.pillars.day) === fixture.expectedDay, 'EXPECTED_DAY_MISMATCH');
        if (fixture.expectedYear) check(pillar(snapshot.pillars.year) === fixture.expectedYear, 'EXPECTED_YEAR_MISMATCH');
        if (fixture.expectedMonth) check(pillar(snapshot.pillars.month) === fixture.expectedMonth, 'EXPECTED_MONTH_MISMATCH');
        if (fixture.expectedHourBranch) check(snapshot.pillars.hour?.earthlyBranch === fixture.expectedHourBranch, 'EXPECTED_SOLAR_HOUR_MISMATCH');
        if (fixture.expectedFlag) check(snapshot.uncertaintyFlags.includes(fixture.expectedFlag), 'EXPECTED_BOUNDARY_FLAG_MISSING');
        if (fixture.expectedForward !== undefined) check(snapshot.daewoon?.forward === fixture.expectedForward, 'EXPECTED_LUCK_DIRECTION_MISMATCH');
        entry.snapshotStatus = snapshot.status; entry.versions = [snapshot.engineVersion, snapshot.ruleVersion, snapshot.conventionVersion];
        entry.chartCount = charts.length; entry.correlatedPillars = tuples; entry.uncertaintyFlags = snapshot.uncertaintyFlags;
        entry.timingStatus = snapshot.timing?.activeDaewoonStatus ?? null; entry.passed = true;
      }
    } catch (error) { entry.wallTimeMs ??= Math.round(performance.now() - started); entry.failure = errorCode(error); }
    report.cases.push(entry); console.log(JSON.stringify({ id: entry.id, passed: entry.passed, wallTimeMs: entry.wallTimeMs, httpStatus: entry.httpStatus, snapshotStatus: entry.snapshotStatus, failure: entry.failure }));
  }
} catch (error) { report.failure = errorCode(error); }
finally {
  for (const userId of [...userIds]) {
    try {
      const deleted = await request(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
      check(deleted.status >= 200 && deleted.status < 300, 'TEST_USER_CLEANUP_FAILED');
      report.cleanup.deleted++;
      userIds.splice(userIds.indexOf(userId), 1); await persistLedger();
      const remains = await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id`);
      check(remains.status === 200 && remains.value?.length === 0, 'TEST_USER_CASCADE_VERIFY_FAILED');
      const readings = await request(`/rest/v1/saju_readings?user_id=eq.${encodeURIComponent(userId)}&select=id`);
      check(readings.status === 200 && readings.value?.length === 0, 'TEST_READING_CASCADE_VERIFY_FAILED');
    } catch (error) { report.cleanup.failure = errorCode(error); }
  }
  report.cleanup.cascadeVerified = report.cleanup.created > 0 && report.cleanup.created === report.cleanup.deleted && !report.cleanup.failure;
  if (userIds.length === 0 && report.cleanup.created > 0) await rm(ledgerPath, { force: true });
  report.completedAt = new Date().toISOString();
  report.passed = report.cases.length === cases.length && report.cases.every(entry => entry.passed) && report.cleanup.cascadeVerified;
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ completed: true, passed: report.passed, cases: report.cases.length, passedCases: report.cases.filter(entry => entry.passed).length, cleanup: report.cleanup, failure: report.failure }));
}
process.exitCode = report.passed ? 0 : 1;
