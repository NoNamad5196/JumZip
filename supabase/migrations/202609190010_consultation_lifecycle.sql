grant delete on public.consultations to authenticated;
create policy own_delete on public.consultations for delete to authenticated using((select auth.uid())=user_id);
create function public.clear_deleted_consultation_cache() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update request_executions set response_data=null,error=null where consultation_id=old.id and user_id=old.user_id;
 return old;
end $$;
create trigger clear_deleted_consultation_cache before delete on public.consultations for each row execute function public.clear_deleted_consultation_cache();
revoke all on function public.clear_deleted_consultation_cache() from public,anon,authenticated;
