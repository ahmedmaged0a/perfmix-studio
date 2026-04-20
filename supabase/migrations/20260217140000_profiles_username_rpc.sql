-- PerfMix: username on profiles + availability RPC + trigger reads signup metadata.
-- Apply after 20260216120000_profiles_rls.sql via Supabase SQL Editor or CLI.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text;

-- Backfill rows created before username column (stable display-safe slug from id)
UPDATE public.profiles
SET username = lower(
    'u_'
      || substring(replace(id::text, '-', '') FROM 1 FOR 8)
      || '_'
      || substring(replace(id::text, '-', '') FROM 9 FOR 8)
  )
WHERE username IS NULL OR trim(username) = '';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_pattern_chk
  CHECK (username ~ '^[a-zA-Z0-9_]{3,64}$');

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_idx ON public.profiles (lower(username));

ALTER TABLE public.profiles
  ALTER COLUMN username SET NOT NULL;

COMMENT ON COLUMN public.profiles.username IS 'Unique login handle; alphanumeric and underscore only; stored lowercase.';

CREATE OR REPLACE FUNCTION public.username_available(p_username text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  t text;
BEGIN
  t := trim(p_username);
  IF t IS NULL OR t = '' THEN
    RETURN false;
  END IF;
  IF length(t) < 3 OR length(t) > 32 THEN
    RETURN false;
  END IF;
  IF t !~ '^[a-zA-Z0-9_]+$' THEN
    RETURN false;
  END IF;
  RETURN NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE lower(p.username) = lower(t)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.username_available(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.username_available(text) TO anon;
GRANT EXECUTE ON FUNCTION public.username_available(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uname text;
  raw_uname text;
BEGIN
  raw_uname := trim(COALESCE(NEW.raw_user_meta_data->>'username', ''));
  IF raw_uname <> '' AND raw_uname ~ '^[a-zA-Z0-9_]{3,32}$' THEN
    uname := lower(raw_uname);
  ELSE
    uname := lower(
      'u_'
        || substring(replace(NEW.id::text, '-', '') FROM 1 FOR 8)
        || '_'
        || substring(replace(NEW.id::text, '-', '') FROM 9 FOR 8)
    );
  END IF;

  INSERT INTO public.profiles (id, username, created_at)
  VALUES (NEW.id, uname, NOW());
  RETURN NEW;
END;
$$;
