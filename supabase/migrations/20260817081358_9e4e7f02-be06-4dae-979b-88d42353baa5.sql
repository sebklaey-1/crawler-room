do $$
declare hs text[] := array[
  '890c56d54b82134f2c42ec8eef81424965b0b61aef263fcbcff0e156efa0508b',
  'e870b9cf3ac09bd45b181a3f35dc8ccc887263635e73bb6f8f289cfa15f941d4'];
declare rids uuid[];
begin
  select array_agg(room_id) into rids from public.user_rooms where owner_subject_hash = any(hs);
  delete from public.analytics_events where owner_subject_hash = any(hs);
  delete from public.content_likes where subject_hash = any(hs) or owner_subject_hash = any(hs);
  delete from public.handle_redirects where owner_subject_hash = any(hs);
  delete from public.memberships where subject_hash = any(hs);
  delete from public.notification_settings where subject_hash = any(hs);
  delete from public.profile_blocks where subject_hash = any(hs) or blocked_subject_hash = any(hs);
  delete from public.rate_events where subject_hash = any(hs);
  delete from public.room_followers where follower_subject_hash = any(hs);
  delete from public.room_notifications where recipient_subject_hash = any(hs);
  delete from public.user_hidden_campaigns where subject_hash = any(hs);
  delete from public.campaign_impression_log where subject_hash = any(hs);
  delete from public.user_rooms where owner_subject_hash = any(hs);
  if rids is not null then
    delete from public.room_followers where room_id = any(rids);
    delete from public.rooms where id = any(rids);
  end if;
  delete from public.name_claims where owner_subject_hash = any(hs);
  delete from public.anonymous_identities where subject_hash = any(hs);
end $$;