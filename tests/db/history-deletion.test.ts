import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const owner='40000000-0000-4000-8000-000000000001', other='40000000-0000-4000-8000-000000000002';
let db:PGlite, conversation:string, siblingConversation:string, consultation:string, siblingConsultation:string, ownMemory:string, keptMemory:string, unrelatedMemory:string, foreignMemory:string;
async function scalar<T=unknown>(sql:string, values:unknown[]=[]):Promise<T> {
  const result=await db.query<Record<string,T>>(sql,values); return Object.values(result.rows[0]!)[0]!;
}
async function authenticated(id=owner) { await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec('set role authenticated'); }
async function deleteRecord(kind:string,id:string,memories:string[]=[]) { return scalar<{deleted:boolean;memoriesDeleted:number}>('select delete_history_with_memories($1,$2,$3)',[kind,id,memories]); }
beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users(id uuid primary key,is_anonymous boolean default true,created_at timestamptz default now());
    create table auth.identities(user_id uuid references auth.users(id) on delete cascade,provider text);
    create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    grant usage on schema public,auth to anon,authenticated,service_role;`);
  for(const file of readdirSync(new URL('../../supabase/migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(new URL(`../../supabase/migrations/${file}`,import.meta.url),'utf8'));
  }
},30_000);
beforeEach(async()=>{
  await db.exec('reset role; truncate auth.users cascade;');
  await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);
  const makeConversation=(id:string)=>scalar<string>("insert into conversations(user_id,character_id) values($1,'BOMI') returning id",[id]);
  conversation=await makeConversation(owner); siblingConversation=await makeConversation(owner); const foreignConversation=await makeConversation(other);
  const makeConsultation=()=>scalar<string>("insert into consultations(user_id,conversation_id,character_id,fortune_type,question) values($1,$2,'BOMI','CHAT','합성 질문') returning id",[owner,conversation]);
  consultation=await makeConsultation(); siblingConsultation=await makeConsultation();
  await db.query("insert into messages(user_id,conversation_id,consultation_id,sender,content) values($1,$2,$3,'USER','삭제할 원문'),($1,$2,$4,'USER','남길 다른 상담 원문')",[owner,conversation,consultation,siblingConsultation]);
  const makeMemory=(id:string,source:string,text:string)=>scalar<string>("insert into memories(user_id,scope,category,subject,content,source_conversation_id) values($1,'GLOBAL','PREFERENCE','USER',$2,$3) returning id",[id,text,source]);
  ownMemory=await makeMemory(owner,conversation,'선택한 기억'); keptMemory=await makeMemory(owner,conversation,'선택하지 않은 기억');
  unrelatedMemory=await makeMemory(owner,siblingConversation,'다른 대화의 기억'); foreignMemory=await makeMemory(other,foreignConversation,'다른 사용자의 기억');
  await authenticated();
});
afterAll(async()=>{await db?.close();});

describe('owner-scoped atomic history and explicit memory selection',()=>{
  it('previews the known conversation scope for either record without claiming consultation provenance',async()=>{
    for(const kind of ['CONVERSATION','CONSULTATION']) {
      const id=kind==='CONVERSATION'?conversation:consultation;
      const rows=await db.query<{id:string}>('select id from history_deletion_memories($1,$2)',[kind,id]);
      expect(rows.rows.map(row=>row.id).sort()).toEqual([ownMemory,keptMemory].sort());
    }
    await db.exec('reset role'); await authenticated(other);
    expect((await db.query('select id from history_deletion_memories($1,$2)',['CONVERSATION',conversation])).rows).toEqual([]);
  });
  it('defaults to record-only deletion and preserves independent memories as orphans',async()=>{
    expect(await deleteRecord('CONVERSATION',conversation)).toEqual({deleted:true,memoriesDeleted:0});
    expect(await scalar('select count(*)::int from messages')).toBe(0);
    expect(await scalar('select count(*)::int from memories')).toBe(3);
    expect(await scalar('select source_conversation_id from memories where id=$1',[ownMemory])).toBeNull();
    expect(await scalar('select source_conversation_id from memories where id=$1',[unrelatedMemory])).toBe(siblingConversation);
  });
  it('deletes only explicit same-conversation memories with a consultation and preserves siblings',async()=>{
    expect(await deleteRecord('CONSULTATION',consultation,[ownMemory,ownMemory])).toEqual({deleted:true,memoriesDeleted:1});
    expect(await scalar('select count(*)::int from consultations where id=$1',[consultation])).toBe(0);
    expect(await scalar('select count(*)::int from consultations where id=$1',[siblingConsultation])).toBe(1);
    expect(await scalar('select content from messages where consultation_id=$1',[siblingConsultation])).toBe('남길 다른 상담 원문');
    expect(await scalar('select count(*)::int from memories where id=$1',[keptMemory])).toBe(1);
    expect(await scalar('select count(*)::int from memories where id=$1',[unrelatedMemory])).toBe(1);
    expect(await deleteRecord('CONSULTATION',consultation,[keptMemory])).toEqual({deleted:false,memoriesDeleted:0});
    expect(await scalar('select count(*)::int from memories where id=$1',[keptMemory])).toBe(1);
  });
  it.each(['FOREIGN','OTHER_CONVERSATION','MISSING'])('rejects a %s selection atomically before deleting either selected memory or history',async(type)=>{
    const invalid=type==='FOREIGN'?foreignMemory:type==='OTHER_CONVERSATION'?unrelatedMemory:'40000000-0000-4000-8000-000000000099';
    await expect(deleteRecord('CONVERSATION',conversation,[ownMemory,invalid])).rejects.toThrow('MEMORY_SELECTION_CHANGED');
    expect(await scalar('select count(*)::int from conversations where id=$1',[conversation])).toBe(1);
    expect(await scalar('select count(*)::int from memories where id=$1',[ownMemory])).toBe(1);
    expect(await scalar('select count(*)::int from messages where conversation_id=$1',[conversation])).toBe(2);
  });
  it('foreign or missing history never grants deletion access to a supplied owned memory',async()=>{
    await db.exec('reset role'); await authenticated(other);
    expect(await deleteRecord('CONVERSATION',conversation,[foreignMemory])).toEqual({deleted:false,memoriesDeleted:0});
    expect(await scalar('select count(*)::int from memories where id=$1',[foreignMemory])).toBe(1);
  });
  it('rejects anonymous database role execution and invalid kind/selection size',async()=>{
    await expect(deleteRecord('UNKNOWN',conversation)).rejects.toThrow('VALIDATION_ERROR');
    await expect(deleteRecord('CONVERSATION',conversation,Array(1001).fill(ownMemory))).rejects.toThrow('VALIDATION_ERROR');
    await db.exec('reset role; set role anon');
    await expect(deleteRecord('CONVERSATION',conversation)).rejects.toThrow('permission denied');
  });
});
