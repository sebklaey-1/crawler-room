ALTER TABLE public.anonymous_identities
  ADD COLUMN IF NOT EXISTS auth_user_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS anonymous_identities_auth_user_id_key
  ON public.anonymous_identities (auth_user_id)
  WHERE auth_user_id IS NOT NULL;