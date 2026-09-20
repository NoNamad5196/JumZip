import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const script = pathToFileURL(resolve('scripts/check-chat-reliability-live.mjs')).href;
const { MODEL, CASES, CAP, GO, cost, plan, main, assertManifest, checkedEndpoint, createTransport, boundedBody } = await import(script);
const account = 'a'.repeat(32), endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/chat/completions`;
const body = (repair = false) => JSON.stringify({ model: MODEL, max_tokens: 900, stream: false, temperature: repair ? 0.15 : 0.65, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: '합성 인사' }] });
const state = () => ({ attempts: [] as any[], neuronsAccounted: 0, stopReason: null as string | null, notSent: [] as unknown[] });
afterEach(() => vi.unstubAllGlobals());

describe('v4.1 bounded live preparation: offline doubles only', () => {
  it('plans four fixed synthetic cases without reading environment or invoking fetch', async () => {
    const fetchImpl = vi.fn(); vi.stubGlobal('fetch', fetchImpl);
    expect(await main([], new Proxy({}, { get: () => { throw Error('NO_ENV_READ'); } }))).toEqual(plan());
    expect(CASES.map((item: any) => item.id)).toEqual(['greeting:BOMI', 'greeting:SANI', 'greeting:ARANG', 'synthetic-recall:BOMI']);
    expect(plan()).toMatchObject({ actualHTTPAttempts: 0, ceilingNeurons: 500, maximumHTTPAttempts: 8, maximumRepairsPerReply: 1 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('requires fresh Main opt-in before loading secrets or a stage', async () => {
    await expect(main(['--execute', '--stage=wrong'], {})).rejects.toThrow('MAIN_FRESH_USAGE_GO_REQUIRED');
    await expect(main(['--execute', '--stage=outside'], { JUMZIP_CHAT_RELIABILITY_LIVE_GO: GO })).rejects.toThrow('UNSAFE_STAGE_PATH');
    await expect(main(['--unknown'], {})).rejects.toThrow('ARGUMENTS_INVALID');
  });
  it('rejects altered full manifests rather than checking only imported modules', () => {
    const expected = { status: 'PREPARED_NOT_DEPLOYED', promptVersion: 'JumZipPersona-v4.1', intentVersion: 'JumZipIntent-v1', model: MODEL, baseVerifiedFiles: 53,
      files: Array.from({ length: 54 }, (_, i) => ({ path: `supabase/functions/file-${i}.ts`, sha256: String(i), bytes: i })), supportFiles: [], contracts: ['DEFAULT', 'TEXT_ONLY_V1'], changedFiles: [], baseFilesSha256: 'base', baseManifestSha256: 'manifest' };
    expect(() => assertManifest(expected, expected)).not.toThrow();
    for (const changed of [{ ...expected, files: expected.files.slice(1) }, { ...expected, intentVersion: 'JumZipIntent-v6' }, { ...expected, model: 'another-model' },
      { ...expected, files: expected.files.map((file, i) => i === 53 ? { ...file, sha256: 'tamper' } : file) }]) expect(() => assertManifest(changed, expected)).toThrow('STAGE_MANIFEST_MISMATCH');
  });
  it('requires the exact HTTPS Cloudflare account endpoint without redirects or URL credentials', () => {
    expect(checkedEndpoint(endpoint.replace('/chat/completions', ''), account)).toBe(endpoint);
    for (const url of [endpoint, `https://evil.test/client/v4/accounts/${account}/ai/v1`, endpoint.replace(':', ':443:'), endpoint.replace(account, 'b'.repeat(32)).replace('/chat/completions', ''), endpoint.replace('/chat/completions', '?x=1')]) expect(() => checkedEndpoint(url, account)).toThrow('ACCOUNT_CONFIGURATION_INVALID');
  });
  it('preserves exact stage body and settles reported token usage without storing provider content', async () => {
    const current = state(), serialized = body();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ usage: { prompt_tokens: 50, completion_tokens: 20 }, choices: [{ message: { content: 'SYNTHETIC_RAW_RESPONSE' } }] }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
    const send = createTransport({ endpoint, state: current, getCaseId: () => CASES[0].id, fetchImpl });
    const response = await send(endpoint, { body: serialized });
    expect(await response.text()).toContain('SYNTHETIC_RAW_RESPONSE');
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ body: serialized, redirect: 'error' });
    expect(current.neuronsAccounted).toBeCloseTo(cost(50, 20), 12);
    expect(current.attempts[0]).toMatchObject({ promptTokens: 50, completionTokens: 20, usageEstimated: false });
    expect(JSON.stringify(current)).not.toContain('SYNTHETIC_RAW_RESPONSE');
  });
  it.each([429, 401, 403])('stops after first HTTP %i and stores only allowlisted numeric codes', async status => {
    const current = state(), secret = 'ERROR_BODY_KEY_CANARY';
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ errors: [{ code: 3036, message: secret }, { code: 99999 }], token: secret }), { status, headers: { 'Content-Type': `application/json; private=${secret}` } }));
    const send = createTransport({ endpoint, state: current, getCaseId: () => CASES[0].id, fetchImpl });
    expect((await send(endpoint, { body: body() })).status).toBe(status);
    await expect(send(endpoint, { body: body(true) })).rejects.toThrow('LOCAL_TRANSPORT_BLOCKED');
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(current.attempts[0].cloudflareCodes).toEqual([3036]);
    expect(JSON.stringify(current)).not.toContain(secret); expect(current.attempts[0].usageEstimated).toBe(true);
  });
  it('retains unknown usage reserve and rejects budget before a second HTTP', async () => {
    const current = state(); const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    const send = createTransport({ endpoint, state: current, getCaseId: () => CASES[0].id, fetchImpl });
    await send(endpoint, { body: body() });
    expect(current.neuronsAccounted).toBe(cost(Buffer.byteLength(body()), 900));
    current.neuronsAccounted = CAP;
    await expect(send(endpoint, { body: body(true) })).rejects.toThrow('LOCAL_TRANSPORT_BLOCKED');
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(current.notSent).toHaveLength(1);
  });
  it('stops a transport exception immediately and never stores the raw exception', async () => {
    const current = state(); const fetchImpl = vi.fn().mockRejectedValue(Error('PRIVATE_NETWORK_DETAIL'));
    const send = createTransport({ endpoint, state: current, getCaseId: () => CASES[0].id, fetchImpl });
    await expect(send(endpoint, { body: body() })).rejects.toThrow('SAFE_TRANSPORT_FAILURE');
    await expect(send(endpoint, { body: body(true) })).rejects.toThrow('LOCAL_TRANSPORT_BLOCKED');
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(JSON.stringify(current)).not.toContain('PRIVATE_NETWORK_DETAIL');
  });
  it('bounds error bytes and cancels a stream without awaiting cancellation', async () => {
    const cancelled = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(4097)); }, cancel: cancelled });
    await expect(boundedBody(new Response(stream), undefined, 4096)).rejects.toThrow('BODY_CAP'); expect(cancelled).toHaveBeenCalledOnce();
  });
});
