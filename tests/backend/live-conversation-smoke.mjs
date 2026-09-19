// Explicit authorized live check; session is held in process memory while cases are prepared.
// node --env-file=.env.server.local tests/backend/live-conversation-smoke.mjs
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: secret } = process.env;
if (!url || !anon || !secret) throw new Error('Server-only test environment is required.');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, options);
const ledgerPath = 'test-results/pending-conversation-smoke-cleanup.json';
const ids = new Set(), checks = [], observations = [];
let operationCount = 0;
const assert = (condition, name) => {
  checks.push({ name, passed: Boolean(condition) });
  if (!condition) throw new Error(name);
  console.log(`PASS ${name}`);
};
const saveLedger = () => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync(ledgerPath, JSON.stringify({ at: new Date().toISOString(), ids: [...ids] }, null, 2));
};
async function cleanup(id) {
  const existing = await admin.auth.admin.getUserById(id);
  if (!existing.error) {
    if (existing.data.user?.user_metadata?.test_run !== 'JumZip conversation smoke'
      || !/^jumzip-conversation-smoke-[0-9a-f-]+@example\.com$/i.test(existing.data.user?.email ?? '')) return false;
    if ((await admin.auth.admin.deleteUser(id, false)).error) return false;
  } else if (existing.error.status !== 404) return false;
  const absent = await admin.auth.admin.getUserById(id);
  if (absent.data.user || absent.error?.status !== 404) return false;
  for (const table of ['profiles', 'messages', 'conversations', 'consultations', 'memories', 'memory_suppressions', 'tarot_draw_groups', 'tarot_draws', 'related_people', 'birth_profiles', 'request_executions']) {
    const key = table === 'profiles' ? 'id' : 'user_id';
    const rows = await admin.from(table).select(key, { count: 'exact', head: true }).eq(key, id);
    if (rows.error || rows.count) return false;
  }
  ids.delete(id); saveLedger(); return true;
}
try {
  if (existsSync(ledgerPath)) {
    for (const id of JSON.parse(readFileSync(ledgerPath, 'utf8')).ids ?? []) {
      if (typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid cleanup ledger.');
      ids.add(id);
    }
    for (const id of [...ids]) assert(await cleanup(id), 'previous conversation test account cleanup');
  }
  const email = `jumzip-conversation-smoke-${randomUUID()}@example.com`;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { test_run: 'JumZip conversation smoke' } });
  if (created.error || !created.data.user) throw new Error('Disposable account creation failed.');
  const id = created.data.user.id; ids.add(id); saveLedger();
  const client = createClient(url, anon, options);
  // Authorized disposable-test workflow; no email is sent and public CAPTCHA remains enabled.
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error || link.data.user?.id !== id || !link.data.properties?.hashed_token) throw new Error('Disposable sign-in link generation failed.');
  const signed = await client.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token });
  if (signed.error || !signed.data.session || signed.data.user?.id !== id) throw new Error('Disposable account sign-in failed.');
  const token = signed.data.session.access_token;
  console.log('SESSION READY: disposable test authenticated; credentials retained only in process memory.');
  if (process.argv.includes('--wait')) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    await prompt.question('Press Enter after live cases are ready. ', { signal: AbortSignal.timeout(20 * 60_000) });
    prompt.close();
  }
  async function request(endpoint, body) {
    operationCount += 1;
    if (operationCount > 12) throw new Error('Live operation budget exceeded.');
    const response = await fetch(`${url}/functions/v1/${endpoint}`, { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: anon, 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' },
      body: JSON.stringify({ schemaVersion: 1, requestId: randomUUID(), ...body }), signal: AbortSignal.timeout(105_000) })
      .catch(() => { throw new Error('Edge transport failed.'); });
    let result;
    try { result = await response.json(); } catch { throw new Error('Edge returned invalid JSON.'); }
    return { ...result, httpStatus: response.status };
  }
  const { runCases } = await import('./live-conversation-cases.mjs');
  await runCases({ id, client, admin, assert, observations, request });
} catch (error) {
  process.exitCode = 1;
  const safeName = error instanceof Error && checks.some(check => check.name === error.message) ? error.message : 'Conversation smoke stopped before completion';
  observations.push({ name: 'failure', reason: safeName });
  console.error(`FAIL ${safeName}`);
} finally {
  for (const id of [...ids]) {
    let ok = false;
    try { ok = await cleanup(id); } catch { /* Ledger retained for a verified recovery. */ }
    checks.push({ name: 'verified disposable conversation account cleanup', passed: ok });
    if (!ok) { process.exitCode = 1; console.error('FAIL disposable conversation cleanup'); }
  }
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/remote-conversation-smoke.json', JSON.stringify({ at: new Date().toISOString(), operationCount,
    checks, observations, pendingCleanupCount: ids.size,
    scope: 'Real model using an admin-created synthetic identity and admin-generated magic-link verification. No public signup/CAPTCHA or >16-turn summary-compaction claim. No assistant results seeded by service role.' }, null, 2));
}
