-- Project the immutable timing metadata already held in the result snapshot.
-- Do not recalculate historical timing on reload or interpretation retry.
create or replace function public.saju_snapshot(p_reading_id uuid,p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r saju_readings; c consultations; answer messages; result jsonb; stem text; flow jsonb;
begin
 select * into r from saju_readings where id=p_reading_id and user_id=p_user_id;
 if not found then raise exception 'NOT_FOUND'; end if;
 select * into c from consultations where id=r.consultation_id and user_id=p_user_id;
 select * into answer from messages where user_id=p_user_id and sender='ASSISTANT' and metadata->'saju'->>'readingId'=r.id::text order by created_at desc,id desc limit 1;
 stem=r.pillars->'day'->>'heavenlyStem';
 flow=jsonb_build_object('daewoon',r.daewoon,'sewoon',r.sewoon,'monthlyFortune',r.monthly_fortune);
 if jsonb_typeof(r.result_snapshot->'timing')='object' then
  flow=flow||jsonb_build_object('timing',r.result_snapshot->'timing');
 end if;
 result=jsonb_build_object('executionStatus',case when answer.id is null then 'PARTIAL' else 'SUCCEEDED' end,
  'readingId',r.id,'conversationId',c.conversation_id,'consultationId',r.consultation_id,
  'engineVersion',r.engine_version,'ruleVersion',r.rule_version,'conventionVersion',r.convention_version,
  'uncertaintyFlags',r.uncertainty_flags,'result',r.result_snapshot,
  'inlineResult',jsonb_build_object('dayMaster',stem||case when stem in ('甲','乙') then '木' when stem in ('丙','丁') then '火' when stem in ('戊','己') then '土' when stem in ('庚','辛') then '金' when stem in ('壬','癸') then '水' end,
   'pillars',r.pillars,'elements',r.elements,'currentFlow',flow),
  'interpretation',case when answer.id is null then null else jsonb_build_object('messageId',answer.id,'content',answer.content,'segments',coalesce(answer.metadata->'segments','[]')) end);
 if answer.id is null then result=result||jsonb_build_object('partialError',jsonb_build_object('code','SAJU_INTERPRETATION_FAILED','message','사주 원국은 저장됐어요. 해석을 다시 요청할 수 있어요.','retryable',true)); end if;
 return result;
end $$;
