-- Paid fallback only. Amounts are integer USD millionths, not floating point dollars.
-- Short-context Luna standard pricing checked 2026-09-20; input includes the cache-write upper rate.
create table public.llm_budget_policy (
  id text primary key check (id = 'openai-luna'),
  enabled boolean not null default true,
  expires_at timestamptz not null default (now() + interval '30 days'),
  daily_limit_micros bigint not null default 100000 check (daily_limit_micros between 1 and 100000),
  monthly_limit_micros bigint not null default 1000000 check (monthly_limit_micros between 1 and 1000000),
  total_limit_micros bigint not null default 1000000 check (total_limit_micros between 1 and 1000000),
  consumed_micros bigint not null default 0 check (consumed_micros >= 0)
);
insert into public.llm_budget_policy(id) values ('openai-luna');
create table public.llm_budget_periods (
  period_kind text not null check (period_kind in ('DAY','MONTH')),
  period_start date not null,
  consumed_micros bigint not null default 0 check (consumed_micros >= 0),
  primary key (period_kind, period_start)
);
create table public.llm_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  day_start date not null,
  month_start date not null,
  input_bytes integer not null,
  max_output_tokens integer not null,
  reserved_micros bigint not null check (reserved_micros > 0),
  charged_micros bigint,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  check (charged_micros is null or charged_micros between 0 and reserved_micros)
);
alter table public.llm_budget_policy enable row level security;
alter table public.llm_budget_periods enable row level security;
alter table public.llm_budget_reservations enable row level security;
revoke all on public.llm_budget_policy, public.llm_budget_periods, public.llm_budget_reservations from public, anon, authenticated;
grant select on public.llm_budget_policy, public.llm_budget_periods, public.llm_budget_reservations to service_role;

create function public.reserve_openai_budget(p_model text, p_input_bytes integer, p_max_output_tokens integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  policy public.llm_budget_policy%rowtype;
  at_time timestamptz;
  day_date date;
  month_date date;
  amount bigint;
  reservation_id uuid;
begin
  if p_model is distinct from 'gpt-5.6-luna' or p_input_bytes is null or p_input_bytes not between 1 and 64000
    or p_max_output_tokens is null or p_max_output_tokens not between 1 and 900 then
    raise exception 'LLM_BUDGET_INVALID_REQUEST';
  end if;
  -- A serialized text-only payload overbounds byte-level tokens, with 1024 tokens of overhead.
  amount := ceil((p_input_bytes + 1024)::numeric * 0.25 + p_max_output_tokens::numeric * 1.2);
  -- This singleton lock serializes day/month/total reservation AND settlement across Edge instances.
  select * into policy from public.llm_budget_policy where id = 'openai-luna' for update;
  at_time := clock_timestamp();
  day_date := (at_time at time zone 'Asia/Seoul')::date;
  month_date := date_trunc('month', at_time at time zone 'Asia/Seoul')::date;
  if not found or not policy.enabled or at_time >= policy.expires_at then raise exception 'LLM_BUDGET_EXCEEDED'; end if;
  insert into public.llm_budget_periods(period_kind, period_start) values ('DAY', day_date), ('MONTH', month_date) on conflict do nothing;
  if policy.consumed_micros + amount > policy.total_limit_micros
    or (select consumed_micros + amount from public.llm_budget_periods where period_kind = 'DAY' and period_start = day_date) > policy.daily_limit_micros
    or (select consumed_micros + amount from public.llm_budget_periods where period_kind = 'MONTH' and period_start = month_date) > policy.monthly_limit_micros then
    raise exception 'LLM_BUDGET_EXCEEDED';
  end if;
  update public.llm_budget_policy set consumed_micros = consumed_micros + amount where id = 'openai-luna';
  update public.llm_budget_periods set consumed_micros = consumed_micros + amount
    where (period_kind = 'DAY' and period_start = day_date) or (period_kind = 'MONTH' and period_start = month_date);
  insert into public.llm_budget_reservations(day_start, month_start, input_bytes, max_output_tokens, reserved_micros)
    values (day_date, month_date, p_input_bytes, p_max_output_tokens, amount) returning id into reservation_id;
  return jsonb_build_object('reservationId', reservation_id, 'reservedMicros', amount);
end;
$$;

create function public.settle_openai_budget(p_reservation_id uuid, p_prompt_tokens integer, p_completion_tokens integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  reservation public.llm_budget_reservations%rowtype;
  amount bigint;
  refund bigint;
begin
  perform 1 from public.llm_budget_policy where id = 'openai-luna' for update;
  select * into reservation from public.llm_budget_reservations where id = p_reservation_id for update;
  if not found then return false; end if;
  -- Replays never refund twice; uncertain/failed requests deliberately keep their full hold.
  if reservation.charged_micros is not null then return true; end if;
  if p_prompt_tokens is null or p_prompt_tokens not between 1 and reservation.input_bytes + 1024
    or p_completion_tokens is null or p_completion_tokens not between 0 and reservation.max_output_tokens then return false; end if;
  amount := ceil(p_prompt_tokens::numeric * 0.25 + p_completion_tokens::numeric * 1.2);
  if amount > reservation.reserved_micros then return false; end if;
  refund := reservation.reserved_micros - amount;
  update public.llm_budget_policy set consumed_micros = consumed_micros - refund where id = 'openai-luna';
  update public.llm_budget_periods set consumed_micros = consumed_micros - refund
    where (period_kind = 'DAY' and period_start = reservation.day_start) or (period_kind = 'MONTH' and period_start = reservation.month_start);
  update public.llm_budget_reservations set charged_micros = amount, settled_at = clock_timestamp() where id = p_reservation_id;
  return true;
end;
$$;
revoke all on function public.reserve_openai_budget(text,integer,integer), public.settle_openai_budget(uuid,integer,integer) from public, anon, authenticated;
grant execute on function public.reserve_openai_budget(text,integer,integer), public.settle_openai_budget(uuid,integer,integer) to service_role;
