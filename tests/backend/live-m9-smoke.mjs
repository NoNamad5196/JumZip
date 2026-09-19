// Explicit live check only: node --env-file=.env.server.local tests/backend/live-m9-smoke.mjs
// Requires the approved M9 domain/runtime and its snapshot migration to be deployed first.
import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: secret } = process.env;
if (!url || !anon || !secret) throw new Error('Configure server-only environment before M9 smoke.');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, options);
const ledgerPath = 'test-results/pending-m9-smoke-cleanup.json';
const users = new Set();
const checks = [], observations = [];
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function assert(condition, name) {
  checks.push({ name, passed: Boolean(condition) });
  if (!condition) throw new Error(name);
  console.log(`PASS ${name}`);
}
function saveLedger() {
  mkdirSync('test-results', { recursive: true });
  writeFileSync(ledgerPath, JSON.stringify({ at: new Date().toISOString(), ids: [...users] }, null, 2));
}
async function cleanup(id) {
  const current = await admin.auth.admin.getUserById(id);
  if (!current.error) {
    if (current.data.user?.user_metadata?.test_run !== 'JumZip M9 timing smoke'
      || !/^jumzip-m9-smoke-[0-9a-f-]+@example\.com$/i.test(current.data.user?.email ?? '')) return false;
    const deleted = await admin.auth.admin.deleteUser(id, false);
    if (deleted.error) return false;
  } else if (current.error.status !== 404) return false;
  const absent = await admin.auth.admin.getUserById(id);
  if (absent.data.user || absent.error?.status !== 404) return false;
  for (const table of ['profiles', 'conversations', 'consultations', 'saju_readings', 'saju_compatibility_readings', 'birth_profiles', 'related_people', 'request_executions']) {
    const rows = await admin.from(table).select('id').eq(table === 'profiles' ? 'id' : 'user_id', id);
    if (rows.error || rows.data.length) return false;
  }
  // Retain the ledger entry until Auth absence AND dependent-row absence are verified.
  users.delete(id); saveLedger(); return true;
}
async function makeUser() {
  const email = `jumzip-m9-smoke-${randomUUID()}@example.com`, password = randomBytes(32).toString('hex');
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { test_run: 'JumZip M9 timing smoke' } });
  if (created.error || !created.data.user) throw new Error('M9 disposable account creation failed.');
  const id = created.data.user.id; users.add(id); saveLedger();
  const client = createClient(url, anon, options);
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw new Error('M9 disposable sign-in failed.');
  return { id, client, token: signed.data.session.access_token };
}
async function request(user, endpoint, body) {
  const response = await fetch(`${url}/functions/v1/${endpoint}`, { method: 'POST',
    headers: { Authorization: `Bearer ${user.token}`, apikey: anon, 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' },
    body: JSON.stringify({ schemaVersion: 1, requestId: randomUUID(), ...body }), signal: AbortSignal.timeout(105_000) })
    .catch(() => { throw new Error('M9 Edge transport failed.'); });
  let result;
  try { result = await response.json(); } catch { throw new Error('M9 Edge returned invalid JSON.'); }
  return { ...result, httpStatus: response.status };
}
async function conversation(user) {
  const row = await user.client.from('conversations').insert({ user_id: user.id, character_id: 'SANI' }).select('id').single();
  if (row.error || !row.data) throw new Error('M9 conversation creation failed.');
  return row.data.id;
}
function checkInference(response, label) {
  assert(response.ok && ['PARTIAL', 'SUCCEEDED'].includes(response.data?.executionStatus), `${label} persists its deterministic result`);
  if (response.data.executionStatus === 'SUCCEEDED') assert(Boolean(response.data.interpretation?.messageId), `${label} interpretation has a durable message ID`);
  else {
    const reason = response.data.partialError?.details?.reason;
    assert(['LLM_UNAVAILABLE', 'LLM_TIMEOUT', 'LLM_INVALID_RESPONSE'].includes(reason), `${label} partial state has a recognized inference cause`);
    observations.push({ name: `${label} inference`, code: reason });
  }
}
function noRawBirth(value) {
  if (Array.isArray(value)) return value.every(noRawBirth);
  if (!value || typeof value !== 'object') return true;
  return Object.entries(value).every(([key, child]) => !/^(birthdate|birthtime|birthprofilesnapshot|birthprofile|rawinput|input|latitude|longitude|location|city|timezone|calendartype|leapmonth|gender)$/.test(key.replace(/[^a-z]/gi, '').toLowerCase()) && noRawBirth(child));
}
function natalFields(result) {
  return { pillars: result.pillars, elements: result.elements, strength: result.strength, gyeokguk: result.gyeokguk,
    yongsin: result.yongsin, heesin: result.heesin, relations: result.relations, shinsal: result.shinsal };
}

try {
  if (existsSync(ledgerPath)) {
    const pending = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    for (const id of pending.ids ?? []) {
      if (typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid M9 cleanup ledger.');
      users.add(id);
    }
    for (const id of [...users]) assert(await cleanup(id), 'previous M9 disposable account cleanup');
  }
  const user = await makeUser(), conv = await conversation(user);
  const resolved = await request(user, 'saju', { action: 'RESOLVE_LOCATION', query: 'Seoul', limit: 1 });
  const location = resolved.data?.locations?.[0];
  assert(resolved.ok && Boolean(location?.providerId), 'M9 uses an actual resolved city snapshot');
  const birth = { calendarType: 'SOLAR', leapMonth: false, birthDate: '1992-10-24', birthTime: '05:30', birthTimeUnknown: false, gender: 'MALE', location };
  async function calculate(input, label) {
    const response = await request(user, 'saju', { action: 'CALCULATE', conversationId: conv, consultationId: null, subject: { input, saveProfile: false }, focus: 'GENERAL' });
    checkInference(response, label);
    const saved = await user.client.from('saju_readings').select('result_snapshot').eq('id', response.data.readingId).single();
    assert(!saved.error && Boolean(saved.data?.result_snapshot?.timing), `${label} stores timing metadata`);
    const result = saved.data.result_snapshot;
    assert(result.timing.conventionVersion === 'JumZipLuckTiming-v1', `${label} records the adopted timing convention`);
    assert(same(response.data.inlineResult?.currentFlow?.timing, result.timing), `${label} inline timing matches its saved snapshot`);
    return { response, result };
  }
  const known = await calculate(birth, 'known birth');
  assert(known.response.data.executionStatus === 'SUCCEEDED', 'configured model completes the known-birth interpretation');
  assert(known.result.timing.activeDaewoonStatus === 'ACTIVE', 'known adult birth resolves the active luck period');
  const active = known.result.timing.luck?.currentPeriod;
  assert(Boolean(active) && active.startDate <= known.result.timing.luck.asOfLocalDate && known.result.timing.luck.asOfLocalDate < active.endDate,
    'active period follows the adopted start-inclusive end-exclusive local-day interval');
  const noGender = await calculate({ ...birth, gender: null }, 'birth without gender');
  assert(noGender.result.timing.activeDaewoonStatus === 'UNRESOLVED' && noGender.result.uncertaintyFlags.includes('DAEWOON_REQUIRES_GENDER'), 'missing gender stays explicitly unresolved');
  assert(same(natalFields(known.result), natalFields(noGender.result)), 'active timing does not change natal judgments');
  const unknown = await calculate({ ...birth, birthTime: null, birthTimeUnknown: true }, 'unknown birth time');
  assert(unknown.result.pillars.hour === null && unknown.result.uncertaintyFlags.includes('BIRTH_TIME_UNKNOWN'), 'unknown time never manufactures a natal hour');
  assert(Array.isArray(unknown.result.possible_values.chartLuck) && unknown.result.possible_values.chartLuck.length > 0
    && unknown.result.possible_values.chartLuck.every(pair => Number.isInteger(pair.chartIndex) && pair.chartIndex >= 0 && pair.chartIndex < unknown.result.possible_values.charts.length
      && (pair.luckIndex === null || Number.isInteger(pair.luckIndex) && pair.luckIndex >= 0 && pair.luckIndex < unknown.result.possible_values.daewoon.length)),
  'unknown time retains actual chart and luck candidate correlations');
  const actualPairs = new Set(unknown.result.possible_values.chartLuck.map(pair => `${pair.chartIndex}:${pair.luckIndex}`));
  const overlayPairs = new Set(unknown.result.possible_values.timing.flatMap(variant => variant.luckIndices.map(luckIndex => `${variant.chartIndex}:${luckIndex}`)));
  assert(actualPairs.size === overlayPairs.size && [...actualPairs].every(pair => overlayPairs.has(pair)), 'timing overlays retain all and only correlated chart-luck pairs');
  // Unknown time may still agree on the active pillar; do not force a blanket status.
  observations.push({ name: 'unknown time', activeStatus: unknown.result.timing.activeDaewoonStatus, chartCount: unknown.result.possible_values.charts.length });
  const compatibility = await request(user, 'compatibility', { action: 'CALCULATE_SAJU', conversationId: conv, consultationId: null,
    personA: { input: birth, saveProfile: false }, personB: { input: { ...birth, birthDate: '1995-08-21', birthTime: null, birthTimeUnknown: true, gender: 'FEMALE' }, alias: '검증 대상', saveRelatedPerson: false } });
  checkInference(compatibility, 'timed compatibility');
  assert(compatibility.data.executionStatus === 'SUCCEEDED', 'configured model completes the timed compatibility interpretation');
  const savedCompatibility = await user.client.from('saju_compatibility_readings').select('result_snapshot').eq('id', compatibility.data.compatibilityReadingId).single();
  assert(!savedCompatibility.error && Boolean(savedCompatibility.data?.result_snapshot), 'timed compatibility reloads its derived snapshot');
  const combined = savedCompatibility.data.result_snapshot;
  assert(combined.personA.timing?.asOf === combined.personB.timing?.asOf && combined.personA.timing?.conventionVersion === 'JumZipLuckTiming-v1'
    && combined.personB.timing?.conventionVersion === 'JumZipLuckTiming-v1', 'compatibility shares one server instant and timing convention');
  assert(noRawBirth(combined) && !JSON.stringify(combined).includes('1995-08-21'), 'active timing preserves raw partner birth minimization');
  const forbidden = await request(user, 'saju', { action: 'CALCULATE', conversationId: conv, consultationId: null, subject: { input: birth, saveProfile: false }, asOf: '2000-01-01T00:00:00Z' });
  assert(forbidden.httpStatus === 400 && forbidden.error?.code === 'VALIDATION_ERROR', 'client cannot override the server timing instant');
  // Fifth and final charged SAJU call. This tests frozen replay timing, not recalculation.
  const retry = await request(user, 'saju', { action: 'RETRY_INTERPRETATION', conversationId: conv, readingId: known.response.data.readingId });
  checkInference(retry, 'timing interpretation retry');
  assert(retry.data.executionStatus === 'SUCCEEDED', 'configured model completes interpretation retry');
  assert(same(retry.data.inlineResult?.currentFlow?.timing, known.result.timing), 'interpretation retry preserves its original timing instant and convention');
  console.log(`M9 REMOTE SMOKE PASSED: ${checks.length} checks. Model availability is separate.`);
} finally {
  for (const id of [...users]) {
    try { const ok = await cleanup(id); checks.push({ name: 'verified M9 disposable account cleanup', passed: ok }); if (!ok) { process.exitCode = 1; console.error('FAIL M9 disposable cleanup'); } }
    catch { process.exitCode = 1; checks.push({ name: 'verified M9 disposable account cleanup', passed: false }); console.error('FAIL M9 disposable cleanup'); }
  }
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/remote-m9-smoke.json', JSON.stringify({ at: new Date().toISOString(), checks, observations,
    pendingCleanupCount: users.size, scope: 'Admin-created disposable test identity. No public signup/CAPTCHA validation; boundary instants use independent local fixed-asOf fixtures.' }, null, 2));
}
