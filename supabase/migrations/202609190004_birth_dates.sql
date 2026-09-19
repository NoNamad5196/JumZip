-- Lunar month/day labels are not Gregorian dates (a lunar February may have day 30).
alter table public.birth_profiles alter column birth_date type text using birth_date::text;
create function public.valid_birth_date(p_calendar text,p_value text) returns boolean language plpgsql immutable set search_path=public as $$
begin
 if p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
 if p_calendar='LUNAR' then return substring(p_value,1,4)::int between 1 and 9999 and substring(p_value,6,2)::int between 1 and 12 and substring(p_value,9,2)::int between 1 and 30; end if;
 if p_calendar<>'SOLAR' then return false; end if;
 return to_char(p_value::date,'YYYY-MM-DD')=p_value;
exception when others then return false;
end $$;
alter table public.birth_profiles add constraint birth_date_calendar_valid check(public.valid_birth_date(calendar_type,birth_date));
alter table public.birth_profiles add constraint solar_not_leap_month check(calendar_type='LUNAR' or not leap_month);

alter table public.related_people add column birth_data_opt_in boolean not null default false;
grant update(birth_data_opt_in) on public.related_people to authenticated;
create function public.require_related_birth_consent() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.owner_type='RELATED_PERSON' and not exists(select 1 from related_people where id=new.related_person_id and user_id=new.user_id and birth_data_opt_in) then raise exception 'FORBIDDEN'; end if;
 return new;
end $$;
create trigger require_related_birth_consent before insert or update on public.birth_profiles for each row execute function public.require_related_birth_consent();
create function public.revoke_related_birth_consent() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.birth_data_opt_in and not new.birth_data_opt_in then delete from birth_profiles where related_person_id=old.id and user_id=old.user_id; end if;
 return new;
end $$;
create trigger revoke_related_birth_consent before update on public.related_people for each row execute function public.revoke_related_birth_consent();
revoke all on function public.require_related_birth_consent() from public,anon,authenticated;
revoke all on function public.revoke_related_birth_consent() from public,anon,authenticated;
