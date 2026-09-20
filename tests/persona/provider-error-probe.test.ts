import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(resolve('scripts/read-workers-ai-error.mjs')).href;
const { APPROVAL, BODY, CEILING_NEURONS, RESERVATION_NEURONS, classify, main, plan, probe, writeProbeReport } = await import(moduleUrl);
const account = 'a'.repeat(32), key = 'SYNTHETIC_PRIVATE_API_KEY';
const options = { baseUrl: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1`, apiKey: key, expectedAccountId: account, approval: APPROVAL };
const raw = (body: unknown) => Buffer.from(JSON.stringify(body));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('one-request Workers AI error diagnosis with synthetic HTTP only', () => {
  it('defaults to a zero-network plan without reading secret environment properties', async () => {
    const fetchImpl = vi.fn(); vi.stubGlobal('fetch', fetchImpl);
    const secretEnv = new Proxy({}, { get: () => { throw Error('SECRET_ENV_WAS_READ'); } });
    expect(await main([], secretEnv)).toEqual(plan());
    expect(await main(['--plan'], secretEnv)).toMatchObject({ actualHTTPAttempts: 0, liveAuthorized: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(CEILING_NEURONS).toBe(7); expect(RESERVATION_NEURONS).toBeLessThan(7);
    expect(RESERVATION_NEURONS).toBe((Buffer.byteLength(BODY) * 9091 + 27273) / 1_000_000);
  });
  it('requires explicit GO before reading credentials and permits no arbitrary CLI options', async () => {
    const fetchImpl = vi.fn(); vi.stubGlobal('fetch', fetchImpl);
    await expect(main(['--run', `--expected-account-id=${account}`, '--report-name=unit'], {})).rejects.toThrow('PROBE_EXPLICIT_GO_REQUIRED');
    await expect(main(['--run', '--url=https://evil.test'], {})).rejects.toThrow('PROBE_ARGUMENTS_INVALID');
    await expect(probe({ ...options, approval: '', fetchImpl })).rejects.toThrow('PROBE_EXPLICIT_GO_REQUIRED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    'http://api.cloudflare.com', 'https://api.cloudflare.com:444', 'https://api.cloudflare.com.evil.test', 'https://api.cloudflare.com@evil.test',
  ])('blocks a changed Cloudflare destination %s before HTTP', async origin => {
    const fetchImpl = vi.fn();
    await expect(probe({ ...options, baseUrl: `${origin}/client/v4/accounts/${account}/ai/v1`, fetchImpl })).rejects.toThrow('PROBE_CONFIGURATION_INVALID');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    { baseUrl: options.baseUrl + '?key=private' }, { baseUrl: options.baseUrl + '#fragment' }, { expectedAccountId: 'b'.repeat(32) },
    { apiKey: '' }, { apiKey: 'secret\r\nInjected: value' }, { baseUrl: options.baseUrl + '/chat/completions' },
  ])('blocks malformed/mismatched account configuration before HTTP', async patch => {
    const fetchImpl = vi.fn();
    await expect(probe({ ...options, ...patch, fetchImpl })).rejects.toThrow('PROBE_CONFIGURATION_INVALID');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([[3036, 'DAILY_FREE_ALLOCATION_EXHAUSTED'], [3040, 'TEMPORARY_CAPACITY_EXCEEDED']])('recognizes numeric code %i with one exact request, without leaking body/header/key', async (code, category) => {
    const body = raw({ errors: [{ code, message: `${key} PRIVATE_RESPONSE_TEXT` }], arbitrary: 'SENSITIVE' });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 429, headers: { 'Retry-After': '17', 'X-Private': key } }));
    const result = await probe({ ...options, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(options.baseUrl + '/chat/completions');
    expect(init).toMatchObject({ method: 'POST', body: BODY, redirect: 'error' });
    expect(JSON.parse(String(init?.body))).toEqual({ model: '@cf/google/gemma-4-26b-a4b-it', messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 1, stream: false, chat_template_kwargs: { enable_thinking: false } });
    expect(result).toMatchObject({ category, httpStatus: 429, errorCodes: [code], retryAfterSeconds: 17, actualHTTPAttempts: 1, usageMeasured: false, neuronsAccounted: RESERVATION_NEURONS });
    expect(result.responseSha256).toMatch(/^[a-f0-9]{64}$/);
    for (const secret of [key, 'PRIVATE_RESPONSE_TEXT', 'SENSITIVE', account]) expect(JSON.stringify(result)).not.toContain(secret);
  });
  it('never infers quota from arbitrary text, string codes, a nested message or non-429 codes', () => {
    expect(classify(429, new Headers({ 'Retry-After': 'Sun, 20 Sep 2026 00:00:00 GMT' }), raw({ error: { code: '3036', message: 'Daily quota exceeded 3036' }, choices: [{ code: 3036 }] })))
      .toMatchObject({ category: 'UNCLASSIFIED_HTTP_ERROR', errorCodes: [], retryAfterSeconds: null });
    expect(classify(400, new Headers(), raw({ error: { code: 3036 } }))).toMatchObject({ category: 'KNOWN_CODE_WITH_UNEXPECTED_ENVELOPE', errorCodes: [3036] });
    expect(classify(429, new Headers(), raw({ errors: [{ code: 3036 }, { code: 3040 }] }))).toMatchObject({ category: 'KNOWN_CODE_WITH_UNEXPECTED_ENVELOPE', errorCodes: [3036, 3040] });
  });
  it('does not expose generated text or malformed bodies on 200/error responses', async () => {
    const success = await probe({ ...options, fetchImpl: vi.fn().mockResolvedValue(new Response(raw({ choices: [{ message: { content: key } }] }))) });
    const malformed = await probe({ ...options, fetchImpl: vi.fn().mockResolvedValue(new Response(key + '3036', { status: 429 })) });
    expect(success.category).toBe('HTTP_SUCCESS_NOT_QUALITY_EVIDENCE'); expect(malformed.category).toBe('UNCLASSIFIED_HTTP_ERROR');
    expect(JSON.stringify([success, malformed])).not.toContain(key);
  });
  it('caps streamed bytes at 4096 despite a false Content-Length and does not await hanging cancel', async () => {
    const cancelled = vi.fn(() => new Promise<void>(() => {})); let chunks = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { chunks++; controller.enqueue(new Uint8Array(2049)); }, cancel: cancelled }, { highWaterMark: 0 });
    const result = await probe({ ...options, fetchImpl: vi.fn().mockResolvedValue(new Response(stream, { status: 429, headers: { 'Content-Length': '1' } })) });
    expect(result).toMatchObject({ category: 'RESPONSE_BODY_LIMIT', responseSha256: null, errorCodes: [] });
    expect(chunks).toBe(2); expect(cancelled).toHaveBeenCalledOnce();
  });
  it('ends a hanging fetch at 10 seconds and cancels a response returned after the deadline', async () => {
    vi.useFakeTimers(); let deliver!: (response: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>(resolve => { deliver = resolve; }));
    const resultPromise = probe({ ...options, fetchImpl });
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await resultPromise).toMatchObject({ category: 'TIMEOUT', actualHTTPAttempts: 1 });
    const cancelled = vi.fn(); deliver(new Response(new ReadableStream({ cancel: cancelled })));
    await vi.advanceTimersByTimeAsync(1); expect(cancelled).toHaveBeenCalledOnce(); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('aborts and cancels a hanging body without waiting for reader cancellation', async () => {
    vi.useFakeTimers(); const cancelled = vi.fn(() => new Promise<void>(() => {}));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ cancel: cancelled }), { status: 429 }));
    const resultPromise = probe({ ...options, fetchImpl });
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await resultPromise).toMatchObject({ category: 'TIMEOUT', httpStatus: 429, responseSha256: null });
    expect(cancelled).toHaveBeenCalledOnce(); expect(fetchImpl.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });
  it('does not retry transport failures or expose exception text', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Error(key));
    const result = await probe({ ...options, fetchImpl });
    expect(result.category).toBe('TRANSPORT_FAILED'); expect(fetchImpl).toHaveBeenCalledOnce(); expect(JSON.stringify(result)).not.toContain(key);
  });
  it('reserves an exclusive report before HTTP, preserves failure and rejects the same name before retry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jumzip-probe-test-'));
    try {
      const fetchImpl = vi.fn().mockRejectedValue(Error(key));
      const result = await writeProbeReport({ ...options, fetchImpl }, directory, 'offline-fixture');
      expect(result.category).toBe('TRANSPORT_FAILED');
      expect((await readdir(directory)).sort()).toEqual(['offline-fixture.json', 'offline-fixture.started.json']);
      const stored = await readFile(join(directory, 'offline-fixture.json'), 'utf8');
      expect(stored).not.toContain(key); expect(stored).not.toContain(account);
      await expect(writeProbeReport({ ...options, fetchImpl }, directory, 'offline-fixture')).rejects.toThrow('PROBE_REPORT_EXISTS');
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(await readFile(join(directory, 'offline-fixture.json'), 'utf8')).toBe(stored);
    } finally {
      await Promise.all(['offline-fixture.json', 'offline-fixture.started.json'].map(name => rm(join(directory, name), { force: true })));
      await rmdir(directory);
    }
  });
});
