DO $do$
DECLARE v_token text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'crawler_room_cleanup_token') THEN
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    PERFORM vault.create_secret(v_token, 'crawler_room_cleanup_token', 'Bearer token for the retention cleanup endpoint');
    INSERT INTO public.internal_secret_hashes (name, sha256)
    VALUES ('crawler_room_cleanup_token', encode(extensions.digest(v_token, 'sha256'), 'hex'))
    ON CONFLICT (name) DO UPDATE SET sha256 = EXCLUDED.sha256;
  ELSIF NOT EXISTS (SELECT 1 FROM public.internal_secret_hashes WHERE name = 'crawler_room_cleanup_token') THEN
    INSERT INTO public.internal_secret_hashes (name, sha256)
    SELECT 'crawler_room_cleanup_token', encode(extensions.digest(decrypted_secret, 'sha256'), 'hex')
      FROM vault.decrypted_secrets WHERE name = 'crawler_room_cleanup_token'
    ON CONFLICT (name) DO UPDATE SET sha256 = EXCLUDED.sha256;
  END IF;
END
$do$;

DO $do$
DECLARE v_job record;
BEGIN
  FOR v_job IN SELECT jobid FROM cron.job WHERE jobname = 'crawler-room-cleanup' LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'crawler-room-cleanup',
    '*/15 * * * *',
    $job$
    SELECT net.http_post(
      url := 'https://crawler.today/api/public/admin/cleanup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
                                        WHERE name = 'crawler_room_cleanup_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 20000
    );
    $job$
  );
END
$do$;