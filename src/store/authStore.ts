import type { AuthError, Session } from '@supabase/supabase-js'
import { create } from 'zustand'
import { isValidE164 } from '../lib/phoneValidation'
import { getSupabase, isSupabaseConfigured } from '../lib/supabaseClient'

/** Legacy localStorage key — cleared on logout after Supabase migration */
const LEGACY_AUTH_KEY = 'perfmix-auth-v1'

function notConfiguredError() {
  return (
    'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local.'
  )
}

function mapSignupError(raw: string): string {
  const lower = raw.toLowerCase()
  if (lower.includes('already registered') || lower.includes('user already')) {
    return 'An account with this email already exists. Try signing in or reset your password.'
  }
  return raw
}

/** Normalize Auth API errors that sometimes arrive as JSON strings */
function unwrapAuthMessage(raw: string): string {
  const t = raw.trim()
  if (!t.startsWith('{')) return raw
  try {
    const j = JSON.parse(t) as { msg?: string; message?: string }
    return typeof j.msg === 'string' ? j.msg : typeof j.message === 'string' ? j.message : raw
  } catch {
    return raw
  }
}

/** PostgREST when `username_available` was never deployed or schema cache is stale */
function mapUsernameRpcError(raw: string): string {
  const msg = unwrapAuthMessage(raw)
  const lower = msg.toLowerCase()
  if (
    (lower.includes('could not find') && lower.includes('function')) ||
    lower.includes('schema cache') ||
    (lower.includes('username_available') &&
      (lower.includes('does not exist') || lower.includes('not found')))
  ) {
    return (
      'Your Supabase database is missing the username migration. In the Dashboard open SQL Editor and run the SQL in supabase/migrations/20260217140000_profiles_username_rpc.sql, then 20260218150000_profiles_phone.sql (in order, after profiles RLS). See supabase/README.md.'
    )
  }
  return msg
}

function mapLoginError(error: AuthError): string {
  const code = error.code
  const msg = unwrapAuthMessage(error.message)
  const lower = msg.toLowerCase()
  if (
    code === 'email_not_confirmed' ||
    lower.includes('email not confirmed') ||
    (lower.includes('not confirmed') && (lower.includes('email') || lower.includes('address')))
  ) {
    return 'Your email is not confirmed yet. Open the confirmation link we sent you, then sign in here.'
  }
  if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
    return 'Invalid email or password. If you have not registered yet, create an account first.'
  }
  return msg
}

function mapOAuthError(raw: string): string {
  const msg = unwrapAuthMessage(raw)
  const lower = msg.toLowerCase()
  if (
    lower.includes('provider is not enabled') ||
    lower.includes('unsupported provider') ||
    lower.includes('validation_failed')
  ) {
    return (
      'Google/GitHub sign-in is turned off in your Supabase project. Open the Supabase Dashboard → Authentication → Providers, enable the provider you want, and paste the OAuth Client ID and Secret from Google Cloud or GitHub (see supabase/README.md).'
    )
  }
  return msg
}

/** `signInWithOtp` — rate limits, OTP disabled, unknown email when login-only */
function mapEmailOtpSendError(error: AuthError): string {
  const code = error.code
  const msg = unwrapAuthMessage(error.message)
  const lower = msg.toLowerCase()
  if (
    code === 'over_email_send_rate_limit' ||
    code === 'over_request_rate_limit' ||
    lower.includes('rate limit')
  ) {
    return (
      'Too many verification emails were sent to this address or from your network. Wait several minutes before requesting another code. Supabase limits OTP/magic-link emails per hour to prevent abuse—use password sign-in meanwhile, or test with a different email.'
    )
  }
  if (code === 'otp_disabled' || (lower.includes('otp') && lower.includes('disabled'))) {
    return (
      'Email OTP / magic link is disabled for this project. In Supabase → Authentication → Providers → Email, enable one-time passwords or magic links (see supabase/README.md).'
    )
  }
  if (code === 'user_not_found' || (lower.includes('user') && lower.includes('not found'))) {
    return (
      'No account exists for this email yet. Register first, then you can use email code sign-in.'
    )
  }
  return msg
}

/** Rate limits are expected during testing — UI can show warning instead of error red */
function emailOtpSendFeedbackTone(error: AuthError): 'warning' | 'error' {
  const code = error.code
  const lower = unwrapAuthMessage(error.message).toLowerCase()
  if (
    code === 'over_email_send_rate_limit' ||
    code === 'over_request_rate_limit' ||
    lower.includes('rate limit')
  ) {
    return 'warning'
  }
  return 'error'
}

