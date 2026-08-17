-- ---------- rate events: allow new actions ----------
CREATE INDEX IF NOT EXISTS rate_events_lookup_idx
  ON public.rate_events(subject_hash, action, created_at DESC);

-- ---------- plan catalogue ----------
INSERT INTO public.plans (code, name, tagline, price_cents, sort_order, limits, entitlements) VALUES
('free', 'Free', 'Meet and talk.', 0, 0,
 '{"room_members":5,"owned_rooms":0,"retention_texts":7,"retention_images":3,"communities":0,"community_members":0}'::jsonb,
 '{"custom_alias":false,"private_rooms":false,"invitations":false,"pin":false,"favorites":false,"delete_own":false,"moderators":false,"events":false,"polls":false,"analytics":false,"campaigns":false,"api_access":false,"ad_free_owned":false}'::jsonb),
('plus', 'Plus', 'Create a room where the connection can continue.', 500, 1,
 '{"room_members":20,"owned_rooms":5,"retention_texts":100,"retention_images":30,"communities":0,"community_members":0}'::jsonb,
 '{"custom_alias":true,"private_rooms":true,"invitations":true,"pin":true,"favorites":true,"delete_own":true,"moderators":false,"events":false,"polls":false,"analytics":false,"campaigns":false,"api_access":false,"ad_free_owned":true}'::jsonb),
('pro', 'Pro', 'Build and grow your own community.', 2000, 2,
 '{"room_members":250,"owned_rooms":10,"retention_texts":1000,"retention_images":200,"communities":10,"community_members":250}'::jsonb,
 '{"custom_alias":true,"private_rooms":true,"invitations":true,"pin":true,"favorites":true,"delete_own":true,"moderators":true,"events":true,"polls":true,"analytics":true,"campaigns":false,"api_access":false,"ad_free_owned":true,"paid_rooms":true,"summaries":true,"search":true}'::jsonb),
('business', 'Business', 'Run a secure communication platform for your organization.', 9900, 3,
 '{"room_members":5000,"owned_rooms":100,"retention_texts":5000,"retention_images":1000,"communities":100,"community_members":5000}'::jsonb,
 '{"custom_alias":true,"private_rooms":true,"invitations":true,"pin":true,"favorites":true,"delete_own":true,"moderators":true,"events":true,"polls":true,"analytics":true,"campaigns":true,"api_access":true,"ad_free_owned":true,"paid_rooms":true,"summaries":true,"search":true,"branding":true,"custom_domain":true,"audit_logs":true,"export":true,"translation":true,"sso":true}'::jsonb);

INSERT INTO public.platform_settings (key, value) VALUES
('universal_room', '{"retention_hours":6,"page_size":50,"max_page_size":100,"rate_per_minute":6,"rate_per_hour":60,"image_retention":20}'::jsonb),
('advertising', '{"frequency_cap_per_hour":2,"max_placements_per_page":2,"min_aggregation_threshold":25,"default_cost_per_entry_cents":50}'::jsonb),
('grace', '{"grace_days":14}'::jsonb);

-- ---------- universal room ----------
INSERT INTO public.topics (slug, display_name, description, enabled)
VALUES ('universal', 'Universal Room', 'The global public starting space of @room.', true)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_capacity_check;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_capacity_check CHECK (capacity > 0 AND capacity <= 1000000000);

INSERT INTO public.rooms (topic_id, room_number, capacity, kind, title, description, visibility, retention_hours)
SELECT t.id, 0, 1000000000, 'universal', 'Universal Room',
       'The global public starting space of @room.', 'public', 6
FROM public.topics t WHERE t.slug = 'universal';

