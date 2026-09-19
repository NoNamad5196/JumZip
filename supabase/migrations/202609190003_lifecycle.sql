-- Retain only the daily eligibility tombstone if the user deletes that conversation.
create table public.daily_draw_claims (
 user_id uuid not null references auth.users(id) on delete cascade, local_date date not null,
 draw_group_id uuid references public.tarot_draw_groups(id) on delete set null,
 created_at timestamptz not null default now(), primary key(user_id,local_date)
);
alter table public.daily_draw_claims enable row level security;
revoke all on public.daily_draw_claims from anon,authenticated;
grant all on public.daily_draw_claims to service_role;
create function public.record_daily_claim() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.mode='DAILY' then insert into daily_draw_claims(user_id,local_date,draw_group_id) values(new.user_id,new.local_date,new.id); end if; return new;
end $$;
create trigger record_daily_claim after insert on public.tarot_draw_groups for each row execute function public.record_daily_claim();
create function public.prevent_deleted_daily_redraw() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.mode='DAILY' and exists(select 1 from daily_draw_claims where user_id=new.user_id and local_date=new.local_date) then raise exception 'TAROT_DAILY_REDRAW_NOT_ALLOWED'; end if; return new;
end $$;
create trigger prevent_deleted_daily_redraw before insert on public.tarot_draw_groups for each row execute function public.prevent_deleted_daily_redraw();
create function public.clear_deleted_conversation_cache() returns trigger language plpgsql security definer set search_path=public as $$
begin update request_executions set response_data=null,error=null,error_code='NOT_FOUND',status='FAILED',http_status=404 where conversation_id=old.id; return old; end $$;
create trigger clear_deleted_conversation_cache before delete on public.conversations for each row execute function public.clear_deleted_conversation_cache();

-- Activity timestamps are authoritative server time, never a client-selected future date.
revoke update(last_seen_at) on public.profiles from authenticated;
create function public.touch_activity() returns void language sql security definer set search_path=public as $$
 update profiles set last_seen_at=now() where id=(select auth.uid());
$$;
revoke all on function public.touch_activity() from public,anon;
grant execute on function public.touch_activity() to authenticated;

alter table public.profiles add column memory_revision bigint not null default 0;
alter table public.conversations add column last_extracted_message_id uuid;
alter table public.conversations add column last_extracted_at timestamptz;
alter table public.conversations add column summary_cursor_at timestamptz;
create table public.memory_suppressions (
 user_id uuid not null references auth.users(id) on delete cascade,
 scope text not null check(scope in ('GLOBAL','CHARACTER')), character_key text not null default '',
 subject text not null, created_at timestamptz not null default now(), primary key(user_id,scope,character_key,subject)
);
alter table public.memory_suppressions enable row level security;
revoke all on public.memory_suppressions from anon,authenticated;
grant all on public.memory_suppressions to service_role;

create function public.invalidate_memory_context() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from auth.users where id=old.user_id) then
  if tg_op='DELETE' then return old; else return new; end if;
 end if;
 if tg_op='DELETE' or (tg_op='UPDATE' and (new.content is distinct from old.content or new.disabled_at is distinct from old.disabled_at)) then
  insert into memory_suppressions(user_id,scope,character_key,subject) values(old.user_id,old.scope,coalesce(old.character_id::text,''),old.subject) on conflict do nothing;
  update profiles set memory_revision=memory_revision+1 where id=old.user_id;
  update conversations set summary=null,summary_cursor_at=null where user_id=old.user_id;
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger memories_invalidate after update or delete on public.memories for each row execute function public.invalidate_memory_context();
create function public.memory_preference_changed() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.memory_enabled is distinct from old.memory_enabled then
  new.memory_revision=old.memory_revision+1;
  update conversations set summary=null,summary_cursor_at=null,last_extracted_at=now(),last_extracted_message_id=null where user_id=new.id;
 end if; return new;
end $$;
create trigger memory_preference_changed before update on public.profiles for each row execute function public.memory_preference_changed();

