-- 1. Extensions ---------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 2. Internal secret hash registry ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.internal_secret_hashes (
  name text PRIMARY KEY,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.internal_secret_hashes FROM anon, authenticated;
GRANT ALL ON public.internal_secret_hashes TO service_role;
ALTER TABLE public.internal_secret_hashes ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS internal_secret_hashes_touch ON public.internal_secret_hashes;
CREATE TRIGGER internal_secret_hashes_touch BEFORE UPDATE ON public.internal_secret_hashes
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Idempotent generation of a 256 bit cleanup token. The plaintext exists only
-- inside this transaction and inside Supabase Vault; only its SHA-256 digest
-- is persisted in the public schema.
DO $do$
DECLARE
  v_token text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'crawler_room_cleanup_token') THEN
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    PERFORM vault.create_secret(v_token, 'crawler_room_cleanup_token',
                                'Crawler Room internal retention cleanup token');
    INSERT INTO public.internal_secret_hashes (name, sha256)
    VALUES ('crawler_room_cleanup_token', encode(extensions.digest(v_token, 'sha256'), 'hex'))
    ON CONFLICT (name) DO UPDATE SET sha256 = EXCLUDED.sha256, updated_at = now();
  ELSIF NOT EXISTS (SELECT 1 FROM public.internal_secret_hashes WHERE name = 'crawler_room_cleanup_token') THEN
    INSERT INTO public.internal_secret_hashes (name, sha256)
    SELECT 'crawler_room_cleanup_token', encode(extensions.digest(decrypted_secret, 'sha256'), 'hex')
      FROM vault.decrypted_secrets WHERE name = 'crawler_room_cleanup_token';
  END IF;
END
$do$;

-- 3. Persistent storage deletion queue ------------------------------------------
CREATE TABLE IF NOT EXISTS public.storage_deletion_queue (
  storage_path text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.storage_deletion_queue FROM anon, authenticated;
GRANT ALL ON public.storage_deletion_queue TO service_role;
ALTER TABLE public.storage_deletion_queue ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS storage_deletion_queue_due_idx
  ON public.storage_deletion_queue (next_attempt_at);

DROP TRIGGER IF EXISTS storage_deletion_queue_touch ON public.storage_deletion_queue;
CREATE TRIGGER storage_deletion_queue_touch BEFORE UPDATE ON public.storage_deletion_queue
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. Maintenance run metrics ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.maintenance_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  counters jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_category text
);
REVOKE ALL ON public.maintenance_runs FROM anon, authenticated;
GRANT ALL ON public.maintenance_runs TO service_role;
ALTER TABLE public.maintenance_runs ENABLE ROW LEVEL SECURITY;

