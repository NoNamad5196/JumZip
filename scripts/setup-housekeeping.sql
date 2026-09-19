-- Run once on hosted Supabase after migrations. Named schedule updates are idempotent.
-- Docs: https://supabase.com/docs/guides/cron/install
begin;
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
select cron.schedule('jumzip-anonymous-90-day-cleanup','13 * * * *',
  'select public.cleanup_inactive_anonymous(now() - interval ''90 days'',100);');
commit;
select jobname,schedule,active from cron.job where jobname='jumzip-anonymous-90-day-cleanup';
