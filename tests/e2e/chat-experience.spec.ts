import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

// Real browser/UI, synthetic transport only: every external request is intercepted.
const localConfig = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : '';
const localUrl = localConfig.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1].trim().replace(/^['"]|['"]$/g, '');
const uid = '11111111-1111-4111-8111-111111111111';
const conversation = '22222222-2222-4222-8222-222222222222';
const consultation = '33333333-3333-4333-8333-333333333333';
const user = { id: uid, aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: { provider: 'anonymous', providers: ['anonymous'] }, user_metadata: {}, created_at: '2026-09-20T00:00:00Z' };
type Row = { id: string; conversation_id: string; consultation_id: string; sender: string; type: string; content: string; request_id: string | null; reply_to_message_id: string | null; metadata: Record<string, unknown>; created_at: string };
const row = (id: string, sender: string, content: string, requestId: string | null = null): Row => ({ id, conversation_id: conversation, consultation_id: consultation, sender, type: 'TEXT', content, request_id: requestId, reply_to_message_id: null, metadata: {}, created_at: new Date(Date.now()).toISOString() });

async function fixture(page: Page, initial: Row[] = [], newDraw?: Record<string, unknown>) {
  let releaseChat: (() => void) | undefined, releaseRead: (() => void) | undefined;
  const chatGate = new Promise<void>(resolve => { releaseChat = resolve; });
  const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
  const state = { messages: initial, requests: [] as Record<string, unknown>[], reads: 0, holdReads: false, unexpected: [] as string[], errors: [] as string[] };
  page.on('pageerror', error => state.errors.push(error.message));
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const session = { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: uid, aud: 'authenticated', exp: expires, role: 'authenticated' })}.fixture-only`, refresh_token: 'fixture-only', token_type: 'bearer', expires_in: 3600, expires_at: expires, user };
  const origins = ['https://jumzip-ui-fixture.supabase.co', ...(localUrl ? [localUrl] : [])];
  await page.addInitScript(({ keys, value }) => { for (const key of keys) localStorage.setItem(key, JSON.stringify(value)); }, { keys: origins.map(origin => `sb-${new URL(origin).hostname.split('.')[0]}-auth-token`), value: session });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), table = url.pathname.split('/').pop();
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    if (!origins.includes(url.origin)) { state.unexpected.push(url.origin + url.pathname); return route.abort(); }
    if (url.pathname.endsWith('/rpc/touch_activity')) return route.fulfill({ status: 200, json: null });
    if (url.pathname.endsWith('/functions/v1/tarot') && request.method() === 'POST' && newDraw) {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.requests.push(body);
      await chatGate;
      const saved = row('new-draw-system', 'SYSTEM', '', String(body.requestId));
      saved.metadata = { tarot: newDraw }; saved.type = 'TAROT_DRAW';
      state.messages.push(saved);
      return route.fulfill({ status: 201, json: { ok: true, data: newDraw, meta: { schemaVersion: 1, requestId: body.requestId, createdAt: saved.created_at } } });
    }
    if (url.pathname.endsWith('/functions/v1/chat') && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.requests.push(body);
      await chatGate;
      const sent = row('saved-user', 'USER', String(body.message), String(body.requestId));
      const answer = row('saved-assistant', 'ASSISTANT', '지금 네가 말한 이야기를 함께 살펴보자.', String(body.requestId));
      answer.reply_to_message_id = sent.id;
      state.messages.push(sent, answer);
      return route.fulfill({ status: 201, json: { ok: true, data: { conversationId: conversation, consultationId: consultation, userMessage: { id: sent.id }, assistantMessage: { id: answer.id, content: answer.content } }, meta: { schemaVersion: 1, requestId: body.requestId, createdAt: answer.created_at } } });
    }
    if (request.method() !== 'GET') { state.unexpected.push(request.method() + ' ' + url.pathname); return route.abort(); }
    if (url.pathname.endsWith('/auth/v1/user')) return route.fulfill({ status: 200, json: user });
    if (table === 'profiles') return route.fulfill({ status: 200, json: { id: uid, display_name: '테스트 친구', preferred_character: 'BOMI', memory_enabled: true } });
    if (table === 'conversations') return route.fulfill({ status: 200, json: { id: conversation, character_id: 'BOMI', title: '합성 채팅 검증', relationship_state: {}, summary: null } });
    if (table === 'messages') { state.reads++; if (state.holdReads) await readGate; return route.fulfill({ status: 200, json: state.messages.slice().reverse() }); }
    return route.fulfill({ status: 200, json: [] });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  return { state, releaseChat: () => releaseChat!(), releaseRead: () => releaseRead!() };
}

test('sending shows a user bubble and character typing before the server, then renders without waiting for refetch', async ({ page }, info) => {
  const f = await fixture(page);
  await page.goto(`/chat/bomi?conversation=${conversation}`);
  await expect.poll(() => f.state.reads).toBeGreaterThan(0);
  const input = page.getByRole('textbox', { name: '보미에게 보낼 이야기' });
  await input.fill('답변을 기다려도 내 말은 바로 보여야 해.');
  await page.getByRole('button', { name: '이야기 보내기' }).click();
  await expect(page.locator('.message-user .message-text')).toContainText('답변을 기다려도 내 말은 바로 보여야 해.');
  await expect(input).toHaveValue('');
  await expect(page.locator('.message-pending .typing-bubble')).toBeVisible();
  await expect(page.locator('.message-pending .avatar img')).toHaveAttribute('alt', '보미');
  await expect(page.getByRole('button', { name: '이야기 보내기' })).toBeDisabled();
  await input.fill('기다리는 동안 다음 이야기를 적어둬.');
  await page.screenshot({ path: info.outputPath('chat-typing.png') });
  f.state.holdReads = true;
  f.releaseChat();
  await expect(page.locator('.message-assistant .message-text')).toContainText('지금 네가 말한 이야기를 함께 살펴보자.');
  await expect(page.locator('.message-pending')).toHaveCount(0);
  await expect(input).toHaveValue('기다리는 동안 다음 이야기를 적어둬.');
  await expect(page.locator('.message-user')).toHaveCount(1);
  f.releaseRead();
  await expect.poll(() => f.state.reads).toBeGreaterThan(1);
  await expect(page.locator('.message-user')).toHaveCount(1);
  await expect(page.locator('.message-assistant')).toHaveCount(1);
  expect(f.state.requests).toHaveLength(1);
  expect(f.state.unexpected).toEqual([]);
  expect(f.state.errors).toEqual([]);
});

test('mobile chat keeps all three cards in one compact row and labels canonical fallback separately', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'The dedicated mobile viewport matrix runs once.');
  const saved = row('saved-draw', 'SYSTEM', '');
  saved.type = 'TAROT_DRAW';
  saved.metadata = { tarot: { executionStatus: 'PARTIAL', consultationId: consultation, drawGroupId: '44444444-4444-4444-8444-444444444444', spreadType: 'GENERAL_3', mode: 'NORMAL', interpretation: null, partialError: { code: 'LLM_INVALID_RESPONSE', retryable: true }, cards: [
    { cardId: 6, orientation: 'UPRIGHT', positionIndex: 0, positionName: '현재 상황' },
    { cardId: 9, orientation: 'REVERSED', positionIndex: 1, positionName: '핵심 변수 / 걸림돌' },
    { cardId: 14, orientation: 'UPRIGHT', positionIndex: 2, positionName: '앞으로의 방향 / 조언' },
  ] } };
  const f = await fixture(page, [saved]);
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/chat/bomi?conversation=${conversation}`);
    const result = page.locator('.tarot-inline-chat');
    await expect(result).toHaveCount(1);
    const images = result.locator('.tarot-card img');
    await expect(images).toHaveCount(3);
    await expect.poll(() => images.evaluateAll(elements => elements.every(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await page.evaluate(() => document.fonts.ready);
    await result.locator('.tarot-cards').scrollIntoViewIfNeeded();
    const boxes = await images.evaluateAll(elements => elements.map(element => { const b = element.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, right: b.right }; }));
    expect(Math.max(...boxes.map(b => b.y)) - Math.min(...boxes.map(b => b.y))).toBeLessThanOrEqual(1);
    expect(boxes[0].width).toBeGreaterThan(55);
    expect(boxes[0].x).toBeGreaterThanOrEqual(0);
    expect(boxes[2].right).toBeLessThanOrEqual(width);
    expect((await result.locator('.tarot-cards').boundingBox())!.height).toBeLessThan(300);
    await expect(result.getByText('카드 기본 의미', { exact: true })).toBeVisible();
    await expect(result.getByRole('button', { name: '해석 다시 받기' })).toBeEnabled();
    await expect(page.locator('.message-assistant')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const viewport = (await page.locator('.chat-messages').boundingBox())!;
    const cardsBox = (await result.locator('.tarot-cards').boundingBox())!;
    expect(cardsBox.y).toBeGreaterThanOrEqual(viewport.y - 1);
    expect(cardsBox.y + cardsBox.height).toBeLessThanOrEqual(viewport.y + viewport.height + 1);
    await page.screenshot({ path: info.outputPath(`chat-cards-${width}.png`) });
  }
  expect(f.state.requests).toEqual([]);
  expect(f.state.unexpected).toEqual([]);
  expect(f.state.errors).toEqual([]);
});

