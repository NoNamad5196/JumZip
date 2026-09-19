-- Authoritative writes are service-role RPCs; browser writes are column-scoped.
create type public.character_id as enum ('BOMI','SANI','ARANG');
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '' check(char_length(display_name)<=30),
 memory_enabled boolean not null default true,
 preferred_character public.character_id,
 last_seen_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.conversations (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 character_id public.character_id not null, title text not null default '새로운 이야기' check(char_length(title)<=100),
 relationship_state jsonb not null default '{}', summary text, last_message_at timestamptz,
 created_at timestamptz not null default now(), unique(id,user_id)
);
create table public.consultations (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 conversation_id uuid not null, character_id public.character_id not null,
 fortune_type text not null check(fortune_type in ('CHAT','TAROT','SAJU','COMPATIBILITY_SAJU','COMPATIBILITY_TAROT')),
 topic text, question text not null default '' check(char_length(question)<=4000), input jsonb not null default '{}',
 title text check(char_length(title)<=100), result_summary text, started_at timestamptz not null default now(),
 last_activity_at timestamptz not null default now(), closed_at timestamptz, created_at timestamptz not null default now(),
 foreign key(conversation_id,user_id) references public.conversations(id,user_id) on delete cascade,
 unique(id,user_id), unique(id,conversation_id,user_id)
);
create table public.messages (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 conversation_id uuid not null, consultation_id uuid, sender text not null check(sender in ('USER','ASSISTANT','SYSTEM')),
 type text not null default 'TEXT', content text not null check(char_length(content)<=20000), request_id uuid,
 reply_to_message_id uuid references public.messages(id) on delete set null,
 metadata jsonb not null default '{}', model_id text, prompt_version text, created_at timestamptz not null default now(),
 foreign key(conversation_id,user_id) references public.conversations(id,user_id) on delete cascade,
 foreign key(consultation_id,conversation_id,user_id) references public.consultations(id,conversation_id,user_id) on delete cascade
);
create index messages_conversation_created on public.messages(conversation_id,created_at);
create table public.tarot_draw_groups (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 consultation_id uuid not null, spread_type text not null check(spread_type in ('ONE_CARD','GENERAL_3','RELATIONSHIP_3','DECISION_3')),
 mode text not null default 'NORMAL' check(mode in ('NORMAL','DAILY')), local_date date,
 source_draw_group_id uuid references public.tarot_draw_groups(id) on delete set null,
 schema_version integer not null default 1, dataset_version text not null default 'JumZipTarot22-v1', created_at timestamptz not null default now(),
 foreign key(consultation_id,user_id) references public.consultations(id,user_id) on delete cascade,
 check((mode='DAILY' and local_date is not null) or(mode='NORMAL' and local_date is null)), unique(id,user_id)
);
create unique index daily_one_per_user on public.tarot_draw_groups(user_id,local_date) where mode='DAILY';
create table public.tarot_draws (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 draw_group_id uuid not null, position_index smallint not null check(position_index between 0 and 2), position_name text not null,
 card_id smallint not null check(card_id between 0 and 21), orientation text not null check(orientation in ('UPRIGHT','REVERSED')),
 created_at timestamptz not null default now(), foreign key(draw_group_id,user_id) references public.tarot_draw_groups(id,user_id) on delete cascade,
 unique(draw_group_id,position_index), unique(draw_group_id,card_id)
);
create table public.related_people (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 display_name text not null check(char_length(display_name) between 1 and 40), relation text, gender text,
 memory_opt_in boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id)
);
create table public.birth_profiles (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 owner_type text not null check(owner_type in ('USER','RELATED_PERSON')), related_person_id uuid,
 calendar_type text not null check(calendar_type in ('SOLAR','LUNAR')), leap_month boolean not null default false,
 birth_date date not null, birth_time time, unknown_birth_time boolean not null default false,
 city text not null, country text not null, latitude numeric not null check(latitude between -90 and 90), longitude numeric not null check(longitude between -180 and 180),
 timezone text not null, location_provider text, location_resolved_at timestamptz, gender text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(related_person_id,user_id) references public.related_people(id,user_id) on delete cascade,
 check((owner_type='USER' and related_person_id is null) or(owner_type='RELATED_PERSON' and related_person_id is not null)),
 check((unknown_birth_time and birth_time is null) or(not unknown_birth_time and birth_time is not null))
);
create table public.saju_readings (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, consultation_id uuid not null,
 birth_profile_snapshot jsonb not null, schema_version integer not null default 1, convention_version text not null, engine_version text not null, rule_version text not null,
 pillars jsonb not null, elements jsonb, ten_gods jsonb, hidden_stems jsonb, relations jsonb, gongmang jsonb, strength jsonb, gyeokguk jsonb,
 yongsin jsonb, heesin jsonb, twelve_stages jsonb, shinsal jsonb, daewoon jsonb, sewoon jsonb, monthly_fortune jsonb,
 uncertainty_flags jsonb not null default '[]', created_at timestamptz not null default now(), foreign key(consultation_id,user_id) references public.consultations(id,user_id) on delete cascade
);
create table public.saju_compatibility_readings (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, consultation_id uuid not null,
 a_chart_snapshot jsonb not null, b_chart_snapshot jsonb not null, schema_version integer not null default 1,
 convention_version text not null, engine_version text not null, rule_version text not null,
 day_master_relation jsonb, element_complement jsonb, stem_branch_relations jsonb, ten_gods jsonb, timing jsonb, strengths jsonb, frictions jsonb,
 uncertainty_flags jsonb not null default '[]', created_at timestamptz not null default now(), foreign key(consultation_id,user_id) references public.consultations(id,user_id) on delete cascade
);
create table public.memories (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 scope text not null check(scope in ('GLOBAL','CHARACTER')), character_id public.character_id, category text not null, subject text not null,
 content text not null check(char_length(content) between 1 and 1000), importance integer not null default 1 check(importance between 1 and 5),
 sensitivity text not null default 'NORMAL', source_conversation_id uuid references public.conversations(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), disabled_at timestamptz,
 check((scope='GLOBAL' and character_id is null) or(scope='CHARACTER' and character_id is not null))
);
create table public.rate_limit_buckets (
 user_id uuid not null references auth.users(id) on delete cascade, subject_key text not null, operation text not null,
 bucket_start timestamptz not null, count integer not null default 0, updated_at timestamptz not null default now(), primary key(subject_key,operation,bucket_start)
);
create table public.request_executions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, request_id uuid not null,
 operation text not null, payload_hash text not null, status text not null default 'PENDING' check(status in ('PENDING','PARTIAL','SUCCEEDED','FAILED')),
 resource_type text, resource_id uuid, conversation_id uuid, consultation_id uuid, user_message_id uuid,
 response_data jsonb, error_code text, error jsonb, http_status integer, schema_version integer not null default 1,
 started_at timestamptz not null default now(), lease_expires_at timestamptz not null default now()+interval '120 seconds',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,operation,request_id)
);
create index executions_user_created on public.request_executions(user_id,created_at);
create index consultations_user_created on public.consultations(user_id,created_at);
create index conversations_user_activity on public.conversations(user_id,last_message_at);