/** `verifyOtp` — wrong digit, expiry */
function mapEmailOtpVerifyError(error: AuthError): string {
  const code = error.code
  const msg = unwrapAuthMessage(error.message)
  const lower = msg.toLowerCase()
  if (
    code === 'otp_expired' ||
    code === 'invalid_credentials' ||
    lower.includes('invalid token') ||
    lower.includes('invalid otp') ||
    lower.includes('token has expired') ||
    lower.includes('expired') ||
    (lower.includes('otp') && lower.includes('invalid'))
  ) {
    return 'That code is incorrect or expired. Enter the latest code from your email, or request a new code.'
  }
  return msg
}

/** Copies `user_metadata.phone_e164` onto Auth `user.phone` so Dashboard → Users shows Phone. No-op if already synced. */
async function syncAuthPhoneFromSignupMetadata(): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return
  const pending =
    typeof user.user_metadata?.phone_e164 === 'string' ? user.user_metadata.phone_e164.trim() : ''
  if (!pending || !isValidE164(pending)) return
  if (user.phone === pending) return
  await supabase.auth.updateUser({ phone: pending })
}

function patchFromSession(session: Session | null) {
  const metaUser =
    typeof session?.user?.user_metadata?.username === 'string'
      ? session.user.user_metadata.username
      : null
  return {
    isAuthenticated: !!session,
    email: session?.user.email ?? null,
    userId: session?.user.id ?? null,
    displayUsername: metaUser,
  }
}

export type OAuthProviderId = 'google' | 'github'

type AuthState = {
  authReady: boolean
  isAuthenticated: boolean
  email: string | null
  userId: string | null
  /** From `user_metadata.username` after register / session refresh */
  displayUsername: string | null
  hydrate: () => Promise<void>
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>
  usernameAvailable: (username: string) => Promise<{ ok: boolean; available?: boolean; error?: string }>
  register: (
    email: string,
    password: string,
    username: string,
    /** E.164 including country code, e.g. +201234567890 */
    phoneE164: string,
  ) => Promise<{ ok: boolean; error?: string; needsEmailConfirmation?: boolean }>
  /** Email OTP login (requires Email OTP enabled in Supabase Dashboard). */
  sendLoginOtp: (
    email: string,
  ) => Promise<{ ok: boolean; error?: string; tone?: 'warning' | 'error' }>
  verifyLoginOtp: (email: string, token: string) => Promise<{ ok: boolean; error?: string }>
  requestPasswordReset: (email: string) => Promise<{ ok: boolean; error?: string }>
  /** After opening the recovery link onto `/reset-password`. */
  updateRecoveryPassword: (password: string) => Promise<{ ok: boolean; error?: string }>
  /** OAuth redirect — browser leaves the page on success (PKCE exchange on return URL). */
  signInWithOAuth: (provider: OAuthProviderId) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
}

let hydratePromise: Promise<void> | null = null
let authListenerAttached = false

