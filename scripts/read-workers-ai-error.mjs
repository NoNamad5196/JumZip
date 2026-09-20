/** One explicitly approved synthetic diagnostic. No env files, retries or raw response logs.
 * Official code meanings: https://developers.cloudflare.com/workers-ai/platform/errors/
 * Main supplies LLM_BASE_URL/LLM_API_KEY privately; this module never prints either.
 */
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const APPROVAL = 'ONE_REQUEST_APPROVED';
export const MODEL = '@cf/google/gemma-4-26b-a4b-it';
export const RESPONSE_BYTES = 4096;
export const TIMEOUT_MS = 10_000;
export const CEILING_NEURONS = 7;
export const BODY = JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 1, stream: false, chat_template_kwargs: { enable_thinking: false } });
const hash = value => createHash('sha256').update(value).digest('hex');
export const RESERVATION_NEURONS = (Buffer.byteLength(BODY) * 9091 + 27273) / 1_000_000;
const ERRORS = new Set(['PROBE_ARGUMENTS_INVALID', 'PROBE_EXPLICIT_GO_REQUIRED', 'PROBE_CONFIGURATION_INVALID', 'PROBE_BUDGET_INVALID', 'PROBE_REPORT_EXISTS', 'PROBE_REPORT_WRITE_FAILED']);
const fail = code => { throw Error(code); };

export function plan() {
  return { mode: 'PLAN_ONLY', actualHTTPAttempts: 0, liveAuthorized: false, maximumHTTPAttempts: 1, model: MODEL, maxOutputTokens: 1, thinking: false,
    requestBytes: Buffer.byteLength(BODY), requestSha256: hash(BODY), conservativeReservationNeurons: RESERVATION_NEURONS, ceilingNeurons: CEILING_NEURONS,
    accounting: 'UTF8_REQUEST_BYTES_AS_INPUT_TOKENS_PLUS_ONE_OUTPUT_TOKEN_NO_MEASURED_USAGE', responseBytes: RESPONSE_BYTES, timeoutMs: TIMEOUT_MS,
    noAutomaticRetry: true, reportPolicy: 'EXCLUSIVE_CREATE_NO_RAW_BODY_OR_CREDENTIALS' };
}

function configuration({ baseUrl, apiKey, expectedAccountId, approval }) {
  if (approval !== APPROVAL) fail('PROBE_EXPLICIT_GO_REQUIRED');
  if (!(RESERVATION_NEURONS > 0 && RESERVATION_NEURONS < CEILING_NEURONS)) fail('PROBE_BUDGET_INVALID');
  if (typeof expectedAccountId !== 'string' || !/^[a-f0-9]{32}$/.test(expectedAccountId) || typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey)) fail('PROBE_CONFIGURATION_INVALID');
  let endpoint;
  try { endpoint = new URL(baseUrl); } catch { fail('PROBE_CONFIGURATION_INVALID'); }
  const path = `/client/v4/accounts/${expectedAccountId}/ai/v1`;
  if (endpoint.origin !== 'https://api.cloudflare.com' || (endpoint.pathname !== path && endpoint.pathname !== path + '/') || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) fail('PROBE_CONFIGURATION_INVALID');
  return endpoint.origin + path + '/chat/completions';
}

function cancel(stream) { try { void stream?.cancel().catch(() => {}); } catch { /* Cancellation cannot extend the deadline. */ } }

export function classify(status, headers, bytes) {
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { /* Unknown bodies stay unknown. */ }
  const candidates = [parsed?.error?.code, ...(Array.isArray(parsed?.errors) ? parsed.errors.map(item => item?.code) : [])];
  const errorCodes = [...new Set(candidates.filter(code => code === 3036 || code === 3040))].sort();
  const rawRetry = headers.get('retry-after');
  const retryAfterSeconds = rawRetry !== null && /^\d+$/.test(rawRetry) && Number.isSafeInteger(Number(rawRetry)) ? Number(rawRetry) : null;
  const category = status === 429 && errorCodes.length === 1 ? errorCodes[0] === 3036 ? 'DAILY_FREE_ALLOCATION_EXHAUSTED' : 'TEMPORARY_CAPACITY_EXCEEDED'
    : errorCodes.length ? 'KNOWN_CODE_WITH_UNEXPECTED_ENVELOPE' : status >= 200 && status < 300 ? 'HTTP_SUCCESS_NOT_QUALITY_EVIDENCE' : 'UNCLASSIFIED_HTTP_ERROR';
  return { httpStatus: status, errorCodes, retryAfterSeconds, responseSha256: hash(bytes), category };
}

