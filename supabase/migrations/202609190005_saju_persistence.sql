-- M8 deterministic snapshots commit before interpretation. Birth data stays in owned rows.
alter table public.saju_readings add column result_snapshot jsonb not null;

create function public.saju_snapshot(p_reading_id uuid,p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r saju_readings; c consultations; answer messages; result jsonb; stem text;
begin
 select * into r from saju_readings where id=p_reading_id and user_id=p_user_id;
 if not found then raise exception 'NOT_FOUND'; end if;
 select * into c from consultations where id=r.consultation_id and user_id=p_user_id;
 select * into answer from messages where user_id=p_user_id and sender='ASSISTANT' and metadata->'saju'->>'readingId'=r.id::text order by created_at desc,id desc limit 1;
 stem=r.pillars->'day'->>'heavenlyStem';
 result=jsonb_build_object('executionStatus',case when answer.id is null then 'PARTIAL' else 'SUCCEEDED' end,
  'readingId',r.id,'conversationId',c.conversation_id,'consultationId',r.consultation_id,
  'engineVersion',r.engine_version,'ruleVersion',r.rule_version,'conventionVersion',r.convention_version,
  'uncertaintyFlags',r.uncertainty_flags,'result',r.result_snapshot,
  'inlineResult',jsonb_build_object('dayMaster',stem||case when stem in ('甲','乙') then '木' when stem in ('丙','丁') then '火' when stem in ('戊','己') then '土' when stem in ('庚','辛') then '金' when stem in ('壬','癸') then '水' end,
   'pillars',r.pillars,'elements',r.elements,'currentFlow',jsonb_build_object('daewoon',r.daewoon,'sewoon',r.sewoon,'monthlyFortune',r.monthly_fortune)),
  'interpretation',case when answer.id is null then null else jsonb_build_object('messageId',answer.id,'content',answer.content,'segments',coalesce(answer.metadata->'segments','[]')) end);
 if answer.id is null then result=result||jsonb_build_object('partialError',jsonb_build_object('code','SAJU_INTERPRETATION_FAILED','message','사주 원국은 저장됐어요. 해석을 다시 요청할 수 있어요.','retryable',true)); end if;
 return result;
end $$;

create function public.begin_saju_request(p_params jsonb) returns jsonb
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
  v_consultation=r.consultation_id; snap=saju_snapshot(r.id,v_user);
 else
  v_consultation=resolve_consultation(v_user,v_conversation,(p_params->>'consultation_id')::uuid,'SAJU',coalesce(p_params->>'focus','GENERAL'),true);
 end if;
 update request_executions set conversation_id=v_conversation,consultation_id=v_consultation,resource_type=case when snap is not null then 'SAJU' end,resource_id=case when snap is not null then r.id end where id=e;
 return claimed||jsonb_build_object('conversationId',v_conversation,'characterId',c.character_id,'consultationId',v_consultation,'resource',snap);
end $$;

create function public.save_saju_reading(p_execution_id uuid,p_result jsonb,p_birth_profile_snapshot jsonb,p_profile_input jsonb default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e request_executions; r saju_readings; snap jsonb; b jsonb=p_profile_input;
begin
 select * into e from request_executions where id=p_execution_id for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if e.resource_type='SAJU' then return saju_snapshot(e.resource_id,e.user_id); end if;
 if e.status<>'PENDING' or e.lease_expires_at<now() then raise exception 'REQUEST_IN_PROGRESS'; end if;
 if not exists(select 1 from consultations where id=e.consultation_id and user_id=e.user_id and fortune_type='SAJU') then raise exception 'NOT_FOUND'; end if;
 if p_result->>'fullCalculationReady'<>'true' or p_result->>'ruleVersion'<>'JumZipSajuRules-v1' or p_result->>'conventionVersion'<>'JumZipSajuConvention-v1' or p_result->>'engineVersion'<>'manseryeok-2.0.0' or jsonb_typeof(p_result->'pillars')<>'object' then raise exception 'VALIDATION_ERROR'; end if;
 if b is not null then
  insert into birth_profiles(user_id,owner_type,calendar_type,leap_month,birth_date,birth_time,unknown_birth_time,city,country,latitude,longitude,timezone,location_provider,location_resolved_at,gender)
  values(e.user_id,'USER',b->>'calendarType',coalesce((b->>'leapMonth')::boolean,false),b->>'birthDate',(b->>'birthTime')::time,(b->>'birthTimeUnknown')::boolean,b->'location'->>'name',coalesce(b->'location'->>'country',''),(b->'location'->>'latitude')::numeric,(b->'location'->>'longitude')::numeric,b->'location'->>'timezone','open-meteo',now(),b->>'gender')
  on conflict(user_id) where owner_type='USER' do update set calendar_type=excluded.calendar_type,leap_month=excluded.leap_month,birth_date=excluded.birth_date,birth_time=excluded.birth_time,unknown_birth_time=excluded.unknown_birth_time,city=excluded.city,country=excluded.country,latitude=excluded.latitude,longitude=excluded.longitude,timezone=excluded.timezone,location_provider=excluded.location_provider,location_resolved_at=excluded.location_resolved_at,gender=excluded.gender,updated_at=now();
 end if;
 insert into saju_readings(user_id,consultation_id,birth_profile_snapshot,convention_version,engine_version,rule_version,pillars,elements,ten_gods,hidden_stems,relations,gongmang,strength,gyeokguk,yongsin,heesin,twelve_stages,shinsal,daewoon,sewoon,monthly_fortune,uncertainty_flags,result_snapshot)
 values(e.user_id,e.consultation_id,p_birth_profile_snapshot,p_result->>'conventionVersion',p_result->>'engineVersion',p_result->>'ruleVersion',p_result->'pillars',p_result->'elements',p_result->'tenGods',p_result->'hiddenStems',p_result->'relations',p_result->'gongmang',p_result->'strength',p_result->'gyeokguk',p_result->'yongsin',p_result->'heesin',p_result->'twelveStages',p_result->'shinsal',p_result->'daewoon',p_result->'sewoon',p_result->'monthlyFortune',coalesce(p_result->'uncertaintyFlags','[]'),p_result) returning * into r;
 snap=saju_snapshot(r.id,e.user_id);
 update request_executions set resource_type='SAJU',resource_id=r.id,status='PARTIAL',response_data=snap-'result',http_status=200,updated_at=now() where id=e.id;
 insert into messages(user_id,conversation_id,consultation_id,sender,type,content,request_id,metadata) values(e.user_id,e.conversation_id,e.consultation_id,'SYSTEM','SAJU_SNAPSHOT','',e.request_id,jsonb_build_object('saju',snap-'result'));
 return snap;
end $$;


create or replace function public.claim_execution(p_params jsonb,p_category text,p_limit int) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e request_executions; v_user uuid=(p_params->>'user_id')::uuid; v_request uuid=(p_params->>'request_id')::uuid; v_op text=p_params->>'operation'; n int; v_bucket timestamptz=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'; r jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(v_user::text||v_op||v_request::text,0));
 select * into e from request_executions where user_id=v_user and operation=v_op and request_id=v_request for update;
 if found then
  if e.payload_hash<>p_params->>'payload_hash' then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
  if e.status='PENDING' and e.lease_expires_at>now() then raise exception 'REQUEST_IN_PROGRESS'; end if;
  if e.resource_type in ('TAROT','SAJU') then
   r=case when e.resource_type='SAJU' then saju_snapshot(e.resource_id,v_user)-'result' else tarot_snapshot(e.resource_id,v_user) end;
   return jsonb_build_object('executionId',e.id,'replay',jsonb_build_object('data',r,'httpStatus',200));
  end if;
  if e.conversation_id is not null and not exists(select 1 from conversations where id=e.conversation_id and user_id=v_user) then raise exception 'NOT_FOUND'; end if;
  if e.status in ('PARTIAL','SUCCEEDED') then return jsonb_build_object('executionId',e.id,'replay',jsonb_build_object('data',e.response_data,'httpStatus',coalesce(e.http_status,200))); end if;
  if e.status='PENDING' then
   update request_executions set status='FAILED',error_code='LLM_TIMEOUT',error=jsonb_build_object('code','LLM_TIMEOUT','message','응답 시간이 초과됐어요. 다시 요청해 주세요.','retryable',true,'details',jsonb_build_object('userMessageId',e.user_message_id)),http_status=504,updated_at=now() where id=e.id returning * into e;
  end if;
  return jsonb_build_object('executionId',e.id,'replay',jsonb_build_object('error',e.error,'httpStatus',coalesce(e.http_status,500)));
 end if;
 insert into rate_limit_buckets(user_id,subject_key,operation,bucket_start,count) values(v_user,v_user::text,p_category,v_bucket,1)
 on conflict(subject_key,operation,bucket_start) do update set count=rate_limit_buckets.count+1,updated_at=now() returning count into n;
 if n>p_limit then raise exception 'RATE_LIMITED'; end if;
 insert into request_executions(user_id,request_id,operation,payload_hash) values(v_user,v_request,v_op,p_params->>'payload_hash') returning * into e;
 update profiles set last_seen_at=now() where id=v_user;
 return jsonb_build_object('executionId',e.id);
end $$;

create or replace function public.complete_execution(p_execution_id uuid,p_assistant_content text,p_segments jsonb,p_model_id text,p_prompt_version text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e request_executions; m messages; result jsonb=p_data; char_id public.character_id; meta jsonb;
begin
 select * into e from request_executions where id=p_execution_id for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if e.status='SUCCEEDED' then return e.response_data; end if;
 if e.status='FAILED' then raise exception 'REQUEST_IN_PROGRESS'; end if;
 if not exists(select 1 from conversations where id=e.conversation_id and user_id=e.user_id) then raise exception 'NOT_FOUND'; end if;
 select character_id into char_id from conversations where id=e.conversation_id;
 if p_assistant_content is not null then
  meta=jsonb_build_object('segments',coalesce(p_segments,'[]'));
  if e.resource_type='TAROT' then meta=meta||jsonb_build_object('tarot',tarot_snapshot(e.resource_id,e.user_id)); elsif e.resource_type='SAJU' then meta=meta||jsonb_build_object('saju',saju_snapshot(e.resource_id,e.user_id)-'result'); end if;
  insert into messages(user_id,conversation_id,consultation_id,sender,type,content,request_id,reply_to_message_id,metadata,model_id,prompt_version)
  values(e.user_id,e.conversation_id,e.consultation_id,'ASSISTANT',case when e.resource_type='TAROT' then 'TAROT' when e.resource_type='SAJU' then 'SAJU' else 'TEXT' end,p_assistant_content,e.request_id,e.user_message_id,meta,p_model_id,p_prompt_version) returning * into m;
  if e.resource_type in ('TAROT','SAJU') then
   result=case when e.resource_type='SAJU' then saju_snapshot(e.resource_id,e.user_id)-'result' else tarot_snapshot(e.resource_id,e.user_id) end;
   update messages set metadata=metadata||jsonb_build_object(case when e.resource_type='SAJU' then 'saju' else 'tarot' end,result) where id=m.id;
   update consultations set result_summary=left(p_assistant_content,300) where id=e.consultation_id;
  else
   result=coalesce(p_data,'{}')||jsonb_build_object('executionStatus','SUCCEEDED','conversationId',e.conversation_id,'consultationId',e.consultation_id,'userMessage',jsonb_build_object('id',e.user_message_id,'createdAt',(select created_at from messages where id=e.user_message_id)),'assistantMessage',jsonb_build_object('id',m.id,'characterId',char_id,'content',m.content,'segments',p_segments));
  end if;
 end if;
 update request_executions set status=coalesce(result->>'executionStatus','SUCCEEDED'),response_data=result,http_status=200,updated_at=now() where id=e.id;
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
 if e.resource_type in ('TAROT','SAJU') then
  result=case when e.resource_type='SAJU' then saju_snapshot(e.resource_id,e.user_id)-'result' else tarot_snapshot(e.resource_id,e.user_id) end;
  if result->>'executionStatus'='PARTIAL' then result=result||jsonb_build_object('partialError',p_error); end if;
  update request_executions set status=result->>'executionStatus',response_data=result,error=p_error,error_code=p_error->>'code',http_status=200,updated_at=now() where id=e.id;
  return result;
 end if;
 update request_executions set status='FAILED',error=p_error||jsonb_build_object('details',coalesce(p_error->'details','{}')||jsonb_build_object('userMessageId',e.user_message_id)),error_code=p_error->>'code',http_status=p_http_status,updated_at=now() where id=e.id;
 return null;
end $$;

do $$declare f record; begin
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in ('saju_snapshot','begin_saju_request','save_saju_reading','claim_execution','complete_execution','fail_execution') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
