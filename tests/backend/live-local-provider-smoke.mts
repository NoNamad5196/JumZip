/** Opt-in native llama.cpp compatibility check, using synthetic data only.
 * This tiny CPU model is not a Korean Persona quality/release benchmark. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createOpenAICompatibleProvider } from '../../supabase/functions/_shared/llm/provider.ts';

if (process.env.JUMZIP_RUN_LOCAL_PROVIDER !== '1') {
  console.log('SKIPPED: local provider probe was not requested.'); process.exit(0);
}
const root = 'test-results/local-inference';
const apiKey = (await readFile(`${root}/api-key.local`, 'utf8')).trim();
if (apiKey.length < 24) throw Error('LOCAL_KEY_MISSING');
const baseUrl = 'http://127.0.0.1:8080/v1';
const startedAt = new Date().toISOString();
const checks: { name: string; passed: boolean }[] = [];
let inferenceRequests = 0;
const responses: { method: string; text: string; wallTimeMs: number; usage?: unknown }[] = [];
const providerSourceHash = createHash('sha256').update(await readFile('supabase/functions/_shared/llm/provider.ts')).digest('hex');
function check(name: string, condition: boolean) { checks.push({ name, passed: condition }); if (!condition) throw Error(name); }
const fetchImpl: typeof fetch = async (input, init) => {
  const destination = String(input);
  if (destination !== `${baseUrl}/chat/completions`) throw Error('LOCAL_DESTINATION_CHANGED');
  if (++inferenceRequests > 4) throw Error('LOCAL_REQUEST_CAP');
  return fetch(input, init);
};
const provider = createOpenAICompatibleProvider({ baseUrl, apiKey, model: 'jumzip-local-smoke',
  structuredFormat: 'json_schema', maxOutputTokens: 160, initialTimeoutMs: 60_000, repairTimeoutMs: 30_000, fetchImpl });
let failure: string | null = null;
try {
  const health = await fetch('http://127.0.0.1:8080/health', { signal: AbortSignal.timeout(5_000) });
  check('native server health ready', health.ok && (await health.json()).status === 'ok');
  const models = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(5_000) });
  check('OpenAI model alias available', models.ok && (await models.json()).data.some((model: {id:string}) => model.id === 'jumzip-local-smoke'));
  const denied = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5_000) });
  check('inference rejects missing local API key', denied.status === 401);

  let start = performance.now();
  const chat = await provider.generateChat([{ role: 'system', content: '한국어로 한 문장 인사를 한다. text와 빈 toolReferences 배열을 갖는 JSON 객체를 출력한다.' }, { role: 'user', content: '안녕, 로컬 연결을 확인하고 있어.' }]);
  const parsedChat = JSON.parse(chat.content);
  check('generateChat returns actual Korean schema response', typeof parsedChat.text === 'string' && /[가-힣]/.test(parsedChat.text) && Array.isArray(parsedChat.toolReferences) && parsedChat.toolReferences.length === 0);
  responses.push({ method: 'generateChat', text: chat.content, wallTimeMs: Math.round(performance.now() - start), usage: chat.usage });

  start = performance.now();
  const structured = await provider.generateStructured({ name: 'LocalSmoke',
    messages: [{ role: 'user', content: 'kind는 LOCAL_SMOKE, value는 42, note는 한국어 인사 한 문장인 JSON을 만든다.' }],
    schema: { type: 'object', additionalProperties: false, required: ['kind', 'value', 'note'], properties: { kind: { type: 'string', enum: ['LOCAL_SMOKE'] }, value: { type: 'integer', enum: [42] }, note: { type: 'string', minLength: 1, maxLength: 100 } } },
    validate(value) {
      const row = value as { kind?: unknown; value?: unknown; note?: unknown } | null;
      if (!row || row.kind !== 'LOCAL_SMOKE' || row.value !== 42 || typeof row.note !== 'string' || !/[가-힣]/.test(row.note) || Object.keys(row).length !== 3) throw Error('LOCAL_SCHEMA_INVALID');
      return row;
    },
  });
  check('generateStructured validates exact schema and Korean output', structured.kind === 'LOCAL_SMOKE');
  responses.push({ method: 'generateStructured', text: JSON.stringify(structured), wallTimeMs: Math.round(performance.now() - start) });

  start = performance.now();
  const repaired = await provider.repairChat([{ role: 'user', content: '한국어로 짧게 인사한다. 도구를 사용하지 않는다.' }], '{"text":"미완성"', ['JSON_INVALID']);
  const parsedRepair = JSON.parse(repaired.content);
  check('repairChat produces schema response from supplied malformed draft', typeof parsedRepair.text === 'string' && /[가-힣]/.test(parsedRepair.text) && Array.isArray(parsedRepair.toolReferences) && parsedRepair.toolReferences.length === 0);
  responses.push({ method: 'repairChat', text: repaired.content, wallTimeMs: Math.round(performance.now() - start), usage: repaired.usage });
} catch (error) { failure = error instanceof Error && /^[A-Z_]{3,80}$/.test(error.message) ? error.message : 'LOCAL_SMOKE_FAILURE'; }
await mkdir('docs/evidence', { recursive: true });
const report = { startedAt, completedAt: new Date().toISOString(), binary: 'llama.cpp b11053 Windows x64 CPU',
  binaryArchiveSha256: 'a73abd4fd618b8145bbe7a9e9ca2dad880f05eb589a5942f921b1f39bd2d87dc',
  model: 'ggml-org/Qwen3.5-0.8B-GGUF Q4_0', modelRevision: '8fea620810c4afa23dd6443f999a48574c1611a3',
  modelSha256: '57d1997790d1744fba5b40a7317df71ea5e2acee28c47e78f0cce39c0703f8cf',
  baseUrl, contextTokens: 8192, parallel: 1, cpuThreads: 4, modelOutputTokenLimit: 160,
  scope: 'Actual native loopback provider protocol/schema/repair compatibility; not Persona quality, local Edge integration, or public release acceptance',
  providerSourceHash, checks, inferenceRequests, responses, failure, passed: failure === null && checks.every(row => row.passed) };
await writeFile('docs/evidence/local-provider-smoke.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, checks: checks.length, inferenceRequests, failure }));
process.exitCode = report.passed ? 0 : 1;
