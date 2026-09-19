-- Clients may edit their location but cannot attest its provider verification.
alter table public.birth_profiles add column location_verified_at timestamptz;
alter table public.birth_profiles add column location_provider_id text check(location_provider_id is null or location_provider_id ~ '^[1-9][0-9]{0,11}$');
grant insert(location_provider_id),update(location_provider_id) on public.birth_profiles to authenticated;
create function public.invalidate_location_verification() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if row(new.city,new.country,new.latitude,new.longitude,new.timezone,new.location_provider_id) is distinct from row(old.city,old.country,old.latitude,old.longitude,old.timezone,old.location_provider_id)
  and new.location_verified_at is not distinct from old.location_verified_at then new.location_verified_at=null; end if;
 return new;
end $$;
create trigger invalidate_location_verification before update on public.birth_profiles for each row execute function public.invalidate_location_verification();

create function public.record_verified_birth_location(p_user_id uuid,p_profile_id uuid,p_expected_location jsonb,p_verified_location jsonb) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 update birth_profiles b set city=p_verified_location->>'name',country=coalesce(p_verified_location->>'country',''),latitude=(p_verified_location->>'latitude')::numeric,longitude=(p_verified_location->>'longitude')::numeric,timezone=p_verified_location->>'timezone',location_provider='open-meteo',location_provider_id=p_verified_location->>'providerId',location_resolved_at=now(),location_verified_at=now()
 where b.id=p_profile_id and b.user_id=p_user_id and (b.owner_type='USER' or exists(select 1 from related_people p where p.id=b.related_person_id and p.user_id=p_user_id and p.birth_data_opt_in))
 and row(b.city,b.country,b.latitude,b.longitude,b.timezone,b.location_provider_id) is not distinct from row(p_expected_location->>'name',coalesce(p_expected_location->>'country',''),(p_expected_location->>'latitude')::numeric,(p_expected_location->>'longitude')::numeric,p_expected_location->>'timezone',p_expected_location->>'providerId');
 return found;
