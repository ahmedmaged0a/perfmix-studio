# Supabase migrations

Apply SQL in `migrations/` **in chronological order** using one of:

1. **Supabase Dashboard** → SQL Editor → paste each migration file → Run.
2. **Supabase CLI**: `supabase link --project-ref <ref>` then `supabase db push`.

After applying `20260216120000_profiles_rls.sql`, run in order:

1. `20260217140000_profiles_username_rpc.sql` — `username` column and `username_available` RPC  
2. `20260218150000_profiles_phone.sql` — optional `profiles.phone` (E.164) from signup metadata

### Error: `Could not find the function public.username_available … in the schema cache`

That means **`20260217140000_profiles_username_rpc.sql` has not been applied** on this Supabase project (or the API schema cache needs a refresh after you ran the SQL). Open **Supabase Dashboard → SQL Editor**, paste the full contents of `migrations/20260217140000_profiles_username_rpc.sql`, run it, then do the same for `20260218150000_profiles_phone.sql` if you use phone on profiles. Alternatively: `supabase link` and `supabase db push`. Afterward, reload the app; if the error persists, wait a minute or redeploy so PostgREST reloads.

## Auth dashboard checklist (Email OTP + password recovery)

- **Authentication → Providers → Email**: enable email sign-in; enable **Email OTP** (or the current dashboard option for one-time codes) so `signInWithOtp` / `verifyOtp` work for login-only codes.
- **Authentication → URL configuration**: add site URLs and redirect URLs your app uses, for example:
  - `http://localhost:5173` and `http://localhost:5173/**` for local Vite dev
  - Production origin(s) and wildcard `https://yourdomain.com/**` if your Supabase version supports it
  - Include `http://localhost:5173/reset-password` (and the same path on production) so `resetPasswordForEmail` recovery links land on the SPA.
- **Email / SMTP**: use Supabase default mail or configure custom SMTP so confirmation, OTP, and recovery emails are delivered.
- **Tauri / desktop**: recovery links must use a URL scheme or deep link your app registers; otherwise links open in the browser. For MVP, use web `localhost` redirects as above.

Ensure **Authentication → Email** matches your product (e.g. “Confirm email” if you require verified addresses before sessions).

### Email OTP / “Sign in with email code” — `email rate limit exceeded`

Supabase Auth **limits how many OTP / magic-link / recovery emails** can be sent **per email address and per IP** within a sliding window (exact numbers depend on your plan and server settings). During development, clicking **Send code** many times or using **Confirm email**, **Reset password**, and **OTP** for the same inbox will hit this limit quickly.

**What to do**

1. **Wait** several minutes to an hour before requesting another code.
2. **Use another email** for testing.
3. **Avoid hammering Send** — the app adds a cooldown after a successful send to reduce accidental limits.
4. Configure **custom SMTP** in Supabase if you rely on higher volume (limits may still apply to OTP generation).
5. Confirm **Authentication → Providers → Email** has **OTP / magic link** enabled so emails are actually dispatched.

Wrong or expired OTP codes show a dedicated message in the app after **Verify code**.

## OAuth (Google / GitHub)

The app calls `signInWithOAuth` with `redirectTo` set to the current origin + pathname (e.g. `http://localhost:5173/` for local Vite).

### Error: `Unsupported provider: provider is not enabled` or `validation_failed`

That response means **the provider is still off** in Supabase or has **no Client ID / Secret**. Buttons in the app only work after you finish **both** steps below for each provider you use.

1. **Supabase Dashboard → Authentication → Providers**
   - Open **Google** (or **GitHub**).
   - Turn the provider **on**.
   - Paste **Client ID** and **Client Secret** from the provider (see below). Save.

2. **Redirect URL inside Google / GitHub (not optional)**  
   In Supabase, each provider shows the exact **Callback URL** (redirect URI), usually:
   `https://<YOUR_PROJECT_REF>.supabase.co/auth/v1/callback`  
   Put that exact URL in:
   - **Google Cloud Console** → APIs & Services → Credentials → your OAuth 2.0 Client → Authorized redirect URIs  
   - **GitHub** → Settings → Developer settings → OAuth Apps → your app → Authorization callback URL  

3. **Authentication → URL configuration** (site + redirect allow list), e.g.:
   - `http://localhost:5173` and `http://localhost:5173/` for dev  
   - Your production origin(s)

### Error 400: `redirect_uri_mismatch` (Google)

This is **not** caused by “wait 5 minutes to a few hours.” Google returns this immediately when **Authorized redirect URIs** in Google Cloud Console omit the URI Supabase actually sends.

Add **exactly** this redirect URI (replace with your project ref):

`https://<YOUR_PROJECT_REF>.supabase.co/auth/v1/callback`

Steps: **Google Cloud Console** → **APIs & Services** → **Credentials** → your OAuth **Web application** client → **Authorized redirect URIs** → **Add URI** → paste the Supabase callback above → **Save**.

**Supabase Dashboard → Authentication → Providers → Google** often displays the callback URL you must copy.

Do **not** rely on only `http://localhost:5173` inside Google’s redirect URI list for Supabase-hosted OAuth—localhost belongs under **Supabase → URL configuration** for returning users to your app after login, not as a replacement for the `*.supabase.co/auth/v1/callback` URI in Google.

### Getting credentials

- **Google**: Google Cloud Console → create OAuth client (Web application) → copy Client ID / Secret → use Supabase’s callback URL as an authorized redirect URI.
- **GitHub**: New OAuth App → Authorization callback URL = Supabase callback above → copy Client ID / Client secrets (generate if needed).

### Desktop / Tauri

Register a custom URL scheme or use the web origin your build loads if OAuth must return to the app.

**Phone column (Dashboard → Authentication → Users)**  
Registration stores `phone_e164` in user metadata and syncs with `auth.updateUser({ phone })` when a session exists (immediate signup) or after the user signs in (email confirmation flow). `public.profiles.phone` is filled by the trigger from the same metadata when you run `20260218150000_profiles_phone.sql`. If `updateUser({ phone })` errors (e.g. SMS verification settings), the profile row still keeps the number.
