DELETE FROM public.invitations WHERE room_id IN (SELECT id FROM public.rooms WHERE title = 'Testraum');
DELETE FROM public.messages WHERE room_id IN (SELECT id FROM public.rooms WHERE title = 'Testraum');
DELETE FROM public.memberships WHERE room_id IN (SELECT id FROM public.rooms WHERE title = 'Testraum');
DELETE FROM public.rooms WHERE title = 'Testraum';
DELETE FROM public.rate_events WHERE subject_hash IN (SELECT subject_hash FROM public.anonymous_identities WHERE last_seen_at > now() - interval '1 hour');
UPDATE public.plans SET price_cents = 0, stripe_price_id = NULL, stripe_product_id = NULL, tagline = 'Included for free';