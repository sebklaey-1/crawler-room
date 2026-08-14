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