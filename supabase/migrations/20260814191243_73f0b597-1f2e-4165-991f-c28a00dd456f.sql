CREATE UNIQUE INDEX IF NOT EXISTS anonymous_identities_custom_alias_unique
  ON public.anonymous_identities (lower(custom_alias))
  WHERE custom_alias IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_rooms_handle_unique
  ON public.user_rooms (lower(handle));