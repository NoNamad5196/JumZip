import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

// Runs against a production build preview. All backend traffic is synthetic.
const baseURL = 'http://127.0.0.1:4173';
const headers = await readFile('public/_headers', 'utf8');
const csp = headers.match(/Content-Security-Policy:\s*(.+)/)?.[1];
if (!csp || csp.includes('unsafe-eval')) throw new Error('Strict public CSP is required');
const env = await readFile('.env.local', 'utf8');
const publicUrl = env.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1].trim().replace(/^['"]|['"]$/g, '');
if (!publicUrl) throw new Error('A public frontend Supabase URL is required');
const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: { provider: 'anonymous', providers: ['anonymous'] }, user_metadata: {}, created_at: '2026-09-20T00:00:00Z' };
const expires = Math.floor(Date.now()/1000)+3600;
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const session = { access_token: `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:user.id,aud:'authenticated',exp:expires,role:'authenticated'})}.fixture-only`, refresh_token: 'fixture-only', token_type: 'bearer', expires_in: 3600, expires_at: expires, user };
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const report = { checkedAt: new Date().toISOString(), mode: 'LOCAL_PRODUCTION_BUILD_STRICT_CSP_FIXTURE', csp, realAuth: false, realBackendWrites: false, mockedActivityTouches: 0, routes: [], mutations: [] };
await mkdir('docs/evidence', { recursive: true });
try {
 for (const [width,height] of [[1440,900],[360,800]]) {
  const context = await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
  const page = await context.newPage();
  await context.route(`${baseURL}/**`,async(route)=>{const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'content-security-policy':csp}});});
  await context.route('**/*.supabase.co/**',async(route)=>{
   const request=route.request(),url=new URL(request.url()),table=url.pathname.split('/').pop();
   if(url.pathname.endsWith('/rpc/touch_activity')){report.mockedActivityTouches++;return route.fulfill({status:200,json:null});}
   if(request.method()!=='GET'){report.mutations.push({method:request.method(),path:url.pathname});return route.fulfill({status:400,json:{message:'No fixture mutation allowed'}});}
   if(table==='profiles')return route.fulfill({status:200,json:{id:user.id,display_name:'하루',memory_enabled:true,preferred_character:'ARANG'}});
   if(table==='conversations')return route.fulfill({status:200,json:{id:'fixture-conversation',character_id:'ARANG',title:'CSP fixture'}});
   if(url.pathname.endsWith('/auth/v1/user'))return route.fulfill({status:200,json:user});
   return route.fulfill({status:200,json:[]});
  });
  await context.addInitScript(({key,session})=>{localStorage.setItem(key,JSON.stringify(session));window.__cspEvents=[];document.addEventListener('securitypolicyviolation',(event)=>window.__cspEvents.push({directive:event.effectiveDirective,blockedURI:event.blockedURI==='eval'?'eval':'resource',line:event.lineNumber}));},{key:`sb-${new URL(publicUrl).hostname.split('.')[0]}-auth-token`,session});
  const errors=[];page.on('pageerror',(error)=>errors.push(error.message.slice(0,200)));
  await page.goto(`${baseURL}/onboarding?character=arang`);
  const start=page.getByRole('button',{name:'아랑과 이야기 시작하기'});await expect(start).toBeEnabled();await start.click();
  await expect(page.getByText('어떻게 불러드리면 좋을까요?',{exact:true})).toBeVisible();
  report.routes.push({name:'onboarding-invalid-nickname',width,validationVisible:true,events:await page.evaluate(()=>window.__cspEvents),errors:[...errors]});
  await page.goto(`${baseURL}/chat/arang?conversation=fixture-conversation`);
  await expect(page.getByRole('textbox',{name:'아랑에게 보낼 이야기'})).toBeEnabled();await page.getByRole('button',{name:'사주',exact:true}).click();
  const dialog=page.getByRole('dialog');await expect(dialog.getByLabel('생년월일',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'나의 사주 이야기',exact:true}).click();
  await expect(dialog.getByText('생년월일을 YYYY-MM-DD 형식으로 입력해 주세요.',{exact:true})).toBeVisible();
  report.routes.push({name:'birth-input-invalid-date',width,validationVisible:true,events:await page.evaluate(()=>window.__cspEvents),errors:[...errors]});
  await page.screenshot({path:`tests/ui/artifacts/strict-csp-birth-${width}.png`,fullPage:true});
  await context.close();
 }
} finally { await browser.close(); }
report.passed=report.routes.every((route)=>route.validationVisible&&!route.events.length&&!route.errors.length)&&!report.mutations.length;
const path='docs/evidence/frontend-strict-csp.json';await writeFile(path,JSON.stringify(report,null,2));
console.log(JSON.stringify({path,passed:report.passed,routes:report.routes,mutationCount:report.mutations.length},null,2));
if(!report.passed)process.exitCode=1;
