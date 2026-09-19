-- Operational lookup ceilings; no fortune quota is consumed by a location lookup.
create function public.consume_location_rate_limit(p_user_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare v_bucket timestamptz; v_operation text; v_limit int; n int;
begin
 if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'NOT_FOUND'; end if;
 for v_operation,v_bucket,v_limit in select 'LOCATION_MINUTE',date_trunc('minute',now()),30 union all select 'LOCATION_DAY',date_trunc('day',now() at time zone 'UTC') at time zone 'UTC',500 loop
  insert into rate_limit_buckets(user_id,subject_key,operation,bucket_start,count) values(p_user_id,p_user_id::text,v_operation,v_bucket,1)
  on conflict(subject_key,operation,bucket_start) do update set count=rate_limit_buckets.count+1,updated_at=now() returning count into n;
  if n>v_limit then raise exception 'RATE_LIMITED' using detail=jsonb_build_object('retryAfterSeconds',greatest(1,ceil(extract(epoch from (v_bucket+case when v_operation='LOCATION_MINUTE' then interval '1 minute' else interval '1 day' end-now())))))::text; end if;
 end loop;
 update profiles set last_seen_at=now() where id=p_user_id;
end $$;

create function public.guard_execution_resource(p_execution_id uuid,p_resource_type text,p_resource_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare e request_executions;
begin
 select * into e from request_executions where id=p_execution_id;
 if not found then raise exception 'NOT_FOUND'; end if;
 perform pg_advisory_xact_lock(hashtextextended(e.user_id::text||p_resource_type||p_resource_id::text,17));
 if exists(select 1 from request_executions other where other.user_id=e.user_id and other.id<>e.id
   and other.status in ('PENDING','PARTIAL') and other.lease_expires_at>now()
   and ((p_resource_type='CHAT' and other.user_message_id=p_resource_id)
    or (other.resource_type=p_resource_type and other.resource_id=p_resource_id))) then raise exception 'REQUEST_IN_PROGRESS'; end if;
end $$;


create or replace function public.begin_chat_request(p_params jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare claimed jsonb; e uuid; v_user uuid=(p_params->>'user_id')::uuid; v_conversation uuid=(p_params->>'conversation_id')::uuid; v_consultation uuid; c conversations; m messages; lim int;
begin
 select * into c from conversations where id=v_conversation and user_id=v_user;
 if not found then raise exception 'NOT_FOUND'; end if;
 lim=case when (select is_anonymous from auth.users where id=v_user) then 50 else 200 end;
 claimed=claim_execution(p_params,'CHAT',lim); if claimed ? 'replay' then return claimed; end if; e=(claimed->>'executionId')::uuid;
 if p_params->>'retry_message_id' is not null then
  select * into m from messages where id=(p_params->>'retry_message_id')::uuid and user_id=v_user and conversation_id=v_conversation and sender='USER';
  if not found then raise exception 'NOT_FOUND'; end if;
  v_consultation=m.consultation_id;
 else
  v_consultation=resolve_consultation(v_user,v_conversation,(p_params->>'consultation_id')::uuid,'CHAT',p_params->>'message',false);
  insert into messages(user_id,conversation_id,consultation_id,sender,content,request_id) values(v_user,v_conversation,v_consultation,'USER',p_params->>'message',(p_params->>'request_id')::uuid) returning * into m;
 end if;
 perform guard_execution_resource(e,'CHAT',m.id);
 update request_executions set conversation_id=v_conversation,consultation_id=v_consultation,user_message_id=m.id where id=e;
 update conversations set last_message_at=now() where id=v_conversation;
 return claimed||jsonb_build_object('conversationId',v_conversation,'characterId',c.character_id,'consultationId',v_consultation,'userMessage',jsonb_build_object('id',m.id,'content',m.content,'createdAt',m.created_at));
end $$;

create or replace function public.begin_fortune_request(p_params jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare claimed jsonb; e uuid; v_user uuid=(p_params->>'user_id')::uuid; v_conversation uuid=(p_params->>'conversation_id')::uuid; v_consultation uuid; c conversations; g tarot_draw_groups; snap jsonb; category text;
begin
 select * into c from conversations where id=v_conversation and user_id=v_user;
 if not found then raise exception 'NOT_FOUND'; end if;
 category=case when p_params->>'operation' like '%SAJU%' then 'SAJU' else 'TAROT' end;
 claimed=claim_execution(p_params,category,case when category='SAJU' then 5 else 10 end); if claimed ? 'replay' then return claimed; end if; e=(claimed->>'executionId')::uuid;
 if p_params->>'draw_group_id' is not null or p_params->>'source_draw_group_id' is not null then
  select d.* into g from tarot_draw_groups d join consultations s on s.id=d.consultation_id where d.id=coalesce(p_params->>'draw_group_id',p_params->>'source_draw_group_id')::uuid and d.user_id=v_user and s.conversation_id=v_conversation;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_params->>'consultation_id' is not null and g.consultation_id<>(p_params->>'consultation_id')::uuid then raise exception 'NOT_FOUND'; end if;
  v_consultation=g.consultation_id;
  if p_params->>'source_draw_group_id' is not null and g.mode='DAILY' then raise exception 'TAROT_DAILY_REDRAW_NOT_ALLOWED'; end if;
  if p_params->>'draw_group_id' is not null then perform guard_execution_resource(e,'TAROT',g.id); snap=tarot_snapshot(g.id,v_user); end if;
 elsif p_params->>'mode'='DAILY' then
  perform pg_advisory_xact_lock(hashtextextended(v_user::text||(p_params->>'local_date'),1));
  select * into g from tarot_draw_groups where user_id=v_user and mode='DAILY' and local_date=(p_params->>'local_date')::date;
  if found then snap=tarot_snapshot(g.id,v_user); v_consultation=g.consultation_id; end if;
 end if;
 if v_consultation is null then v_consultation=resolve_consultation(v_user,v_conversation,(p_params->>'consultation_id')::uuid,case when p_params->>'operation' like 'compatibility%' then 'COMPATIBILITY_TAROT' else 'TAROT' end,p_params->>'question',true); end if;
 update request_executions set conversation_id=v_conversation,consultation_id=v_consultation,resource_type=case when snap is not null then 'TAROT' end,resource_id=case when snap is not null then g.id end where id=e;
 return claimed||jsonb_build_object('conversationId',v_conversation,'characterId',c.character_id,'consultationId',v_consultation,'resource',snap,'source',case when p_params->>'source_draw_group_id' is not null then tarot_snapshot(g.id,v_user) end);
end $$;

create or replace function public.begin_saju_request(p_params jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare claimed jsonb; e uuid; v_user uuid=(p_params->>'user_id')::uuid; v_conversation uuid=(p_params->>'conversation_id')::uuid; v_consultation uuid; c conversations; r saju_readings; snap jsonb;
begin
 select * into c from conversations where id=v_conversation and user_id=v_user;
 if not found then raise exception 'NOT_FOUND'; end if;
 claimed=claim_execution(p_params,'SAJU',5); if claimed ? 'replay' then return claimed; end if; e=(claimed->>'executionId')::uuid;
 if p_params->>'reading_id' is not null then
  select d.* into r from saju_readings d join consultations s on s.id=d.consultation_id where d.id=(p_params->>'reading_id')::uuid and d.user_id=v_user and s.conversation_id=v_conversation;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_params->>'consultation_id' is not null and r.consultation_id<>(p_params->>'consultation_id')::uuid then raise exception 'NOT_FOUND'; end if;
  perform guard_execution_resource(e,'SAJU',r.id);
  v_consultation=r.consultation_id; snap=saju_snapshot(r.id,v_user);
 else
  v_consultation=resolve_consultation(v_user,v_conversation,(p_params->>'consultation_id')::uuid,'SAJU',coalesce(p_params->>'focus','GENERAL'),true);
 end if;
 update request_executions set conversation_id=v_conversation,consultation_id=v_consultation,resource_type=case when snap is not null then 'SAJU' end,resource_id=case when snap is not null then r.id end where id=e;
 return claimed||jsonb_build_object('conversationId',v_conversation,'characterId',c.character_id,'consultationId',v_consultation,'resource',snap);
end $$;

create or replace function public.begin_saju_compatibility_request(p_params jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare claimed jsonb; e uuid; v_user uuid=(p_params->>'user_id')::uuid; v_conversation uuid=(p_params->>'conversation_id')::uuid; v_consultation uuid; c conversations; r saju_compatibility_readings; snap jsonb;
begin
 select * into c from conversations where id=v_conversation and user_id=v_user;
 if not found then raise exception 'NOT_FOUND'; end if;
 claimed=claim_execution(p_params,'SAJU',5); if claimed ? 'replay' then return claimed; end if; e=(claimed->>'executionId')::uuid;
 if p_params->>'reading_id' is not null then
  select d.* into r from saju_compatibility_readings d join consultations s on s.id=d.consultation_id where d.id=(p_params->>'reading_id')::uuid and d.user_id=v_user and s.conversation_id=v_conversation;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_params->>'consultation_id' is not null and r.consultation_id<>(p_params->>'consultation_id')::uuid then raise exception 'NOT_FOUND'; end if;
  perform guard_execution_resource(e,'COMPATIBILITY_SAJU',r.id);
  v_consultation=r.consultation_id; snap=saju_compatibility_snapshot(r.id,v_user);
 else
  v_consultation=resolve_consultation(v_user,v_conversation,(p_params->>'consultation_id')::uuid,'COMPATIBILITY_SAJU','관계 흐름 상담',true);
 end if;
 update request_executions set conversation_id=v_conversation,consultation_id=v_consultation,resource_type=case when snap is not null then 'COMPATIBILITY_SAJU' end,resource_id=case when snap is not null then r.id end where id=e;
 return claimed||jsonb_build_object('conversationId',v_conversation,'characterId',c.character_id,'consultationId',v_consultation,'resource',snap);
end $$;

create or replace function public.complete_execution(p_execution_id uuid,p_assistant_content text,p_segments jsonb,p_model_id text,p_prompt_version text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e request_executions; m messages; result jsonb=p_data; char_id public.character_id; meta jsonb;
begin
 select * into e from request_executions where id=p_execution_id for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if e.status='SUCCEEDED' then return e.response_data; end if;
 if p_assistant_content is not null and e.lease_expires_at<=now() then raise exception 'REQUEST_IN_PROGRESS'; end if;
 if e.status='FAILED' then raise exception 'REQUEST_IN_PROGRESS'; end if;
 if not exists(select 1 from conversations where id=e.conversation_id and user_id=e.user_id) then raise exception 'NOT_FOUND'; end if;
 select character_id into char_id from conversations where id=e.conversation_id;
 if p_assistant_content is not null then
  meta=jsonb_build_object('segments',coalesce(p_segments,'[]'));
  if e.resource_type is null then meta=meta||jsonb_build_object('recommendation',p_data->'recommendation'); end if;
  if e.resource_type='TAROT' then meta=meta||jsonb_build_object('tarot',tarot_snapshot(e.resource_id,e.user_id)); elsif e.resource_type='COMPATIBILITY_SAJU' then meta=meta||jsonb_build_object('compatibility',saju_compatibility_snapshot(e.resource_id,e.user_id)-'result'); elsif e.resource_type='SAJU' then meta=meta||jsonb_build_object('saju',saju_snapshot(e.resource_id,e.user_id)-'result'); end if;
  insert into messages(user_id,conversation_id,consultation_id,sender,type,content,request_id,reply_to_message_id,metadata,model_id,prompt_version)
  values(e.user_id,e.conversation_id,e.consultation_id,'ASSISTANT',case when e.resource_type='TAROT' then 'TAROT' when e.resource_type='SAJU' then 'SAJU' when e.resource_type='COMPATIBILITY_SAJU' then 'COMPATIBILITY_SAJU' else 'TEXT' end,p_assistant_content,e.request_id,e.user_message_id,meta,p_model_id,p_prompt_version) returning * into m;
  if e.resource_type in ('TAROT','SAJU','COMPATIBILITY_SAJU') then
   result=case when e.resource_type='COMPATIBILITY_SAJU' then saju_compatibility_snapshot(e.resource_id,e.user_id)-'result' when e.resource_type='SAJU' then saju_snapshot(e.resource_id,e.user_id)-'result' else tarot_snapshot(e.resource_id,e.user_id) end;
   update messages set metadata=metadata||jsonb_build_object(case when e.resource_type='COMPATIBILITY_SAJU' then 'compatibility' when e.resource_type='SAJU' then 'saju' else 'tarot' end,result) where id=m.id;
   update consultations set result_summary=left(p_assistant_content,300) where id=e.consultation_id;
  else
   result=coalesce(p_data,'{}')||jsonb_build_object('executionStatus','SUCCEEDED','conversationId',e.conversation_id,'consultationId',e.consultation_id,'userMessage',jsonb_build_object('id',e.user_message_id,'createdAt',(select created_at from messages where id=e.user_message_id)),'assistantMessage',jsonb_build_object('id',m.id,'characterId',char_id,'content',m.content,'segments',p_segments));
  end if;
 end if;
 update request_executions set lease_expires_at=now(),status=coalesce(result->>'executionStatus','SUCCEEDED'),response_data=result,http_status=200,updated_at=now() where id=e.id;
 update conversations set last_message_at=now() where id=e.conversation_id;
 update consultations set last_activity_at=now() where id=e.consultation_id;
 return result;
end $$;

create or replace function public.fail_execution(p_execution_id uuid,p_error jsonb,p_http_status int) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e request_executions; result jsonb;
begin
 select * into e from request_executions where id=p_execution_id for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if e.status='SUCCEEDED' then return e.response_data; end if;
 if e.resource_type in ('TAROT','SAJU','COMPATIBILITY_SAJU') then
  result=case when e.resource_type='COMPATIBILITY_SAJU' then saju_compatibility_snapshot(e.resource_id,e.user_id)-'result' when e.resource_type='SAJU' then saju_snapshot(e.resource_id,e.user_id)-'result' else tarot_snapshot(e.resource_id,e.user_id) end;
  if result->>'executionStatus'='PARTIAL' then result=result||jsonb_build_object('partialError',p_error); end if;
  update request_executions set lease_expires_at=now(),status=result->>'executionStatus',response_data=result,error=p_error,error_code=p_error->>'code',http_status=200,updated_at=now() where id=e.id;
  return result;
 end if;
 update request_executions set lease_expires_at=now(),status='FAILED',error=p_error||jsonb_build_object('details',coalesce(p_error->'details','{}')||jsonb_build_object('userMessageId',e.user_message_id)),error_code=p_error->>'code',http_status=p_http_status,updated_at=now() where id=e.id;
 return null;
end $$;

do $$declare f record; begin
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in ('consume_location_rate_limit','guard_execution_resource','begin_chat_request','begin_fortune_request','begin_saju_request','begin_saju_compatibility_request','complete_execution','fail_execution') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
