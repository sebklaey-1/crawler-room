-- Handle (username) on the pseudonymous identity
ALTER TABLE public.anonymous_identities ADD COLUMN IF NOT EXISTS handle text;
CREATE UNIQUE INDEX IF NOT EXISTS anonymous_identities_handle_key
  ON public.anonymous_identities (handle) WHERE handle IS NOT NULL;

-- Personal rooms -----------------------------------------------------------
CREATE TABLE public.user_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_subject_hash text NOT NULL UNIQUE,
  room_id uuid NOT NULL UNIQUE REFERENCES public.rooms(id) ON DELETE CASCADE,
  handle text NOT NULL UNIQUE,
  room_name text NOT NULL,
  description text,
  avatar_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.user_rooms TO service_role;
ALTER TABLE public.user_rooms ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER user_rooms_touch BEFORE UPDATE ON public.user_rooms
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Followers ----------------------------------------------------------------
CREATE TABLE public.room_followers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  follower_subject_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, follower_subject_hash)
);
CREATE INDEX room_followers_follower_idx ON public.room_followers (follower_subject_hash);
GRANT ALL ON public.room_followers TO service_role;
ALTER TABLE public.room_followers ENABLE ROW LEVEL SECURITY;

-- Owners may never follow their own room (defence in depth)
CREATE OR REPLACE FUNCTION public.block_self_follow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_rooms ur
     WHERE ur.room_id = NEW.room_id
       AND ur.owner_subject_hash = NEW.follower_subject_hash
  ) THEN
    RAISE EXCEPTION 'SELF_FOLLOW';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER room_followers_no_self BEFORE INSERT OR UPDATE ON public.room_followers
  FOR EACH ROW EXECUTE FUNCTION public.block_self_follow();

-- Notifications ------------------------------------------------------------
CREATE TABLE public.room_notifications (
  id bigserial PRIMARY KEY,
  recipient_subject_hash text NOT NULL,
  room_id uuid REFERENCES public.rooms(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  message text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX room_notifications_recipient_idx
  ON public.room_notifications (recipient_subject_hash, created_at DESC);
GRANT ALL ON public.room_notifications TO service_role;
ALTER TABLE public.room_notifications ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.notification_settings (
  subject_hash text PRIMARY KEY,
  new_conversation boolean NOT NULL DEFAULT true,
  public_message boolean NOT NULL DEFAULT true,
  live_event boolean NOT NULL DEFAULT true,
  new_follower boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.notification_settings TO service_role;
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER notification_settings_touch BEFORE UPDATE ON public.notification_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Live presence view (never affects follower counts) ------------------------
CREATE VIEW public.room_presence
WITH (security_invoker = true) AS
SELECT m.room_id,
       m.subject_hash AS user_id,
       m.alias,
       m.joined_at,
       m.last_seen_at,
       CASE WHEN m.last_seen_at > now() - interval '3 minutes' THEN 'online' ELSE 'away' END
         AS presence_status
  FROM public.memberships m
 WHERE m.left_at IS NULL;
GRANT SELECT ON public.room_presence TO service_role;

-- Personal room provisioning ------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_or_create_personal_room(
  p_subject_hash text,
  p_handle text,
  p_room_name text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_room public.user_rooms%ROWTYPE;
  v_room public.rooms%ROWTYPE;
BEGIN
  SELECT * INTO v_user_room FROM public.user_rooms WHERE owner_subject_hash = p_subject_hash;

  IF NOT FOUND THEN
    PERFORM pg_advisory_xact_lock(hashtext('personal_room:' || p_subject_hash));
    SELECT * INTO v_user_room FROM public.user_rooms WHERE owner_subject_hash = p_subject_hash;

    IF NOT FOUND THEN
      INSERT INTO public.rooms (topic_id, room_number, capacity, kind, visibility,
                                title, description, retention_hours, retention_texts)
      VALUES (NULL, 1, 1000000, 'personal', 'public', p_room_name, NULL, 24, NULL)
      RETURNING * INTO v_room;

      INSERT INTO public.user_rooms (owner_subject_hash, room_id, handle, room_name)
      VALUES (p_subject_hash, v_room.id, p_handle, p_room_name)
      RETURNING * INTO v_user_room;
    END IF;
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = v_user_room.room_id;

  RETURN json_build_object(
    'room_id', v_user_room.room_id,
    'handle', v_user_room.handle,
    'room_name', v_user_room.room_name,
    'description', v_user_room.description,
    'created_at', v_user_room.created_at,
    'capacity', v_room.capacity
  );
END;
$$;

-- Personal rooms are permanent: never touched by the cleanup job
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
  DELETE FROM public.messages WHERE expires_at <= now();
  GET DIAGNOSTICS v_messages = ROW_COUNT;

  FOR v_room IN SELECT id FROM public.rooms WHERE kind = 'universal' OR retention_hours IS NOT NULL LOOP
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