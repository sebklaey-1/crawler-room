ALTER TABLE public.rate_events DROP CONSTRAINT IF EXISTS rate_events_action_check;
ALTER TABLE public.rate_events ADD CONSTRAINT rate_events_action_check
  CHECK (action = ANY (ARRAY['message'::text, 'join'::text, 'report'::text, 'upload'::text, 'like'::text, 'profile_image'::text]));