/** fetchImpl exists only for offline tests. The CLI always uses native fetch. */
export async function probe(options) {
  const destination = configuration(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  let reader;
  let response;
  let timeout;
  const report = { ...plan(), mode: 'ONE_APPROVED_DIAGNOSTIC', actualHTTPAttempts: 1, liveAuthorized: true, httpStatus: null, errorCodes: [], retryAfterSeconds: null,
    responseSha256: null, category: 'TRANSPORT_FAILED', usageMeasured: false, neuronsAccounted: RESERVATION_NEURONS, rawBodyPersisted: false, credentialsPersisted: false };
  const work = (async () => {
    response = await fetchImpl(destination, { method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' }, body: BODY, redirect: 'error', signal: controller.signal });
    if (controller.signal.aborted) { cancel(response.body); return; }
    report.httpStatus = response.status;
    reader = response.body?.getReader();
    const chunks = []; let total = 0;
    if (reader) while (true) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) return;
      if (done) break;
      total += value.byteLength;
      if (total > RESPONSE_BYTES) { cancel(reader); report.category = 'RESPONSE_BODY_LIMIT'; return; }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks, total);
    Object.assign(report, classify(response.status, response.headers, bytes));
  })();
  try {
    await Promise.race([work, new Promise(resolveTimeout => {
      timeout = setTimeout(() => { report.category = 'TIMEOUT'; controller.abort(); if (reader) cancel(reader); else cancel(response?.body); resolveTimeout(); }, TIMEOUT_MS);
    })]);
  } catch { report.category = controller.signal.aborted ? 'TIMEOUT' : 'TRANSPORT_FAILED'; }
  finally { clearTimeout(timeout); }
  return report;
}

export async function writeProbeReport(options, directory, name) {
  configuration(options); // Reject configuration before any file or HTTP mutation.
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) fail('PROBE_ARGUMENTS_INVALID');
  const finalPath = join(directory, `${name}.json`), startPath = join(directory, `${name}.started.json`);
  for (const path of [finalPath, startPath]) {
    try { await access(path); fail('PROBE_REPORT_EXISTS'); }
    catch (error) { if (error?.code !== 'ENOENT') fail('PROBE_REPORT_EXISTS'); }
  }
  const sourceSha256 = hash((await readFile(fileURLToPath(import.meta.url), 'utf8')).replace(/\r\n/g, '\n'));
  await mkdir(directory, { recursive: true });
  // The exclusive start record is also a no-retry lock if execution is interrupted.
  try { await writeFile(startPath, JSON.stringify({ ...plan(), mode: 'APPROVED_REQUEST_RESERVED', sourceSha256, startedAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' }); }
  catch { fail('PROBE_REPORT_EXISTS'); }
  const result = { ...(await probe(options)), sourceSha256, completedAt: new Date().toISOString() };
  try { await writeFile(finalPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); }
  catch { fail('PROBE_REPORT_WRITE_FAILED'); }
  return result;
}

export async function main(args = process.argv.slice(2), env = process.env) {
  if (!args.length || (args.length === 1 && args[0] === '--plan')) return plan();
  if (args.length !== 3 || args[0] !== '--run' || !args[1].startsWith('--expected-account-id=') || !args[2].startsWith('--report-name=')) fail('PROBE_ARGUMENTS_INVALID');
  if (env.JUMZIP_WORKERS_AI_ERROR_PROBE_GO !== APPROVAL) fail('PROBE_EXPLICIT_GO_REQUIRED');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  return writeProbeReport({ baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, expectedAccountId: args[1].slice('--expected-account-id='.length), approval: env.JUMZIP_WORKERS_AI_ERROR_PROBE_GO },
    join(root, 'test-results/workers-ai-error-probe'), args[2].slice('--report-name='.length));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(JSON.stringify({ status: 'NOT_COMPLETED', code: ERRORS.has(error?.message) ? error.message : 'PROBE_LOCAL_FAILURE', rawErrorOmitted: true }));
    process.exitCode = 1;
  });
}
