CREATE TABLE IF NOT EXISTS public.identity_anchors (
  anchor_hash text PRIMARY KEY,
  subject_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS identity_anchors_subject_idx ON public.identity_anchors (subject_hash);

GRANT ALL ON public.identity_anchors TO service_role;

ALTER TABLE public.identity_anchors ENABLE ROW LEVEL SECURITY;