end $$;
revoke all on function public.invalidate_location_verification() from public,anon,authenticated;
revoke all on function public.record_verified_birth_location(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.record_verified_birth_location(uuid,uuid,jsonb,jsonb) to service_role;


create or replace function public.save_saju_reading(p_execution_id uuid,p_result jsonb,p_birth_profile_snapshot jsonb,p_profile_input jsonb default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e request_executions; r saju_readings; snap jsonb; b jsonb=p_profile_input;
begin
 select * into e from request_executions where id=p_execution_id for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if e.resource_type='SAJU' then return saju_snapshot(e.resource_id,e.user_id); end if;
 if e.status<>'PENDING' or e.lease_expires_at<now() then raise exception 'REQUEST_IN_PROGRESS'; end if;
 if not exists(select 1 from consultations where id=e.consultation_id and user_id=e.user_id and fortune_type='SAJU') then raise exception 'NOT_FOUND'; end if;
 if p_result->>'fullCalculationReady' is distinct from 'true' or p_result->>'ruleVersion' is distinct from 'JumZipSajuRules-v1' or p_result->>'conventionVersion' is distinct from 'JumZipSajuConvention-v1' or p_result->>'engineVersion' is distinct from 'manseryeok-2.0.0' or jsonb_typeof(p_result->'pillars') is distinct from 'object' then raise exception 'VALIDATION_ERROR'; end if;
 if b is not null then
  perform pg_advisory_xact_lock(hashtextextended(e.user_id::text||'USER',9));
  insert into birth_profiles(user_id,owner_type,calendar_type,leap_month,birth_date,birth_time,unknown_birth_time,city,country,latitude,longitude,timezone,location_provider,location_resolved_at,gender,location_verified_at,location_provider_id)
  values(e.user_id,'USER',b->>'calendarType',coalesce((b->>'leapMonth')::boolean,false),b->>'birthDate',(b->>'birthTime')::time,(b->>'birthTimeUnknown')::boolean,b->'location'->>'name',coalesce(b->'location'->>'country',''),(b->'location'->>'latitude')::numeric,(b->'location'->>'longitude')::numeric,b->'location'->>'timezone','open-meteo',now(),b->>'gender',now(),b->'location'->>'providerId')
  on conflict(user_id) where owner_type='USER' do update set calendar_type=excluded.calendar_type,leap_month=excluded.leap_month,birth_date=excluded.birth_date,birth_time=excluded.birth_time,unknown_birth_time=excluded.unknown_birth_time,city=excluded.city,country=excluded.country,latitude=excluded.latitude,longitude=excluded.longitude,timezone=excluded.timezone,location_provider=excluded.location_provider,location_resolved_at=excluded.location_resolved_at,gender=excluded.gender,location_verified_at=excluded.location_verified_at,location_provider_id=excluded.location_provider_id,updated_at=now();
 end if;
 insert into saju_readings(user_id,consultation_id,birth_profile_snapshot,convention_version,engine_version,rule_version,pillars,elements,ten_gods,hidden_stems,relations,gongmang,strength,gyeokguk,yongsin,heesin,twelve_stages,shinsal,daewoon,sewoon,monthly_fortune,uncertainty_flags,result_snapshot)
 values(e.user_id,e.consultation_id,p_birth_profile_snapshot,p_result->>'conventionVersion',p_result->>'engineVersion',p_result->>'ruleVersion',p_result->'pillars',p_result->'elements',p_result->'tenGods',p_result->'hiddenStems',p_result->'relations',p_result->'gongmang',p_result->'strength',p_result->'gyeokguk',p_result->'yongsin',p_result->'heesin',p_result->'twelveStages',p_result->'shinsal',p_result->'daewoon',p_result->'sewoon',p_result->'monthlyFortune',coalesce(p_result->'uncertaintyFlags','[]'),p_result) returning * into r;
 snap=saju_snapshot(r.id,e.user_id);
 update request_executions set resource_type='SAJU',resource_id=r.id,status='PARTIAL',response_data=snap-'result',http_status=200,updated_at=now() where id=e.id;
 insert into messages(user_id,conversation_id,consultation_id,sender,type,content,request_id,metadata) values(e.user_id,e.conversation_id,e.consultation_id,'SYSTEM','SAJU_SNAPSHOT','',e.request_id,jsonb_build_object('saju',snap-'result'));
 return snap;
end $$;

create or replace function public.save_saju_compatibility(p_execution_id uuid,p_result jsonb,p_person_a_profile_input jsonb default null,p_person_b_profile_input jsonb default null,p_person_b_alias text default null,p_related_person_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e request_executions; r saju_compatibility_readings; snap jsonb; b jsonb; v_related uuid=p_related_person_id; v_birth uuid; v_owner text;
begin
 select * into e from request_executions where id=p_execution_id for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if e.resource_type='COMPATIBILITY_SAJU' then return saju_compatibility_snapshot(e.resource_id,e.user_id); end if;
 if e.status<>'PENDING' or e.lease_expires_at<now() then raise exception 'REQUEST_IN_PROGRESS'; end if;
 if not exists(select 1 from consultations where id=e.consultation_id and user_id=e.user_id and fortune_type='COMPATIBILITY_SAJU') then raise exception 'NOT_FOUND'; end if;
 if p_result->>'kind' is distinct from 'SAJU_COMPATIBILITY' or p_result->>'ruleVersion' is distinct from 'JumZipSajuRules-v1' or jsonb_typeof(p_result->'personA') is distinct from 'object' or jsonb_typeof(p_result->'personB') is distinct from 'object' then raise exception 'VALIDATION_ERROR'; end if;
 -- Two explicit profile requests, one transaction. Aliases/related IDs are never stored otherwise.
 for v_owner,b in select 'USER',p_person_a_profile_input union all select 'RELATED_PERSON',p_person_b_profile_input loop
  if b is null then continue; end if;
  if v_owner='RELATED_PERSON' then
   if v_related is null then
    if nullif(trim(p_person_b_alias),'') is null or char_length(p_person_b_alias)>40 then raise exception 'VALIDATION_ERROR'; end if;
    insert into related_people(user_id,display_name,birth_data_opt_in,memory_opt_in) values(e.user_id,p_person_b_alias,true,false) returning id into v_related;
   else
    update related_people set birth_data_opt_in=true where id=v_related and user_id=e.user_id;
    if not found then raise exception 'NOT_FOUND'; end if;
   end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(e.user_id::text||v_owner||case when v_owner='RELATED_PERSON' then v_related::text else '' end,9));
  select id into v_birth from birth_profiles where user_id=e.user_id and owner_type=v_owner and (v_owner='USER' or related_person_id=v_related) for update;
  if found then
   update birth_profiles set calendar_type=b->>'calendarType',leap_month=coalesce((b->>'leapMonth')::boolean,false),birth_date=b->>'birthDate',birth_time=(b->>'birthTime')::time,unknown_birth_time=(b->>'birthTimeUnknown')::boolean,city=b->'location'->>'name',country=coalesce(b->'location'->>'country',''),latitude=(b->'location'->>'latitude')::numeric,longitude=(b->'location'->>'longitude')::numeric,timezone=b->'location'->>'timezone',location_provider='open-meteo',location_resolved_at=now(),gender=b->>'gender',location_verified_at=now(),location_provider_id=b->'location'->>'providerId',updated_at=now() where id=v_birth;
  else
   insert into birth_profiles(user_id,owner_type,related_person_id,calendar_type,leap_month,birth_date,birth_time,unknown_birth_time,city,country,latitude,longitude,timezone,location_provider,location_resolved_at,gender,location_verified_at,location_provider_id)
   values(e.user_id,v_owner,case when v_owner='RELATED_PERSON' then v_related end,b->>'calendarType',coalesce((b->>'leapMonth')::boolean,false),b->>'birthDate',(b->>'birthTime')::time,(b->>'birthTimeUnknown')::boolean,b->'location'->>'name',coalesce(b->'location'->>'country',''),(b->'location'->>'latitude')::numeric,(b->'location'->>'longitude')::numeric,b->'location'->>'timezone','open-meteo',now(),b->>'gender',now(),b->'location'->>'providerId');
  end if;
 end loop;
 insert into saju_compatibility_readings(user_id,consultation_id,a_chart_snapshot,b_chart_snapshot,convention_version,engine_version,rule_version,day_master_relation,element_complement,stem_branch_relations,ten_gods,timing,strengths,frictions,uncertainty_flags,result_snapshot)
 values(e.user_id,e.consultation_id,p_result->'personA',p_result->'personB',p_result->>'conventionVersion',p_result->>'engineVersion',p_result->>'ruleVersion',p_result->'summary'->'dayMasterRelation',p_result->'summary'->'elementComplement',jsonb_build_object('spousePalaceRelations',p_result->'summary'->'spousePalaceRelations','stemRelations',p_result->'summary'->'stemRelations','branchRelations',p_result->'summary'->'branchRelations'),p_result->'summary'->'mutualTenGods',p_result->'summary'->'timing',p_result->'summary'->'strengths',p_result->'summary'->'frictions',coalesce(p_result->'uncertaintyFlags','[]'),p_result) returning * into r;
 snap=saju_compatibility_snapshot(r.id,e.user_id);
 update request_executions set resource_type='COMPATIBILITY_SAJU',resource_id=r.id,status='PARTIAL',response_data=snap-'result',http_status=200,updated_at=now() where id=e.id;
 insert into messages(user_id,conversation_id,consultation_id,sender,type,content,request_id,metadata) values(e.user_id,e.conversation_id,e.consultation_id,'SYSTEM','COMPATIBILITY_SNAPSHOT','',e.request_id,jsonb_build_object('compatibility',snap-'result'));
 return snap;
end $$;
