-- Consent transitions are forward-only for extraction AND compressed summaries.
-- No raw conversation content is removed; invalid derived context is discarded.
create or replace function public.memory_preference_changed() returns trigger
language plpgsql security definer set search_path=public as $$
declare boundary timestamptz=now();
begin
 if new.memory_enabled is distinct from old.memory_enabled then
  new.memory_revision=old.memory_revision+1;
  update conversations set summary=null,summary_cursor_at=boundary,
   last_extracted_at=boundary,last_extracted_message_id=null where user_id=new.id;
 end if;
 return new;
end $$;

create or replace function public.related_memory_consent_changed() returns trigger
language plpgsql security definer set search_path=public as $$
declare withdrawn boolean=false; changed boolean=false; retiring_alias boolean=false; boundary timestamptz=now();
begin
 if tg_op='INSERT' then
  -- Registering a known alias changes which existing derived context is eligible.
  -- Do not tombstone a default opt-out: later opt-in may learn new facts prospectively.
  if exists(select 1 from auth.users where id=new.user_id) then
   update profiles set memory_revision=memory_revision+1 where id=new.user_id;
   update conversations set summary=null,summary_cursor_at=boundary,
    last_extracted_at=boundary,last_extracted_message_id=null where user_id=new.user_id;
  end if;
  return new;
 end if;
 -- Account deletion owns the FK cascade. Never recreate a child tombstone after
 -- the owning Auth row has disappeared.
 if not exists(select 1 from auth.users where id=old.user_id) then
  if tg_op='DELETE' then return old; else return new; end if;
 end if;
 if tg_op='DELETE' then
  withdrawn=true; changed=true; retiring_alias=true;
 else
  withdrawn=old.memory_opt_in and not new.memory_opt_in;
  changed=new.memory_opt_in is distinct from old.memory_opt_in
   or new.display_name is distinct from old.display_name;
  retiring_alias=not old.memory_opt_in and changed;
 end if;
 -- A historical model may have attributed a person's fact to USER. Retire
 -- exact normalized alias matches before that alias leaves the blocked list,
 -- so deletion, rename or prospective opt-in cannot reveal that derived row.
 -- The normal memory deletion trigger retains its conservative suppression.
 if retiring_alias and length(btrim(old.display_name))>0 then
  delete from memories where user_id=old.user_id
   and strpos(lower(normalize(content,NFKC)),lower(normalize(btrim(old.display_name),NFKC)))>0;
 end if;
 if withdrawn then
  insert into memory_suppressions(user_id,scope,character_key,subject)
   values(old.user_id,'GLOBAL','','RELATED_PERSON:'||old.id::text) on conflict do nothing;
  delete from memories where user_id=old.user_id and subject='RELATED_PERSON:'||old.id::text;
 end if;
 if changed then
  update profiles set memory_revision=memory_revision+1 where id=old.user_id;
  update conversations set summary=null,summary_cursor_at=boundary,
   last_extracted_at=boundary,last_extracted_message_id=null where user_id=old.user_id;
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;

create trigger related_memory_consent_inserted before insert on public.related_people
 for each row execute function public.related_memory_consent_changed();

create or replace function public.memory_context_state(p_user_id uuid,p_conversation_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p profiles; c conversations; suppressions jsonb; people jsonb; blocked_people jsonb;
begin
 select * into p from profiles where id=p_user_id;
 select * into c from conversations where id=p_conversation_id and user_id=p_user_id;
 if p.id is null or c.id is null then raise exception 'NOT_FOUND'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('scope',scope,'characterId',nullif(character_key,''),'subject',subject)),'[]')
  into suppressions from memory_suppressions where user_id=p_user_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'alias',display_name)),'[]')
  into people from related_people where user_id=p_user_id and memory_opt_in;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'alias',display_name)),'[]')
  into blocked_people from related_people where user_id=p_user_id and not memory_opt_in;
 return jsonb_build_object('memoryEnabled',p.memory_enabled,'revision',p.memory_revision,
  'lastExtractedMessageId',c.last_extracted_message_id,'lastExtractedAt',c.last_extracted_at,
  'summary',c.summary,'summaryCursorAt',c.summary_cursor_at,'suppressions',suppressions,
  'allowedRelatedPeople',people,'blockedRelatedPeople',blocked_people);
end $$;

-- Existing consent history cannot be reconstructed safely. Start a fresh derived
-- context window for affected profiles and reject any work using their old revision.
update profiles p set memory_revision=p.memory_revision+1
 where not p.memory_enabled or p.memory_revision>0
 or exists(select 1 from related_people r where r.user_id=p.id and not r.memory_opt_in);
update conversations c set summary=null,summary_cursor_at=now(),
 last_extracted_at=now(),last_extracted_message_id=null
 where exists(select 1 from profiles p where p.id=c.user_id and (not p.memory_enabled or p.memory_revision>0));

revoke all on function public.memory_preference_changed(),public.related_memory_consent_changed(),public.memory_context_state(uuid,uuid) from public,anon,authenticated;
grant execute on function public.memory_preference_changed(),public.related_memory_consent_changed(),public.memory_context_state(uuid,uuid) to service_role;
