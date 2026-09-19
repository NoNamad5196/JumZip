import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { checkHttpBoundaries, checkCompatibility, checkLocationRate } from './smoke-remote-boundaries.mjs';
const { SUPABASE_URL:url, SUPABASE_ANON_KEY:anon, SUPABASE_SERVICE_ROLE_KEY:secret }=process.env;
if(!url||!anon||!secret)throw new Error('Configure server-only environment before remote smoke.');
const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const users=[];const checks=[];const observations=[];
const assert=(condition,name)=>{checks.push({name,passed:!!condition});if(!condition)throw new Error(name);console.log(`PASS ${name}`);};
const cleanupPath='test-results/pending-smoke-cleanup.json';
function persistCleanup(){mkdirSync('test-results',{recursive:true});writeFileSync(cleanupPath,JSON.stringify({at:new Date().toISOString(),ids:users},null,2));}
function forgetUser(id){const index=users.indexOf(id);if(index>=0)users.splice(index,1);persistCleanup();}
async function cleanupUser(id){const current=await admin.auth.admin.getUserById(id);if(current.error?.status===404){forgetUser(id);return true;}if(current.error||current.data.user?.user_metadata?.test_run!=='JumZip integration smoke'||!/^jumzip-smoke-[0-9a-f-]+@example\.com$/i.test(current.data.user?.email??''))return false;const{error}=await admin.auth.admin.deleteUser(id,false);const ok=!error||error.status===404||['user_not_found','not_found'].includes(error.code);if(ok)forgetUser(id);return ok;}
async function makeUser(){
 const email=`jumzip-smoke-${randomUUID()}@example.com`;
 const{data,error}=await admin.auth.admin.createUser({email,email_confirm:true,user_metadata:{test_run:'JumZip integration smoke'}});
 if(error||!data.user)throw new Error('Create disposable user failed.');
 users.push(data.user.id);persistCleanup();
 const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 // Privileged test-only link generation sends no email and leaves public CAPTCHA enabled.
 // Verify the generated and authenticated identities before using the in-memory session.
 const link=await admin.auth.admin.generateLink({type:'magiclink',email});
 if(link.error||link.data.user?.id!==data.user.id||!link.data.properties?.hashed_token)throw new Error('Generate disposable sign-in link failed.');
 const sign=await client.auth.verifyOtp({type:'magiclink',token_hash:link.data.properties.hashed_token});
 if(sign.error||!sign.data.session||sign.data.user?.id!==data.user.id)throw new Error('Verify disposable sign-in link failed.');
 return{client,id:data.user.id,token:sign.data.session.access_token};
}
async function api(user,endpoint,body){const response=await fetch(`${url}/functions/v1/${endpoint}`,{method:'POST',headers:{Authorization:`Bearer ${user.token}`,apikey:anon,'Content-Type':'application/json',Origin:'http://127.0.0.1:5173'},body:JSON.stringify({schemaVersion:1,requestId:randomUUID(),...body}),signal:AbortSignal.timeout(105000)}).catch(()=>{throw new Error('Remote Edge transport failed.');});let result;try{result=await response.json();}catch{throw new Error('Remote Edge did not return JSON.');}return{status:response.status,headers:response.headers,...result};}
async function conversation(user,character='BOMI'){const{data,error}=await user.client.from('conversations').insert({user_id:user.id,character_id:character}).select().single();if(error)throw new Error(`Create conversation: ${error.code}`);return data.id;}
try{
 if(existsSync(cleanupPath)){const pending=JSON.parse(readFileSync(cleanupPath,'utf8'));for(const id of pending.ids??[]){if(typeof id!=='string'||!(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i).test(id))throw new Error('Invalid disposable cleanup manifest.');users.push(id);}for(const id of [...users])assert(await cleanupUser(id),'previous disposable user cleanup');}
 const a=await makeUser(),b=await makeUser();const conv=await conversation(a);const other=await conversation(b);
 await checkHttpBoundaries({url,anon,user:a,conversationId:conv,assert});
 const profile=await a.client.from('profiles').select('id').single();assert(!profile.error&&profile.data.id===a.id,'real Auth creates owned profile');
 const blocked=await b.client.from('conversations').select('id').eq('id',conv);assert(!blocked.error&&blocked.data.length===0,'RLS prevents cross-account reads');
 const forged=await a.client.from('messages').insert({user_id:a.id,conversation_id:conv,sender:'ASSISTANT',content:'forged'});assert(!!forged.error,'browser cannot forge assistant rows');
 const requestId=randomUUID();const body={action:'DRAW',conversationId:conv,consultationId:null,spreadType:'GENERAL_3',question:'이 테스트에서는 이번 주에 집중할 것을 살펴보고 싶어요.',mode:'NORMAL',clientTimezone:'Asia/Seoul',requestId};
 const drawn=await api(a,'tarot',body);assert(drawn.ok&&[200,201].includes(drawn.status)&&drawn.data.cards.length===3,'deployed Edge commits three cards');
 assert(new Set(drawn.data.cards.map(x=>x.cardId)).size===3,'persisted draw has no duplicate cards');
 const reload=await a.client.from('messages').select('metadata').eq('conversation_id',conv).eq('type','TAROT_DRAW');assert(reload.data?.[0]?.metadata?.tarot?.drawGroupId===drawn.data.drawGroupId,'partial/success draw restores after page reload');
 const repeated=await api(a,'tarot',body);assert(repeated.ok&&repeated.data.drawGroupId===drawn.data.drawGroupId,'same request replays same persisted group');
 const changed=await api(a,'tarot',{...body,question:'changed payload'});assert(changed.status===409&&changed.error.code==='IDEMPOTENCY_KEY_REUSED','changed payload conflicts');
 const retry=await api(a,'tarot',{action:'RETRY_INTERPRETATION',conversationId:conv,drawGroupId:drawn.data.drawGroupId});assert(retry.ok&&JSON.stringify(retry.data.cards)===JSON.stringify(drawn.data.cards),'interpretation retry never redraws');
 const foreign=await api(b,'tarot',{action:'RETRY_INTERPRETATION',conversationId:other,drawGroupId:drawn.data.drawGroupId});assert(foreign.status===404||foreign.status===403,'foreign retry is rejected');
 const dailyOne=await api(a,'tarot',{...body,requestId:randomUUID(),spreadType:'ONE_CARD',mode:'DAILY'});
 const convTwo=await conversation(a,'SANI');const dailyTwo=await api(a,'tarot',{...body,requestId:randomUUID(),conversationId:convTwo,spreadType:'ONE_CARD',mode:'DAILY'});
 assert(dailyOne.ok&&dailyTwo.ok&&dailyOne.data.drawGroupId===dailyTwo.data.drawGroupId,'Daily Tarot is unique across characters');
 const chat=await api(a,'chat',{action:'SEND',conversationId:conv,consultationId:drawn.data.consultationId,message:'이 카드를 바탕으로 내가 할 수 있는 한 가지 행동을 알려줘.'});
 if(chat.ok) assert(!!chat.data.assistantMessage?.content,'real model Chat response stored');
 else { assert(!!chat.error?.details?.userMessageId&&['LLM_UNAVAILABLE','LLM_TIMEOUT','LLM_INVALID_RESPONSE'].includes(chat.error.code),'recognized inference failure retains Chat retry pointer'); observations.push({name:'Chat inference',code:chat.error.code}); console.log(`MODEL STATUS ${chat.error.code}`); }
 const resolved=await api(a,'saju',{action:'RESOLVE_LOCATION',query:'Seoul',limit:1});
 const city=resolved.data?.locations?.[0] ?? resolved.data?.[0];
 assert(resolved.ok&&!!city?.timezone,'deployed location resolver supplies authoritative timezone');
 const sajuBody={action:'CALCULATE',conversationId:conv,consultationId:null,requestId:randomUUID(),subject:{input:{calendarType:'SOLAR',leapMonth:false,birthDate:'1990-05-10',birthTime:'12:30',birthTimeUnknown:false,gender:'FEMALE',location:city},saveProfile:false},focus:'GENERAL'};
 const saju=await api(a,'saju',sajuBody);
 assert(saju.ok&&saju.data.ruleVersion==='JumZipSajuRules-v1'&&!!saju.data.readingId,'actual full Saju engine persists its versioned result');
 const storedSaju=await a.client.from('saju_readings').select('result_snapshot').eq('id',saju.data.readingId).single();
 assert(!!storedSaju.data?.result_snapshot?.strength?.components,'Saju detail preserves component evidence');
 const sajuRetry=await api(a,'saju',{action:'RETRY_INTERPRETATION',conversationId:conv,readingId:saju.data.readingId});
 assert(sajuRetry.ok&&JSON.stringify(sajuRetry.data.inlineResult)===JSON.stringify(saju.data.inlineResult),'Saju retry uses identical persisted calculation');
 const sajuReplay=await api(a,'saju',sajuBody);assert(sajuReplay.ok&&sajuReplay.data.readingId===saju.data.readingId&&!('result' in sajuReplay.data),'Saju idempotent replay projects canonical inline result');
 const foreignSaju=await api(b,'saju',{action:'RETRY_INTERPRETATION',conversationId:other,readingId:saju.data.readingId});assert(foreignSaju.status===404,'Saju retry enforces ownership');
 const messageSaju=await a.client.from('messages').select('metadata').eq('consultation_id',saju.data.consultationId).eq('type','SAJU_SNAPSHOT');assert(messageSaju.data?.[0]?.metadata?.saju?.readingId===saju.data.readingId&&!JSON.stringify(messageSaju.data).includes('1990-05-10'),'Saju reload metadata excludes raw birth date');
 await checkCompatibility({admin,a,b,other,city,ownInput:sajuBody.subject.input,api,conversation,assert,observations});
 await checkLocationRate({admin,user:b,api,assert});
 const deletion=await api(a,'account',{action:'DELETE_ACCOUNT',confirmation:'DELETE'});assert(deletion.ok&&deletion.data.deleted,'account endpoint deletes disposable account');
 forgetUser(a.id);
 const revoked=await api(a,'chat',{action:'SEND',conversationId:conv,message:'deleted user'});assert(revoked.status===401,'deleted account token is rejected by server getUser');
 for(const table of ['tarot_draw_groups','saju_readings','saju_compatibility_readings','request_executions']){const remaining=await admin.from(table).select('id').eq('user_id',a.id);assert(!remaining.error&&remaining.data?.length===0,`account deletion cascades ${table}`);}
 console.log(`REMOTE SMOKE PASSED: ${checks.length} checks. Initial interpretation=${drawn.data.executionStatus}.`);
}finally{
 for(const id of [...users]){try{const ok=await cleanupUser(id);checks.push({name:'disposable user cleanup',passed:ok});if(!ok){process.exitCode=1;console.error('FAIL disposable user cleanup');}}catch{process.exitCode=1;checks.push({name:'disposable user cleanup',passed:false});console.error('FAIL disposable user cleanup');}}
 mkdirSync('test-results',{recursive:true});writeFileSync('test-results/remote-smoke.json',JSON.stringify({at:new Date().toISOString(),checks,observations,scope:'Admin-created disposable identities with admin-generated magic-link token verification. Public anonymous signup/CAPTCHA is not covered.'},null,2));
}