-- 5. Retention functions: queue the storage path before deleting the row ----------
CREATE OR REPLACE FUNCTION public.enforce_image_retention(p_room_id uuid)
 RETURNS TABLE(storage_path text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('room_image_retention:' || p_room_id::text));
  SELECT COALESCE(r.retention_images, 3) INTO v_limit FROM public.rooms r WHERE r.id = p_room_id;
  IF v_limit IS NULL THEN v_limit := 3; END IF;

  RETURN QUERY
  WITH doomed AS (
    SELECT i.id, i.storage_path
      FROM public.image_messages i
     WHERE i.room_id = p_room_id
       AND (
         i.created_at < now() - interval '24 hours'
         OR i.expires_at <= now()
         OR (
           i.moderation_status = 'approved'
           AND i.id NOT IN (
             SELECT id FROM public.image_messages
              WHERE room_id = p_room_id AND moderation_status = 'approved'
              ORDER BY created_at DESC, id DESC
              LIMIT v_limit
           )
         )
       )
  ), queued AS (
    INSERT INTO public.storage_deletion_queue (storage_path)
    SELECT d.storage_path FROM doomed d
    ON CONFLICT (storage_path) DO NOTHING
    RETURNING storage_path
  ), removed AS (
    DELETE FROM public.image_messages i
     USING doomed d
     WHERE i.id = d.id
    RETURNING i.storage_path
  )
  SELECT r.storage_path FROM removed r
   WHERE (SELECT count(*) FROM queued) >= 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.purge_dead_images()
 RETURNS TABLE(storage_path text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH doomed AS (
    SELECT i.id, i.storage_path
      FROM public.image_messages i
     WHERE i.created_at < now() - interval '24 hours'
        OR i.expires_at <= now()
        OR i.moderation_status IN ('rejected', 'failed')
        OR (i.moderation_status = 'pending' AND i.created_at < now() - interval '30 minutes')
  ), queued AS (
    INSERT INTO public.storage_deletion_queue (storage_path)
    SELECT d.storage_path FROM doomed d
    ON CONFLICT (storage_path) DO NOTHING
    RETURNING storage_path
  ), removed AS (
    DELETE FROM public.image_messages i
     USING doomed d
     WHERE i.id = d.id
    RETURNING i.storage_path
  )
  SELECT r.storage_path FROM removed r
   WHERE (SELECT count(*) FROM queued) >= 0;
END;
$function$;

-- Transactional helper used by the server before it deletes a single image row.
CREATE OR REPLACE FUNCTION public.queue_storage_deletion(p_paths text[])
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH inserted AS (
    INSERT INTO public.storage_deletion_queue (storage_path)
    SELECT DISTINCT p FROM unnest(coalesce(p_paths, '{}'::text[])) AS p
     WHERE p IS NOT NULL AND length(p) > 0
    ON CONFLICT (storage_path) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer FROM inserted;
$function$;

-- Marks a queue entry as successfully removed (idempotent).
CREATE OR REPLACE FUNCTION public.complete_storage_deletion(p_paths text[])
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH gone AS (
    DELETE FROM public.storage_deletion_queue
     WHERE storage_path = ANY(coalesce(p_paths, '{}'::text[]))
    RETURNING 1
  )
  SELECT count(*)::integer FROM gone;
$function$;

-- Records a failed attempt with a bounded exponential backoff (max 60 minutes).
CREATE OR REPLACE FUNCTION public.fail_storage_deletion(p_paths text[], p_category text)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH bumped AS (
    UPDATE public.storage_deletion_queue q
       SET attempts = q.attempts + 1,
           last_error = left(coalesce(p_category, 'unknown'), 64),
           next_attempt_at = now() + make_interval(mins => least(60, power(2, least(q.attempts, 6))::integer))
     WHERE q.storage_path = ANY(coalesce(p_paths, '{}'::text[]))
    RETURNING 1
  )
  SELECT count(*)::integer FROM bumped;
$function$;

-- Due queue entries, oldest first, in bounded batches.
CREATE OR REPLACE FUNCTION public.due_storage_deletions(p_limit integer DEFAULT 100)
 RETURNS TABLE(storage_path text, attempts integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT q.storage_path, q.attempts
    FROM public.storage_deletion_queue q
   WHERE q.next_attempt_at <= now()
   ORDER BY q.next_attempt_at ASC
   LIMIT greatest(1, least(coalesce(p_limit, 100), 500));
$function$;

-- 6. Scheduler ---------------------------------------------------------------------
DO $do$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN SELECT jobid FROM cron.job WHERE jobname = 'crawler-room-cleanup' LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'crawler-room-cleanup',
    '*/15 * * * *',
    $job$
    SELECT net.http_post(
      url := 'https://zinga-room.lovable.app/api/public/admin/cleanup',
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

-- 7. Secret-free status function -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_scheduler_status()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_jobs integer;
  v_active integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE active) INTO v_jobs, v_active
    FROM cron.job WHERE jobname = 'crawler-room-cleanup';

  RETURN json_build_object(
    'pg_cron', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'),
    'pg_net', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net'),
    'vault_secret_present', EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'crawler_room_cleanup_token'),
    'token_hash_present', EXISTS (SELECT 1 FROM public.internal_secret_hashes WHERE name = 'crawler_room_cleanup_token'),
    'jobs', v_jobs,
    'active_jobs', v_active,
    'queue_pending', (SELECT count(*) FROM public.storage_deletion_queue),
    'recent_runs', (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
        SELECT started_at, finished_at, status, counters, error_category
          FROM public.maintenance_runs ORDER BY started_at DESC LIMIT 5) x)
  );
END;
$function$;