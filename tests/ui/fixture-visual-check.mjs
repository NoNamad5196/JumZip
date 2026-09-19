import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { calculateFullSajuWithTiming } from '../../supabase/functions/_shared/domain/fortune-timing.ts';
import { calculateSajuCompatibility } from '../../supabase/functions/_shared/domain/saju-compatibility.ts';
// Local visual fixtures only. Every Supabase request is intercepted; no backend mutations are made.
const config=await readFile('.env.local','utf8');
const url=config.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1].trim().replace(/^['"]|['"]$/g,'');
if(!url)throw new Error('Local public Supabase URL required');
const ref=new URL(url).hostname.split('.')[0];
const user={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',is_anonymous:true,email:'',app_metadata:{provider:'anonymous',providers:['anonymous']},user_metadata:{},created_at:'2026-09-20T00:00:00Z'};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const expires=Math.floor(Date.now()/1000)+3600;
const session={access_token:`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:user.id,aud:'authenticated',role:'authenticated',exp:expires,is_anonymous:true})}.local-test-only`,refresh_token:'local-test-only',token_type:'bearer',expires_in:3600,expires_at:expires,user};
const birth={calendarType:'SOLAR',leapMonth:false,birthDate:'1992-10-24',birthTime:'05:30',birthTimeUnknown:false,location:{providerId:'1835848',name:'Seoul',latitude:37.5665,longitude:126.978,timezone:'Asia/Seoul'},gender:'MALE',trueSolarTime:false};
const full=calculateFullSajuWithTiming(birth,new Date('2026-09-20T00:00:00Z')),other=calculateFullSajuWithTiming({...birth,birthDate:'1994-07-18',birthTime:'13:20',gender:'FEMALE'},new Date('2026-09-20T00:00:00Z'));
const compatibility=calculateSajuCompatibility({personA:full,personB:other});
const base={conversation_id:'visual-conversation',character_id:'SANI',created_at:'2026-09-20T00:00:00Z',question:'요즘 새로운 일을 시작할지 고민하고 있어요.',result_summary:null,tarot_draw_groups:[],saju_readings:[],saju_compatibility_readings:[]};
const rows={
 'visual-saju':{...base,id:'visual-saju',title:'새로운 시작 앞에서 만난 나의 흐름',fortune_type:'SAJU',saju_readings:[{id:'saju-fixture',result_snapshot:full,birth_profile_snapshot:birth}]},
 'visual-compatibility':{...base,id:'visual-compatibility',title:'서로의 속도를 이해하는 시간',fortune_type:'COMPATIBILITY',saju_compatibility_readings:[{id:'compatibility-fixture',result_snapshot:compatibility}]},
 'visual-tarot':{...base,id:'visual-tarot',title:'선택 앞에서 펼친 세 장',fortune_type:'TAROT',tarot_draw_groups:[{id:'tarot-fixture',mode:'NORMAL',spread_type:'DECISION_3',created_at:'2026-09-20T00:00:00Z',tarot_draws:[{card_id:0,orientation:'UPRIGHT',position_index:0,position_name:'SUPPORTING_FORCE'},{card_id:16,orientation:'REVERSED',position_index:1,position_name:'RISK'},{card_id:17,orientation:'UPRIGHT',position_index:2,position_name:'PRACTICAL_DIRECTION'}]}]}
};
const tarot={executionStatus:'PARTIAL',conversationId:'visual-conversation',consultationId:'visual-tarot',drawGroupId:'tarot-fixture',spreadType:'DECISION_3',mode:'NORMAL',cards:rows['visual-tarot'].tarot_draw_groups[0].tarot_draws.map(card=>({cardId:card.card_id,orientation:card.orientation,positionIndex:card.position_index,positionKey:card.position_name})),interpretation:null};
const saju={executionStatus:'PARTIAL',conversationId:'visual-conversation',consultationId:'visual-saju',readingId:'saju-fixture',inlineResult:{dayMaster:full.pillars.day?.heavenlyStem,pillars:full.pillars,elements:full.elements,currentFlow:{daewoon:full.daewoon,sewoon:full.sewoon,monthlyFortune:full.monthlyFortune,timing:full.timing}},uncertaintyFlags:full.uncertaintyFlags,interpretation:null};
const messages=[{id:'question-fixture',conversation_id:'visual-conversation',consultation_id:'visual-tarot',sender:'USER',type:'TEXT',content:base.question,metadata:{},created_at:'2026-09-20T00:00:00Z'},{id:'tarot-message',conversation_id:'visual-conversation',consultation_id:'visual-tarot',sender:'SYSTEM',type:'TAROT_DRAW',content:'',metadata:{tarot},created_at:'2026-09-20T00:00:01Z'},{id:'saju-message',conversation_id:'visual-conversation',consultation_id:'visual-saju',sender:'SYSTEM',type:'SAJU_SNAPSHOT',content:'',metadata:{saju},created_at:'2026-09-20T00:00:02Z'}];
const conversation={id:'visual-conversation',character_id:'SANI',title:'새로운 시작을 앞둔 이야기',created_at:base.created_at,last_message_at:base.created_at,relationship_state:{},summary:null};
const exportsOnly=process.argv.includes('--exports-only');
const browser=await chromium.launch({headless:true,channel:'msedge'});await mkdir('tests/ui/artifacts',{recursive:true});const observations=[];
for(const width of exportsOnly?[360]:[1440,1280,390,360]){
 const context=await browser.newContext({viewport:{width,height:width===360?800:900},reducedMotion:'reduce',acceptDownloads:true});
 await context.addInitScript(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:`sb-${ref}-auth-token`,value:session});
 const unexpected=[];
 await context.route(`${url}/**`,async route=>{const request=route.request(),parsed=new URL(request.url()),table=parsed.pathname.split('/').pop();let body;
  if(parsed.pathname.endsWith('/rpc/touch_activity'))body=null;
  else if(parsed.pathname.endsWith('/auth/v1/user'))body=user;
  else if(request.method()!=='GET'){unexpected.push(`${request.method()} ${parsed.pathname}`);return route.fulfill({status:400,json:{message:'Fixture forbids mutations'}});}
  else if(table==='profiles')body={id:user.id,display_name:'하루',memory_enabled:true,preferred_character:'SANI'};
  else if(table==='conversations')body=parsed.searchParams.has('id')?conversation:[conversation];
  else if(table==='consultations'){const id=parsed.searchParams.get('id')?.replace(/^eq\./,'');body=id?rows[id]:Object.values(rows);}
  else if(table==='messages'){const id=parsed.searchParams.get('consultation_id')?.replace(/^eq\./,'');body=id?messages.filter(message=>message.consultation_id===id):messages;}
  else if(['birth_profiles','related_people','memories'].includes(table))body=[];
  else {unexpected.push(`${request.method()} ${parsed.pathname}`);body=[];}
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body),headers:{'access-control-allow-origin':'*'}});
 });
 for(const [name,path] of [['saju','/reading/visual-saju'],['compatibility','/reading/visual-compatibility'],['tarot','/reading/visual-tarot'],['chat','/chat/sani?conversation=visual-conversation'],['history','/history']]){
  if(exportsOnly&&!['saju','compatibility'].includes(name))continue;
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:5173${path}`,{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);if(name==='saju'&&width===360){await page.locator('.current-luck').first().screenshot({path:'tests/ui/artifacts/fixture-current-luck-360.png'});await page.locator('.luck-date-timeline').screenshot({path:'tests/ui/artifacts/fixture-luck-timeline-360.png'});}await page.screenshot({path:`tests/ui/artifacts/fixture-${name}-${width}.png`,fullPage:true});const scrollWidth=await page.evaluate(()=>document.documentElement.scrollWidth);observations.push({name,width,scrollWidth,errors});
  if(['tarot','saju','compatibility'].includes(name)&&width===360){const downloadPromise=page.waitForEvent('download',{timeout:120000});await page.getByRole('button',{name:/결과 이미지 저장/}).click();const download=await downloadPromise;const exportPath=`tests/ui/artifacts/fixture-${name}-export.png`;await download.saveAs(exportPath);const bytes=await readFile(exportPath);observations.push({export:name,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),bytes:bytes.length});const visibleText=await page.locator('.reading-export').innerText();if(visibleText.includes(birth.birthDate)||visibleText.includes(String(birth.location.latitude)))throw new Error('Default export exposed private birth input');}
  await page.close();
 }
 observations.push({width,unexpectedBackendRequests:unexpected});await context.close();
}
await browser.close();await writeFile(exportsOnly?'tests/ui/artifacts/fixture-export-report.json':'tests/ui/artifacts/fixture-visual-report.json',JSON.stringify(observations,null,2));console.log(JSON.stringify(observations,null,2));if(observations.some(item=>item.scrollWidth>item.width||item.errors?.length||item.unexpectedBackendRequests?.length))process.exitCode=1;
