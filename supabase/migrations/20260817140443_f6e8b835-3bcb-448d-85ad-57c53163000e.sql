-- ============================================================
-- Core messaging schema: topics, rooms, memberships, messages
-- ============================================================

CREATE TABLE public.topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  display_name text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.topics TO service_role;
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.topic_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  normalized_alias text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.topic_aliases TO service_role;
ALTER TABLE public.topic_aliases ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  room_number integer NOT NULL,
  capacity integer NOT NULL DEFAULT 5,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rooms_topic_number_unique UNIQUE (topic_id, room_number),
  CONSTRAINT rooms_capacity_check CHECK (capacity = 5),
  CONSTRAINT rooms_status_check CHECK (status IN ('active', 'closed'))
);
GRANT ALL ON public.rooms TO service_role;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  subject_hash text NOT NULL,
  alias text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_read_message_id bigint,
  left_at timestamptz
);
GRANT ALL ON public.memberships TO service_role;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX memberships_active_unique
  ON public.memberships (subject_hash, topic_id) WHERE left_at IS NULL;
CREATE INDEX memberships_room_active_idx
  ON public.memberships (room_id) WHERE left_at IS NULL;
CREATE INDEX memberships_subject_idx ON public.memberships (subject_hash);

CREATE TABLE public.messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX messages_room_id_idx ON public.messages (room_id, id);
CREATE INDEX messages_expires_at_idx ON public.messages (expires_at);

CREATE TABLE public.message_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id bigint NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  reporter_membership_id uuid NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_reports_unique UNIQUE (message_id, reporter_membership_id),
  CONSTRAINT message_reports_reason_check CHECK (
    reason IN ('spam','harassment','hate','sexual_content','violence','personal_data','other')
  )
);
GRANT ALL ON public.message_reports TO service_role;
ALTER TABLE public.message_reports ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.rate_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_hash text NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.rate_events TO service_role;
ALTER TABLE public.rate_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX rate_events_lookup_idx ON public.rate_events (subject_hash, action, created_at DESC);

-- ============ capacity guard ============
CREATE OR REPLACE FUNCTION public.enforce_room_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  active_count integer;
  room_capacity integer;
BEGIN
  IF NEW.left_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT capacity INTO room_capacity FROM public.rooms WHERE id = NEW.room_id;
  SELECT count(*) INTO active_count
    FROM public.memberships
   WHERE room_id = NEW.room_id AND left_at IS NULL AND id <> NEW.id;
  IF active_count >= room_capacity THEN
    RAISE EXCEPTION 'ROOM_FULL';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER memberships_capacity_guard
  BEFORE INSERT OR UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.enforce_room_capacity();

-- ============ transactional join ============
CREATE OR REPLACE FUNCTION public.join_topic_room(
  p_subject_hash text,
  p_topic_slug text,
  p_alias text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_topic public.topics%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_membership public.memberships%ROWTYPE;
  v_joined_now boolean := false;
  v_next_number integer;
  v_member_count integer;
BEGIN
  SELECT * INTO v_topic FROM public.topics WHERE slug = p_topic_slug AND enabled;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'TOPIC_NOT_FOUND');
  END IF;

  SELECT * INTO v_membership
    FROM public.memberships
   WHERE subject_hash = p_subject_hash AND topic_id = v_topic.id AND left_at IS NULL;

  IF NOT FOUND THEN
    PERFORM pg_advisory_xact_lock(hashtext('room_join:' || v_topic.id::text));

    SELECT * INTO v_membership
      FROM public.memberships
     WHERE subject_hash = p_subject_hash AND topic_id = v_topic.id AND left_at IS NULL;

    IF NOT FOUND THEN
      SELECT r.* INTO v_room
        FROM public.rooms r
       WHERE r.topic_id = v_topic.id
         AND r.status = 'active'
         AND (SELECT count(*) FROM public.memberships m
               WHERE m.room_id = r.id AND m.left_at IS NULL) < r.capacity
       ORDER BY r.room_number ASC
       LIMIT 1
       FOR UPDATE OF r;

      IF NOT FOUND THEN
        SELECT COALESCE(max(room_number), 0) + 1 INTO v_next_number
          FROM public.rooms WHERE topic_id = v_topic.id;
        INSERT INTO public.rooms (topic_id, room_number)
        VALUES (v_topic.id, v_next_number)
        RETURNING * INTO v_room;
      END IF;

      INSERT INTO public.memberships (topic_id, room_id, subject_hash, alias)
      VALUES (v_topic.id, v_room.id, p_subject_hash, p_alias)
      RETURNING * INTO v_membership;
      v_joined_now := true;
    END IF;
  END IF;

  IF v_room.id IS NULL THEN
    SELECT * INTO v_room FROM public.rooms WHERE id = v_membership.room_id;
  END IF;

  SELECT count(*) INTO v_member_count
    FROM public.memberships WHERE room_id = v_room.id AND left_at IS NULL;

  UPDATE public.memberships SET last_seen_at = now() WHERE id = v_membership.id;

  RETURN json_build_object(
    'topic_slug', v_topic.slug,
    'topic_display_name', v_topic.display_name,
    'room_id', v_room.id,
    'room_number', v_room.room_number,
    'capacity', v_room.capacity,
    'member_count', v_member_count,
    'membership_id', v_membership.id,
    'alias', v_membership.alias,
    'joined_at', v_membership.joined_at,
    'last_read_message_id', v_membership.last_read_message_id,
    'joined_now', v_joined_now
  );