grant insert(user_id,display_name,relation,gender,memory_opt_in),update(display_name,relation,gender,memory_opt_in),delete on public.related_people to authenticated;
create policy own_insert on public.related_people for insert to authenticated with check((select auth.uid())=user_id);
create policy own_update on public.related_people for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy own_delete on public.related_people for delete to authenticated using((select auth.uid())=user_id);
grant insert(user_id,owner_type,related_person_id,calendar_type,leap_month,birth_date,birth_time,unknown_birth_time,city,country,latitude,longitude,timezone,location_provider,location_resolved_at,gender),update(calendar_type,leap_month,birth_date,birth_time,unknown_birth_time,city,country,latitude,longitude,timezone,location_provider,location_resolved_at,gender),delete on public.birth_profiles to authenticated;
create policy own_insert on public.birth_profiles for insert to authenticated with check((select auth.uid())=user_id);
create policy own_update on public.birth_profiles for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy own_delete on public.birth_profiles for delete to authenticated using((select auth.uid())=user_id);
create unique index one_user_birth on public.birth_profiles(user_id) where owner_type='USER';
create unique index one_related_birth on public.birth_profiles(related_person_id) where owner_type='RELATED_PERSON';
create function public.related_memory_consent_changed() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='DELETE' or (tg_op='UPDATE' and not new.memory_opt_in and old.memory_opt_in) then
  delete from memories where user_id=old.user_id and subject='RELATED_PERSON:'||old.id::text;
  update profiles set memory_revision=memory_revision+1 where id=old.user_id;
  update conversations set summary=null,summary_cursor_at=null where user_id=old.user_id;
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger related_memory_consent_changed before update or delete on public.related_people for each row execute function public.related_memory_consent_changed();

create function public.memory_context_state(p_user_id uuid,p_conversation_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare p profiles; c conversations; suppressions jsonb; people jsonb;
begin
 select * into p from profiles where id=p_user_id;
 select * into c from conversations where id=p_conversation_id and user_id=p_user_id;
 if p.id is null or c.id is null then raise exception 'NOT_FOUND'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('scope',scope,'characterId',nullif(character_key,''),'subject',subject)),'[]') into suppressions from memory_suppressions where user_id=p_user_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'alias',display_name)),'[]') into people from related_people where user_id=p_user_id and memory_opt_in;
 return jsonb_build_object('memoryEnabled',p.memory_enabled,'revision',p.memory_revision,'lastExtractedMessageId',c.last_extracted_message_id,'lastExtractedAt',c.last_extracted_at,'summary',c.summary,'summaryCursorAt',c.summary_cursor_at,'suppressions',suppressions,'allowedRelatedPeople',people);
