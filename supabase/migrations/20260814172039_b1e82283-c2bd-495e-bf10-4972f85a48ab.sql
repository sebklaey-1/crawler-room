DROP FUNCTION IF EXISTS public.expire_images();
DROP FUNCTION IF EXISTS public.delete_images(bigint[]);

CREATE OR REPLACE FUNCTION public.enforce_text_retention(p_room_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('room_text_retention:' || p_room_id::text));
  DELETE FROM public.messages m
   WHERE m.room_id = p_room_id
     AND m.id NOT IN (
       SELECT id FROM public.messages
        WHERE room_id = p_room_id
        ORDER BY created_at DESC, id DESC
        LIMIT 7
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_image_retention(p_room_id uuid)
RETURNS TABLE (storage_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('room_image_retention:' || p_room_id::text));
  RETURN QUERY
  DELETE FROM public.image_messages i
   WHERE i.room_id = p_room_id
     AND i.moderation_status = 'approved'
     AND i.id NOT IN (
       SELECT id FROM public.image_messages
        WHERE room_id = p_room_id AND moderation_status = 'approved'
        ORDER BY created_at DESC, id DESC
        LIMIT 3
     )
  RETURNING i.storage_path;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_dead_images()
RETURNS TABLE (storage_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  DELETE FROM public.image_messages i
   WHERE i.expires_at <= now()
      OR i.moderation_status IN ('rejected', 'failed')
      OR (i.moderation_status = 'pending' AND i.created_at < now() - interval '30 minutes')
  RETURNING i.storage_path;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_all_retention()
RETURNS TABLE (storage_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_room record;
BEGIN
  FOR v_room IN SELECT id FROM public.rooms LOOP
    PERFORM public.enforce_text_retention(v_room.id);
    RETURN QUERY SELECT * FROM public.enforce_image_retention(v_room.id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_text_retention(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_image_retention(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_dead_images() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_all_retention() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_text_retention(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_image_retention(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_dead_images() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_all_retention() TO service_role;

-- One-time cleanup of rooms that already exceed the new limits.
SELECT public.enforce_text_retention(id) FROM public.rooms;