import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Explicit opt-in. No LLM calls, email delivery, public CAPTCHA bypass or real user data.
const live = process.env.JUMZIP_LIVE_PAGINATION === '1';
const ledgerPath = 'test-results/pending-pagination-cleanup.json';
const marker = 'JumZip pagination integration';
afterEach(() => vi.unstubAllEnvs());
describe.skipIf(!live)('hosted history continuation', () => {
  it('preserves all rows across ties, nulls, search filters and the hosted 1,000-row cap', async () => {
    const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: secret } = process.env;
    if (!url || !anon || !secret) throw new Error('Private integration environment is required.');
    const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const pending: string[] = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')).ids : [];
    const persist = () => { mkdirSync('test-results', { recursive: true }); writeFileSync(ledgerPath, JSON.stringify({ ids: pending })); };
    const checks: string[] = [];
    const cleanup = async (id: string) => {
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid cleanup identity.');
      const found = await admin.auth.admin.getUserById(id);
      if (found.error?.status !== 404) {
        if (found.error || found.data.user.user_metadata.test_run !== marker || !/^jumzip-pagination-[0-9a-f-]+@example\.com$/.test(found.data.user.email ?? '')) throw new Error('Disposable identity ownership check failed.');
        const removed = await admin.auth.admin.deleteUser(id);
        if (removed.error) throw new Error('Disposable identity cleanup failed.');
        const gone = await admin.auth.admin.getUserById(id);
        if (gone.error?.status !== 404) throw new Error('Disposable identity still exists.');
      }
      pending.splice(pending.indexOf(id), 1); persist();
    };
    for (const id of [...pending]) await cleanup(id);
    let failed = true;
    try {
      const email = `jumzip-pagination-${randomUUID()}@example.com`;
      const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { test_run: marker } });
      if (created.error || !created.data.user) throw new Error('Disposable identity creation failed.');
      const userId = created.data.user.id; pending.push(userId); persist();
      const authLink = await admin.auth.admin.generateLink({ type: 'magiclink', email });
      if (authLink.error || authLink.data.user.id !== userId) throw new Error('Disposable sign-in preparation failed.');
      vi.stubEnv('VITE_SUPABASE_URL', url); vi.stubEnv('VITE_SUPABASE_ANON_KEY', anon);
      const { service, supabase } = await import('../../src/lib/service');
      const signed = await supabase!.auth.verifyOtp({ type: 'magiclink', token_hash: authLink.data.properties.hashed_token });
      if (signed.error || signed.data.user?.id !== userId) throw new Error('Disposable sign-in verification failed.');
      checks.push('same disposable identity authenticated without email delivery');
      const at = '2026-09-19T01:02:03.123456+00:00';
      const convIds = Array.from({ length: 7 }, () => randomUUID());
      const convSeed = await admin.from('conversations').insert(convIds.map((id, i) => ({ id, user_id: userId, character_id: 'BOMI', last_message_at: i < 3 ? at : null })));
      if (convSeed.error) throw new Error(`Conversation fixture insertion failed: ${convSeed.error.code}`);
      const readingIds = Array.from({ length: 8 }, () => randomUUID());
      const needle = 'A,B (100%)_".*\\';
      const readingSeed = await admin.from('consultations').insert(readingIds.map((id, i) => ({ id, user_id: userId, conversation_id: convIds[0], character_id: 'BOMI', fortune_type: i === 7 ? 'SAJU' : 'TAROT', title: i === 2 || i === 7 ? needle : 'ordinary synthetic record', result_summary: i === 5 ? needle : null, created_at: at })));
      if (readingSeed.error) throw new Error(`Reading fixture insertion failed: ${readingSeed.error.code}`);
      const messageIds = Array.from({ length: 1005 }, () => randomUUID()).sort();
      for (let start = 0; start < messageIds.length; start += 250) {
        const seed = await admin.from('messages').insert(messageIds.slice(start, start + 250).map((id) => ({ id, user_id: userId, conversation_id: convIds[0], consultation_id: readingIds[0], sender: 'USER', content: 'Synthetic pagination check', created_at: at })));
        if (seed.error) throw new Error(`Message fixture insertion failed: ${seed.error.code}`);
      }
      const conversations: string[] = [];
      let convCursor: import('../../src/lib/service').ConversationCursor | null = null;
      do { const page = await service.listConversationsPage(convCursor, 2); conversations.push(...page.items.map((item) => item.id)); convCursor = page.nextCursor; } while (convCursor);
      expect(new Set(conversations).size).toBe(7); expect(conversations).toHaveLength(7);
      checks.push('all seven conversations retained across equal timestamps and four null dates');
      const readings: string[] = [];
      let readingCursor: import('../../src/lib/service').HistoryCursor | null = null;
      do { const page = await service.listReadingsPage({ cursor: readingCursor, pageSize: 2 }); readings.push(...page.items.map((item) => item.id)); readingCursor = page.nextCursor; } while (readingCursor);
      expect(readings).toEqual([...readingIds].sort().reverse());
      checks.push('eight readings retain deterministic ID ordering across timestamp ties');
      const first = await service.listReadingsPage({ search: needle, fortuneType: 'TAROT', pageSize: 1 });
      const second = await service.listReadingsPage({ search: needle, fortuneType: 'TAROT', pageSize: 1, cursor: first.nextCursor });
      expect([...first.items, ...second.items].map((item) => item.id).sort()).toEqual([readingIds[2], readingIds[5]].sort());
      expect(first.nextCursor).not.toBeNull(); expect(second.nextCursor).toBeNull();
      checks.push('literal quote/comma/parenthesis/percent/underscore/regex/backslash search combines with type and continuation');
      const pages: string[][] = []; let cursor: import('../../src/lib/service').HistoryCursor | null = null;
      do { const page = await service.listMessagesPage(convIds[0], cursor, 200); pages.push(page.items.map((item) => item.id)); cursor = page.nextCursor; } while (cursor);
      expect(pages.reverse().flat()).toEqual(messageIds);
      checks.push('all 1,005 conversation messages preserved chronologically across six pages');
      const detail = await service.listConsultationMessages(readingIds[0]);
      expect(detail.map((item) => item.id)).toEqual(messageIds);
      checks.push('consultation detail/export includes all 1,005 messages beyond the hosted row cap');
      await supabase!.auth.signOut({ scope: 'local' });
      failed = false;
    } finally {
      for (const id of [...pending]) await cleanup(id);
      checks.push('disposable Auth identity deleted and independently verified absent');
      const report = { at: new Date().toISOString(), status: failed ? 'FAILED' : 'PASSED', scope: 'Actual hosted PostgREST through production service methods; one admin-created synthetic identity, 7 conversations, 8 readings, 1,005 messages. No model calls. Does not test public signup.', checks, pendingCleanup: pending.length };
      mkdirSync('docs/evidence', { recursive: true }); writeFileSync('docs/evidence/service-pagination.json', JSON.stringify(report, null, 2));
    }
  }, 90_000);
});