test('a newly drawn partial result opens at its cards instead of scrolling past them to the fallback', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Mobile drawing regression.');
  const draw = { executionStatus: 'PARTIAL', conversationId: conversation, consultationId: consultation, drawGroupId: '55555555-5555-4555-8555-555555555555', spreadType: 'GENERAL_3', interpretation: null, partialError: { code: 'TAROT_INTERPRETATION_FAILED', retryable: true }, cards: [
    { cardId: 0, orientation: 'UPRIGHT', positionIndex: 0, positionName: '현재 상황' },
    { cardId: 9, orientation: 'REVERSED', positionIndex: 1, positionName: '핵심 변수' },
    { cardId: 14, orientation: 'UPRIGHT', positionIndex: 2, positionName: '앞으로의 조언' },
  ] };
  const f = await fixture(page, [], draw);
  await page.goto(`/chat/bomi?conversation=${conversation}`);
  await page.getByRole('button', { name: '타로', exact: true }).click();
  await page.getByRole('button', { name: '나의 카드 펼치기' }).click();
  await expect(page.locator('.message-pending')).toBeVisible();
  f.releaseChat();
  const result = page.locator(`[data-draw-group-id="${draw.drawGroupId}"]`);
  await expect(result).toBeVisible();
  await expect(page.locator('.message-pending')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('new-draw-before-assert.png') });
  await expect.poll(async () => {
    const box = (await result.locator('.tarot-cards').boundingBox())!;
    const container = (await page.locator('.chat-messages').boundingBox())!;
    return box.y >= container.y && box.y + box.height <= container.y + container.height;
  }).toBe(true);
  await page.screenshot({ path: info.outputPath('new-draw-cards-visible.png') });
  expect(f.state.requests).toHaveLength(1);
  expect(f.state.requests[0].action).toBe('DRAW');
  expect(f.state.unexpected).toEqual([]);
  expect(f.state.errors).toEqual([]);
});
