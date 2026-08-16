CREATE TABLE IF NOT EXISTS public.support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  category text NOT NULL CHECK (category IN ('technical','account','privacy','abuse','other')),
  subject text NOT NULL,
  body text NOT NULL,
  contact text,
  public_target text,
  requester_hash text,
  requester_hash_expires_at timestamp with time zone,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','closed')),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT now() + interval '90 days'
);

GRANT ALL ON public.support_requests TO service_role;
ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS support_requests_expires_idx ON public.support_requests (expires_at);
CREATE INDEX IF NOT EXISTS support_requests_hash_expiry_idx ON public.support_requests (requester_hash_expires_at) WHERE requester_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  request_type text NOT NULL CHECK (request_type IN ('deletion','access','correction')),
  auth_user_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_review','completed','rejected')),
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT now() + interval '90 days'
);

GRANT ALL ON public.privacy_requests TO service_role;
ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS privacy_requests_open_unique
  ON public.privacy_requests (auth_user_hash, request_type)
  WHERE status IN ('pending','in_review');

CREATE INDEX IF NOT EXISTS privacy_requests_expires_idx ON public.privacy_requests (expires_at);

DROP TRIGGER IF EXISTS support_requests_touch ON public.support_requests;
CREATE TRIGGER support_requests_touch BEFORE UPDATE ON public.support_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS privacy_requests_touch ON public.privacy_requests;
CREATE TRIGGER privacy_requests_touch BEFORE UPDATE ON public.privacy_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.cleanup_support_requests()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_support integer;
  v_hashes integer;
  v_privacy integer;
BEGIN
  DELETE FROM public.support_requests WHERE expires_at <= now();
  GET DIAGNOSTICS v_support = ROW_COUNT;

  UPDATE public.support_requests
     SET requester_hash = NULL, requester_hash_expires_at = NULL
   WHERE requester_hash IS NOT NULL
     AND requester_hash_expires_at IS NOT NULL
     AND requester_hash_expires_at <= now();
  GET DIAGNOSTICS v_hashes = ROW_COUNT;

  DELETE FROM public.privacy_requests
   WHERE expires_at <= now() AND status IN ('completed','rejected');
  GET DIAGNOSTICS v_privacy = ROW_COUNT;

  RETURN json_build_object(
    'deleted_support_requests', v_support,
    'cleared_requester_hashes', v_hashes,
    'deleted_privacy_requests', v_privacy
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cleanup_support_requests() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_support_requests() TO service_role;