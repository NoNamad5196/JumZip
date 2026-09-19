import { createClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: secret } = process.env;
if (!url || !anon || !secret) throw new Error('Configure the ignored server environment before this check.');
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const checks = [];
const ledgerPath = 'test-results/pending-public-auth-cleanup.json';
const created = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')).ids : [];
mkdirSync('test-results', { recursive: true });
const ledger = () => writeFileSync(ledgerPath, JSON.stringify({ ids: created }));
let failure;
try {
  for (const captchaToken of [undefined, 'jumzip-deliberately-invalid-captcha']) {
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.signInAnonymously({ options: {
      captchaToken, data: { test_run: 'JumZip CAPTCHA rejection probe', test_id: randomUUID() },
    } });
    if (data.user) { created.push(data.user.id); ledger(); }
    checks.push({ name: captchaToken ? 'Invalid CAPTCHA rejected' : 'Missing CAPTCHA rejected',
      passed: !data.session && error?.code === 'captcha_failed', status: error?.status ?? null, code: error?.code ?? null });
  }
} catch { failure = 'Authentication probe transport failed.'; }
finally {
  for (const id of [...created]) {
    const current = await admin.auth.admin.getUserById(id);
    if (current.data.user?.user_metadata?.test_run !== 'JumZip CAPTCHA rejection probe') {
      checks.push({ name: 'Disposable identity ownership verified for cleanup', passed: false }); continue;
    }
    const { error } = await admin.auth.admin.deleteUser(id);
    if (!error) created.splice(created.indexOf(id), 1);
  }
  ledger();
  checks.push({ name: 'No disposable identities remain', passed: created.length === 0 });
  const report = { at: new Date().toISOString(), checks, failure: failure ?? null,
    scope: 'Real hosted CAPTCHA rejection only. This does not verify successful CAPTCHA or public browser onboarding.' };
  writeFileSync('test-results/public-auth-rejection.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (failure || checks.some(check => !check.passed)) process.exitCode = 1;
}
