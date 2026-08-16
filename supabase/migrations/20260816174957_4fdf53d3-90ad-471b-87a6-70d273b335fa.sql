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