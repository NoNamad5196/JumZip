import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Public app only, fresh browser contexts, no auth action and no CAPTCHA interaction.
const origin = 'https://jumzip.pages.dev';
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const safeUrl = (value) => { try { const url = new URL(value); return url.origin + (url.hostname.endsWith('challenges.cloudflare.com') ? '/[turnstile-resource]' : url.pathname); } catch { return String(value).slice(0, 120); } };
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const report = { checkedAt: new Date().toISOString(), origin, mode: 'PUBLIC_GUEST_READ_ONLY', authenticationAttempted: false, captchaInteractionAttempted: false, routes: [], resources: [], blockedMutations: [] };
const resources = new Map();
await mkdir('docs/evidence', { recursive: true });
await mkdir('tests/ui/artifacts', { recursive: true });
try {
  for (const [width, height] of [[1440, 900], [360, 800]]) {
    for (const [name, path] of [['root', '/'], ['onboarding', '/onboarding?character=arang'], ['history', '/history'], ['auth', '/auth'], ['privacy', '/privacy'], ['chat', '/chat/arang']]) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = []; const failures = [];
      await context.route('**/*.supabase.co/**', async (route) => {
        const request = route.request();
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
          report.blockedMutations.push({ method: request.method(), url: safeUrl(request.url()) });
          await route.abort('blockedbyclient');
        } else await route.continue();
      });
      await page.addInitScript(() => {
        window.__publicCspEvents = [];
        document.addEventListener('securitypolicyviolation', (event) => window.__publicCspEvents.push({ directive: event.effectiveDirective, blockedURI: event.blockedURI, sourceFile: event.sourceFile, lineNumber: event.lineNumber, columnNumber: event.columnNumber }));
      });
      page.on('pageerror', (error) => errors.push(error.message.replace(/https?:\/\/\S+/g, '[URL]').slice(0, 240)));
      page.on('requestfailed', (request) => failures.push({ url: safeUrl(request.url()), error: request.failure()?.errorText }));
      page.on('response', (response) => {
        const request = response.request();
        if (['image', 'font', 'stylesheet', 'script'].includes(request.resourceType())) resources.set(safeUrl(response.url()), { url: safeUrl(response.url()), type: request.resourceType(), status: response.status() });
      });
      const response = await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
      await page.locator('main:not([role="status"])').waitFor();
      await page.evaluate(() => document.fonts.ready);
      const reload = await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('main:not([role="status"])').waitFor();
      await page.evaluate(() => document.fonts.ready);
      if (name === 'onboarding') {
        await page.getByRole('textbox', { name: '이름 또는 닉네임' }).fill('화면 확인');
        await page.waitForFunction(() => typeof window.turnstile !== 'undefined', { timeout: 15000 });
        await page.waitForTimeout(3000); // Observe widget loading without interacting with the challenge.
      }
      const state = await page.evaluate(() => ({
        width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth,
        title: document.querySelector('main h1')?.textContent,
        imageErrors: [...document.querySelectorAll('img')].filter((image) => image.complete && image.naturalWidth === 0).map((image) => image.getAttribute('src')),
        csp: window.__publicCspEvents,
        turnstileIframeCount: document.querySelectorAll('iframe[src*="challenges.cloudflare.com"]').length,
        turnstileInputPresent: !!document.querySelector('input[name="cf-turnstile-response"]'),
        turnstileTokenPresent: !!document.querySelector('input[name="cf-turnstile-response"]')?.value,
        submitDisabled: document.querySelector('main form button[type="submit"]')?.disabled ?? null,
        sidebarArangLabels: [...document.querySelectorAll('a[aria-label]')].map((a) => a.getAttribute('aria-label')).filter((label) => label.includes('아랑')),
      }));
      const screenshot = `tests/ui/artifacts/public-${name}-${width}.png`;
      await page.screenshot({ path: screenshot, fullPage: true });
      const challengeFrameCount = page.frames().filter((frame) => frame.url().startsWith('https://challenges.cloudflare.com/')).length;
      report.routes.push({ name, path, width, status: response?.status(), reloadStatus: reload?.status(), ...state, challengeFrameCount, csp: state.csp.map((event) => ({ ...event, blockedURI: safeUrl(event.blockedURI), sourceFile: safeUrl(event.sourceFile) })), errors, failures, screenshot });
      await context.close();
    }
  }
} finally { await browser.close(); }
report.resources = [...resources.values()];
report.summary = {
  routeCount: report.routes.length,
  overflowCount: report.routes.filter((route) => route.scrollWidth > route.width).length,
  routeErrorCount: report.routes.filter((route) => route.status !== 200 || route.reloadStatus !== 200 || route.errors.length).length,
  cspViolationCount: report.routes.reduce((total, route) => total + route.csp.length, 0),
  assetErrorCount: report.resources.filter((resource) => resource.status >= 400).length,
  blockedMutationCount: report.blockedMutations.length,
  challengeNetworkFailureCount: report.routes.reduce((total, route) => total + route.failures.filter((failure) => failure.url.includes('challenges.cloudflare.com')).length, 0),
  turnstileLimitation: 'Widget visibility and disabled-until-token can be observed. A failed challenge network request prevents validating token issuance; no CAPTCHA is solved or account created. HTTP asset status alone is not Turnstile success.',
  note: 'Production may still show the previously deployed sidebar particle. Local correction uses withName; this check does not deploy it. Turnstile is observed only; automatic token issuance, if any, is not a CAPTCHA interaction or an account creation.',
};
const output = `docs/evidence/frontend-public-${stamp}.json`;
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, ...report.summary, onboarding: report.routes.filter((route) => route.name === 'onboarding').map(({ width, challengeFrameCount, turnstileInputPresent, turnstileTokenPresent, submitDisabled }) => ({ width, challengeFrameCount, turnstileInputPresent, turnstileTokenPresent, submitDisabled })) }, null, 2));
if (report.summary.overflowCount || report.summary.routeErrorCount || report.summary.blockedMutationCount) process.exitCode = 1;
