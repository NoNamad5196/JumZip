create function public.tarot_snapshot(p_group_id uuid,p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare g record; answer record; cards jsonb; result jsonb;
begin
 select d.*,c.conversation_id,c.character_id,c.question into g from tarot_draw_groups d join consultations c on c.id=d.consultation_id where d.id=p_group_id and d.user_id=p_user_id;
 if not found then raise exception 'NOT_FOUND'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('cardId',card_id,'orientation',orientation,'positionIndex',position_index,'positionKey',position_name) order by position_index),'[]') into cards from tarot_draws where draw_group_id=g.id;
 select id,content,metadata into answer from messages where user_id=p_user_id and sender='ASSISTANT' and metadata->'tarot'->>'drawGroupId'=g.id::text order by created_at desc limit 1;
 result=jsonb_build_object('executionStatus',case when answer.id is null then 'PARTIAL' else 'SUCCEEDED' end,'drawGroupId',g.id,'consultationId',g.consultation_id,'conversationId',g.conversation_id,'characterId',g.character_id,'question',g.question,'spreadType',g.spread_type,'mode',g.mode,'localDate',g.local_date,'schemaVersion',g.schema_version,'datasetVersion',g.dataset_version,'cards',cards,'interpretation',case when answer.id is null then null else jsonb_build_object('messageId',answer.id,'content',answer.content,'segments',coalesce(answer.metadata->'segments','[]')) end);
 if answer.id is null then result=result||jsonb_build_object('partialError',jsonb_build_object('code','TAROT_INTERPRETATION_FAILED','message','카드는 저장됐어요. 해석을 다시 요청할 수 있어요.','retryable',true)); end if;
 return result;
end $$;

create function public.claim_execution(p_params jsonb,p_category text,p_limit int) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e request_executions; v_user uuid=(p_params->>'user_id')::uuid; v_request uuid=(p_params->>'request_id')::uuid; v_op text=p_params->>'operation'; n int; v_bucket timestamptz=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'; r jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(v_user::text||v_op||v_request::text,0));
 select * into e from request_executions where user_id=v_user and operation=v_op and request_id=v_request for update;
 if found then
  if e.payload_hash<>p_params->>'payload_hash' then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
  if e.status='PENDING' and e.lease_expires_at>now() then raise exception 'REQUEST_IN_PROGRESS'; end if;
  if e.resource_type='TAROT' then
   r=tarot_snapshot(e.resource_id,v_user);
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

create function public.resolve_consultation(p_user uuid,p_conversation uuid,p_consultation uuid,p_type text,p_question text,p_force_new boolean) returns uuid
language plpgsql security definer set search_path=public as $$
declare c conversations; s consultations;
begin
 select * into c from conversations where id=p_conversation and user_id=p_user for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if p_consultation is not null then
  select * into s from consultations where id=p_consultation and conversation_id=p_conversation and user_id=p_user;
  if not found then raise exception 'NOT_FOUND'; end if;
 elsif not p_force_new then
  select * into s from consultations where conversation_id=p_conversation and user_id=p_user and closed_at is null order by last_activity_at desc limit 1;
 end if;
 if p_force_new or s.id is null or s.closed_at is not null or s.last_activity_at<now()-interval '8 hours' then
  if s.id is not null then update consultations set closed_at=coalesce(closed_at,now()) where id=s.id; end if;
  insert into consultations(user_id,conversation_id,character_id,fortune_type,question,title) values(p_user,p_conversation,c.character_id,p_type,coalesce(p_question,''),left(nullif(p_question,''),60)) returning * into s;
 end if;
 update consultations set last_activity_at=now() where id=s.id;
 return s.id;
end $$;

create function public.begin_chat_request(p_params jsonb) returns jsonb
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
 update request_executions set conversation_id=v_conversation,consultation_id=v_consultation,user_message_id=m.id where id=e;
 update conversations set last_message_at=now() where id=v_conversation;
 return claimed||jsonb_build_object('conversationId',v_conversation,'characterId',c.character_id,'consultationId',v_consultation,'userMessage',jsonb_build_object('id',m.id,'content',m.content,'createdAt',m.created_at));
end $$;

create function public.begin_fortune_request(p_params jsonb) returns jsonb
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
  if p_params->>'draw_group_id' is not null then snap=tarot_snapshot(g.id,v_user); end if;
 elsif p_params->>'mode'='DAILY' then
  perform pg_advisory_xact_lock(hashtextextended(v_user::text||(p_params->>'local_date'),1));
  select * into g from tarot_draw_groups where user_id=v_user and mode='DAILY' and local_date=(p_params->>'local_date')::date;
  if found then snap=tarot_snapshot(g.id,v_user); v_consultation=g.consultation_id; end if;
 end if;
 if v_consultation is null then v_consultation=resolve_consultation(v_user,v_conversation,(p_params->>'consultation_id')::uuid,case when p_params->>'operation' like 'compatibility%' then 'COMPATIBILITY_TAROT' else 'TAROT' end,p_params->>'question',true); end if;
 update request_executions set conversation_id=v_conversation,consultation_id=v_consultation,resource_type=case when snap is not null then 'TAROT' end,resource_id=case when snap is not null then g.id end where id=e;
 return claimed||jsonb_build_object('conversationId',v_conversation,'characterId',c.character_id,'consultationId',v_consultation,'resource',snap,'source',case when p_params->>'source_draw_group_id' is not null then tarot_snapshot(g.id,v_user) end);
end $$;

