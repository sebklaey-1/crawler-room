REVOKE ALL ON TABLE cron.job_run_details FROM PUBLIC;
REVOKE ALL ON TABLE cron.job_run_details FROM anon, authenticated;
REVOKE ALL ON TABLE cron.job FROM PUBLIC;
REVOKE ALL ON TABLE cron.job FROM anon, authenticated;
REVOKE USAGE ON SCHEMA cron FROM PUBLIC, anon, authenticated;