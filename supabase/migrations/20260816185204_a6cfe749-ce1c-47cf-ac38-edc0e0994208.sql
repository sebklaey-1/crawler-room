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