-- ---------- retention: honour per-room limits ----------
CREATE OR REPLACE FUNCTION public.enforce_text_retention(p_room_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
  v_room public.rooms%ROWTYPE;
  v_limit integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('room_text_retention:' || p_room_id::text));
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  IF v_room.kind = 'universal' OR v_room.retention_hours IS NOT NULL THEN
    DELETE FROM public.messages m
     WHERE m.room_id = p_room_id
       AND m.created_at < now() - make_interval(hours => COALESCE(v_room.retention_hours, 6));
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
  END IF;

  v_limit := COALESCE(v_room.retention_texts, 7);
  DELETE FROM public.messages m
   WHERE m.room_id = p_room_id
     AND m.id NOT IN (
       SELECT id FROM public.messages
        WHERE room_id = p_room_id
        ORDER BY created_at DESC, id DESC
        LIMIT v_limit
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
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
     AND i.moderation_status = 'approved'
     AND i.id NOT IN (
       SELECT id FROM public.image_messages
        WHERE room_id = p_room_id AND moderation_status = 'approved'
        ORDER BY created_at DESC, id DESC
        LIMIT v_limit
     )
  RETURNING i.storage_path;
END;
$function$;

-- ---------- universal room join (no duplicate memberships) ----------
CREATE OR REPLACE FUNCTION public.join_universal_room(p_subject_hash text, p_alias text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_membership public.memberships%ROWTYPE;
  v_joined_now boolean := false;
  v_presence integer;
BEGIN
  SELECT * INTO v_room FROM public.rooms WHERE kind = 'universal' LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'ROOM_UNAVAILABLE');
  END IF;

  SELECT * INTO v_membership
    FROM public.memberships
   WHERE subject_hash = p_subject_hash AND room_id = v_room.id AND left_at IS NULL;

  IF NOT FOUND THEN
    PERFORM pg_advisory_xact_lock(hashtext('universal_join:' || p_subject_hash));
    SELECT * INTO v_membership
      FROM public.memberships
     WHERE subject_hash = p_subject_hash AND room_id = v_room.id AND left_at IS NULL;
    IF NOT FOUND THEN
      INSERT INTO public.memberships (topic_id, room_id, subject_hash, alias)
      VALUES (v_room.topic_id, v_room.id, p_subject_hash, p_alias)
      RETURNING * INTO v_membership;
      v_joined_now := true;
    END IF;
  END IF;

  UPDATE public.memberships SET last_seen_at = now() WHERE id = v_membership.id;

  SELECT count(*) INTO v_presence
    FROM public.memberships
   WHERE room_id = v_room.id AND left_at IS NULL AND last_seen_at > now() - interval '15 minutes';

  RETURN json_build_object(
    'room_id', v_room.id,
    'membership_id', v_membership.id,
    'alias', v_membership.alias,
    'joined_at', v_membership.joined_at,
    'joined_now', v_joined_now,
    'last_read_message_id', v_membership.last_read_message_id,
    'presence', v_presence
  );
END;
$function$;

-- ---------- cleanup extended ----------
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
     AND subject_hash NOT LIKE 'anonymized:%';
  GET DIAGNOSTICS v_memberships = ROW_COUNT;

  DELETE FROM public.rooms r
   WHERE r.kind = 'topic'
     AND r.created_at < now() - interval '24 hours'
     AND NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.room_id = r.id AND m.left_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.messages msg WHERE msg.room_id = r.id);
  GET DIAGNOSTICS v_rooms = ROW_COUNT;

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

-- ---------- updated_at trigger ----------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER plans_touch BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER accounts_touch BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER subscriptions_touch BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER organizations_touch BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER rooms_touch BEFORE UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER campaigns_touch BEFORE UPDATE ON public.sponsored_campaigns FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER campaign_budgets_touch BEFORE UPDATE ON public.campaign_budgets FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER events_touch BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Reset plans to free (features included at no cost)
UPDATE public.plans SET price_cents = 0, stripe_price_id = NULL, stripe_product_id = NULL, tagline = 'Included for free';

-- ---------- handle on pseudonymous identity ----------
ALTER TABLE public.anonymous_identities ADD COLUMN IF NOT EXISTS handle text;
CREATE UNIQUE INDEX IF NOT EXISTS anonymous_identities_handle_key
  ON public.anonymous_identities (handle) WHERE handle IS NOT NULL;

-- ---------- personal rooms ----------
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

-- ---------- followers ----------
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

-- ---------- notifications ----------
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

-- ---------- live presence view ----------
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

-- ---------- personal room provisioning ----------
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

-- ---------- cleanup (spares personal rooms) ----------
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