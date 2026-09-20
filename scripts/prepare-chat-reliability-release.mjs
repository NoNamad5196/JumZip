import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// This preparer reads committed release blobs and reviewed text overlays only.
// It never imports current candidate runtime, reads secrets, contacts a service,
// edits an existing stage, or deploys. Run with --check for a zero-write audit.
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BASE_MANIFEST = 'docs/evidence/edge-saju-focus-release.json';
const BASE_FILES_SHA256 = '9f0b9053817c65b1d207fdaaff20288ef7e8aec0ce21a98d5f026d59c7f3e2f6';
const SUPPORT = 'scripts/chat-reliability-release';
const overlays = {
  'llm/chat-contract.ts': 'chat-contract.ts.txt',
  'llm/provider.ts': 'provider.ts.txt',
  'llm/reply.ts': 'reply.ts.txt',
  'llm/validator.ts': 'validator.ts.txt',
  'persona/prompt.ts': 'prompt.ts.txt',
  'http/errors.ts': 'errors.ts.txt',
};
const prefix = 'supabase/functions/_shared/';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (base, target) => { const rel = relative(base, target); return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 5_000_000 });
function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2) throw Error('PARTIAL_PATCH_ANCHOR_MISMATCH');
  return text.replace(before, after);
}

export function buildRelease() {
  const baseBytes = readFileSync(resolve(root, BASE_MANIFEST));
  const base = JSON.parse(baseBytes.toString('utf8'));
  if (!base.deployedAt || base.promptVersion !== 'JumZipPersona-v4' || base.intentVersion !== 'JumZipIntent-v1'
    || base.model !== '@cf/qwen/qwen3-30b-a3b-fp8' || base.files.length !== 53
    || sha256(JSON.stringify(base.files)) !== BASE_FILES_SHA256) throw Error('UNEXPECTED_DEPLOYED_BASE');
  const entries = new Map(base.files.map(item => [item.path, item]));
  if (entries.size !== 53) throw Error('BASE_DUPLICATE_PATH');
  const tree = git('ls-tree', '-rz', base.baseCommit, '--', 'supabase/functions', 'supabase/config.toml').toString('utf8').split('\0').filter(Boolean);
  if (tree.length !== 53) throw Error('BASE_TREE_SIZE');
  for (const row of tree) {
    const [meta, path] = row.split('\t'); const [mode, kind, blob] = meta.split(' ');
    if (mode !== '100644' || kind !== 'blob' || entries.get(path)?.originalGitBlob !== blob) throw Error('BASE_TREE_MISMATCH');
  }
  const original = new Map();
  for (const item of entries.values()) {
    const bytes = git('cat-file', 'blob', item.stagedGitBlob);
    if (sha256(bytes) !== item.sha256 || item.changed !== (item.originalGitBlob !== item.stagedGitBlob)) throw Error('BASE_BLOB_MISMATCH');
    original.set(item.path, bytes);
  }
  const blobs = new Map(original);
  const supportFiles = [];
  for (const [target, support] of Object.entries(overlays)) {
    const path = `${SUPPORT}/${support}`;
    const bytes = Buffer.from(readFileSync(resolve(root, path), 'utf8').replaceAll('\r\n', '\n'));
    if (!bytes.length || !bytes.toString('utf8').endsWith('\n')) throw Error('INVALID_SUPPORT_FILE');
    blobs.set(prefix + target, bytes);
    supportFiles.push({ path, sha256: sha256(bytes), target: prefix + target });
  }
  // Preserve existing deletion/resource guards and the deployed YEAR_FLOW retry
  // lookup. Only the allowlisted PARTIAL reason projection changes in these files.
  for (const [name, id] of [['execute', 'drawGroupId'], ['saju', 'readingId'], ['compatibility', 'compatibilityReadingId']]) {
    const path = `${prefix}orchestration/${name}.ts`;
    let text = original.get(path).toString('utf8');
    text = replaceOnce(text, "import { ApiFailure, safeFailure } from '../http/errors.ts';", "import { ApiFailure, safeFailure, partialFailureDetails } from '../http/errors.ts';");
    text = replaceOnce(text, `details: { ${id}: saved.${id}, reason: failure.code }`, `details: { ${id}: saved.${id}, ...partialFailureDetails(failure) }`);
    blobs.set(path, Buffer.from(text));
  }
  const textOf = path => blobs.get(prefix + path).toString('utf8');
  if (!textOf('llm/reply.ts').includes("'JumZipPersona-v4.1'") || !textOf('llm/intent.ts').includes("'JumZipIntent-v1'")) throw Error('VERSION_DRIFT');
  for (const path of ['llm/provider.ts', 'llm/chat-contract.ts', 'llm/reply.ts', 'llm/validator.ts']) {
    if (/TAROT_EVIDENCE|interpretationEvidence|activeKeywordOptions|diagnoseValidationError|chat_template_kwargs/.test(textOf(path))) throw Error('UNACCEPTED_CONTRACT_IMPORTED');
  }
  const files = [...blobs].map(([path, bytes]) => ({ path, sha256: sha256(bytes), bytes: bytes.length, baseSha256: entries.get(path)?.sha256 ?? null, changed: !original.has(path) || !bytes.equals(original.get(path)), added: !original.has(path) })).sort((a, b) => a.path.localeCompare(b.path));
  const changed = files.filter(item => item.changed);
  if (files.length !== 54 || changed.length !== 9 || changed.filter(item => item.added).length !== 1) throw Error('RELEASE_SCOPE_DRIFT');
  const report = {
    status: 'PREPARED_NOT_DEPLOYED', baseManifest: BASE_MANIFEST, baseManifestSha256: sha256(baseBytes), baseFilesSha256: BASE_FILES_SHA256,
    baseCommit: base.baseCommit, baseOverlayCommit: base.overlayCommit, baseVerifiedFiles: 53,
    promptVersion: 'JumZipPersona-v4.1', intentVersion: base.intentVersion, model: base.model,
    contracts: ['DEFAULT', 'TEXT_ONLY_V1'], changedFiles: changed.map(item => item.path), addedFiles: changed.filter(item => item.added).map(item => item.path),
    files, supportFiles, networkRequests: 0, modelRequests: 0, deployed: false,
    acceptance: 'Offline checks only. Existing captured responses are replayed; fresh model quality and hosted behavior are not established.',
  };
  return { blobs, original, report };
}

