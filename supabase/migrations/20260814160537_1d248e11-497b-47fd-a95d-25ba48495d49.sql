REVOKE EXECUTE ON FUNCTION public.join_topic_room(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_room_capacity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_topic_room(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired() TO service_role;