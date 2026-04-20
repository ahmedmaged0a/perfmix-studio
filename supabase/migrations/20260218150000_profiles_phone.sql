-- PerfMix: optional phone on profiles (E.164), from signup metadata phone_e164.
-- Apply after 20260217140000_profiles_username_rpc.sql.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone text;

COMMENT ON COLUMN public.profiles.phone IS 'E.164 phone captured at signup; mirrors Auth phone when synced.';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uname text;
  raw_uname text;
  raw_phone text;
  phone_val text;
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

  raw_phone := trim(COALESCE(NEW.raw_user_meta_data->>'phone_e164', ''));
  IF raw_phone <> '' AND raw_phone ~ '^\+[1-9][0-9]{6,14}$' THEN
    phone_val := raw_phone;
  ELSE
    phone_val := NULL;
  END IF;

  INSERT INTO public.profiles (id, username, phone, created_at)
  VALUES (NEW.id, uname, phone_val, NOW());
  RETURN NEW;
END;
$$;
