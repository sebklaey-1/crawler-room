ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS rooms_slug_unique_idx ON public.rooms (lower(slug)) WHERE slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_unique_idx ON public.organizations (lower(slug)) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS rooms_kind_visibility_idx ON public.rooms (kind, visibility) WHERE archived_at IS NULL;