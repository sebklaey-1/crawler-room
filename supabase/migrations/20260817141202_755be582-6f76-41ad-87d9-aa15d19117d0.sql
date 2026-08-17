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

DO $$
DECLARE
  old_hash text := '4b20d6d24b195e696c56a64d31318be82e5ae3ac302b6f209e657238ee6e437e';
  new_hash text := '66b0969a2861a2e123857cecdebb0e5aea79a0c6cb05e64fe7f5828099ee942d';
  violet_room uuid := '6bc2d785-240e-4023-984d-dc92d7c675f4';
  satoshi_room uuid := '5cd071d9-84e8-4ecd-982b-00542224fa99';
BEGIN
  DELETE FROM public.name_claims WHERE owner_subject_hash = new_hash;
  DELETE FROM public.handle_redirects WHERE owner_subject_hash = new_hash;
  DELETE FROM public.user_rooms WHERE room_id = violet_room;
  DELETE FROM public.messages WHERE room_id = violet_room;
  DELETE FROM public.image_messages WHERE room_id = violet_room;
  DELETE FROM public.memberships WHERE room_id = violet_room;
  DELETE FROM public.room_followers WHERE room_id = violet_room;
  DELETE FROM public.analytics_events WHERE room_id = violet_room;
  DELETE FROM public.rooms WHERE id = violet_room;

  UPDATE public.name_claims SET owner_subject_hash = new_hash WHERE owner_subject_hash = old_hash;
  UPDATE public.handle_redirects SET owner_subject_hash = new_hash WHERE owner_subject_hash = old_hash;
  UPDATE public.memberships SET subject_hash = new_hash
    WHERE room_id = satoshi_room AND subject_hash = old_hash;
  UPDATE public.user_rooms SET owner_subject_hash = new_hash WHERE owner_subject_hash = old_hash;
  UPDATE public.analytics_events SET owner_subject_hash = new_hash WHERE owner_subject_hash = old_hash;
  UPDATE public.content_likes SET owner_subject_hash = new_hash WHERE owner_subject_hash = old_hash;
  UPDATE public.notification_settings SET subject_hash = new_hash WHERE subject_hash = old_hash
    AND NOT EXISTS (SELECT 1 FROM public.notification_settings n WHERE n.subject_hash = new_hash);
END $$;

revoke all on all tables in schema cron from anon, authenticated;
revoke usage on schema cron from anon, authenticated;

do $$
declare hs text[] := array[
  '890c56d54b82134f2c42ec8eef81424965b0b61aef263fcbcff0e156efa0508b',
  'e870b9cf3ac09bd45b181a3f35dc8ccc887263635e73bb6f8f289cfa15f941d4'];
declare rids uuid[];
begin
  select array_agg(room_id) into rids from public.user_rooms where owner_subject_hash = any(hs);
  delete from public.analytics_events where owner_subject_hash = any(hs);
  delete from public.content_likes where subject_hash = any(hs) or owner_subject_hash = any(hs);
  delete from public.handle_redirects where owner_subject_hash = any(hs);
  delete from public.memberships where subject_hash = any(hs);
  delete from public.notification_settings where subject_hash = any(hs);
  delete from public.profile_blocks where subject_hash = any(hs) or blocked_subject_hash = any(hs);
  delete from public.rate_events where subject_hash = any(hs);
  delete from public.room_followers where follower_subject_hash = any(hs);
  delete from public.room_notifications where recipient_subject_hash = any(hs);
  delete from public.user_hidden_campaigns where subject_hash = any(hs);
  delete from public.campaign_impression_log where subject_hash = any(hs);
  delete from public.user_rooms where owner_subject_hash = any(hs);
  if rids is not null then
    delete from public.room_followers where room_id = any(rids);
    delete from public.rooms where id = any(rids);
  end if;
  delete from public.name_claims where owner_subject_hash = any(hs);
  delete from public.anonymous_identities where subject_hash = any(hs);
end $$;

REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  claims jsonb;
  client_id text;
  resource constant text := 'https://crawler.today/mcp';
BEGIN
  claims := coalesce(event -> 'claims', '{}'::jsonb);
  client_id := nullif(trim(both from coalesce(claims ->> 'client_id', '')), '');

  IF client_id IS NULL THEN
    RETURN event;
  END IF;

  claims := jsonb_set(claims, '{aud}', to_jsonb(resource), true);
  claims := jsonb_set(claims, '{room_resource}', to_jsonb(resource), true);
  claims := jsonb_set(claims, '{room_scopes}', '["openid","profile"]'::jsonb, true);

  RETURN jsonb_set(event, '{claims}', claims, true);
END;
$function$;

REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;