export function prepareRelease() {
  const { blobs, report } = buildRelease();
  const parent = resolve(root, 'supabase/.temp');
  if (!within(realpathSync(root), realpathSync(resolve(root, 'supabase')))) throw Error('UNSAFE_STAGING_PARENT');
  if (existsSync(parent) && (lstatSync(parent).isSymbolicLink() || !lstatSync(parent).isDirectory())) throw Error('UNSAFE_STAGING_PARENT');
  mkdirSync(parent, { recursive: true });
  if (!within(realpathSync(root), realpathSync(parent))) throw Error('UNSAFE_STAGING_PARENT');
  const stage = mkdtempSync(resolve(parent, 'chat-reliability-v4-1-'));
  for (const [path, bytes] of blobs) {
    const output = resolve(stage, path);
    if (!within(stage, output)) throw Error('UNSAFE_OUTPUT_PATH');
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, bytes, { flag: 'wx' });
    if (sha256(readFileSync(output)) !== sha256(bytes)) throw Error('STAGE_READBACK_MISMATCH');
  }
  writeFileSync(resolve(stage, 'release-manifest.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return { stage, report };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => arg !== '--check')) throw Error('INVALID_ARGUMENTS');
  const result = args.includes('--check') ? { report: buildRelease().report } : prepareRelease();
  console.log(JSON.stringify({ stage: result.stage ?? null, status: result.report.status, files: result.report.files.length, changedFiles: result.report.changedFiles, promptVersion: result.report.promptVersion, intentVersion: result.report.intentVersion, model: result.report.model, networkRequests: 0, deployed: false }));
}
