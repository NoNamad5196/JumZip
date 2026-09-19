import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

// Synthetic browser fixtures only. No live sign-in, database write, or LLM request.
const fixtureUrl='https://jumzip-ui-fixture.supabase.co';
const localConfig=existsSync('.env.local')?readFileSync('.env.local','utf8'):'';
const localUrl=localConfig.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1].trim().replace(/^['"]|['"]$/g,'');
const user={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',is_anonymous:true,email:'',app_metadata:{provider:'anonymous',providers:['anonymous']},user_metadata:{},created_at:'2026-09-20T00:00:00Z'};
async function isolateBackend(page:Page,authenticated=false,paginated=false){
 const mutations:string[]=[];
 await page.route('**/*.supabase.co/**',async route=>{const request=route.request(),url=new URL(request.url()),table=url.pathname.split('/').pop();
  if(url.pathname.endsWith('/rpc/touch_activity'))return route.fulfill({status:200,json:null});
  if(request.method()!=='GET'){mutations.push(`${request.method()} ${url.pathname}`);return route.fulfill({status:400,json:{message:'Browser fixture forbids mutations'}});}
  if(table==='profiles')return route.fulfill({status:200,json:{id:user.id,display_name:'하루',memory_enabled:true,preferred_character:'BOMI'}});
  if(table==='conversations')return route.fulfill({status:200,json:{id:'fixture-conversation',character_id:'BOMI',title:'테스트 전용 대화',relationship_state:{},summary:null}});
  if(table==='messages'&&paginated){
   const before=url.searchParams.get('or')?.match(/created_at\.lt\.([^,)]+)/)?.[1].replaceAll('"','');
   const messages=Array.from({length:120},(_,index)=>({id:`22222222-2222-4222-8222-${String(index+1).padStart(12,'0')}`,conversation_id:'fixture-conversation',consultation_id:'fixture-consultation',sender:'USER',type:'TEXT',content:`이전 기록 ${String(index+1).padStart(3,'0')}`,metadata:{},created_at:new Date(Date.UTC(2026,8,20,0,0,index)).toISOString()}));
   return route.fulfill({status:200,json:messages.filter(message=>!before||message.created_at<before).reverse().slice(0,Number(url.searchParams.get('limit')||101))});
  }
  if(url.pathname.endsWith('/auth/v1/user'))return route.fulfill({status:200,json:user});
  return route.fulfill({status:200,json:[]});
 });
 if(authenticated){const expires=Math.floor(Date.now()/1000)+3600;const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');const session={access_token:`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:user.id,aud:'authenticated',exp:expires,role:'authenticated'})}.fixture-only`,refresh_token:'fixture-only',token_type:'bearer',expires_in:3600,expires_at:expires,user};
  await page.addInitScript(({keys,value})=>{for(const key of keys)localStorage.setItem(key,JSON.stringify(value));},{keys:[fixtureUrl,...(localUrl?[localUrl]:[])].map(value=>`sb-${new URL(value).hostname.split('.')[0]}-auth-token`),value:session});
 }
 return mutations;
}
async function expectNoOverflow(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(()=>innerWidth));}

test('guest selects a character with the keyboard and navigates through public routes',async({page})=>{
 const mutations=await isolateBackend(page);await page.goto('/');await expectNoOverflow(page);
 const arang=page.getByRole('button',{name:'아랑 선택',exact:true});await arang.focus();await arang.press('Enter');await expect(arang).toHaveAttribute('aria-pressed','true');
 await page.getByRole('link',{name:'아랑과 이야기하기',exact:true}).click();await expect(page).toHaveURL(/\/chat\/arang$/);await expect(page.getByRole('textbox',{name:'아랑에게 보낼 이야기'})).toBeDisabled();await expectNoOverflow(page);
 await page.getByRole('link',{name:'나의 기록',exact:true}).click();await expect(page).toHaveURL(/\/history$/);await expect(page.getByRole('heading',{level:1})).toBeVisible();
 await page.getByRole('link',{name:/개인정보와 이용 안내/}).click();await expect(page).toHaveURL(/\/privacy$/);await expect(page.getByRole('heading',{level:1})).toBeVisible();await expectNoOverflow(page);expect(mutations).toEqual([]);
});

test('older message pages preserve the reader position in an actual scroll container',async({page})=>{
 const mutations=await isolateBackend(page,true,true);await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/chat/bomi?conversation=fixture-conversation');await page.evaluate(()=>document.fonts.ready);
 const older=page.getByRole('button',{name:'이전 메시지 더 보기'});await expect(older).toHaveCount(1);await older.scrollIntoViewIfNeeded();
 const anchor=page.locator('.message-text').filter({hasText:'이전 기록 021'});await expect(anchor).toHaveCount(1);
 const before=await anchor.boundingBox();expect(before).not.toBeNull();
 await older.click();await expect(page.locator('.message-text').filter({hasText:'이전 기록 001'})).toHaveCount(1);
 await expect(older).toHaveCount(0);const after=await anchor.boundingBox();expect(after).not.toBeNull();
 expect(Math.abs(after!.y-before!.y)).toBeLessThanOrEqual(2);await expectNoOverflow(page);expect(mutations).toEqual([]);
});

test('tool modal keeps focus inside, closes with Escape, and returns focus without submitting',async({page})=>{
 const mutations=await isolateBackend(page,true);await page.goto('/chat/bomi?conversation=fixture-conversation');await expect(page.getByRole('textbox',{name:'보미에게 보낼 이야기'})).toBeEnabled();
 const trigger=page.getByRole('button',{name:'타로',exact:true});await trigger.focus();await trigger.press('Enter');const modal=page.getByRole('dialog',{name:'마음을 비추는 타로'});await expect(modal).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>document.querySelector('dialog')?.contains(document.activeElement))).toBe(true);
 for(let index=0;index<12;index++){await page.keyboard.press('Tab');await expect.poll(()=>page.evaluate(()=>document.querySelector('dialog')?.contains(document.activeElement))).toBe(true);}
 await expectNoOverflow(page);await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);await expect(trigger).toBeFocused();expect(mutations).toEqual([]);
});
