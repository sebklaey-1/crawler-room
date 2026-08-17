DO $$
DECLARE
  v_hash text := encode(digest('crawler-room:official:crawler','sha256'),'hex');
  v_room uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.name_claims WHERE kind='handle' AND normalized='crawler') THEN
    RETURN;
  END IF;

  INSERT INTO public.rooms (kind, title, description, visibility, status, capacity, retention_hours, room_number)
  VALUES ('personal', 'Crawler', 'Official Crawler Room profile.', 'public', 'active', 1000000, 24, 1)
  RETURNING id INTO v_room;

  INSERT INTO public.user_rooms (owner_subject_hash, room_id, handle, room_name, description, external_url, profile_visibility)
  VALUES (
    v_hash,
    v_room,
    'crawler',
    'Crawler',
    'Official profile of Crawler Room. Developed by SEBKLAEY Agency — by Sebastian Kläy, AI Creative Concept Developer, artist from Bern, Switzerland. Creative concepts for the conversational AI era. Also creator of @Crawler — AI-readable Presence. crawler.today · sebklaey.app',
    'https://crawler.today',
    'public'
  );

  INSERT INTO public.name_claims (kind, normalized, owner_subject_hash)
  VALUES ('handle','crawler',v_hash), ('alias','crawler',v_hash)
  ON CONFLICT DO NOTHING;
END $$;