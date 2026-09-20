import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRelease as buildGeminiRelease, root, sha256 } from './prepare-gemini-fallback-release.mjs';
export { root, sha256 };
const prefix = 'supabase/functions/_shared/';
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw Error('RELEASE_ANCHOR_MISMATCH');
  return source.replace(before, after);
}
const text = path => readFileSync(resolve(root, path), 'utf8').replaceAll('\r\n', '\n');
export function buildRelease() {
  // Reconstruct the deployed v4 Gemini build, never copy the unaccepted v12 backend.
  const accepted = buildGeminiRelease();
  const original = accepted.blobs;
  const blobs = new Map(original);
  const overlays = { 'llm/provider.ts': 'provider', 'persona/config.ts': 'config', 'persona/prompt.ts': 'prompt', 'llm/reply.ts': 'reply' };
  for (const [path, name] of Object.entries(overlays)) blobs.set(prefix + path, Buffer.from(text(`scripts/openai-fallback-release/${name}.ts.txt`)));
  const provider = blobs.get(prefix + 'llm/provider.ts').toString();
  if (/gemini|generativelanguage|TEXT_ONLY_V1|TAROT_EVIDENCE_V1|interpretationEvidence|LLMDiagnostic/.test(provider)
    || !provider.includes('https://api.openai.com/v1') || !provider.includes('secondary.reserve')) throw Error('WRONG_PROVIDER_OVERLAY');
  let execute = original.get(prefix + 'orchestration/execute.ts').toString();
  execute = replaceOnce(execute, "import { createOpenAICompatibleProvider } from '../llm/provider.ts';", "import { createOpenAICompatibleProvider } from '../llm/provider.ts';\nimport { createOpenAIBudget } from '../llm/budget.ts';");
  execute = replaceOnce(execute, 'const providerConfig = () =>', 'const providerConfig = (allowPaidFallback = false) =>');
  execute = replaceOnce(execute, "...(environment('LLM_FALLBACK_ENABLED') === 'true'", "...(allowPaidFallback && environment('LLM_FALLBACK_ENABLED') === 'true'");
  execute = replaceOnce(execute, "apiKey: environment('LLM_FALLBACK_API_KEY') ?? '',", "apiKey: environment('LLM_FALLBACK_API_KEY') ?? '', reserve: createOpenAIBudget(client),");
  execute = replaceOnce(execute, '...providerConfig(), ...inferenceTimeouts(deadlineAt)', '...providerConfig(true), ...inferenceTimeouts(deadlineAt)');
  blobs.set(prefix + 'orchestration/execute.ts', Buffer.from(execute));
  let errors = original.get(prefix + 'http/errors.ts').toString();
  const anchor = "  if (['LLM_NOT_CONFIGURED', 'LLM_AUTH_FAILED', 'LLM_RATE_LIMITED'].includes(code))";
  errors = replaceOnce(errors, anchor, "  if (code === 'LLM_BUDGET_EXCEEDED') return new ApiFailure('LLM_BUDGET_EXCEEDED', 503, '보조 AI의 이용 한도 또는 사용 기간을 확인할 수 없어 답변 생성을 멈췄습니다.', false, { reason: code });\n" + anchor);
  blobs.set(prefix + 'http/errors.ts', Buffer.from(errors));
  blobs.set(prefix + 'llm/budget.ts', Buffer.from(text(prefix + 'llm/budget.ts')));
  const files = [...blobs].map(([path, bytes]) => ({ path, sha256: sha256(bytes), baseSha256: original.has(path) ? sha256(original.get(path)) : null,
    bytes: bytes.length, added: !original.has(path), changed: !original.has(path) || !bytes.equals(original.get(path)) })).sort((a,b) => a.path.localeCompare(b.path));
  const changedFiles = files.filter(file => file.changed).map(file => file.path);
  if (files.length !== 54 || changedFiles.length !== 7 || files.filter(file => file.added).length !== 1) throw Error('SCOPE_DRIFT');
  return { original, blobs, report: { status: 'PREPARED_NOT_DEPLOYED', baseManifest: 'docs/evidence/edge-gemini-fallback-release.json',
    promptVersion: 'JumZipPersona-v4.2', intentVersion: 'JumZipIntent-v1', primaryModel: '@cf/qwen/qwen3-30b-a3b-fp8', secondaryModel: 'gpt-5.6-luna',
    fallbackTrigger: 'PRIMARY_HTTP_429_ONLY', paidScope: 'USER_FACING_REPLY_ONLY', migration: '202609200016', budget: { dailyUSD:0.10,monthlyUSD:1,totalUSD:1,durationDays:30,periodTimezone:'Asia/Seoul' },
    changedFiles, unchangedFiles:47, files, modelRequests:0, networkRequests:0, deployed:false } };
}
export function prepareRelease() {
  const {blobs,report} = buildRelease();
  const parent = realpathSync(resolve(root,'supabase/.temp'));
  const rel = relative(realpathSync(root),parent);
  if (!rel || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Error('UNSAFE_PARENT');
  const stage = mkdtempSync(resolve(parent,'openai-fallback-v4-2-'));
  for (const [path,bytes] of blobs) {
    const target = resolve(stage,path); mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes,{flag:'wx'});
    if (sha256(readFileSync(target)) !== sha256(bytes)) throw Error('READBACK_MISMATCH');
  }
  writeFileSync(resolve(stage,'release-manifest.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  return {stage,report};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => arg !== '--check')) throw Error('INVALID_ARGUMENTS');
  const result = args.includes('--check') ? {report:buildRelease().report} : prepareRelease();
  console.log(JSON.stringify({stage:result.stage??null,files:result.report.files.length,changedFiles:result.report.changedFiles,promptVersion:result.report.promptVersion,budget:result.report.budget,deployed:false}));
}
