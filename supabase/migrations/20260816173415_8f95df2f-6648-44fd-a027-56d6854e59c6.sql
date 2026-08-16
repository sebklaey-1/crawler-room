-- 1. Data minimisation: store only a keyed hash of the auth account, never the raw UUID.
ALTER TABLE public.anonymous_identities ADD COLUMN IF NOT EXISTS auth_user_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS anonymous_identities_auth_user_hash_key
  ON public.anonymous_identities (auth_user_hash)
  WHERE auth_user_hash IS NOT NULL;

DROP INDEX IF EXISTS public.anonymous_identities_auth_user_id_key;
DROP INDEX IF EXISTS public.anonymous_identities_auth_user_id_idx;
ALTER TABLE public.anonymous_identities DROP COLUMN IF EXISTS auth_user_id;

-- 2. Custom access token hook: bind MCP OAuth tokens to the canonical resource.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  claims jsonb;
  client_id text;
  resource constant text := 'https://zinga-room.lovable.app/api/public/mcp';
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
$$;

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM public, anon, authenticated;