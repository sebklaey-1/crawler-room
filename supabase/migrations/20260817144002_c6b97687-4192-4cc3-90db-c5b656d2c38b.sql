REVOKE ALL ON FUNCTION public.cleanup_oauth_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_oauth_state() TO service_role, postgres;

REVOKE ALL ON ALL TABLES IN SCHEMA cron FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SCHEMA cron FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA cron FROM PUBLIC, anon, authenticated;