/** Six synthetic reply-only diagnostics, not the full Persona acceptance benchmark.
 * New provider model is confined to this opt-in harness; deployed configuration stays put. */
import { readFile, writeFile, appendFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { createOpenAICompatibleProvider, LLMError } from '../../supabase/functions/_shared/llm/provider.ts';
import { generatePersonaReply, PERSONA_PROMPT_VERSION } from '../../supabase/functions/_shared/llm/reply.ts';
import { buildPersonaMessages, type PersonaPromptInput } from '../../supabase/functions/_shared/persona/prompt.ts';
import { PERSONA_BENCHMARK_CASES } from '../../supabase/functions/_shared/persona/benchmark.ts';
import { SAJU_SUPPLEMENTAL_CASES, PRIVACY_CANARIES } from './saju-benchmark-corpus.ts';

const optIn = process.env.JUMZIP_RUN_MODEL_COMPARISON;
if (!['PREFLIGHT', '1'].includes(optIn ?? '')) throw new Error('EXPLICIT_LIVE_OPT_IN_REQUIRED');
const model = '@cf/google/gemma-4-26b-a4b-it';
const rates = { inputNeuronsPerMillion: 9091, outputNeuronsPerMillion: 27273 };
const cap = 500;
const endpoint = new URL(process.env.LLM_BASE_URL ?? '');
if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'api.cloudflare.com' || !/^\/client\/v4\/accounts\/[^/]+\/ai\/v1\/?$/.test(endpoint.pathname)) throw new Error('DESTINATION_NOT_APPROVED');
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const directory = resolve('tests/persona/model-comparison-runs/gemma4-v4-six'); await mkdir(directory, { recursive: true });
const files = { result: join(directory, 'results.json'), raw: join(directory, 'provider-attempts.jsonl'), manifest: join(directory, 'manifest.json'), preflight: join(directory, 'preflight.json') };
for (const file of [files.result, files.raw, files.manifest]) { try { await access(file); throw new Error('COMPARISON_ARTIFACT_ALREADY_EXISTS'); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; } }
const core = (id: string) => PERSONA_BENCHMARK_CASES.find(item => item.id === id)!.input;
const supplement = (id: string) => SAJU_SUPPLEMENTAL_CASES.find(item => item.id === id)!.input;
// Hold the previous classifier's erroneous recommendation constant so the comparison
// measures the reply model only. Do not make another intent request or claim to fix it.
const recommendation = { recommendedTools: [{ tool: 'SAJU', mode: 'NATAL', reason: '타고난 성향은 원국의 구조를 바탕으로 살펴봐요.', missingSlots: ['ownBirthData'] }] };
const cases: { id: string; input: PersonaPromptInput }[] = [
  { id: 'controlled-recall:BOMI', input: { characterId: 'BOMI', relationshipState: 'FIRST_MEETING', currentMessage: '내가 오래 즐겨 온 취미가 무엇이었는지 기억하고 있으면 말해 줘.', recentMessages: [], summary: '',
    memories: [{ id: '11111111-1111-4111-8111-111111111111', scope: 'GLOBAL', category: 'PREFERENCE', subject: 'USER', content: '종이별 접기를 오래 즐기고 있으며, 꾸준히 만드는 종이별을 가장 좋아함', importance: 5 }],
    currentTask: `현재 이야기에 자연스럽게 답한다. 다음은 서버의 도구 제안이며 실행 결과가 아니다: ${JSON.stringify(recommendation)}. 도구를 사용하기 전 사용자가 직접 선택해야 한다. 필요한 정보가 있으면 핵심 한 가지만 캐릭터 말투로 묻되 정확한 생년월일이나 생시는 채팅에 요구하지 않고 출생 정보 입력 화면으로 안내한다. 준비된 카드나 사주 결과를 꾸미지 않는다.` } },
  { id: '01-first-meeting:SANI', input: { ...core('01-first-meeting'), characterId: 'SANI' } },
  { id: '10-retry-same-draw:BOMI', input: { ...core('10-retry-same-draw'), characterId: 'BOMI' } },
  { id: 's02-unknown-hour:BOMI', input: { ...supplement('s02-unknown-hour'), characterId: 'BOMI' } },
  { id: 's05-compatibility-evidence:ARANG', input: { ...supplement('s05-compatibility-evidence'), characterId: 'ARANG' } },
  { id: 's07-no-invented-score:ARANG', input: { ...supplement('s07-no-invented-score'), characterId: 'ARANG' } },
];
// Memory extraction/summary is an independently edited background subsystem and is
// not imported by these reply-only diagnostics. It is not part of this freeze claim.
const sourcePaths = Object.keys(JSON.parse(await readFile('tests/persona/benchmark-runs/v4/focused/benchmark-baseline-manifest.json', 'utf8')).sourceHashes).filter(path => !path.endsWith('/persona/memory.ts'));
async function hashes() { return Object.fromEntries(await Promise.all(sourcePaths.map(async path => { const bytes = await readFile(path); return [path, { raw: sha(bytes), canonicalLF: sha(bytes.toString('utf8').replace(/\r\n/g, '\n')) }]; }))); }
const before = await hashes(); const harnessHash = sha(await readFile('tests/persona/model-comparison-gemma4.mts'));
const cost = (input: number, output: number) => (input * rates.inputNeuronsPerMillion + output * rates.outputNeuronsPerMillion) / 1_000_000;
const cancel = (reader: { cancel(): Promise<unknown> }) => { try { void reader.cancel().catch(() => {}); } catch { /* cleanup only */ } };
let activeId = '', consumed = 0, stopReason: string | null = null; const requests: unknown[] = [], attempts: unknown[] = [];
const fetchImpl: typeof fetch = async (url, init) => {
  const body = JSON.parse(String(init?.body));
  // Official Cloudflare Gemma guide and this model's API schema document this option.
  // No Qwen soft switch or unsupported top-level reasoning option is transplanted.
  body.chat_template_kwargs = { enable_thinking: false };
  const serialized = JSON.stringify(body);
  if (PRIVACY_CANARIES.some(canary => serialized.includes(canary)) || /birthProfile|PRIVATE_CITY_SENTINEL|latitude|longitude/.test(serialized)) throw new Error('PROMPT_PRIVACY_PREFLIGHT_FAILED');
  requests.push({ id: activeId, sha256: sha(serialized), bytes: Buffer.byteLength(serialized), canaryCount: 0, rawBirthFields: false });
  if (optIn === 'PREFLIGHT') return new Response(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }));
  const reserve = cost(Buffer.byteLength(serialized), 900);
  if (stopReason || consumed + reserve > cap || attempts.length >= 12) { stopReason ??= 'LOCAL_BUDGET_OR_ATTEMPT_CAP'; throw new LLMError('LLM_RATE_LIMITED', false); }
  const started = performance.now(); let response: Response;
  try { response = await fetch(url, { ...init, body: serialized }); } catch { stopReason = 'TRANSPORT_FAILED'; throw new LLMError('LLM_UNAVAILABLE'); }
  if (!response.ok) {
    if (response.status === 429) stopReason = 'PROVIDER_QUOTA_OR_RATE_LIMIT';
    const item = { id: activeId, status: response.status, errorBodyOmitted: true }; attempts.push(item); await appendFile(files.raw, JSON.stringify(item) + '\n'); return response;
  }
  const reader = response.clone().body?.getReader(); const decoder = new TextDecoder(); let raw = '', bytes = 0;
  const abort = () => { if (reader) cancel(reader); }; init?.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (!reader) throw Error('EMPTY_BODY');
    while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 128_000) { cancel(reader); throw Error('BODY_CAP'); } raw += decoder.decode(value, { stream: true }); }
    raw += decoder.decode(); const value = JSON.parse(raw); const input = value.usage?.prompt_tokens, output = value.usage?.completion_tokens;
    const reported = typeof input === 'number' && typeof output === 'number' && Number.isFinite(input + output) && input >= 0 && output >= 0;
    const neurons = reported ? cost(input, output) : reserve; consumed += neurons;
    const item = { id: activeId, status: response.status, latencyMs: Math.round(performance.now() - started), promptTokens: reported ? input : null, completionTokens: reported ? output : null, neurons, estimated: !reported };
    attempts.push(item); await appendFile(files.raw, JSON.stringify({ ...item, requestSha256: sha(serialized), response: value }) + '\n');
  } catch { consumed += reserve; attempts.push({ id: activeId, status: response.status, captureFailed: true }); await appendFile(files.raw, JSON.stringify({ id: activeId, captureFailed: true, responseBodyOmitted: true }) + '\n'); }
  finally { init?.signal?.removeEventListener('abort', abort); }
  return response;
};
const provider = createOpenAICompatibleProvider({ baseUrl: endpoint.href, apiKey: process.env.LLM_API_KEY, model, structuredFormat: 'json_object', initialTimeoutMs: 60_000, repairTimeoutMs: 30_000, maxOutputTokens: 900, fetchImpl });
const startedAt = new Date().toISOString(); const entries: unknown[] = []; let completed = false;
if (optIn === 'PREFLIGHT') {
  for (const item of cases) { activeId = item.id; await provider.generateChat(buildPersonaMessages(item.input)); }
  await writeFile(files.preflight, JSON.stringify({ model, promptVersion: PERSONA_PROMPT_VERSION, destinationOrigin: endpoint.origin, pathTemplate: '/client/v4/accounts/[configured-account]/ai/v1/chat/completions', inputKind: 'six synthetic cases; no actual customer data', requests, networkRequests: 0, capNeurons: cap, rates, thinking: { enable_thinking: false, source: 'https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/' }, sourceHashes: before, harnessHash }, null, 2));
  console.log(JSON.stringify({ preflight: true, model, requestCount: requests.length, canaryCount: 0, networkRequests: 0, capNeurons: cap }));
} else try {
  for (const item of cases) {
    activeId = item.id; const started = performance.now(); let response = null, errorCode = null;
    try { response = await generatePersonaReply(provider, item.input); } catch (error) { errorCode = error instanceof LLMError ? error.code : 'BENCHMARK_EXECUTION_FAILED'; }
    entries.push({ id: item.id, response, errorCode, latencyMs: Math.round(performance.now() - started) });
    await writeFile(files.result, JSON.stringify({ model, promptVersion: PERSONA_PROMPT_VERSION, scope: 'SIX_DIAGNOSTICS_NOT_ACCEPTANCE', entries }, null, 2));
    console.log(`${item.id} ${errorCode ?? 'generated'} neurons=${consumed.toFixed(2)}`); if (stopReason) break;
  }
  completed = entries.length === cases.length && !stopReason;
} finally {
  const after = await hashes(); const changedSources = sourcePaths.filter(path => before[path].canonicalLF !== after[path].canonicalLF);
  await writeFile(files.manifest, JSON.stringify({ startedAt, completedAt: new Date().toISOString(), completed, stopReason, model, promptVersion: PERSONA_PROMPT_VERSION, rates, capNeurons: cap, neuronsAccounted: consumed, attempts, sourceHashes: before, afterSourceHashes: after, sourceFrozen: !changedSources.length, changedSources, harnessHash, maxOutputTokens: 900, structuredFormat: 'json_object', thinking: { enable_thinking: false }, fullAcceptanceEligible: false,
    sources: ['https://developers.cloudflare.com/workers-ai/platform/pricing/', 'https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/', 'https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/', 'https://ai.google.dev/gemma/docs/capabilities/thinking'] }, null, 2));
  console.log(JSON.stringify({ completed, stopReason, entries: entries.length, neuronsAccounted: consumed, sourceFrozen: !changedSources.length }));
  if (!completed || changedSources.length) process.exitCode = 1;
}
