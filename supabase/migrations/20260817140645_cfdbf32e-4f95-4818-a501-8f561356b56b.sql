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

-- ---------- platform settings & plans ----------
CREATE TABLE public.platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.platform_settings TO service_role;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  tagline text,
  price_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  interval text NOT NULL DEFAULT 'month',
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  stripe_product_id text,
  stripe_price_id text,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  entitlements jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.plans TO service_role;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

-- ---------- accounts & identities ----------
CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  display_alias text,
  stripe_customer_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.accounts TO service_role;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.anonymous_identities (
  subject_hash text PRIMARY KEY,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  custom_alias text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX anonymous_identities_account_idx ON public.anonymous_identities(account_id);
GRANT ALL ON public.anonymous_identities TO service_role;
ALTER TABLE public.anonymous_identities ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('free','trialing','active','past_due','canceled','expired')),
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  current_period_end timestamptz,
  grace_until timestamptz,
  stripe_subscription_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id)
);
CREATE INDEX subscriptions_status_idx ON public.subscriptions(status);
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.entitlement_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, key)
);
GRANT ALL ON public.entitlement_overrides TO service_role;
ALTER TABLE public.entitlement_overrides ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.platform_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('platform_admin','moderator')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, role)
);
GRANT ALL ON public.platform_roles TO service_role;
ALTER TABLE public.platform_roles ENABLE ROW LEVEL SECURITY;

-- ---------- organizations ----------
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text UNIQUE,
  description text,
  website text,
  logo_path text,
  verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  billing_ready boolean NOT NULL DEFAULT false,
  suspended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('member','moderator','organization_admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, account_id)
);
GRANT ALL ON public.organization_members TO service_role;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- ---------- rooms: ownership, visibility, retention ----------
ALTER TABLE public.rooms ALTER COLUMN topic_id DROP NOT NULL;
ALTER TABLE public.rooms
  ADD COLUMN kind text NOT NULL DEFAULT 'topic'
    CHECK (kind IN ('topic','private','community','universal','sponsored')),
  ADD COLUMN owner_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN title text,
  ADD COLUMN description text,
  ADD COLUMN visibility text NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public','private','invite','paid')),
  ADD COLUMN color text,
  ADD COLUMN cover_path text,
  ADD COLUMN rules text,
  ADD COLUMN retention_texts integer,
  ADD COLUMN retention_images integer,
  ADD COLUMN retention_hours integer,
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX rooms_kind_idx ON public.rooms(kind);
CREATE INDEX rooms_owner_idx ON public.rooms(owner_account_id);
CREATE INDEX rooms_org_idx ON public.rooms(organization_id);

ALTER TABLE public.memberships
  ADD COLUMN role text NOT NULL DEFAULT 'participant'
    CHECK (role IN ('participant','moderator','owner')),
  ADD COLUMN account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  ADD COLUMN pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN favorite boolean NOT NULL DEFAULT false;
ALTER TABLE public.memberships ALTER COLUMN topic_id DROP NOT NULL;
CREATE INDEX memberships_account_idx ON public.memberships(account_id);

ALTER TABLE public.messages ADD COLUMN pinned boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN deleted_at timestamptz;
ALTER TABLE public.messages ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX messages_idempotency_idx
  ON public.messages(membership_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX messages_room_created_idx ON public.messages(room_id, created_at DESC, id DESC);

CREATE TABLE public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  created_by_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  token_hash text NOT NULL UNIQUE,
  max_uses integer,
  used_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_room_idx ON public.invitations(room_id);
GRANT ALL ON public.invitations TO service_role;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid REFERENCES public.rooms(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','live','completed','canceled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_starts_idx ON public.events(starts_at);
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  created_by_membership_id uuid REFERENCES public.memberships(id) ON DELETE SET NULL,
  question text NOT NULL,
  options jsonb NOT NULL,
  closes_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.poll_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  option_index integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poll_id, membership_id)
);
GRANT ALL ON public.polls TO service_role;
GRANT ALL ON public.poll_votes TO service_role;
ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;

