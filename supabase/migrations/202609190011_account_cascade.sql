-- A direct account deletion removes auth.users before its FK cascades run.
-- Do not update a child row that is itself waiting for deletion: PostgreSQL
-- rechecks its user FK and can reject the whole account-deletion transaction.
-- Ordinary conversation/consultation deletion still clears replay caches.
create or replace function public.clear_deleted_consultation_cache() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from auth.users where id=old.user_id) then
  update request_executions set response_data=null,error=null where consultation_id=old.id and user_id=old.user_id;
 end if;
 return old;
end $$;

create or replace function public.clear_deleted_conversation_cache() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from auth.users where id=old.user_id) then
  update request_executions set response_data=null,error=null,error_code='NOT_FOUND',status='FAILED',http_status=404 where conversation_id=old.id and user_id=old.user_id;
 end if;
 return old;
end $$;
