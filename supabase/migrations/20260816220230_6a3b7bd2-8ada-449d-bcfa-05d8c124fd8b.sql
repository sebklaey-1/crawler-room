DO $$
DECLARE
  old_hash text := '4b20d6d24b195e696c56a64d31318be82e5ae3ac302b6f209e657238ee6e437e';
  new_hash text := '66b0969a2861a2e123857cecdebb0e5aea79a0c6cb05e64fe7f5828099ee942d';
  violet_room uuid := '6bc2d785-240e-4023-984d-dc92d7c675f4';
  satoshi_room uuid := '5cd071d9-84e8-4ecd-982b-00542224fa99';
BEGIN
  DELETE FROM public.name_claims WHERE owner_subject_hash = new_hash;
  DELETE FROM public.handle_redirects WHERE owner_subject_hash = new_hash;
  DELETE FROM public.user_rooms WHERE room_id = violet_room;
  DELETE FROM public.messages WHERE room_id = violet_room;
  DELETE FROM public.image_messages WHERE room_id = violet_room;
  DELETE FROM public.memberships WHERE room_id = violet_room;
  DELETE FROM public.room_followers WHERE room_id = violet_room;
  DELETE FROM public.analytics_events WHERE room_id = violet_room;
  DELETE FROM public.rooms WHERE id = violet_room;

  UPDATE public.name_claims SET owner_subject_hash = new_hash WHERE owner_subject_hash = old_hash;
  UPDATE public.handle_redirects SET owner_subject_hash = new_hash WHERE owner_subject_hash = old_hash;
  UPDATE public.memberships SET subject_hash = new_hash
    WHERE room_id = satoshi_room AND subject_hash = old_hash;
  UPDATE public.user_rooms SET owner_subject_hash = new_hash WHERE owner_subject_hash = old_hash;
  UPDATE public.analytics_events SET owner_subject_hash = new_hash WHERE owner_subject_hash = old_hash;
  UPDATE public.content_likes SET owner_subject_hash = new_hash WHERE owner_subject_hash = old_hash;
  UPDATE public.notification_settings SET subject_hash = new_hash WHERE subject_hash = old_hash
    AND NOT EXISTS (SELECT 1 FROM public.notification_settings n WHERE n.subject_hash = new_hash);
END $$;