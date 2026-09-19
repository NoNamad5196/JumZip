import { chromium, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

// Local browser fixtures only: all Supabase traffic is fulfilled below.
const env = await readFile('.env.local', 'utf8');
const publicUrl = env.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1].trim().replace(/^['"]|['"]$/g, '');
if (!publicUrl) throw new Error('Public frontend Supabase URL is required');
const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: { provider: 'anonymous', providers: ['anonymous'] }, user_metadata: {}, created_at: '2026-09-20T00:00:00Z' };
const expires = Math.floor(Date.now() / 1000) + 3600;
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const session = { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, aud: 'authenticated', role: 'authenticated', exp: expires })}.fixture-only`, refresh_token: 'fixture-only', token_type: 'bearer', expires_in: 3600, expires_at: expires, user };
const readingId = '22222222-2222-4222-8222-222222222222', conversationId = '33333333-3333-4333-8333-333333333333';
const memories = [
  { id: '44444444-4444-4444-8444-444444444444', content: '혼자 생각을 정리할 때 조용한 산책을 좋아한다.', scope: 'GLOBAL', character_id: null, disabled_at: null, created_at: '2026-09-20T00:00:01Z' },
  { id: '55555555-5555-4555-8555-555555555555', content: '프로젝트를 시작할 때 작은 목표부터 정하는 편이다.', scope: 'CHARACTER', character_id: 'ARANG', disabled_at: null, created_at: '2026-09-20T00:00:00Z' },
];
const reading = { id: readingId, title: '새로운 시작 앞에서 나눈 이야기', conversation_id: conversationId, character_id: 'ARANG', fortune_type: 'TAROT', created_at: '2026-09-20T00:00:00Z', result_summary: null };
const conversation = { id: conversationId, title: '아랑과 차근차근 이야기하기', character_id: 'ARANG', created_at: reading.created_at, last_message_at: reading.created_at, summary: null };
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const report = { checkedAt: new Date().toISOString(), mode: 'LOCAL_PRODUCTION_BUILD_DELETION_FIXTURE', realAuthentication: false, realBackendWrites: false, views: [] };
try {
  for (const width of [1440, 360]) for (const kind of ['CONSULTATION', 'CONVERSATION']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const unexpected = [], deletes = []; let removed = false;
    await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${new URL(publicUrl).hostname.split('.')[0]}-auth-token`, session });
    await context.route('**/*.supabase.co/**', async (route) => {
      const request = route.request(), url = new URL(request.url()), table = url.pathname.split('/').pop();
      let body;
      if (table === 'touch_activity') body = null;
      else if (table === 'history_deletion_memories') body = memories;
      else if (table === 'delete_history_with_memories') { deletes.push(request.postDataJSON()); removed = true; body = { deleted: true }; }
      else if (request.method() !== 'GET') { unexpected.push({ method: request.method(), path: url.pathname }); return route.fulfill({ status: 400, json: { message: 'Unexpected fixture mutation' } }); }
      else if (table === 'user') body = user;
      else if (table === 'profiles') body = { id: user.id, display_name: '하루', memory_enabled: true, preferred_character: 'ARANG' };
      else if (table === 'consultations') body = removed ? [] : [reading];
      else if (table === 'conversations') body = removed && kind === 'CONVERSATION' ? [] : [conversation];
      else body = [];
      await route.fulfill({ status: 200, json: body });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:4173/history${kind === 'CONVERSATION' ? '?tab=conversations' : ''}`);
    await page.getByRole('button', { name: kind === 'CONSULTATION' ? '이 상담 삭제' : '상담 기록 삭제', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('checkbox')).toHaveCount(2);
    await expect(dialog.getByRole('checkbox').first()).not.toBeChecked();
    await expect(dialog.getByRole('button', { name: '기록만 삭제', exact: true })).toBeVisible();
    await dialog.getByRole('checkbox', { name: /작은 목표/ }).check();
    await expect(dialog.getByRole('button', { name: '기록과 기억 1개 삭제', exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const screenshot = `tests/ui/artifacts/deletion-${kind.toLowerCase()}-${width}.png`;
    await page.screenshot({ path: screenshot, fullPage: true });
    const geometry = await page.evaluate(() => ({ viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, dialogWidth: document.querySelector('dialog').clientWidth, dialogScrollWidth: document.querySelector('dialog').scrollWidth }));
    await dialog.getByRole('button', { name: '기록과 기억 1개 삭제', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(deletes).toEqual([{ p_kind: kind, p_record_id: kind === 'CONSULTATION' ? readingId : conversationId, p_memory_ids: [memories[1].id] }]);
    report.views.push({ kind, width, ...geometry, errors, unexpected, selectedMemoryCount: 1, atomicRpcCalls: deletes.length, screenshot });
    await context.close();
  }
} finally { await browser.close(); }
report.passed = report.views.every((view) => view.pageWidth === view.viewport && view.dialogScrollWidth <= view.dialogWidth && !view.errors.length && !view.unexpected.length && view.atomicRpcCalls === 1);
const output = 'tests/ui/artifacts/deletion-visual-report.json';
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, ...report }, null, 2));
if (!report.passed) process.exitCode = 1;
