import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const BASE = 'docs/evidence/edge-saju-focus-release.json';
const BASE_FILES_HASH = '9f0b9053817c65b1d207fdaaff20288ef7e8aec0ce21a98d5f026d59c7f3e2f6';
const prefix = 'supabase/functions/_shared/';
const within = (base, target) => { const rel = relative(base, target); return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 5_000_000 });
export function wireFallback(source) {
  const before = "structuredFormat: environment('LLM_STRUCTURED_FORMAT') === 'json_object' ? 'json_object' as const : 'json_schema' as const });";
  if (source.split(before).length !== 2) throw Error('RUNTIME_ANCHOR_MISMATCH');
  return source.replace(before, `structuredFormat: environment('LLM_STRUCTURED_FORMAT') === 'json_object' ? 'json_object' as const : 'json_schema' as const,
      ...(environment('LLM_FALLBACK_ENABLED') === 'true' ? { fallback: {
        baseUrl: environment('LLM_FALLBACK_BASE_URL') ?? '', model: environment('LLM_FALLBACK_MODEL') ?? '', apiKey: environment('LLM_FALLBACK_API_KEY') ?? '',
      } } : {}) });`);
}

/** Reconstruct the accepted deployment; never copy the candidate working backend. */
export function buildRelease() {
  const baseBytes = readFileSync(resolve(root, BASE));
  const base = JSON.parse(baseBytes);
  if (!base.deployedAt || base.files.length !== 53 || sha256(JSON.stringify(base.files)) !== BASE_FILES_HASH
      || base.promptVersion !== 'JumZipPersona-v4' || base.intentVersion !== 'JumZipIntent-v1') throw Error('UNEXPECTED_BASE');
  const original = new Map();
  for (const item of base.files) {
    if (!/^supabase\/(?:functions\/|config\.toml$)/.test(item.path) || item.path.includes('..') || original.has(item.path)) throw Error('INVALID_BASE_PATH');
    const bytes = git('cat-file', 'blob', item.stagedGitBlob);
    if (sha256(bytes) !== item.sha256) throw Error('BASE_BLOB_MISMATCH');
    original.set(item.path, bytes);
  }
  const blobs = new Map(original);
  const provider = Buffer.from(readFileSync(resolve(root, 'scripts/gemini-fallback-release/provider.ts.txt'), 'utf8').replaceAll('\r\n', '\n'));
  if (!provider.length || /TEXT_ONLY_V1|TAROT_EVIDENCE_V1|interpretationEvidence|chat_template_kwargs|LLMDiagnostic/.test(provider.toString())) throw Error('CANDIDATE_PROVIDER_IMPORTED');
  blobs.set(prefix + 'llm/provider.ts', provider);
  blobs.set(prefix + 'orchestration/execute.ts', Buffer.from(wireFallback(original.get(prefix + 'orchestration/execute.ts').toString())));
  const files = [...blobs].map(([path, bytes]) => ({ path, sha256: sha256(bytes), baseSha256: sha256(original.get(path)), bytes: bytes.length, changed: !bytes.equals(original.get(path)) })).sort((a, b) => a.path.localeCompare(b.path));
  const changed = files.filter(item => item.changed).map(item => item.path);
  if (JSON.stringify(changed) !== JSON.stringify([prefix + 'llm/provider.ts', prefix + 'orchestration/execute.ts'])) throw Error('RELEASE_SCOPE_DRIFT');
  const report = { status: 'PREPARED_NOT_DEPLOYED', baseManifest: BASE, baseManifestSha256: sha256(baseBytes), baseFilesSha256: BASE_FILES_HASH,
    promptVersion: base.promptVersion, intentVersion: base.intentVersion, primaryModel: base.model, secondaryModel: 'gemini-3.5-flash', fallbackTrigger: 'PRIMARY_HTTP_429_ONLY',
    changedFiles: changed, unchangedFiles: 51, files, modelRequests: 0, networkRequests: 0, deployed: false };
  return { original, blobs, report };
}
export function prepareRelease() {
  const { blobs, report } = buildRelease();
  const parent = resolve(root, 'supabase/.temp');
  if (!within(realpathSync(root), realpathSync(resolve(root, 'supabase')))) throw Error('UNSAFE_PARENT');
  if (existsSync(parent) && (lstatSync(parent).isSymbolicLink() || !lstatSync(parent).isDirectory())) throw Error('UNSAFE_PARENT');
  mkdirSync(parent, { recursive: true });
  if (!within(realpathSync(root), realpathSync(parent))) throw Error('UNSAFE_PARENT');
  const stage = mkdtempSync(resolve(parent, 'gemini-fallback-v4-'));
  for (const [path, bytes] of blobs) {
    const target = resolve(stage, path);
    if (!within(stage, target)) throw Error('UNSAFE_TARGET');
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes, { flag: 'wx' });
    if (sha256(readFileSync(target)) !== sha256(bytes)) throw Error('READBACK_MISMATCH');
  }
  writeFileSync(resolve(stage, 'release-manifest.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return { stage, report };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check') || args.length > 1) throw Error('INVALID_ARGUMENTS');
  const result = args.includes('--check') ? { report: buildRelease().report } : prepareRelease();
  console.log(JSON.stringify({ stage: result.stage ?? null, files: result.report.files.length, changedFiles: result.report.changedFiles, promptVersion: result.report.promptVersion, secondaryModel: result.report.secondaryModel, deployed: false }));
}
