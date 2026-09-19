alter table public.conversations add column title_custom boolean not null default false,
 add column title_generated_at timestamptz,add column title_claim_id uuid,add column title_claim_until timestamptz;
alter table public.consultations add column title_custom boolean not null default false,
 add column title_generated_at timestamptz,add column title_claim_id uuid,add column title_claim_until timestamptz;
grant update(title) on public.consultations to authenticated;
create policy own_update_title on public.consultations for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);

create function public.protect_user_title() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is not null then new.title_custom=true; new.title_claim_id=null; new.title_claim_until=null; end if;
 return new;
end $$;
create trigger protect_user_title before update of title on public.conversations for each row execute function public.protect_user_title();
create trigger protect_user_title before update of title on public.consultations for each row execute function public.protect_user_title();

create function public.claim_title_generation(p_user_id uuid,p_conversation_id uuid,p_consultation_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c conversations; s consultations; v_messages jsonb; claim_id uuid; result jsonb='[]';
begin
 select * into c from conversations where id=p_conversation_id and user_id=p_user_id for update;
 select * into s from consultations where id=p_consultation_id and conversation_id=p_conversation_id and user_id=p_user_id for update;
 if c.id is null or s.id is null then raise exception 'NOT_FOUND'; end if;
 if not c.title_custom and c.title_generated_at is null and coalesce(c.title_claim_until,'-infinity')<=now() then
  select coalesce(jsonb_agg(jsonb_build_object('role',lower(sender),'content',content) order by created_at,id),'[]') into v_messages from (select id,sender,content,created_at from messages where conversation_id=c.id and user_id=p_user_id and sender in ('USER','ASSISTANT') order by created_at,id limit 5) early;
  if jsonb_array_length(v_messages)>=3 then
   claim_id=gen_random_uuid();update conversations set title_claim_id=claim_id,title_claim_until=now()+interval '30 seconds' where id=c.id;
   result=result||jsonb_build_array(jsonb_build_object('targetType','CONVERSATION','targetId',c.id,'claimId',claim_id,'characterId',c.character_id,'messages',v_messages));
  end if;
 end if;
 if not s.title_custom and s.title_generated_at is null and coalesce(s.title_claim_until,'-infinity')<=now() then
  select coalesce(jsonb_agg(jsonb_build_object('role',lower(sender),'content',content) order by created_at,id),'[]') into v_messages from (select id,sender,content,created_at from messages where consultation_id=s.id and user_id=p_user_id and sender in ('USER','ASSISTANT') order by created_at,id limit 5) early;
  if jsonb_array_length(v_messages)>=3 then
   claim_id=gen_random_uuid();update consultations set title_claim_id=claim_id,title_claim_until=now()+interval '30 seconds' where id=s.id;
   result=result||jsonb_build_array(jsonb_build_object('targetType','CONSULTATION','targetId',s.id,'claimId',claim_id,'characterId',c.character_id,'messages',v_messages));
  end if;
 end if;
 return result;
end $$;

create function public.apply_generated_title(p_user_id uuid,p_target_type text,p_target_id uuid,p_claim_id uuid,p_title text) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 if char_length(trim(p_title)) not between 1 and 60 or p_title ~ '[[:cntrl:]]' then raise exception 'VALIDATION_ERROR'; end if;
 if p_target_type='CONVERSATION' then
  update conversations set title=trim(p_title),title_generated_at=now(),title_claim_id=null,title_claim_until=null where id=p_target_id and user_id=p_user_id and not title_custom and title_generated_at is null and title_claim_id=p_claim_id and title_claim_until>now();
 elsif p_target_type='CONSULTATION' then
  update consultations set title=trim(p_title),title_generated_at=now(),title_claim_id=null,title_claim_until=null where id=p_target_id and user_id=p_user_id and not title_custom and title_generated_at is null and title_claim_id=p_claim_id and title_claim_until>now();
 else raise exception 'VALIDATION_ERROR'; end if;
 return found;
end $$;

-- Familiarity is based on completed distinct chat turns, never an affection/romance score.
create function public.record_completed_relationship_turn() returns trigger language plpgsql security definer set search_path=public as $$
declare n int;
begin
 if new.sender<>'ASSISTANT' or new.reply_to_message_id is null then return new; end if;
 perform 1 from conversations where id=new.conversation_id for update;
 select count(distinct reply_to_message_id)::int into n from messages where conversation_id=new.conversation_id and user_id=new.user_id and sender='ASSISTANT' and reply_to_message_id is not null;
 update conversations set relationship_state=jsonb_build_object('stage',case when n>=30 then 'CLOSE' when n>=10 then 'FAMILIAR' when n>=1 then 'ACQUAINTANCE' else 'FIRST_MEETING' end,'completedTurns',n) where id=new.conversation_id;
 return new;
end $$;
create trigger record_completed_relationship_turn after insert on public.messages for each row execute function public.record_completed_relationship_turn();
do $$declare f record; begin
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in ('protect_user_title','claim_title_generation','apply_generated_title','record_completed_relationship_turn') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
