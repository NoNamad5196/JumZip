import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Reconstruct an already verified release from committed Git objects. Candidate
// working files are never copied and this script never deploys or contacts a server.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--check' && !arg.startsWith('--manifest=')) || args.filter(arg => arg.startsWith('--manifest=')).length > 1) throw Error('INVALID_ARGUMENTS');
const manifestPath = resolve(root, args.find(arg => arg.startsWith('--manifest='))?.slice(11) ?? 'docs/evidence/edge-deletion-guard-release.json');
const within = (base, target) => { const rel = relative(base, target); return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
if (!within(root, manifestPath) || !within(realpathSync(root), realpathSync(manifestPath))) throw Error('MANIFEST_OUTSIDE_REPOSITORY');
let manifest;
try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { throw Error('INVALID_MANIFEST_JSON'); }
const hex40 = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const hex64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
if (manifest.status !== 'DEPLOYED_AND_SMOKE_VERIFIED' || !hex40(manifest.baseCommit) || !Array.isArray(manifest.files) || !Array.isArray(manifest.changedFiles)) throw Error('UNVERIFIED_RELEASE_MANIFEST');
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 5_000_000 });
const sha = data => createHash('sha256').update(data).digest('hex');
const validPath = path => typeof path === 'string' && !path.includes('\\') && !path.includes(':') && !path.split('/').some(part => part === '..' || part === '.' || !part) && (path === 'supabase/config.toml' || path.startsWith('supabase/functions/'));
const files = new Map();
for (const item of manifest.files) {
  if (!validPath(item.path) || files.has(item.path) || !hex40(item.originalGitBlob) || !hex40(item.stagedGitBlob) || !hex64(item.sha256) || typeof item.changed !== 'boolean') throw Error('INVALID_RELEASE_ENTRY');
  if (item.changed !== (item.originalGitBlob !== item.stagedGitBlob)) throw Error('RELEASE_CHANGE_FLAG_MISMATCH');
  files.set(item.path, item);
}
const tree = git('ls-tree', '-rz', manifest.baseCommit, '--', 'supabase/functions', 'supabase/config.toml').toString('utf8').split('\0').filter(Boolean).map(line => {
  const [metadata, path] = line.split('\t'); const [mode, kind, blob] = metadata.split(' ');
  if (mode !== '100644' || kind !== 'blob' || files.get(path)?.originalGitBlob !== blob) throw Error('BASE_RELEASE_TREE_MISMATCH');
  return path;
});
if (!tree.length || tree.length !== files.size || tree.some(path => !files.has(path))) throw Error('INCOMPLETE_RELEASE_TREE');
const changed = [...files.values()].filter(item => item.changed).map(item => item.path).sort();
if (JSON.stringify(changed) !== JSON.stringify([...manifest.changedFiles].sort())) throw Error('RELEASE_CHANGED_FILES_MISMATCH');
const blobs = new Map();
for (const [path, item] of files) {
  const bytes = git('cat-file', 'blob', item.stagedGitBlob);
  if (sha(bytes) !== item.sha256) throw Error('RELEASE_CONTENT_HASH_MISMATCH');
  blobs.set(path, bytes);
}
const reply = blobs.get('supabase/functions/_shared/llm/reply.ts')?.toString('utf8');
const intent = blobs.get('supabase/functions/_shared/llm/intent.ts')?.toString('utf8');
if (typeof manifest.promptVersion !== 'string' || typeof manifest.intentVersion !== 'string' || !reply?.includes(`'${manifest.promptVersion}'`) || !intent?.includes(`'${manifest.intentVersion}'`)) throw Error('RELEASE_VERSION_MISMATCH');
const report = { status: 'VERIFIED', files: blobs.size, changedFiles: changed, baseCommit: manifest.baseCommit, promptVersion: manifest.promptVersion, intentVersion: manifest.intentVersion, networkRequests: 0, deployed: false };
if (args.includes('--check')) {
  console.log(JSON.stringify(report));
} else {
  const parent = resolve(root, 'supabase/.temp');
  if (!within(realpathSync(root), realpathSync(resolve(root, 'supabase')))) throw Error('STAGING_PARENT_OUTSIDE_REPOSITORY');
  if (existsSync(parent) && (lstatSync(parent).isSymbolicLink() || !lstatSync(parent).isDirectory())) throw Error('UNSAFE_STAGING_PARENT');
  mkdirSync(parent, { recursive: true });
  if (!within(realpathSync(root), realpathSync(parent))) throw Error('STAGING_PARENT_OUTSIDE_REPOSITORY');
  const stage = mkdtempSync(resolve(parent, 'verified-edge-'));
  for (const [path, bytes] of blobs) {
    const output = resolve(stage, path);
    if (!within(stage, output)) throw Error('UNSAFE_OUTPUT_PATH');
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, bytes, { flag: 'wx' });
    if (sha(readFileSync(output)) !== files.get(path).sha256) throw Error('STAGED_READBACK_MISMATCH');
  }
  writeFileSync(resolve(stage, 'release-verification.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ ...report, stage }));
}
