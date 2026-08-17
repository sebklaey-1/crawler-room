CREATE OR REPLACE FUNCTION public.normalize_handle(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN v ~ '^[a-z0-9_]{3,30}$' THEN v
    ELSE NULL
  END
  FROM (
    SELECT lower(regexp_replace(btrim(normalize(coalesce(p_value, ''), NFKC)), '^@+', '')) AS v
  ) s;
$$;

CREATE OR REPLACE FUNCTION public.normalize_alias(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN char_length(v) BETWEEN 1 AND 32 THEN lower(v)
    ELSE NULL
  END
  FROM (
    SELECT btrim(regexp_replace(normalize(coalesce(p_value, ''), NFKC), '\s+', ' ', 'g')) AS v
  ) s;
$$;

DO $preflight$
DECLARE
  v_dupes text;
BEGIN
  SELECT string_agg(k, ', ') INTO v_dupes FROM (
    SELECT coalesce(public.normalize_handle(handle), 'invalid:' || handle) AS k
      FROM public.user_rooms
     GROUP BY 1 HAVING count(DISTINCT owner_subject_hash) > 1
  ) d;
  IF v_dupes IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: duplicate normalised handles in user_rooms: %', v_dupes;
  END IF;

  SELECT string_agg(r.old_handle, ', ') INTO v_dupes
    FROM public.handle_redirects r
    JOIN public.user_rooms u
      ON public.normalize_handle(u.handle) IS NOT DISTINCT FROM public.normalize_handle(r.old_handle)
   WHERE u.owner_subject_hash <> r.owner_subject_hash;
  IF v_dupes IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: redirect handles owned by a different identity: %', v_dupes;
  END IF;

  SELECT string_agg(k, ', ') INTO v_dupes FROM (
    SELECT coalesce(public.normalize_handle(old_handle), 'invalid:' || old_handle) AS k
      FROM public.handle_redirects
     GROUP BY 1 HAVING count(DISTINCT owner_subject_hash) > 1
  ) d;
  IF v_dupes IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: duplicate normalised redirect handles: %', v_dupes;
  END IF;

  SELECT string_agg(k, ', ') INTO v_dupes FROM (
    SELECT coalesce(public.normalize_alias(custom_alias), 'invalid:' || custom_alias) AS k
      FROM public.anonymous_identities
     WHERE custom_alias IS NOT NULL
     GROUP BY 1 HAVING count(DISTINCT subject_hash) > 1
  ) d;
  IF v_dupes IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: duplicate normalised display names: %', v_dupes;
  END IF;
END
$preflight$;

CREATE TABLE IF NOT EXISTS public.name_claims (
  kind text NOT NULL CHECK (kind IN ('handle', 'alias')),
  normalized text NOT NULL,
  owner_subject_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, normalized)
);

CREATE INDEX IF NOT EXISTS name_claims_owner_idx
  ON public.name_claims (owner_subject_hash, kind);

REVOKE ALL ON public.name_claims FROM PUBLIC;
REVOKE ALL ON public.name_claims FROM anon;
REVOKE ALL ON public.name_claims FROM authenticated;
GRANT ALL ON public.name_claims TO service_role;
ALTER TABLE public.name_claims ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.try_claim_name(
  p_kind text, p_normalized text, p_owner text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner text;
BEGIN
  IF p_normalized IS NULL OR p_owner IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO public.name_claims (kind, normalized, owner_subject_hash)
  VALUES (p_kind, p_normalized, p_owner)
  ON CONFLICT (kind, normalized) DO NOTHING;

  SELECT owner_subject_hash INTO v_owner
    FROM public.name_claims
   WHERE kind = p_kind AND normalized = p_normalized;

  RETURN v_owner IS NOT DISTINCT FROM p_owner;
END
$$;

CREATE OR REPLACE FUNCTION public.claim_name(
  p_kind text, p_value text, p_owner text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text;
BEGIN
  v_norm := CASE WHEN p_kind = 'handle'
                 THEN public.normalize_handle(p_value)
                 ELSE public.normalize_alias(p_value) END;
  IF v_norm IS NULL THEN
    RAISE EXCEPTION 'INVALID_NAME' USING ERRCODE = '22023';
  END IF;
  IF NOT public.try_claim_name(p_kind, v_norm, p_owner) THEN
    RAISE EXCEPTION 'ALIAS_TAKEN' USING ERRCODE = '23505';
  END IF;
  RETURN v_norm;
END
$$;

INSERT INTO public.name_claims (kind, normalized, owner_subject_hash)
SELECT 'handle', public.normalize_handle(handle), owner_subject_hash
  FROM public.user_rooms
 WHERE public.normalize_handle(handle) IS NOT NULL
ON CONFLICT (kind, normalized) DO NOTHING;

INSERT INTO public.name_claims (kind, normalized, owner_subject_hash)
SELECT 'handle', public.normalize_handle(old_handle), owner_subject_hash
  FROM public.handle_redirects
 WHERE public.normalize_handle(old_handle) IS NOT NULL
ON CONFLICT (kind, normalized) DO NOTHING;

INSERT INTO public.name_claims (kind, normalized, owner_subject_hash)
SELECT 'alias', public.normalize_alias(custom_alias), subject_hash
  FROM public.anonymous_identities
 WHERE custom_alias IS NOT NULL
   AND public.normalize_alias(custom_alias) IS NOT NULL
ON CONFLICT (kind, normalized) DO NOTHING;

CREATE OR REPLACE FUNCTION public.guard_user_room_handle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text;
BEGIN
  v_norm := public.normalize_handle(NEW.handle);
  IF v_norm IS NULL THEN
    RAISE EXCEPTION 'INVALID_HANDLE' USING ERRCODE = '22023';
  END IF;
  NEW.handle := v_norm;
  IF TG_OP = 'UPDATE' AND OLD.handle = v_norm
     AND OLD.owner_subject_hash = NEW.owner_subject_hash THEN
    RETURN NEW;
  END IF;
  IF NOT public.try_claim_name('handle', v_norm, NEW.owner_subject_hash) THEN
    RAISE EXCEPTION 'ALIAS_TAKEN' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS user_rooms_handle_guard ON public.user_rooms;
CREATE TRIGGER user_rooms_handle_guard
  BEFORE INSERT OR UPDATE OF handle, owner_subject_hash ON public.user_rooms
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_room_handle();

CREATE OR REPLACE FUNCTION public.guard_handle_redirect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text;
BEGIN
  v_norm := public.normalize_handle(NEW.old_handle);
  IF v_norm IS NULL THEN
    RAISE EXCEPTION 'INVALID_HANDLE' USING ERRCODE = '22023';
  END IF;
  NEW.old_handle := v_norm;
  IF NOT public.try_claim_name('handle', v_norm, NEW.owner_subject_hash) THEN
    RAISE EXCEPTION 'ALIAS_TAKEN' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS handle_redirects_guard ON public.handle_redirects;
CREATE TRIGGER handle_redirects_guard
  BEFORE INSERT OR UPDATE ON public.handle_redirects
  FOR EACH ROW EXECUTE FUNCTION public.guard_handle_redirect();

CREATE OR REPLACE FUNCTION public.release_handle_redirect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.name_claims c
   WHERE c.kind = 'handle'
     AND c.normalized = OLD.old_handle
     AND c.owner_subject_hash = OLD.owner_subject_hash
     AND NOT EXISTS (
       SELECT 1 FROM public.user_rooms u
        WHERE u.handle = OLD.old_handle
          AND u.owner_subject_hash = OLD.owner_subject_hash
     );
  RETURN OLD;
END
$$;

DROP TRIGGER IF EXISTS handle_redirects_release ON public.handle_redirects;
CREATE TRIGGER handle_redirects_release
  AFTER DELETE ON public.handle_redirects
  FOR EACH ROW EXECUTE FUNCTION public.release_handle_redirect();

CREATE OR REPLACE FUNCTION public.guard_identity_alias()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text;
  v_clean text;
BEGIN
  NEW.handle := (
    SELECT u.handle FROM public.user_rooms u
     WHERE u.owner_subject_hash = NEW.subject_hash
  );

  IF NEW.custom_alias IS NULL THEN
    RETURN NEW;
  END IF;

  v_clean := btrim(regexp_replace(normalize(NEW.custom_alias, NFKC), '\s+', ' ', 'g'));
  v_norm := public.normalize_alias(v_clean);
  IF v_norm IS NULL THEN
    RAISE EXCEPTION 'INVALID_ALIAS' USING ERRCODE = '22023';
  END IF;
  NEW.custom_alias := v_clean;

  IF TG_OP = 'UPDATE' AND OLD.custom_alias IS NOT NULL
     AND public.normalize_alias(OLD.custom_alias) = v_norm THEN
    RETURN NEW;
  END IF;
  IF NOT public.try_claim_name('alias', v_norm, NEW.subject_hash) THEN
    RAISE EXCEPTION 'ALIAS_TAKEN' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS anonymous_identities_alias_guard ON public.anonymous_identities;
CREATE TRIGGER anonymous_identities_alias_guard
  BEFORE INSERT OR UPDATE ON public.anonymous_identities
  FOR EACH ROW EXECUTE FUNCTION public.guard_identity_alias();

CREATE OR REPLACE FUNCTION public.claim_free_handle(p_base text, p_owner text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base text;
  v_candidate text;
  v_suffix text;
  i integer;
BEGIN
  v_base := public.normalize_handle(p_base);
  IF v_base IS NULL THEN
    v_base := lower(regexp_replace(normalize(coalesce(p_base, ''), NFKC), '[^A-Za-z0-9_]+', '_', 'g'));
    v_base := btrim(v_base, '_');
    v_base := left(v_base, 30);
    IF char_length(v_base) < 3 THEN v_base := 'member'; END IF;
  END IF;

  FOR i IN 1..200 LOOP
    v_suffix := CASE WHEN i = 1 THEN '' ELSE '_' || i::text END;
    v_candidate := left(v_base, 30 - char_length(v_suffix)) || v_suffix;
    IF public.normalize_handle(v_candidate) IS NOT NULL
       AND public.try_claim_name('handle', v_candidate, p_owner) THEN
      RETURN v_candidate;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'ALIAS_TAKEN' USING ERRCODE = '23505';
END
$$;

CREATE OR REPLACE FUNCTION public.claim_free_alias(p_base text, p_owner text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base text;
  v_candidate text;
  v_suffix text;
  i integer;
BEGIN
  v_base := btrim(regexp_replace(normalize(coalesce(p_base, ''), NFKC), '\s+', ' ', 'g'));
  IF char_length(v_base) = 0 THEN v_base := 'Member'; END IF;
  v_base := left(v_base, 32);

  FOR i IN 1..200 LOOP
    v_suffix := CASE WHEN i = 1 THEN '' ELSE ' ' || i::text END;
    v_candidate := btrim(left(v_base, 32 - char_length(v_suffix))) || v_suffix;
    IF public.normalize_alias(v_candidate) IS NOT NULL
       AND public.try_claim_name('alias', public.normalize_alias(v_candidate), p_owner) THEN
      RETURN v_candidate;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'ALIAS_TAKEN' USING ERRCODE = '23505';
END
$$;

DROP FUNCTION IF EXISTS public.get_or_create_personal_room(text, text, text);

CREATE OR REPLACE FUNCTION public.get_or_create_personal_room(
  p_subject_hash text,
  p_handle text,
  p_room_name text,
  p_display_name text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_room public.user_rooms%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_alias text;
  v_handle text;
  v_room_name text;
BEGIN
  SELECT * INTO v_user_room FROM public.user_rooms WHERE owner_subject_hash = p_subject_hash;

  IF NOT FOUND THEN
    PERFORM pg_advisory_xact_lock(hashtext('personal_room:' || p_subject_hash));
    SELECT * INTO v_user_room FROM public.user_rooms WHERE owner_subject_hash = p_subject_hash;

    IF NOT FOUND THEN
      SELECT custom_alias INTO v_alias
        FROM public.anonymous_identities WHERE subject_hash = p_subject_hash;

      IF v_alias IS NULL THEN
        v_alias := public.claim_free_alias(
          coalesce(nullif(btrim(coalesce(p_display_name, '')), ''),
                   regexp_replace(coalesce(p_room_name, 'Member'), '''?s Room$', '')),
          p_subject_hash);
        UPDATE public.anonymous_identities
           SET custom_alias = v_alias
         WHERE subject_hash = p_subject_hash AND custom_alias IS NULL;
      END IF;

      v_handle := public.claim_free_handle(p_handle, p_subject_hash);
      v_room_name := CASE
        WHEN v_alias ~* 's$' THEN v_alias || ''' Room'
        ELSE v_alias || '''s Room'
      END;

      INSERT INTO public.rooms (topic_id, room_number, capacity, kind, visibility,
                                title, description, retention_hours, retention_texts)
      VALUES (NULL, 1, 1000000, 'personal', 'public', v_room_name, NULL, 24, NULL)
      RETURNING * INTO v_room;

      INSERT INTO public.user_rooms (owner_subject_hash, room_id, handle, room_name)
      VALUES (p_subject_hash, v_room.id, v_handle, v_room_name)
      RETURNING * INTO v_user_room;
    END IF;
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = v_user_room.room_id;

  RETURN json_build_object(
    'room_id', v_user_room.room_id,
    'handle', v_user_room.handle,
    'room_name', v_user_room.room_name,
    'description', v_user_room.description,
    'created_at', v_user_room.created_at,
    'capacity', v_room.capacity
  );
END
$$;

CREATE OR REPLACE FUNCTION public.change_personal_handle(
  p_subject_hash text,
  p_handle text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text;
  v_old text;
  v_room_id uuid;
BEGIN
  v_norm := public.normalize_handle(p_handle);
  IF v_norm IS NULL THEN
    RAISE EXCEPTION 'INVALID_HANDLE' USING ERRCODE = '22023';
  END IF;

  SELECT handle, room_id INTO v_old, v_room_id
    FROM public.user_rooms WHERE owner_subject_hash = p_subject_hash FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_PERSONAL_ROOM' USING ERRCODE = 'P0002';
  END IF;

  IF v_old = v_norm THEN
    RETURN json_build_object('handle', v_norm, 'old_handle', v_norm, 'changed', false);
  END IF;

  IF NOT public.try_claim_name('handle', v_norm, p_subject_hash) THEN
    RAISE EXCEPTION 'ALIAS_TAKEN' USING ERRCODE = '23505';
  END IF;

  DELETE FROM public.handle_redirects
   WHERE old_handle = v_norm AND owner_subject_hash = p_subject_hash;

  UPDATE public.user_rooms SET handle = v_norm WHERE owner_subject_hash = p_subject_hash;

  INSERT INTO public.handle_redirects (old_handle, room_id, owner_subject_hash)
  VALUES (v_old, v_room_id, p_subject_hash)
  ON CONFLICT (old_handle) DO UPDATE
    SET room_id = EXCLUDED.room_id
  WHERE public.handle_redirects.owner_subject_hash = EXCLUDED.owner_subject_hash;

  RETURN json_build_object('handle', v_norm, 'old_handle', v_old, 'changed', true);
END
$$;

CREATE OR REPLACE FUNCTION public.set_display_name(
  p_subject_hash text,
  p_display_name text,
  p_room_name text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean text;
  v_norm text;
  v_room_name text;
  v_room_id uuid;
  v_rooms integer := 0;
BEGIN
  v_clean := btrim(regexp_replace(normalize(coalesce(p_display_name, ''), NFKC), '\s+', ' ', 'g'));
  v_norm := public.normalize_alias(v_clean);
  IF v_norm IS NULL THEN
    RAISE EXCEPTION 'INVALID_ALIAS' USING ERRCODE = '22023';
  END IF;

  IF NOT public.try_claim_name('alias', v_norm, p_subject_hash) THEN
    RAISE EXCEPTION 'ALIAS_TAKEN' USING ERRCODE = '23505';
  END IF;

  UPDATE public.anonymous_identities
     SET custom_alias = v_clean, last_seen_at = now()
   WHERE subject_hash = p_subject_hash;

  v_room_name := coalesce(nullif(btrim(coalesce(p_room_name, '')), ''),
    CASE WHEN v_clean ~* 's$' THEN v_clean || ''' Room' ELSE v_clean || '''s Room' END);

  UPDATE public.user_rooms SET room_name = v_room_name
   WHERE owner_subject_hash = p_subject_hash
  RETURNING room_id INTO v_room_id;

  IF v_room_id IS NOT NULL THEN
    UPDATE public.rooms SET title = v_room_name WHERE id = v_room_id;
  END IF;

  WITH touched AS (
    UPDATE public.memberships SET alias = v_clean
     WHERE subject_hash = p_subject_hash AND left_at IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_rooms FROM touched;

  RETURN json_build_object(
    'display_name', v_clean,
    'room_name', v_room_name,
    'rooms_updated', v_rooms
  );
END
$$;

DO $grants$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.try_claim_name(text, text, text)',
    'public.claim_name(text, text, text)',
    'public.claim_free_handle(text, text)',
    'public.claim_free_alias(text, text)',
    'public.change_personal_handle(text, text)',
    'public.set_display_name(text, text, text)',
    'public.get_or_create_personal_room(text, text, text, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END
$grants$;

GRANT EXECUTE ON FUNCTION public.normalize_handle(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.normalize_alias(text) TO service_role;