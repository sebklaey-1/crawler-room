do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

revoke all on schema cron from anon, authenticated;
revoke all on all tables in schema cron from anon, authenticated;
revoke all on all functions in schema cron from anon, authenticated;
revoke all on all sequences in schema cron from anon, authenticated;