end $$;
create function public.apply_memory_update(p_user_id uuid,p_conversation_id uuid,p_expected_revision bigint,p_through_message_id uuid,p_candidates jsonb,p_summary text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare p profiles; c conversations; m messages; candidate jsonb; subj text; sc text; char_key text; content_text text; related_id uuid; inserted int=0;
begin
 select * into p from profiles where id=p_user_id for update;
 select * into c from conversations where id=p_conversation_id and user_id=p_user_id for update;
 select * into m from messages where id=p_through_message_id and conversation_id=p_conversation_id and user_id=p_user_id and sender='USER';
 if p.id is null or c.id is null or m.id is null then raise exception 'NOT_FOUND'; end if;
 if not p.memory_enabled or p.memory_revision<>p_expected_revision then return jsonb_build_object('applied',false,'reason','CONTEXT_CHANGED'); end if;
 if c.last_extracted_at is not null and (m.created_at<c.last_extracted_at or(m.created_at=c.last_extracted_at and (c.last_extracted_message_id is null or m.id<=c.last_extracted_message_id))) then return jsonb_build_object('applied',false,'reason','ALREADY_PROCESSED'); end if;
 if jsonb_typeof(p_candidates)<>'array' or jsonb_array_length(p_candidates)>8 then raise exception 'VALIDATION_ERROR'; end if;
 for candidate in select * from jsonb_array_elements(p_candidates) loop
  subj=candidate->>'subject'; sc=candidate->>'scope'; content_text=btrim(candidate->>'content');
  char_key=case when sc='CHARACTER' then c.character_id::text else '' end;
  if sc not in ('GLOBAL','CHARACTER') or subj is null or content_text is null or char_length(content_text) not between 1 and 1000 then continue; end if;
  if candidate->>'category' not in ('PERSON','EVENT','GOAL','RELATIONSHIP','PREFERENCE','CONSULTATION_CONTEXT') or coalesce(candidate->>'sensitivity','NORMAL')<>'NORMAL' then continue; end if;
  if sc='CHARACTER' and candidate->>'characterId' is not null and candidate->>'characterId'<>c.character_id::text then continue; end if;
  if content_text ~* '(주민등록|여권.?번호|계좌.?번호|신용카드|비밀번호|패스워드|의료.?기록|진단.?명|생년월일|출생.?시각|태어난.?시간|성적.?취향|정치.?성향|password|passport|ssn|diagnos|birth.?date)' then continue; end if;
  if subj<>'USER' then
   if subj !~ '^RELATED_PERSON:[0-9a-fA-F-]{36}$' then continue; end if;
   begin related_id=substring(subj from 16)::uuid; exception when invalid_text_representation then continue; end;
   if not exists(select 1 from related_people where id=related_id and user_id=p_user_id and memory_opt_in) then continue; end if;
  end if;
  if exists(select 1 from memory_suppressions where user_id=p_user_id and scope=sc and character_key=char_key and subject=subj) then continue; end if;
  if exists(select 1 from memories where user_id=p_user_id and scope=sc and coalesce(character_id::text,'')=char_key and subject=subj and content=content_text) then continue; end if;
  insert into memories(user_id,scope,character_id,category,subject,content,importance,sensitivity,source_conversation_id)
  values(p_user_id,sc,case when sc='CHARACTER' then c.character_id end,candidate->>'category',subj,content_text,least(5,greatest(1,coalesce((candidate->>'importance')::int,1))),'NORMAL',p_conversation_id);
  inserted=inserted+1;
 end loop;
 -- Never regenerate a summary from old messages after an explicit forgetting action.
 update conversations set last_extracted_message_id=m.id,last_extracted_at=m.created_at,
  summary=case when p_summary is not null and not exists(select 1 from memory_suppressions where user_id=p_user_id) then left(p_summary,6000) else summary end,
  summary_cursor_at=case when p_summary is not null and not exists(select 1 from memory_suppressions where user_id=p_user_id) then m.created_at else summary_cursor_at end where id=c.id;
 return jsonb_build_object('applied',true,'inserted',inserted);
end $$;

create function public.cleanup_inactive_anonymous(p_before timestamptz default now()-interval '90 days',p_limit int default 100) returns integer language plpgsql security definer set search_path=public as $$
declare u record; deleted int=0;
begin
 -- Caller cannot accidentally shorten the retention period.
 if p_before>now()-interval '90 days' or p_limit not between 1 and 1000 then raise exception 'VALIDATION_ERROR'; end if;
 for u in select a.id from auth.users a left join profiles p on p.id=a.id where a.is_anonymous and coalesce(p.last_seen_at,a.created_at)<p_before and not exists(select 1 from auth.identities i where i.user_id=a.id and i.provider<>'anonymous') order by coalesce(p.last_seen_at,a.created_at) limit p_limit for update of a skip locked loop
  perform 1 from profiles where id=u.id for update;
  delete from auth.users where id=u.id and is_anonymous and coalesce((select last_seen_at from profiles where id=u.id),created_at)<p_before and not exists(select 1 from auth.identities i where i.user_id=u.id and i.provider<>'anonymous');
  if found then deleted=deleted+1; end if;
 end loop;
 delete from rate_limit_buckets where bucket_start<now()-interval '7 days';
 delete from daily_draw_claims where local_date<(now() at time zone 'UTC')::date-2;
 return deleted;
end $$;
do $$declare f record; begin
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in ('record_daily_claim','prevent_deleted_daily_redraw','clear_deleted_conversation_cache','invalidate_memory_context','memory_preference_changed','related_memory_consent_changed','memory_context_state','apply_memory_update','cleanup_inactive_anonymous') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
