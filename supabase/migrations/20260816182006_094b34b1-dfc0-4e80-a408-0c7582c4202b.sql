-- Phase 1E: absolute 24 hour retention for messages and images in every room.

CREATE OR REPLACE FUNCTION public.clamp_retention_expiry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_created timestamptz;
  v_cap timestamptz;
BEGIN
  v_created := COALESCE(NEW.created_at, now());
  NEW.created_at := v_created;
  v_cap := v_created + interval '24 hours';
  NEW.expires_at := LEAST(COALESCE(NEW.expires_at, v_cap), v_cap);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_clamp_expiry ON public.messages;
CREATE TRIGGER messages_clamp_expiry
BEFORE INSERT OR UPDATE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.clamp_retention_expiry();

DROP TRIGGER IF EXISTS image_messages_clamp_expiry ON public.image_messages;
CREATE TRIGGER image_messages_clamp_expiry
BEFORE INSERT OR UPDATE ON public.image_messages
FOR EACH ROW EXECUTE FUNCTION public.clamp_retention_expiry();

UPDATE public.messages
   SET expires_at = LEAST(expires_at, created_at + interval '24 hours')
 WHERE expires_at > created_at + interval '24 hours';

UPDATE public.image_messages
   SET expires_at = LEAST(expires_at, created_at + interval '24 hours')
 WHERE expires_at > created_at + interval '24 hours';

-- Rooms may never declare a retention window longer than the hard cap.
UPDATE public.rooms
   SET retention_hours = 24
 WHERE retention_hours IS NOT NULL AND retention_hours > 24;

CREATE OR REPLACE FUNCTION public.enforce_text_retention(p_room_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
  v_absolute integer;
  v_room public.rooms%ROWTYPE;
  v_limit integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('room_text_retention:' || p_room_id::text));
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- Hard cap: nothing survives longer than 24 hours, regardless of room kind.
  DELETE FROM public.messages m
   WHERE m.room_id = p_room_id
     AND (m.created_at < now() - interval '24 hours' OR m.expires_at <= now());
  GET DIAGNOSTICS v_absolute = ROW_COUNT;

  IF v_room.retention_hours IS NOT NULL AND v_room.retention_hours < 24 THEN
    DELETE FROM public.messages m
     WHERE m.room_id = p_room_id
       AND m.created_at < now() - make_interval(hours => v_room.retention_hours);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_absolute := v_absolute + v_count;
  END IF;

  v_limit := COALESCE(v_room.retention_texts, 7);
  IF v_limit IS NOT NULL AND v_room.kind <> 'universal' THEN
    DELETE FROM public.messages m
     WHERE m.room_id = p_room_id
       AND m.id NOT IN (
         SELECT id FROM public.messages
          WHERE room_id = p_room_id
          ORDER BY created_at DESC, id DESC
          LIMIT v_limit
       );
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_absolute := v_absolute + v_count;
  END IF;

  RETURN v_absolute;
END;
$function$;

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
  DELETE FROM public.image_messages i
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
  RETURNING i.storage_path;
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
  DELETE FROM public.image_messages i
   WHERE i.created_at < now() - interval '24 hours'
      OR i.expires_at <= now()
      OR i.moderation_status IN ('rejected', 'failed')
      OR (i.moderation_status = 'pending' AND i.created_at < now() - interval '30 minutes')
  RETURNING i.storage_path;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_expired()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_messages integer;
  v_rooms integer;
  v_memberships integer;
  v_rate integer;
  v_impressions integer;
  v_universal integer := 0;
  v_room record;
BEGIN
  -- Absolute cap first: every room type, independent of any per-room setting.
  DELETE FROM public.messages
   WHERE expires_at <= now() OR created_at < now() - interval '24 hours';
  GET DIAGNOSTICS v_messages = ROW_COUNT;

  FOR v_room IN SELECT id FROM public.rooms LOOP
    v_universal := v_universal + public.enforce_text_retention(v_room.id);
  END LOOP;

  DELETE FROM public.rate_events WHERE created_at < now() - interval '2 hours';
  GET DIAGNOSTICS v_rate = ROW_COUNT;

  DELETE FROM public.campaign_impression_log WHERE created_at < now() - interval '24 hours';
  GET DIAGNOSTICS v_impressions = ROW_COUNT;

  UPDATE public.sponsored_campaigns
     SET status = 'completed', updated_at = now()
   WHERE status IN ('approved','active') AND ends_at IS NOT NULL AND ends_at < now();

  UPDATE public.memberships
     SET alias = 'Ehemalige Person', subject_hash = 'anonymized:' || id::text
   WHERE left_at IS NOT NULL
     AND left_at < now() - interval '7 days'
     AND subject_hash NOT LIKE 'anonymized:%'
     AND NOT EXISTS (SELECT 1 FROM public.user_rooms ur WHERE ur.owner_subject_hash = memberships.subject_hash);
  GET DIAGNOSTICS v_memberships = ROW_COUNT;

  DELETE FROM public.rooms r
   WHERE r.kind = 'topic'
     AND r.created_at < now() - interval '24 hours'
     AND NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.room_id = r.id AND m.left_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.messages msg WHERE msg.room_id = r.id);
  GET DIAGNOSTICS v_rooms = ROW_COUNT;

  DELETE FROM public.room_notifications WHERE created_at < now() - interval '30 days';

  RETURN json_build_object(
    'deleted_messages', v_messages,
    'universal_pruned', v_universal,
    'deleted_rooms', v_rooms,
    'anonymized_memberships', v_memberships,
    'deleted_rate_events', v_rate,
    'deleted_impressions', v_impressions
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.clamp_retention_expiry() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_text_retention(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_image_retention(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_dead_images() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_text_retention(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_image_retention(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_dead_images() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired() TO service_role;