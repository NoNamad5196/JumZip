-- The stored provenance identifies a conversation, not one of its consultations.
-- Preview therefore exposes that exact scope; the UI explicitly explains it.
create function public.history_deletion_memories(p_kind text,p_record_id uuid)
returns setof public.memories language plpgsql stable security invoker set search_path=public as $$
declare owner_id uuid=auth.uid(); conversation_id uuid;
begin
 if owner_id is null then raise exception 'UNAUTHORIZED'; end if;
 if p_kind='CONVERSATION' then
  select c.id into conversation_id from conversations c where c.id=p_record_id and c.user_id=owner_id;
 elsif p_kind='CONSULTATION' then
  select c.conversation_id into conversation_id from consultations c where c.id=p_record_id and c.user_id=owner_id;
 else raise exception 'VALIDATION_ERROR'; end if;
 if conversation_id is null then return; end if;
 return query select m.* from memories m where m.user_id=owner_id and m.source_conversation_id=conversation_id;
end $$;

create function public.delete_history_with_memories(p_kind text,p_record_id uuid,p_memory_ids uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare owner_id uuid=auth.uid(); conversation_id uuid; selected_ids uuid[]; selected_count int; matching_count int;
begin
 if owner_id is null then raise exception 'UNAUTHORIZED'; end if;
 if p_kind not in ('CONVERSATION','CONSULTATION') or p_kind is null
  or p_record_id is null or p_memory_ids is null or cardinality(p_memory_ids)>1000
  or array_position(p_memory_ids,null) is not null then raise exception 'VALIDATION_ERROR'; end if;
 select coalesce(array_agg(distinct x),'{}') into selected_ids from unnest(p_memory_ids) x;
 selected_count=cardinality(selected_ids);
 -- Match maintenance's lock order. Consent updates and in-flight extraction
 -- cannot insert a selected memory between verification and the deletion.
 perform 1 from profiles p where p.id=owner_id for update;
 if not found then raise exception 'UNAUTHORIZED'; end if;
 if p_kind='CONVERSATION' then
  select c.id into conversation_id from conversations c where c.id=p_record_id and c.user_id=owner_id for update;
 else
  select c.conversation_id into conversation_id from consultations c where c.id=p_record_id and c.user_id=owner_id for update;
 end if;
 -- A lost success response can be replayed safely. An absent or foreign record
 -- never authorizes deleting the supplied memories.
 if conversation_id is null then return jsonb_build_object('deleted',false,'memoriesDeleted',0); end if;
 select count(*) into matching_count from memories m where m.id=any(selected_ids)
  and m.user_id=owner_id and m.source_conversation_id=conversation_id;
 if matching_count<>selected_count then raise exception 'MEMORY_SELECTION_CHANGED'; end if;
 delete from memories m where m.id=any(selected_ids) and m.user_id=owner_id and m.source_conversation_id=conversation_id;
 if p_kind='CONVERSATION' then
  delete from conversations where id=p_record_id and user_id=owner_id;
 else
  delete from consultations where id=p_record_id and user_id=owner_id;
 end if;
 return jsonb_build_object('deleted',true,'memoriesDeleted',selected_count);
end $$;

revoke all on function public.history_deletion_memories(text,uuid),public.delete_history_with_memories(text,uuid,uuid[]) from public,anon;
grant execute on function public.history_deletion_memories(text,uuid),public.delete_history_with_memories(text,uuid,uuid[]) to authenticated;