END;
$$;

-- ============ cleanup ============
CREATE OR REPLACE FUNCTION public.cleanup_expired()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_messages integer;
  v_rooms integer;
  v_memberships integer;
  v_rate integer;
BEGIN
  DELETE FROM public.messages WHERE expires_at <= now();
  GET DIAGNOSTICS v_messages = ROW_COUNT;

  DELETE FROM public.rate_events WHERE created_at < now() - interval '2 hours';
  GET DIAGNOSTICS v_rate = ROW_COUNT;

  UPDATE public.memberships
     SET alias = 'Ehemalige Person', subject_hash = 'anonymized:' || id::text
   WHERE left_at IS NOT NULL
     AND left_at < now() - interval '7 days'
     AND subject_hash NOT LIKE 'anonymized:%';
  GET DIAGNOSTICS v_memberships = ROW_COUNT;

  DELETE FROM public.rooms r
   WHERE r.created_at < now() - interval '24 hours'
     AND NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.room_id = r.id AND m.left_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.messages msg WHERE msg.room_id = r.id);
  GET DIAGNOSTICS v_rooms = ROW_COUNT;

  RETURN json_build_object(
    'deleted_messages', v_messages,
    'deleted_rooms', v_rooms,
    'anonymized_memberships', v_memberships,
    'deleted_rate_events', v_rate
  );
END;
$$;

-- ============ seed topics ============
INSERT INTO public.topics (slug, display_name, description) VALUES
  ('ai', 'AI', 'Künstliche Intelligenz, Modelle und AI-Produkte'),
  ('art', 'Art', 'Kunst, Illustration, Design und Kreativität'),
  ('science', 'Science', 'Wissenschaft, Forschung und Entdeckungen'),
  ('tech', 'Tech', 'Technologie, Software und Hardware'),
  ('music', 'Music', 'Musik, Produktion und Instrumente'),
  ('gaming', 'Gaming', 'Games, Entwicklung und Gaming-Kultur'),
  ('life', 'Life', 'Alltag, persönliche Interessen und lockerer Austausch');

INSERT INTO public.topic_aliases (topic_id, normalized_alias)
SELECT t.id, a.alias FROM (VALUES
  ('ai', 'ki'),
  ('ai', 'künstliche intelligenz'),
  ('ai', 'artificial intelligence'),
  ('art', 'kunst'),
  ('science', 'sience'),
  ('science', 'wissenschaft'),
  ('tech', 'technology'),
  ('tech', 'technologie'),
  ('music', 'musik'),
  ('gaming', 'spiele'),
  ('life', 'leben')
) AS a(slug, alias)
JOIN public.topics t ON t.slug = a.slug;

-- ============ restrict functions to service role ============
REVOKE EXECUTE ON FUNCTION public.join_topic_room(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_room_capacity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_topic_room(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired() TO service_role;