-- ---------- advertising ----------
CREATE TABLE public.sponsored_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NOT NULL,
  cover_path text,
  cta_label text,
  cta_url text,
  topics text[] NOT NULL DEFAULT '{}',
  languages text[] NOT NULL DEFAULT '{}',
  starts_at timestamptz,
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_review','approved','active','paused','rejected','completed','suspended')),
  safety_status text NOT NULL DEFAULT 'unreviewed'
    CHECK (safety_status IN ('unreviewed','pass','fail')),
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sponsored_campaigns_status_idx ON public.sponsored_campaigns(status);
CREATE INDEX sponsored_campaigns_org_idx ON public.sponsored_campaigns(organization_id);
GRANT ALL ON public.sponsored_campaigns TO service_role;
ALTER TABLE public.sponsored_campaigns ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.campaign_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.sponsored_campaigns(id) ON DELETE CASCADE,
  total_budget_cents integer NOT NULL DEFAULT 0,
  spent_cents integer NOT NULL DEFAULT 0,
  daily_cap_cents integer,
  cost_per_entry_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id)
);
GRANT ALL ON public.campaign_budgets TO service_role;
ALTER TABLE public.campaign_budgets ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.sponsored_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.sponsored_campaigns(id) ON DELETE CASCADE,
  surface text NOT NULL DEFAULT 'universal_room'
    CHECK (surface IN ('universal_room','discovery','event')),
  topic_slug text,
  weight integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sponsored_placements_campaign_idx ON public.sponsored_placements(campaign_id);
GRANT ALL ON public.sponsored_placements TO service_role;
ALTER TABLE public.sponsored_placements ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.campaign_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.sponsored_campaigns(id) ON DELETE CASCADE,
  reviewer_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  decision text NOT NULL CHECK (decision IN ('approve','reject','request_changes','suspend','auto_flag')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX campaign_reviews_campaign_idx ON public.campaign_reviews(campaign_id);
GRANT ALL ON public.campaign_reviews TO service_role;
ALTER TABLE public.campaign_reviews ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.campaign_metrics (
  id bigserial PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.sponsored_campaigns(id) ON DELETE CASCADE,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  impressions integer NOT NULL DEFAULT 0,
  entries integer NOT NULL DEFAULT 0,
  cta_clicks integer NOT NULL DEFAULT 0,
  event_signups integer NOT NULL DEFAULT 0,
  hides integer NOT NULL DEFAULT 0,
  reports integer NOT NULL DEFAULT 0,
  unique_viewers integer NOT NULL DEFAULT 0,
  spend_cents integer NOT NULL DEFAULT 0,
  UNIQUE (campaign_id, day)
);
GRANT ALL ON public.campaign_metrics TO service_role;
ALTER TABLE public.campaign_metrics ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.campaign_impression_log (
  id bigserial PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.sponsored_campaigns(id) ON DELETE CASCADE,
  subject_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX campaign_impression_log_lookup_idx
  ON public.campaign_impression_log(campaign_id, subject_hash, created_at DESC);
GRANT ALL ON public.campaign_impression_log TO service_role;
ALTER TABLE public.campaign_impression_log ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_hidden_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_hash text NOT NULL,
  campaign_id uuid NOT NULL REFERENCES public.sponsored_campaigns(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_hash, campaign_id)
);
GRANT ALL ON public.user_hidden_campaigns TO service_role;
ALTER TABLE public.user_hidden_campaigns ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.message_reports ADD COLUMN campaign_id uuid REFERENCES public.sponsored_campaigns(id) ON DELETE CASCADE;
ALTER TABLE public.message_reports ALTER COLUMN reporter_membership_id DROP NOT NULL;
ALTER TABLE public.message_reports ADD COLUMN reporter_subject_hash text;
ALTER TABLE public.message_reports ADD COLUMN status text NOT NULL DEFAULT 'open'
  CHECK (status IN ('open','reviewing','resolved','dismissed'));

CREATE TABLE public.moderation_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL CHECK (subject_type IN ('message','image','campaign','organization','room')),
  subject_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved','rejected','escalated','suspended','appealed','restored')),
  source text NOT NULL DEFAULT 'automated' CHECK (source IN ('automated','human','appeal')),
  reason text,
  reviewer_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_decisions_subject_idx ON public.moderation_decisions(subject_type, subject_id);
GRANT ALL ON public.moderation_decisions TO service_role;
ALTER TABLE public.moderation_decisions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.audit_logs (
  id bigserial PRIMARY KEY,
  actor_type text NOT NULL DEFAULT 'system'
    CHECK (actor_type IN ('system','user','organization','platform_admin')),
  actor_id text,
  action text NOT NULL,
  target_type text,
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON public.audit_logs(created_at DESC);
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'stripe',
  external_id text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);
GRANT ALL ON public.webhook_events TO service_role;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;