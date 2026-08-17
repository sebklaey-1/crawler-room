ALTER TABLE public.rooms DROP CONSTRAINT rooms_kind_check;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_kind_check
  CHECK (kind = ANY (ARRAY['topic','private','community','universal','sponsored','personal']));

CREATE UNIQUE INDEX IF NOT EXISTS anonymous_identities_custom_alias_unique
  ON public.anonymous_identities (lower(custom_alias))
  WHERE custom_alias IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_rooms_handle_unique
  ON public.user_rooms (lower(handle));

DELETE FROM public.anonymous_identities WHERE custom_alias ILIKE 'UniqTest99';

ALTER TABLE public.user_rooms
  ADD COLUMN IF NOT EXISTS banner_path text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS external_url text,
  ADD COLUMN IF NOT EXISTS profile_visibility text NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS show_online_status boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_follower_count boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_likes boolean NOT NULL DEFAULT true;

DO $$ BEGIN
  ALTER TABLE public.user_rooms
    ADD CONSTRAINT user_rooms_visibility_check CHECK (profile_visibility IN ('public','private'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.content_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_hash text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('profile','message','image')),
  target_id text NOT NULL,
  owner_subject_hash text NOT NULL,
  room_id uuid REFERENCES public.rooms(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_hash, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS content_likes_target_idx ON public.content_likes (target_type, target_id);
CREATE INDEX IF NOT EXISTS content_likes_owner_idx ON public.content_likes (owner_subject_hash);
GRANT ALL ON public.content_likes TO service_role;
ALTER TABLE public.content_likes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  owner_subject_hash text NOT NULL,
  event_type text NOT NULL,
  actor_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_events_owner_idx ON public.analytics_events (owner_subject_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_room_idx ON public.analytics_events (room_id, event_type, created_at DESC);
GRANT ALL ON public.analytics_events TO service_role;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.handle_redirects (
  old_handle text PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  owner_subject_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.handle_redirects TO service_role;
ALTER TABLE public.handle_redirects ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.profile_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_hash text NOT NULL,
  blocked_subject_hash text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_hash, blocked_subject_hash)
);
GRANT ALL ON public.profile_blocks TO service_role;
ALTER TABLE public.profile_blocks ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS user_rooms_handle_unique ON public.user_rooms (lower(handle));

ALTER TABLE public.rate_events DROP CONSTRAINT IF EXISTS rate_events_action_check;
ALTER TABLE public.rate_events ADD CONSTRAINT rate_events_action_check
  CHECK (action = ANY (ARRAY['message'::text, 'join'::text, 'report'::text, 'upload'::text, 'like'::text, 'profile_image'::text]));

REVOKE EXECUTE ON FUNCTION public.block_self_follow() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_or_create_personal_room(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.join_universal_room(text, text) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS rooms_slug_unique_idx ON public.rooms (lower(slug)) WHERE slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_unique_idx ON public.organizations (lower(slug)) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS rooms_kind_visibility_idx ON public.rooms (kind, visibility) WHERE archived_at IS NULL;

ALTER TABLE public.anonymous_identities
  ADD COLUMN IF NOT EXISTS auth_user_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS anonymous_identities_auth_user_hash_key
  ON public.anonymous_identities (auth_user_hash)
  WHERE auth_user_hash IS NOT NULL;

DROP INDEX IF EXISTS public.anonymous_identities_auth_user_id_key;
DROP INDEX IF EXISTS public.anonymous_identities_auth_user_id_idx;
ALTER TABLE public.anonymous_identities DROP COLUMN IF EXISTS auth_user_id;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  claims jsonb;
  client_id text;
  resource constant text := 'https://crawler.today/api/public/mcp';
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

REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM public, anon, authenticated;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

CREATE TABLE IF NOT EXISTS public.support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  category text NOT NULL CHECK (category IN ('technical','account','privacy','abuse','other')),
  subject text NOT NULL,
  body text NOT NULL,
  contact text,
  public_target text,
  requester_hash text,
  requester_hash_expires_at timestamp with time zone,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','closed')),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT now() + interval '90 days'
);

GRANT ALL ON public.support_requests TO service_role;
ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS support_requests_expires_idx ON public.support_requests (expires_at);
CREATE INDEX IF NOT EXISTS support_requests_hash_expiry_idx ON public.support_requests (requester_hash_expires_at) WHERE requester_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  request_type text NOT NULL CHECK (request_type IN ('deletion','access','correction')),
  auth_user_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_review','completed','rejected')),
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT now() + interval '90 days'
);

GRANT ALL ON public.privacy_requests TO service_role;
ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS privacy_requests_open_unique
  ON public.privacy_requests (auth_user_hash, request_type)
  WHERE status IN ('pending','in_review');

CREATE INDEX IF NOT EXISTS privacy_requests_expires_idx ON public.privacy_requests (expires_at);

DROP TRIGGER IF EXISTS support_requests_touch ON public.support_requests;
CREATE TRIGGER support_requests_touch BEFORE UPDATE ON public.support_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS privacy_requests_touch ON public.privacy_requests;
CREATE TRIGGER privacy_requests_touch BEFORE UPDATE ON public.privacy_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.cleanup_support_requests()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_support integer;
  v_hashes integer;
  v_privacy integer;
BEGIN
  DELETE FROM public.support_requests WHERE expires_at <= now();
  GET DIAGNOSTICS v_support = ROW_COUNT;

  UPDATE public.support_requests
     SET requester_hash = NULL, requester_hash_expires_at = NULL
   WHERE requester_hash IS NOT NULL
     AND requester_hash_expires_at IS NOT NULL
     AND requester_hash_expires_at <= now();
  GET DIAGNOSTICS v_hashes = ROW_COUNT;

  DELETE FROM public.privacy_requests
   WHERE expires_at <= now() AND status IN ('completed','rejected');
  GET DIAGNOSTICS v_privacy = ROW_COUNT;

  RETURN json_build_object(
    'deleted_support_requests', v_support,
    'cleared_requester_hashes', v_hashes,
    'deleted_privacy_requests', v_privacy
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cleanup_support_requests() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_support_requests() TO service_role;

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

CREATE TABLE IF NOT EXISTS public.content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt text NOT NULL UNIQUE,
  reporter_subject_hash text NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('profile','room','message','image','community','organization')),
  target_ref text NOT NULL,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  target_owner_subject_hash text,
  target_snapshot_hash text,
  reason text NOT NULL CHECK (reason IN ('spam','harassment','hate','sexual_content','violence','self_harm','privacy','impersonation','illegal_content','other')),
  details text CHECK (details IS NULL OR char_length(details) <= 500),
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','reviewing','actioned','dismissed')),
  resolution text,
  reviewer_hash text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS content_reports_open_unique
  ON public.content_reports (reporter_subject_hash, target_kind, target_ref)
  WHERE status IN ('received','reviewing');

CREATE INDEX IF NOT EXISTS content_reports_status_created_idx
  ON public.content_reports (status, created_at DESC);

GRANT ALL ON public.content_reports TO service_role;
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.moderator_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_hash text NOT NULL UNIQUE,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.moderator_subjects TO service_role;
ALTER TABLE public.moderator_subjects ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS content_reports_touch ON public.content_reports;
CREATE TRIGGER content_reports_touch BEFORE UPDATE ON public.content_reports
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS moderator_subjects_touch ON public.moderator_subjects;
CREATE TRIGGER moderator_subjects_touch BEFORE UPDATE ON public.moderator_subjects
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();