export const useAuthStore = create<AuthState>((set, get) => ({
  authReady: false,
  isAuthenticated: false,
  email: null,
  userId: null,
  displayUsername: null,

  hydrate: async () => {
    if (get().authReady) return
    if (!hydratePromise) {
      hydratePromise = (async () => {
        const supabase = getSupabase()
        if (!supabase) {
          set({ authReady: true })
          return
        }

        const { data } = await supabase.auth.getSession()
        set(patchFromSession(data.session))
        void syncAuthPhoneFromSignupMetadata()

        if (!authListenerAttached) {
          authListenerAttached = true
          supabase.auth.onAuthStateChange((_event, session) => {
            set(patchFromSession(session))
            if (session) void syncAuthPhoneFromSignupMetadata()
          })
        }

        set({ authReady: true })
      })()
    }
    await hydratePromise
  },

  usernameAvailable: async (username: string) => {
    if (!isSupabaseConfigured() || !getSupabase()) {
      return { ok: false, error: notConfiguredError() }
    }
    const { data, error } = await getSupabase()!.rpc('username_available', {
      p_username: username.trim(),
    })
    if (error) return { ok: false, error: mapUsernameRpcError(error.message) }
    return { ok: true, available: Boolean(data) }
  },

  login: async (email, password) => {
    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password.trim()) {
      return { ok: false, error: 'Email and password are required.' }
    }
    if (!isSupabaseConfigured() || !getSupabase()) {
      return { ok: false, error: notConfiguredError() }
    }

    const { error } = await getSupabase()!.auth.signInWithPassword({
      email: trimmedEmail,
      password: password.trim(),
    })

    if (error) {
      return { ok: false, error: mapLoginError(error) }
    }
    await syncAuthPhoneFromSignupMetadata()
    return { ok: true }
  },

  signInWithOAuth: async (provider: OAuthProviderId) => {
    if (!isSupabaseConfigured() || !getSupabase()) {
      return { ok: false, error: notConfiguredError() }
    }
    const redirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname || '/'}` : undefined
    const { error } = await getSupabase()!.auth.signInWithOAuth({
      provider,
      options: redirectTo ? { redirectTo } : {},
    })
    if (error) return { ok: false, error: mapOAuthError(error.message) }
    return { ok: true }
  },

  sendLoginOtp: async (email: string) => {
    const trimmedEmail = email.trim()
    if (!trimmedEmail) return { ok: false, error: 'Email is required.' }
    if (!isSupabaseConfigured() || !getSupabase()) {
      return { ok: false, error: notConfiguredError() }
    }

    const { error } = await getSupabase()!.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        shouldCreateUser: false,
      },
    })

    if (error) {
      return {
        ok: false,
        error: mapEmailOtpSendError(error),
        tone: emailOtpSendFeedbackTone(error),
      }
    }
    return { ok: true }
  },

  verifyLoginOtp: async (email: string, token: string) => {
    const trimmedEmail = email.trim()
    const trimmedToken = token.trim()
    if (!trimmedEmail || !trimmedToken) {
      return { ok: false, error: 'Email and code are required.' }
    }
    if (!isSupabaseConfigured() || !getSupabase()) {
      return { ok: false, error: notConfiguredError() }
    }

    const { error } = await getSupabase()!.auth.verifyOtp({
      email: trimmedEmail,
      token: trimmedToken,
      type: 'email',
    })

    if (error) return { ok: false, error: mapEmailOtpVerifyError(error) }
    await syncAuthPhoneFromSignupMetadata()
    return { ok: true }
  },

  register: async (email, password, username, phoneE164) => {
    const trimmedEmail = email.trim()
    const trimmedUser = username.trim()
    if (!trimmedEmail || !password.trim()) {
      return { ok: false, error: 'Email and password are required.' }
    }
    if (!trimmedUser) {
      return { ok: false, error: 'Username is required.' }
    }
    const trimmedPhone = phoneE164.trim()
    if (!trimmedPhone || !isValidE164(trimmedPhone)) {
      return { ok: false, error: 'A valid phone number with country code is required.' }
    }
    if (!isSupabaseConfigured() || !getSupabase()) {
      return { ok: false, error: notConfiguredError() }
    }

    const avail = await get().usernameAvailable(trimmedUser)
    if (!avail.ok) return { ok: false, error: avail.error ?? 'Could not verify username.' }
    if (!avail.available) {
      return { ok: false, error: 'This username is already taken. Choose another.' }
    }

    const { data, error } = await getSupabase()!.auth.signUp({
      email: trimmedEmail,
      password: password.trim(),
      options: {
        data: {
          username: trimmedUser.toLowerCase(),
          phone_e164: trimmedPhone,
        },
      },
    })

    if (error) {
      return { ok: false, error: mapSignupError(error.message) }
    }

    if (data.session) {
      const { error: phoneErr } = await getSupabase()!.auth.updateUser({ phone: trimmedPhone })
      if (!phoneErr) {
        const { data: sess } = await getSupabase()!.auth.getSession()
        set(patchFromSession(sess.session))
      }
    }

    const needsEmailConfirmation = !data.session
    return { ok: true, needsEmailConfirmation }
  },

  requestPasswordReset: async (email: string) => {
    const trimmedEmail = email.trim()
    if (!trimmedEmail) return { ok: false, error: 'Email is required.' }
    if (!isSupabaseConfigured() || !getSupabase()) {
      return { ok: false, error: notConfiguredError() }
    }

    const redirectTo = `${typeof window !== 'undefined' ? window.location.origin : ''}/reset-password`

    const { error } = await getSupabase()!.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo,
    })

    if (error) return { ok: false, error: error.message }
    return { ok: true }
  },

  updateRecoveryPassword: async (password: string) => {
    if (!password.trim()) return { ok: false, error: 'Password is required.' }
    if (!isSupabaseConfigured() || !getSupabase()) {
      return { ok: false, error: notConfiguredError() }
    }

    const { error } = await getSupabase()!.auth.updateUser({
      password: password.trim(),
    })

    if (error) return { ok: false, error: error.message }
    const { data } = await getSupabase()!.auth.getSession()
    set(patchFromSession(data.session))
    return { ok: true }
  },

  logout: async () => {
    try {
      localStorage.removeItem(LEGACY_AUTH_KEY)
    } catch {
      /* ignore */
    }
    const supabase = getSupabase()
    if (supabase) {
      await supabase.auth.signOut()
    }
    set({ isAuthenticated: false, email: null, userId: null, displayUsername: null })
  },
}))
