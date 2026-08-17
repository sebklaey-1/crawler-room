
-- Self-hosted OAuth 2.1 authorization server state for Crawler Room.
-- Every table is server-only: RLS on, no policies, service_role grants only.

CREATE TABLE public.oauth_clients (
  client_id text PRIMARY KEY,
  client_secret_hash text,
  client_name text NOT NULL,
  client_uri text,
  redirect_uris text[] NOT NULL,
  grant_types text[] NOT NULL DEFAULT ARRAY['authorization_code','refresh_token'],
  response_types text[] NOT NULL DEFAULT ARRAY['code'],
  token_endpoint_auth_method text NOT NULL DEFAULT 'none',
  scope text NOT NULL DEFAULT 'openid profile room:private room:write',
  registration_access_token_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
GRANT ALL ON public.oauth_clients TO service_role;
ALTER TABLE public.oauth_clients ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.oauth_auth_requests (
  id text PRIMARY KEY,
  client_id text NOT NULL REFERENCES public.oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  state text,
  scope text NOT NULL,
  resource text NOT NULL,
  code_challenge text NOT NULL,
  code_challenge_method text NOT NULL DEFAULT 'S256',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX oauth_auth_requests_expires_idx ON public.oauth_auth_requests(expires_at);
GRANT ALL ON public.oauth_auth_requests TO service_role;
ALTER TABLE public.oauth_auth_requests ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.oauth_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL REFERENCES public.oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  scope text NOT NULL,
  resource text NOT NULL,
  code_challenge text NOT NULL,
  subject_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX oauth_codes_expires_idx ON public.oauth_codes(expires_at);
GRANT ALL ON public.oauth_codes TO service_role;
ALTER TABLE public.oauth_codes ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.oauth_refresh_tokens (
  token_hash text PRIMARY KEY,
  client_id text NOT NULL REFERENCES public.oauth_clients(client_id) ON DELETE CASCADE,
  subject_id text NOT NULL,
  scope text NOT NULL,
  resource text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by text
);
CREATE INDEX oauth_refresh_tokens_subject_idx ON public.oauth_refresh_tokens(subject_id);
CREATE INDEX oauth_refresh_tokens_expires_idx ON public.oauth_refresh_tokens(expires_at);
GRANT ALL ON public.oauth_refresh_tokens TO service_role;
ALTER TABLE public.oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;

-- Housekeeping: drop expired authorization state.
CREATE OR REPLACE FUNCTION public.cleanup_oauth_state()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.oauth_auth_requests WHERE expires_at < now() - interval '1 hour';
  DELETE FROM public.oauth_codes WHERE expires_at < now() - interval '1 hour';
  DELETE FROM public.oauth_refresh_tokens
    WHERE expires_at < now() - interval '7 days'
       OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days');
END;
$$;
REVOKE ALL ON FUNCTION public.cleanup_oauth_state() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_oauth_state() TO service_role;
