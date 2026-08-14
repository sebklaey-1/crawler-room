CREATE TABLE public.image_messages (
  id bigserial PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  sender_membership_id uuid NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  file_size integer NOT NULL DEFAULT 0 CHECK (file_size >= 0 AND file_size <= 10485760),
  width integer,
  height integer,
  alt_text text,
  checksum text,
  uploaded boolean NOT NULL DEFAULT false,
  moderation_status text NOT NULL DEFAULT 'pending'
    CHECK (moderation_status IN ('pending','approved','rejected','failed')),
  moderation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);

CREATE INDEX image_messages_room_idx ON public.image_messages (room_id, id);
CREATE INDEX image_messages_sender_idx ON public.image_messages (sender_membership_id);
CREATE INDEX image_messages_status_idx ON public.image_messages (moderation_status, created_at);
CREATE UNIQUE INDEX image_messages_room_checksum_idx
  ON public.image_messages (room_id, checksum)
  WHERE checksum IS NOT NULL AND moderation_status <> 'rejected';

GRANT ALL ON public.image_messages TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.image_messages_id_seq TO service_role;
ALTER TABLE public.image_messages ENABLE ROW LEVEL SECURITY;

-- No policies: only the service role (server-side handlers) may touch image rows.

ALTER TABLE public.memberships ADD COLUMN last_read_image_id bigint;

ALTER TABLE public.message_reports ALTER COLUMN message_id DROP NOT NULL;
ALTER TABLE public.message_reports
  ADD COLUMN image_message_id bigint REFERENCES public.image_messages(id) ON DELETE CASCADE;
ALTER TABLE public.message_reports
  ADD CONSTRAINT message_reports_target_check
  CHECK (num_nonnulls(message_id, image_message_id) = 1);
CREATE UNIQUE INDEX message_reports_image_unique_idx
  ON public.message_reports (image_message_id, reporter_membership_id)
  WHERE image_message_id IS NOT NULL;

ALTER TABLE public.rate_events DROP CONSTRAINT IF EXISTS rate_events_action_check;
ALTER TABLE public.rate_events
  ADD CONSTRAINT rate_events_action_check
  CHECK (action IN ('message','join','report','upload'));

CREATE OR REPLACE FUNCTION public.expire_images()
RETURNS TABLE (id bigint, storage_path text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT i.id, i.storage_path
    FROM public.image_messages i
   WHERE i.expires_at <= now()
      OR (i.moderation_status = 'rejected' AND i.created_at < now() - interval '1 hour')
      OR (i.moderation_status = 'pending' AND i.created_at < now() - interval '1 hour');
$$;

REVOKE ALL ON FUNCTION public.expire_images() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_images() TO service_role;

CREATE OR REPLACE FUNCTION public.delete_images(p_ids bigint[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.image_messages WHERE id = ANY(p_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_images(bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_images(bigint[]) TO service_role;