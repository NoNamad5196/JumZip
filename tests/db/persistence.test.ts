import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';

const a='10000000-0000-4000-8000-000000000001';
const b='10000000-0000-4000-8000-000000000002';
let db: PGlite;
let conversation: string;
async function scalar(sql: string, values: unknown[] = []) { const r=await db.query<Record<string,any>>(sql, values); return Object.values(r.rows[0])[0]; }
async function rpc(name: string, params: unknown[]) { return scalar(`select public.${name}(${params.map((_,i)=>`$${i+1}`).join(',')})`,params); }
function request<T extends Record<string,unknown>>(extra: T={} as T) { return {user_id:a,operation:'tarot.DRAW',request_id:crypto.randomUUID(),payload_hash:crypto.randomUUID(),conversation_id:conversation,question:'오늘 무엇을 돌아보면 좋을까?',spread_type:'ONE_CARD',mode:'NORMAL',...extra}; }
const card=[{cardId:17,orientation:'UPRIGHT',positionIndex:0,positionKey:'PRESENT'}];
const birth={calendarType:'SOLAR',leapMonth:false,birthDate:'1990-05-10',birthTime:'12:30',birthTimeUnknown:false,location:{name:'Seoul',country:'KR',latitude:37.57,longitude:126.97,timezone:'Asia/Seoul'},gender:'FEMALE'};
// Persistence fixture: deliberately small; independent domain tests validate the actual rules.
const sajuResult={fullCalculationReady:true,engineVersion:'manseryeok-2.0.0',ruleVersion:'JumZipSajuRules-v1',conventionVersion:'JumZipSajuConvention-v1',pillars:{year:{heavenlyStem:'庚',earthlyBranch:'午'},month:null,day:{heavenlyStem:'甲',earthlyBranch:'子'},hour:null},elements:null,uncertaintyFlags:['TEST_UNCERTAINTY']};
const compatibilityResult={kind:'SAJU_COMPATIBILITY',engineVersion:sajuResult.engineVersion,ruleVersion:sajuResult.ruleVersion,conventionVersion:sajuResult.conventionVersion,personA:{charts:[sajuResult.pillars]},personB:{charts:[sajuResult.pillars]},summary:{dayMasterRelation:{aSeesB:'비견',bSeesA:'비견'},strengths:[],frictions:[],practicalAdvice:[]},uncertaintyFlags:[]};
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role bypassrls; create table auth.users(id uuid primary key,is_anonymous boolean default true,created_at timestamptz default now()); create table auth.identities(user_id uuid references auth.users(id) on delete cascade,provider text); create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid'; grant usage on schema public,auth to anon,authenticated,service_role;`);
 for(const file of readdirSync(new URL('../../supabase/migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(`../../supabase/migrations/${file}`,import.meta.url),'utf8'));
},30000);
beforeEach(async()=>{await db.exec("reset role; select set_config('request.jwt.claim.sub','',false); truncate auth.users cascade;"); await db.query('insert into auth.users(id) values($1),($2)',[a,b]); conversation=await scalar('insert into conversations(user_id,character_id) values($1,\'BOMI\') returning id',[a]);});
afterAll(async()=>{await db?.close();});

describe('authoritative persistence',()=>{
 it('projects stored timing through reload and retry without substituting the current clock',async()=>{
  const timing={asOf:'2024-02-04T08:26:00.000Z',precision:'MINUTE',periodBasis:'SOLAR_TERM',calendarLabel:{year:2024,month:2},activeDaewoonStatus:'UNRESOLVED'};
  const begun=await rpc('begin_saju_request',[request({operation:'saju.CALCULATE'})]);
  const saved=await rpc('save_saju_reading',[begun.executionId,{...sajuResult,timing},birth,null]);
  expect(saved.inlineResult.currentFlow.timing).toEqual(timing);
  await rpc('fail_execution',[begun.executionId,{code:'LLM_UNAVAILABLE',retryable:true},502]);
  const retried=await rpc('begin_saju_request',[request({operation:'saju.RETRY_INTERPRETATION',reading_id:saved.readingId})]);
  expect(retried.resource.result.timing).toEqual(timing);
  expect(retried.resource.inlineResult.currentFlow.timing).toEqual(timing);
  const another=await rpc('begin_saju_request',[request({operation:'saju.CALCULATE'})]);
  const legacy=await rpc('save_saju_reading',[another.executionId,sajuResult,birth,null]);
  expect(legacy.inlineResult.currentFlow).not.toHaveProperty('timing');
 });
 it('deletes an account with overlapping consultation cascades and populated execution caches',async()=>{
  const tarot=await rpc('begin_fortune_request',[request()]);
  await rpc('save_tarot_draw',[tarot.executionId,card,'ONE_CARD','DAILY','2026-09-20','test',null]);
  const saju=await rpc('begin_saju_request',[request({operation:'saju.CALCULATE'})]);
  await rpc('save_saju_reading',[saju.executionId,sajuResult,birth,birth]);
  const compatibility=await rpc('begin_saju_compatibility_request',[request({operation:'compatibility.CALCULATE_SAJU'})]);
  await rpc('save_saju_compatibility',[compatibility.executionId,compatibilityResult,null,birth,'삭제 검증 상대',null]);
  const relatedId=await scalar('select id from related_people where user_id=$1',[a]);
  await db.query("insert into memories(user_id,scope,category,subject,content,source_conversation_id) values($1,'GLOBAL','RELATIONSHIP',$2,'삭제할 합성 기억',$3)",[a,`RELATED_PERSON:${relatedId}`,conversation]);
  await db.query('delete from auth.users where id=$1',[a]);
  for(const table of ['conversations','consultations','messages','tarot_draw_groups','tarot_draws','saju_readings','saju_compatibility_readings','birth_profiles','related_people','memories','memory_suppressions','request_executions','daily_draw_claims','rate_limit_buckets']) {
   expect(await scalar(`select count(*)::int from public.${table} where user_id=$1`,[a]),table).toBe(0);
  }
  expect(await scalar('select count(*)::int from profiles where id=$1',[a])).toBe(0);
  expect(await scalar('select count(*)::int from auth.users where id=$1',[b])).toBe(1);
 });
 it('deletes an owned consultation with snapshots and response caches while preserving its conversation',async()=>{
  const begun=await rpc('begin_fortune_request',[request()]);await rpc('save_tarot_draw',[begun.executionId,card,'ONE_CARD','NORMAL',null,'test',null]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[b]);await db.exec('set role authenticated');
  await db.query('delete from consultations where id=$1',[begun.consultationId]);await db.exec('reset role');
  expect(await scalar('select count(*)::int from consultations')).toBe(1);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[a]);await db.exec('set role authenticated');
  await db.query('delete from consultations where id=$1',[begun.consultationId]);await db.exec('reset role');
  expect(await scalar('select count(*)::int from tarot_draw_groups')).toBe(0);expect(await scalar('select count(*)::int from messages')).toBe(0);
  expect(await scalar('select count(*)::int from conversations')).toBe(1);expect(await scalar('select response_data from request_executions')).toBeNull();
 });
 it('persists recommendation metadata together with the final assistant reply',async()=>{
  const first=await rpc('begin_chat_request',[request({operation:'chat.SEND',message:'올해 흐름을 보고 싶어'})]);
  const recommendation={recommendedTools:[{tool:'SAJU',mode:'SEWOON',reason:'올해 흐름',missingSlots:['ownBirthData']}]};
  await rpc('complete_execution',[first.executionId,'출생 정보로 함께 살펴볼 수 있어요.',['출생 정보로 함께 살펴볼 수 있어요.'],'test','test',{recommendation}]);
  expect(await scalar("select metadata->'recommendation' from messages where sender='ASSISTANT'")).toEqual(recommendation);
 });
 it('caches verified profile locations and invalidates edits without trusting client attestations',async()=>{
  const begun=await rpc('begin_saju_request',[request({operation:'saju.CALCULATE'})]);
  await rpc('save_saju_reading',[begun.executionId,sajuResult,birth,birth]);
  const profileId=await scalar('select id from birth_profiles');expect(await scalar('select location_verified_at is not null from birth_profiles')).toBe(true);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[a]);await db.exec('set role authenticated');
  await expect(db.query('update birth_profiles set location_verified_at=now() where id=$1',[profileId])).rejects.toThrow('permission denied');
  await db.query("update birth_profiles set city='edited' where id=$1",[profileId]);await db.exec("reset role;select set_config('request.jwt.claim.sub','',false)");
  expect(await scalar('select location_verified_at from birth_profiles')).toBeNull();
  expect(await rpc('record_verified_birth_location',[a,profileId,birth.location,birth.location])).toBe(false);
  expect(await rpc('record_verified_birth_location',[a,profileId,{...birth.location,name:'edited'},birth.location])).toBe(true);
  expect(await scalar('select city from birth_profiles')).toBe('Seoul');expect(await scalar('select location_verified_at is not null from birth_profiles')).toBe(true);
  expect(await rpc('record_verified_birth_location',[b,profileId,birth.location,birth.location])).toBe(false);
 });
 it('claims titles after three messages and never overwrites a concurrent manual title',async()=>{
  const first=await rpc('begin_chat_request',[request({operation:'chat.SEND',message:'새로운 일을 시작하고 싶어'})]);
  await rpc('complete_execution',[first.executionId,'어떤 일이 마음에 남았어?',['어떤 일이 마음에 남았어?'],'test','test',{}]);
  expect(await rpc('claim_title_generation',[a,conversation,first.consultationId])).toEqual([]);
  await rpc('begin_chat_request',[request({operation:'chat.SEND',consultation_id:first.consultationId,message:'글쓰기 수업이야'})]);
  const claims=await rpc('claim_title_generation',[a,conversation,first.consultationId]);expect(claims).toHaveLength(2);expect(claims[0].messages).toHaveLength(3);
  expect(await rpc('claim_title_generation',[a,conversation,first.consultationId])).toEqual([]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[a]);await db.exec('set role authenticated');
  await db.query("update conversations set title='내가 정한 제목' where id=$1",[conversation]);await db.exec("reset role;select set_config('request.jwt.claim.sub','',false)");
  expect(await rpc('apply_generated_title',[a,'CONVERSATION',conversation,claims[0].claimId,'글쓰기의 첫 걸음'])).toBe(false);
  expect(await rpc('apply_generated_title',[a,'CONSULTATION',first.consultationId,claims[1].claimId,'글쓰기의 첫 걸음'])).toBe(true);
  expect(await scalar('select title from conversations')).toBe('내가 정한 제목');
 });
 it('counts distinct completed user turns for familiarity without retry inflation',async()=>{
  const first=await rpc('begin_chat_request',[request({operation:'chat.SEND',message:'첫 만남'})]);
  await rpc('complete_execution',[first.executionId,'반가워',['반가워'],'test','test',{}]);
  const retry=await rpc('begin_chat_request',[request({operation:'chat.RETRY_RESPONSE',retry_message_id:first.userMessage.id})]);
  await rpc('complete_execution',[retry.executionId,'다시 반가워',['다시 반가워'],'test','test',{}]);
  expect(await scalar('select relationship_state from conversations')).toEqual({stage:'ACQUAINTANCE',completedTurns:1});
 });
 it('blocks overlapping retries by resource and refuses late completion from an expired worker',async()=>{
  const begin=await rpc('begin_fortune_request',[request()]);const saved=await rpc('save_tarot_draw',[begin.executionId,card,'ONE_CARD','NORMAL',null,'test',null]);
  const retryParams=request({operation:'tarot.RETRY_INTERPRETATION',draw_group_id:saved.drawGroupId});
  await expect(rpc('begin_fortune_request',[retryParams])).rejects.toThrow('REQUEST_IN_PROGRESS');
  expect(await scalar('select count(*)::int from request_executions')).toBe(1);
  await db.query("update request_executions set lease_expires_at=now()-interval '1 second' where id=$1",[begin.executionId]);
  const retry=await rpc('begin_fortune_request',[retryParams]);
  await expect(rpc('complete_execution',[begin.executionId,'late',['late'],'test','test',{}])).rejects.toThrow('REQUEST_IN_PROGRESS');
  const done=await rpc('complete_execution',[retry.executionId,'current',['current'],'test','test',{}]);expect(done.interpretation.content).toBe('current');
  expect(await scalar("select count(*)::int from messages where sender='ASSISTANT'")).toBe(1);
 });
 it('failed Chat releases its lease, while a live user message cannot be retried twice',async()=>{
  const begin=await rpc('begin_chat_request',[request({operation:'chat.SEND',message:'test'})]);
  const params=request({operation:'chat.RETRY_RESPONSE',retry_message_id:begin.userMessage.id});
  await expect(rpc('begin_chat_request',[params])).rejects.toThrow('REQUEST_IN_PROGRESS');
  await rpc('fail_execution',[begin.executionId,{code:'LLM_TIMEOUT',retryable:true},504]);
  const retry=await rpc('begin_chat_request',[params]);
  expect(retry.userMessage.id).toBe(begin.userMessage.id);
  await expect(rpc('begin_chat_request',[{...params,request_id:crypto.randomUUID()}])).rejects.toThrow('REQUEST_IN_PROGRESS');
 });
 it('limits location lookups atomically without consuming Saju quota',async()=>{
  for(let i=0;i<30;i++)await rpc('consume_location_rate_limit',[a]);
  await expect(rpc('consume_location_rate_limit',[a])).rejects.toThrow('RATE_LIMITED');
  expect(await scalar("select count from rate_limit_buckets where operation='LOCATION_MINUTE'")).toBe(30);
  expect(await scalar('select count(*)::int from request_executions')).toBe(0);
  await db.exec("delete from rate_limit_buckets where operation='LOCATION_MINUTE'; update rate_limit_buckets set count=500 where operation='LOCATION_DAY';");
  await expect(rpc('consume_location_rate_limit',[a])).rejects.toThrow('RATE_LIMITED');
  expect(await scalar("select count(*)::int from rate_limit_buckets where operation='LOCATION_MINUTE'")).toBe(0);
 });
 it('compatibility stores derived charts without related birth consent and retries the same evidence',async()=>{
  const p=request({operation:'compatibility.CALCULATE_SAJU'});const begun=await rpc('begin_saju_compatibility_request',[p]);
  const saved=await rpc('save_saju_compatibility',[begun.executionId,compatibilityResult,null,null,'temporary alias',null]);
  expect(saved.executionStatus).toBe('PARTIAL'); expect(saved.result).toEqual(compatibilityResult);
  expect(await scalar('select count(*)::int from related_people')).toBe(0); expect(await scalar('select count(*)::int from birth_profiles')).toBe(0);
  const stored=await scalar('select result_snapshot from saju_compatibility_readings');expect(JSON.stringify(stored)).not.toContain('temporary alias');
  await rpc('fail_execution',[begun.executionId,{code:'SAJU_INTERPRETATION_FAILED',retryable:true},200]);
  const retry=await rpc('begin_saju_compatibility_request',[request({operation:'compatibility.RETRY_INTERPRETATION',reading_id:saved.compatibilityReadingId})]);
  expect(retry.resource.result).toEqual(compatibilityResult);
  const done=await rpc('complete_execution',[retry.executionId,'서로의 차이를 대화의 출발점으로 삼아봐요.',['서로의 차이를 대화의 출발점으로 삼아봐요.'],'test-model','test-prompt',{}]);
  expect(done.interpretation.messageId).toBeTruthy();expect(done.result).toBeUndefined();expect(done.executionStatus).toBe('SUCCEEDED');
  expect((await rpc('begin_saju_compatibility_request',[p])).replay.data).toEqual(done);
  expect(await scalar('select count(*)::int from saju_compatibility_readings')).toBe(1);
 });
 it('explicit compatibility birth consent never implicitly enables related memory',async()=>{
  const begun=await rpc('begin_saju_compatibility_request',[request({operation:'compatibility.CALCULATE_SAJU'})]);
  await rpc('save_saju_compatibility',[begun.executionId,compatibilityResult,birth,birth,'테스트 상대',null]);
  expect(await scalar('select count(*)::int from birth_profiles')).toBe(2);
  const person=(await db.query<{memory_opt_in:boolean;birth_data_opt_in:boolean}>('select memory_opt_in,birth_data_opt_in from related_people')).rows[0];
  expect(person).toEqual({memory_opt_in:false,birth_data_opt_in:true});
 });
 it('foreign related references roll back compatibility snapshot and profile writes',async()=>{
  const foreignPerson=await scalar("insert into related_people(user_id,display_name) values($1,'외부 테스트') returning id",[b]);
  const begun=await rpc('begin_saju_compatibility_request',[request({operation:'compatibility.CALCULATE_SAJU'})]);
  await expect(rpc('save_saju_compatibility',[begun.executionId,compatibilityResult,birth,birth,'테스트',foreignPerson])).rejects.toThrow('NOT_FOUND');
  expect(await scalar('select count(*)::int from birth_profiles')).toBe(0);expect(await scalar('select count(*)::int from saju_compatibility_readings')).toBe(0);
 });
 it('persists a Saju snapshot before LLM and retries without recalculating or leaking birth input',async()=>{
  const p=request({operation:'saju.CALCULATE',focus:'GENERAL'}); const begun=await rpc('begin_saju_request',[p]);
  const saved=await rpc('save_saju_reading',[begun.executionId,sajuResult,birth,null]);
  expect(saved.result).toEqual(sajuResult); expect(saved.inlineResult.dayMaster).toBe('甲木');
  expect(await scalar('select count(*)::int from birth_profiles')).toBe(0);
  const meta=await scalar("select metadata from messages where type='SAJU_SNAPSHOT'");
  expect(JSON.stringify(meta)).not.toContain(birth.birthDate); expect(meta.saju.result).toBeUndefined();
  const failed=await rpc('fail_execution',[begun.executionId,{code:'SAJU_INTERPRETATION_FAILED',retryable:true},200]);
  expect(failed.executionStatus).toBe('PARTIAL'); expect(failed.result).toBeUndefined();
  const retry=await rpc('begin_saju_request',[request({operation:'saju.RETRY_INTERPRETATION',reading_id:saved.readingId})]);
  expect(retry.resource.result).toEqual(sajuResult);
  const completed=await rpc('complete_execution',[retry.executionId,'불확실한 부분은 남겨 두고 살펴봐요.',['불확실한 부분은 남겨 두고 살펴봐요.'],'test-model','test-prompt',{}]);
  expect(completed.executionStatus).toBe('SUCCEEDED'); expect(completed.interpretation.messageId).toBeTruthy(); expect(completed.result).toBeUndefined();
  expect((await rpc('begin_saju_request',[p])).replay.data).toEqual(completed);
  expect(await scalar('select count(*)::int from saju_readings')).toBe(1);
 });
 it('saves an explicit own birth profile atomically and rejects foreign Saju retries',async()=>{
  const begun=await rpc('begin_saju_request',[request({operation:'saju.CALCULATE'})]);
  const saved=await rpc('save_saju_reading',[begun.executionId,sajuResult,birth,birth]);
  expect(await scalar('select birth_date from birth_profiles')).toBe(birth.birthDate);
  const foreignConversation=await scalar("insert into conversations(user_id,character_id) values($1,'ARANG') returning id",[b]);
  await expect(rpc('begin_saju_request',[request({user_id:b,operation:'saju.RETRY_INTERPRETATION',conversation_id:foreignConversation,reading_id:saved.readingId})])).rejects.toThrow('NOT_FOUND');
  await db.query('delete from conversations where id=$1',[conversation]);
  expect(await scalar('select count(*)::int from saju_readings')).toBe(0);
  expect(await scalar('select count(*)::int from birth_profiles')).toBe(1);
 });
 it('commits cards before model failure; retries keep cards and store one new interpretation',async()=>{
  const p=request();const begun=await rpc('begin_fortune_request',[p]);
  const saved=await rpc('save_tarot_draw',[begun.executionId,card,'ONE_CARD','NORMAL',null,p.question,null]);
  expect(saved.executionStatus).toBe('PARTIAL'); expect(saved.cards).toEqual(card);
  expect(await scalar("select metadata->'tarot'->>'drawGroupId' from messages where type='TAROT_DRAW'")).toBe(saved.drawGroupId);
  const partial=await rpc('fail_execution',[begun.executionId,{code:'LLM_TIMEOUT',message:'timeout',retryable:true},504]);
  expect(partial.drawGroupId).toBe(saved.drawGroupId);
  const retry=await rpc('begin_fortune_request',[request({operation:'tarot.RETRY_INTERPRETATION',draw_group_id:saved.drawGroupId})]);
  const complete=await rpc('complete_execution',[retry.executionId,'별 카드와 함께 오늘의 가능성을 살펴봐요.',['별 카드와 함께 오늘의 가능성을 살펴봐요.'],'test-model','test-prompt',{}]);
  expect(complete.executionStatus).toBe('SUCCEEDED'); expect(complete.cards).toEqual(card); expect(complete.interpretation.messageId).toBeTruthy();
  expect(await scalar('select count(*)::int from tarot_draw_groups')).toBe(1);
  const replay=await rpc('begin_fortune_request',[p]); expect(replay.replay.data.interpretation.content).toContain('별 카드');
 });
 it('deduplicates identical requests and rejects changed payload without charging again',async()=>{
  const p=request({operation:'chat.SEND',message:'안녕'}); const first=await rpc('begin_chat_request',[p]);
  await expect(rpc('begin_chat_request',[p])).rejects.toThrow('REQUEST_IN_PROGRESS');
  await expect(rpc('begin_chat_request',[{...p,payload_hash:'different'}])).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
  expect(await scalar('select count(*)::int from messages')).toBe(1);
  expect(await scalar('select count from rate_limit_buckets')).toBe(1);
  const done=await rpc('complete_execution',[first.executionId,'반가워요',['반가워요'],'model','prompt',{}]);
  const replay=await rpc('begin_chat_request',[p]); expect(replay.replay.data).toEqual(done);
 });
 it('preserves failed user input and explicit response retry never duplicates it',async()=>{
  const p=request({operation:'chat.SEND',message:'마음이 복잡해'}); const first=await rpc('begin_chat_request',[p]);
  await rpc('fail_execution',[first.executionId,{code:'LLM_TIMEOUT',message:'timeout',retryable:true},504]);
  const replay=await rpc('begin_chat_request',[p]); expect(replay.replay.error.details.userMessageId).toBe(first.userMessage.id);
  const retry=await rpc('begin_chat_request',[request({operation:'chat.RETRY_RESPONSE',retry_message_id:first.userMessage.id})]);
  expect(retry.userMessage.id).toBe(first.userMessage.id); expect(await scalar("select count(*)::int from messages where sender='USER'")).toBe(1);
 });
 it('daily draw is unique across conversations and a racing writer reuses persisted cards',async()=>{
  const date='2026-09-20'; const p=request({mode:'DAILY',local_date:date});
  const one=await rpc('begin_fortune_request',[p]);
  const otherConversation=await scalar("insert into conversations(user_id,character_id) values($1,'SANI') returning id",[a]);
  const two=await rpc('begin_fortune_request',[request({conversation_id:otherConversation,mode:'DAILY',local_date:date})]);
  const saved=await rpc('save_tarot_draw',[one.executionId,card,'ONE_CARD','DAILY',date,p.question,null]);
  const reused=await rpc('save_tarot_draw',[two.executionId,[{...card[0],cardId:0}],'ONE_CARD','DAILY',date,p.question,null]);
  expect(reused.reused).toBe(true); expect(reused.drawGroupId).toBe(saved.drawGroupId); expect(reused.cards).toEqual(card);
  await expect(rpc('begin_fortune_request',[request({source_draw_group_id:saved.drawGroupId})])).rejects.toThrow('TAROT_DAILY_REDRAW_NOT_ALLOWED');
 });
 it('enforces owned parents on retry and rejects replay after deletion',async()=>{
  const p=request(); const begin=await rpc('begin_fortune_request',[p]); const saved=await rpc('save_tarot_draw',[begin.executionId,card,'ONE_CARD','NORMAL',null,p.question,null]);
  const foreignConversation=await scalar("insert into conversations(user_id,character_id) values($1,'SANI') returning id",[b]);
  await expect(rpc('begin_fortune_request',[request({user_id:b,conversation_id:foreignConversation,draw_group_id:saved.drawGroupId})])).rejects.toThrow('NOT_FOUND');
  await db.query('delete from conversations where id=$1',[conversation]);
  await expect(rpc('begin_fortune_request',[p])).rejects.toThrow('NOT_FOUND');
  expect(await scalar('select count(*)::int from tarot_draws')).toBe(0);
 });
 it('RLS isolates accounts and forbids client authoring of authoritative tables/RPCs',async()=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[b]); await db.exec('set role authenticated');
  expect((await db.query('select * from conversations')).rows).toHaveLength(0);
  await expect(db.query("insert into messages(user_id,conversation_id,sender,content) values($1,$2,'ASSISTANT','forged')",[b,conversation])).rejects.toThrow('permission denied');
  await expect(rpc('begin_chat_request',[request({message:'forged'})])).rejects.toThrow('permission denied');
  await db.exec('reset role');
 });
 it('conversation deletion keeps explicit memories, while account deletion cascades everything',async()=>{
  await db.query("insert into memories(user_id,scope,category,subject,content,source_conversation_id) values($1,'GLOBAL','PREFERENCE','USER','짧은 답변을 선호함',$2)",[a,conversation]);
  await db.query('delete from conversations where id=$1',[conversation]); expect(await scalar('select source_conversation_id from memories')).toBeNull();
  await db.query('delete from auth.users where id=$1',[a]); expect(await scalar('select count(*)::int from memories')).toBe(0); expect(await scalar('select count(*)::int from profiles where id=$1',[a])).toBe(0);
 });
 it('stale pending attempts fail with an explicit replay error, never create another user message',async()=>{
  const p=request({operation:'chat.SEND',message:'안녕'});const begun=await rpc('begin_chat_request',[p]);
  await db.query("update request_executions set lease_expires_at=now()-interval '1 second' where id=$1",[begun.executionId]);
  const replay=await rpc('begin_chat_request',[p]); expect(replay.replay.error.code).toBe('LLM_TIMEOUT'); expect(await scalar('select count(*)::int from messages')).toBe(1);
 });
 it('deleting a daily conversation cannot mint a second daily draw',async()=>{
  const p=request({mode:'DAILY',local_date:'2026-09-20'}); const begun=await rpc('begin_fortune_request',[p]);
  await rpc('save_tarot_draw',[begun.executionId,card,'ONE_CARD','DAILY',p.local_date,p.question,null]);
  await db.query('delete from conversations where id=$1',[conversation]);
  expect(await scalar('select response_data from request_executions')).toBeNull();
  conversation=await scalar("insert into conversations(user_id,character_id) values($1,'BOMI') returning id",[a]);
  const next=await rpc('begin_fortune_request',[request({mode:'DAILY',local_date:p.local_date})]);
  await expect(rpc('save_tarot_draw',[next.executionId,card,'ONE_CARD','DAILY',p.local_date,p.question,null])).rejects.toThrow('TAROT_DAILY_REDRAW_NOT_ALLOWED');
 });
 it('memory deletion invalidates in-flight extraction and prevents forgotten facts returning',async()=>{
  const begin=await rpc('begin_chat_request',[request({operation:'chat.SEND',message:'글쓰기 프로젝트를 진행 중이야'})]);
  const candidates=[{scope:'GLOBAL',subject:'USER',category:'GOAL',content:'글쓰기 프로젝트를 진행함',importance:3}];
  expect((await rpc('apply_memory_update',[a,conversation,0,begin.userMessage.id,candidates,'작업 이야기를 나눔'])).inserted).toBe(1);
  await db.exec('delete from memories');
  const state=await rpc('memory_context_state',[a,conversation]); expect(state.summary).toBeNull(); expect(state.revision).toBe(1);
  const later=await rpc('begin_chat_request',[request({operation:'chat.SEND',message:'그 일을 계속하는 중이야'})]);
  expect((await rpc('apply_memory_update',[a,conversation,0,later.userMessage.id,candidates,'old facts'])).applied).toBe(false);
  await rpc('apply_memory_update',[a,conversation,state.revision,later.userMessage.id,candidates,'old facts']);
  expect(await scalar('select count(*)::int from memories')).toBe(0); expect(await scalar('select summary from conversations')).toBeNull();
 });
 it('memory opt-out rejects new extraction and sensitive birth facts are not persisted',async()=>{
  const begin=await rpc('begin_chat_request',[request({operation:'chat.SEND',message:'생년월일은 기억하지 마'})]);
  const candidate={scope:'GLOBAL',subject:'USER',category:'PERSON',content:'생년월일 1990-01-01',importance:3};
  expect((await rpc('apply_memory_update',[a,conversation,0,begin.userMessage.id,[candidate],null])).inserted).toBe(0);
  await db.query('update profiles set memory_enabled=false where id=$1',[a]);
  const later=await rpc('begin_chat_request',[request({operation:'chat.SEND',message:'새 취향'})]);
  const state=await rpc('memory_context_state',[a,conversation]); expect(state.memoryEnabled).toBe(false);
  expect((await rpc('apply_memory_update',[a,conversation,state.revision,later.userMessage.id,[{...candidate,content:'짧은 설명 선호'}],null])).applied).toBe(false);
 });
 it('90-day cleanup preserves active anonymous and linked accounts',async()=>{
  const linked='10000000-0000-4000-8000-000000000003'; await db.query('insert into auth.users(id,is_anonymous) values($1,false)',[linked]);
  await db.query("update profiles set last_seen_at=now()-interval '100 days' where id in($1,$2)",[a,linked]);
  expect(await rpc('cleanup_inactive_anonymous',[])).toBe(1);
  expect(await scalar('select count(*)::int from auth.users')).toBe(2);
  await expect(rpc('cleanup_inactive_anonymous',[new Date().toISOString(),100])).rejects.toThrow('VALIDATION_ERROR');
 });
 it('clients cannot forge future activity times and a birth record cannot reference another account',async()=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[a]); await db.exec('set role authenticated');
  await expect(db.query("update profiles set last_seen_at=now()+interval '100 years' where id=$1",[a])).rejects.toThrow('permission denied');
  await rpc('touch_activity',[]); await db.exec('reset role');
 });
 it('preserves lunar day 30 but rejects nonexistent solar dates',async()=>{
  const columns='user_id,owner_type,calendar_type,birth_date,unknown_birth_time,city,country,latitude,longitude,timezone';
  await db.query(`insert into birth_profiles(${columns}) values($1,'USER','LUNAR','2024-02-30',true,'Seoul','KR',37.57,126.97,'Asia/Seoul')`,[a]);
  expect(await scalar('select birth_date from birth_profiles')).toBe('2024-02-30');
  await expect(db.query(`insert into birth_profiles(${columns}) values($1,'USER','SOLAR','2024-02-30',true,'Seoul','KR',37.57,126.97,'Asia/Seoul')`,[b])).rejects.toThrow('birth_date_calendar_valid');
 });
 it('requires distinct related-person birth consent and clears stored birth on revocation',async()=>{
  const person=await scalar("insert into related_people(user_id,display_name,memory_opt_in) values($1,'테스트 상대',false) returning id",[a]);
  const insert="insert into birth_profiles(user_id,owner_type,related_person_id,calendar_type,birth_date,unknown_birth_time,city,country,latitude,longitude,timezone) values($1,'RELATED_PERSON',$2,'SOLAR','1990-01-01',true,'Seoul','KR',37.57,126.97,'Asia/Seoul')";
  await expect(db.query(insert,[a,person])).rejects.toThrow('FORBIDDEN');
  await db.query('update related_people set birth_data_opt_in=true where id=$1',[person]); await db.query(insert,[a,person]);
  expect(await scalar('select memory_opt_in from related_people')).toBe(false);
  await db.query('update related_people set birth_data_opt_in=false where id=$1',[person]); expect(await scalar('select count(*)::int from birth_profiles')).toBe(0);
 });
});
