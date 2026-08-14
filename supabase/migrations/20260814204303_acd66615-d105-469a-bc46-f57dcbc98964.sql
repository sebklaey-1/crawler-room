REVOKE EXECUTE ON FUNCTION public.block_self_follow() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_or_create_personal_room(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.join_universal_room(text, text) FROM PUBLIC, anon, authenticated;