import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Read-only publication verification. Does not create sessions or call AI/Edge.
const origin = 'https://jumzip.pages.dev';
const reportPath = process.argv.find(arg => arg.startsWith('--report='))?.slice(9);
if (!process.argv.includes('--execute')) {
  console.log(JSON.stringify({ mode: 'PLAN', origin, networkRequests: 0, description: 'Compare the published index and every local JS/CSS bundle byte-for-byte.' }));
} else {
  if (!reportPath || !/^docs\/evidence\/[a-z0-9-]+\.json$/.test(reportPath)) throw Error('EXPLICIT_EVIDENCE_PATH_REQUIRED');
  if (process.argv.slice(2).some(arg => arg !== '--execute' && !arg.startsWith('--report='))) throw Error('UNEXPECTED_ARGUMENT');
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const paths = ['/index.html', ...(await readdir('dist/assets')).filter(name => /\.(js|css)$/.test(name)).sort().map(name => '/assets/' + name)];
  const report = { checkedAt: new Date().toISOString(), mode: 'PUBLIC_BUILD_READ_ONLY', origin, modelRequests: 0, authRequests: 0, mutations: 0, files: [], passed: false };
  for (const path of paths) {
    const local = await readFile('dist' + path);
    let response = await fetch(origin + path, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (response.status >= 300 && response.status < 400) {
      const next = new URL(response.headers.get('location'), origin + path);
      if (path !== '/index.html' || next.origin !== origin || next.pathname !== '/' || next.search) throw Error('UNEXPECTED_PUBLIC_REDIRECT');
      response = await fetch(next, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    }
    const remote = Buffer.from(await response.arrayBuffer());
    report.files.push({ path, status: response.status, localSha256: sha(local), publicSha256: sha(remote), match: local.equals(remote) });
  }
  report.passed = report.files.length > 1 && report.files.every(file => file.status === 200 && file.match);
  report.limits = ['Byte equality verifies publication only. Browser behavior and authenticated backend/LLM acceptance require separate evidence.'];
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ report: reportPath, passed: report.passed, files: report.files.length, indexSha256: report.files[0].localSha256, modelRequests: 0 }));
  if (!report.passed) process.exitCode = 1;
}