create function public.create_user_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.profiles(id) values(new.id) on conflict do nothing; return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_user_profile();
insert into public.profiles(id) select id from auth.users on conflict do nothing;
create function public.touch_updated_at() returns trigger language plpgsql set search_path=public as $$begin new.updated_at=now(); return new; end$$;
create trigger profiles_updated before update on public.profiles for each row execute function public.touch_updated_at();
create trigger memories_updated before update on public.memories for each row execute function public.touch_updated_at();
create trigger people_updated before update on public.related_people for each row execute function public.touch_updated_at();
create trigger births_updated before update on public.birth_profiles for each row execute function public.touch_updated_at();

do $$declare t text; begin
 foreach t in array array['profiles','conversations','consultations','messages','tarot_draw_groups','tarot_draws','birth_profiles','related_people','saju_readings','saju_compatibility_readings','memories','rate_limit_buckets','request_executions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  if t not in ('rate_limit_buckets','request_executions') then
   execute format('grant select on public.%I to authenticated',t);
   execute format('create policy own_read on public.%I for select to authenticated using ((select auth.uid())=%I)',t,case when t='profiles' then 'id' else 'user_id' end);
  end if;
 end loop;
end $$;
grant update(display_name,memory_enabled,preferred_character,last_seen_at) on public.profiles to authenticated;
create policy own_update on public.profiles for update to authenticated using((select auth.uid())=id) with check((select auth.uid())=id);
grant insert(user_id,character_id,title),update(title),delete on public.conversations to authenticated;
create policy own_insert on public.conversations for insert to authenticated with check((select auth.uid())=user_id);
create policy own_update on public.conversations for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy own_delete on public.conversations for delete to authenticated using((select auth.uid())=user_id);
grant update(content,disabled_at),delete on public.memories to authenticated;
create policy own_update on public.memories for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy own_delete on public.memories for delete to authenticated using((select auth.uid())=user_id);
-- Birth/related person mutation goes through consent-aware server actions.
revoke all on function public.create_user_profile() from public;
