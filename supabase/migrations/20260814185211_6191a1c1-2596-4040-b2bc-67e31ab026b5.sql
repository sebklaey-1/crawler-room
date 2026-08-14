ALTER TABLE public.rooms DROP CONSTRAINT rooms_kind_check;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_kind_check
  CHECK (kind = ANY (ARRAY['topic','private','community','universal','sponsored','personal']));