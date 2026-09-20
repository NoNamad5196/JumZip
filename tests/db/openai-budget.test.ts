import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';

let db: PGlite;
async function scalar<T = any>(sql: string, params: unknown[] = []): Promise<T> {
  const value = await db.query<Record<string,T>>(sql, params); return Object.values(value.rows[0])[0];
}
const reserve = (bytes = 10000, output = 900, model = 'gpt-5.6-luna') => scalar<{reservationId: string;reservedMicros: number}>('select reserve_openai_budget($1,$2,$3)', [model,bytes,output]);
const settle = (id: string, input = 3000, output = 500) => scalar('select settle_openai_budget($1,$2,$3)', [id,input,output]);
const consumed = () => scalar<number>("select consumed_micros::int from llm_budget_policy where id='openai-luna'");
beforeAll(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;');
  await db.exec(readFileSync(new URL('../../supabase/migrations/202609200016_openai_budget.sql', import.meta.url), 'utf8'));
}, 30000);
beforeEach(async () => {
  await db.exec("reset role; truncate llm_budget_reservations, llm_budget_periods; update llm_budget_policy set enabled=true,expires_at=now()+interval '30 days',daily_limit_micros=100000,monthly_limit_micros=1000000,total_limit_micros=1000000,consumed_micros=0;");
});
afterAll(async () => { await db?.close(); });
describe('persistent paid OpenAI budget', () => {
  it('reserves before sending and settles a conservative cost only once', async () => {
    const hold = await reserve();
    expect(hold.reservedMicros).toBe(3836); expect(await consumed()).toBe(3836);
    expect(await settle(hold.reservationId)).toBe(true); expect(await consumed()).toBe(1350);
    expect(await settle(hold.reservationId,1,0)).toBe(true); expect(await consumed()).toBe(1350);
    const periods = await db.query<{consumed_micros: number}>('select consumed_micros::int from llm_budget_periods');
    expect(periods.rows.map(row => row.consumed_micros)).toEqual([1350,1350]);
  });
  it('keeps failed or uncertain requests charged and rejects malformed usage', async () => {
    const hold = await reserve();
    expect(await settle(hold.reservationId,12000,500)).toBe(false);
    expect(await settle(hold.reservationId,3000,901)).toBe(false);
    expect(await consumed()).toBe(3836);
  });
  it('serializes competing reservations at the daily boundary', async () => {
    await db.exec('update llm_budget_policy set daily_limit_micros=8000;');
    const outcomes = await Promise.allSettled(Array.from({length:10},() => reserve()));
    expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(2);
    expect(await consumed()).toBe(7672);
    expect(await scalar('select count(*)::int from llm_budget_reservations')).toBe(2);
  });
  it('enforces monthly and total budgets independently of the day counter', async () => {
    await db.exec('update llm_budget_policy set monthly_limit_micros=4000;');
    await reserve(); await expect(reserve()).rejects.toThrow('LLM_BUDGET_EXCEEDED');
    await db.exec("update llm_budget_periods set consumed_micros=0 where period_kind='MONTH'; update llm_budget_policy set total_limit_micros=4000;");
    await expect(reserve()).rejects.toThrow('LLM_BUDGET_EXCEEDED');
    expect(await consumed()).toBe(3836);
  });
  it('stops when disabled, expired or misconfigured without making a hold', async () => {
    await db.exec('update llm_budget_policy set enabled=false;');
    await expect(reserve()).rejects.toThrow('LLM_BUDGET_EXCEEDED');
    await db.exec("update llm_budget_policy set enabled=true,expires_at=now()-interval '1 second';");
    await expect(reserve()).rejects.toThrow('LLM_BUDGET_EXCEEDED');
    await expect(reserve(64001)).rejects.toThrow('LLM_BUDGET_INVALID_REQUEST');
    await expect(reserve(1,901)).rejects.toThrow('LLM_BUDGET_INVALID_REQUEST');
    await expect(reserve(1,1,'gpt-5.6-terra')).rejects.toThrow('LLM_BUDGET_INVALID_REQUEST');
    expect(await consumed()).toBe(0);
  });
  it('keeps KST reservation periods for late settlement across a day boundary', async () => {
    const hold = await reserve();
    await db.exec("update llm_budget_periods set period_start=period_start-interval '2 months'; update llm_budget_reservations set day_start=day_start-interval '2 months',month_start=month_start-interval '2 months';");
    expect(await settle(hold.reservationId)).toBe(true);
    expect(await scalar("select sum(consumed_micros)::int from llm_budget_periods")).toBe(2700);
  });
  it.each(['anon','authenticated'])('denies %s reserve, settlement, policy and ledger access', async role => {
    await db.exec(`set role ${role};`);
    await expect(reserve()).rejects.toThrow('permission denied');
    await expect(settle(crypto.randomUUID())).rejects.toThrow('permission denied');
    await expect(consumed()).rejects.toThrow('permission denied');
    await expect(scalar('select count(*) from llm_budget_reservations')).rejects.toThrow('permission denied');
  });
  it('allows the trusted server role to reserve but not directly lower counters', async () => {
    await db.exec('set role service_role;');
    const hold = await reserve(); expect(hold.reservedMicros).toBe(3836);
    await expect(db.exec('update llm_budget_policy set consumed_micros=0')).rejects.toThrow('permission denied');
    expect(await settle(hold.reservationId)).toBe(true);
  });
});