create function public.save_tarot_draw(p_execution_id uuid,p_cards jsonb,p_spread_type text,p_mode text,p_local_date date,p_question text,p_source_draw_group_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e request_executions; g tarot_draw_groups; card jsonb; snap jsonb; expected_count int;
begin
 select * into e from request_executions where id=p_execution_id for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if e.resource_type='TAROT' then return tarot_snapshot(e.resource_id,e.user_id)||jsonb_build_object('reused',true); end if;
 if e.status<>'PENDING' or e.lease_expires_at<now() then raise exception 'REQUEST_IN_PROGRESS'; end if;
 if not exists(select 1 from consultations where id=e.consultation_id and user_id=e.user_id) then raise exception 'NOT_FOUND'; end if;
 if p_source_draw_group_id is not null then
  select * into g from tarot_draw_groups where id=p_source_draw_group_id and user_id=e.user_id and consultation_id=e.consultation_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if g.mode='DAILY' then raise exception 'TAROT_DAILY_REDRAW_NOT_ALLOWED'; end if;
  if g.spread_type<>p_spread_type then raise exception 'VALIDATION_ERROR'; end if;
 end if;
 if p_mode='DAILY' then
  perform pg_advisory_xact_lock(hashtextextended(e.user_id::text||p_local_date::text,1));
  select * into g from tarot_draw_groups where user_id=e.user_id and mode='DAILY' and local_date=p_local_date;
  if found then
   snap=tarot_snapshot(g.id,e.user_id);
   update request_executions set resource_type='TAROT',resource_id=g.id,consultation_id=g.consultation_id,status=snap->>'executionStatus',response_data=snap,http_status=200 where id=e.id;
   return snap||jsonb_build_object('reused',true);
  end if;
 end if;
 expected_count=case when p_spread_type='ONE_CARD' then 1 else 3 end;
 if jsonb_array_length(p_cards)<>expected_count or(select count(distinct (a->>'positionIndex')::int) from jsonb_array_elements(p_cards) a)<>expected_count then raise exception 'VALIDATION_ERROR'; end if;
 insert into tarot_draw_groups(user_id,consultation_id,spread_type,mode,local_date,source_draw_group_id) values(e.user_id,e.consultation_id,p_spread_type,p_mode,p_local_date,p_source_draw_group_id) returning * into g;
 for card in select * from jsonb_array_elements(p_cards) loop
  if (card->>'positionIndex')::int not between 0 and expected_count-1 then raise exception 'VALIDATION_ERROR'; end if;
  insert into tarot_draws(user_id,draw_group_id,position_index,position_name,card_id,orientation) values(e.user_id,g.id,(card->>'positionIndex')::smallint,card->>'positionKey',(card->>'cardId')::smallint,card->>'orientation');
 end loop;
 snap=tarot_snapshot(g.id,e.user_id);
 update request_executions set resource_type='TAROT',resource_id=g.id,status='PARTIAL',response_data=snap,http_status=200,updated_at=now() where id=e.id;
 insert into messages(user_id,conversation_id,consultation_id,sender,type,content,request_id,metadata)
 values(e.user_id,e.conversation_id,e.consultation_id,'SYSTEM','TAROT_DRAW','',e.request_id,jsonb_build_object('tarot',snap));
 return snap||jsonb_build_object('reused',false);
end $$;

create function public.complete_execution(p_execution_id uuid,p_assistant_content text,p_segments jsonb,p_model_id text,p_prompt_version text,p_data jsonb) returns jsonb
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
  if e.resource_type='TAROT' then meta=meta||jsonb_build_object('tarot',tarot_snapshot(e.resource_id,e.user_id)); end if;
  insert into messages(user_id,conversation_id,consultation_id,sender,type,content,request_id,reply_to_message_id,metadata,model_id,prompt_version)
  values(e.user_id,e.conversation_id,e.consultation_id,'ASSISTANT',case when e.resource_type='TAROT' then 'TAROT' else 'TEXT' end,p_assistant_content,e.request_id,e.user_message_id,meta,p_model_id,p_prompt_version) returning * into m;
  if e.resource_type='TAROT' then
   result=tarot_snapshot(e.resource_id,e.user_id);
   update messages set metadata=metadata||jsonb_build_object('tarot',result) where id=m.id;
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

create function public.fail_execution(p_execution_id uuid,p_error jsonb,p_http_status int) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e request_executions; result jsonb;
begin
 select * into e from request_executions where id=p_execution_id for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if e.status='SUCCEEDED' then return e.response_data; end if;
 if e.resource_type='TAROT' then
  result=tarot_snapshot(e.resource_id,e.user_id);
  if result->>'executionStatus'='PARTIAL' then result=result||jsonb_build_object('partialError',p_error); end if;
  update request_executions set status=result->>'executionStatus',response_data=result,error=p_error,error_code=p_error->>'code',http_status=200,updated_at=now() where id=e.id;
  return result;
 end if;
 update request_executions set status='FAILED',error=p_error||jsonb_build_object('details',coalesce(p_error->'details','{}')||jsonb_build_object('userMessageId',e.user_message_id)),error_code=p_error->>'code',http_status=p_http_status,updated_at=now() where id=e.id;
 return null;
end $$;

-- Never callable by JWT-authenticated browsers; Edge code must verify getUser first.
do $$declare f record; begin
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in ('tarot_snapshot','claim_execution','resolve_consultation','begin_chat_request','begin_fortune_request','save_tarot_draw','complete_execution','fail_execution') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
