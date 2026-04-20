import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Valid E.164 used across register tests */
const SAMPLE_E164 = '+12025559876'

const ctx = vi.hoisted(() => ({
  configured: true,
  rpc: vi.fn(),
  auth: {
    signInWithPassword: vi.fn(),
    signInWithOtp: vi.fn(),
    verifyOtp: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    getSession: vi.fn(),
    getUser: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
    signInWithOAuth: vi.fn(),
    onAuthStateChange: vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    })),
  },
}))

vi.mock('../lib/supabaseClient', () => ({
  getSupabase: () =>
    ctx.configured
      ? {
          auth: ctx.auth,
          rpc: ctx.rpc,
        }
      : null,
  isSupabaseConfigured: () => ctx.configured,
}))

import { useAuthStore } from './authStore'

describe('authStore (Supabase)', () => {
  beforeEach(() => {
    ctx.configured = true
    vi.clearAllMocks()
    ctx.auth.getSession.mockResolvedValue({ data: { session: null } })
    ctx.auth.signInWithPassword.mockResolvedValue({ error: null })
    ctx.auth.signInWithOtp.mockResolvedValue({ error: null })
    ctx.auth.verifyOtp.mockResolvedValue({ error: null })
    ctx.auth.signUp.mockResolvedValue({
      data: { session: null, user: { id: 'new-user' } },
      error: null,
    })
    ctx.auth.signOut.mockResolvedValue(undefined)
    ctx.auth.resetPasswordForEmail.mockResolvedValue({ error: null })
    ctx.auth.updateUser.mockResolvedValue({ error: null })
    ctx.auth.signInWithOAuth.mockResolvedValue({ data: {}, error: null })
    ctx.auth.getUser.mockResolvedValue({ data: { user: null }, error: null })
    ctx.rpc.mockResolvedValue({ data: true, error: null })

    useAuthStore.setState({
      authReady: false,
      isAuthenticated: false,
      email: null,
      userId: null,
      displayUsername: null,
    })
  })

  it('login rejects empty credentials', async () => {
    let r = await useAuthStore.getState().login('', 'secret')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/required/i)
    r = await useAuthStore.getState().login('a@b.com', '   ')
    expect(r.ok).toBe(false)
    expect(ctx.auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('login calls signInWithPassword when configured', async () => {
    const r = await useAuthStore.getState().login('a@b.com', 'secret')
    expect(r.ok).toBe(true)
    expect(ctx.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'secret',
    })
  })

  it('login returns API error message', async () => {
    ctx.auth.signInWithPassword.mockResolvedValueOnce({
      error: { message: 'Invalid login credentials' },
    })
    const r = await useAuthStore.getState().login('a@b.com', 'wrong')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('Invalid email or password. If you have not registered yet, create an account first.')
  })

  it('login maps unconfirmed email to a clear message', async () => {
    ctx.auth.signInWithPassword.mockResolvedValueOnce({
      error: {
        message: 'Email not confirmed',
        code: 'email_not_confirmed',
      },
    })
    const r = await useAuthStore.getState().login('a@b.com', 'secret')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/confirmation link/)
  })

  it('login fails when Supabase env is not configured', async () => {
    ctx.configured = false
    const r = await useAuthStore.getState().login('a@b.com', 'secret')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Supabase is not configured/)
    expect(ctx.auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('register rejects missing email, password, username, or phone', async () => {
    let r = await useAuthStore.getState().register('', 'secret', 'user_one', SAMPLE_E164)
    expect(r.ok).toBe(false)
    expect(ctx.auth.signUp).not.toHaveBeenCalled()

    r = await useAuthStore.getState().register('a@b.com', '   ', 'user_one', SAMPLE_E164)
    expect(r.ok).toBe(false)
    expect(ctx.auth.signUp).not.toHaveBeenCalled()

    r = await useAuthStore.getState().register('a@b.com', 'secret', '', SAMPLE_E164)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/username/i)
    expect(ctx.auth.signUp).not.toHaveBeenCalled()

    r = await useAuthStore.getState().register('a@b.com', 'secret', 'user_one', '')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/phone/i)
    expect(ctx.auth.signUp).not.toHaveBeenCalled()

    r = await useAuthStore.getState().register('a@b.com', 'secret', 'user_one', '+999')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/phone/i)
    expect(ctx.auth.signUp).not.toHaveBeenCalled()
  })

  it('usernameAvailable maps missing-RPC / schema-cache error to migration hint', async () => {
    ctx.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message:
          'Could not find the function public.username_available(p_username) in the schema cache',
      },
    })
    const r = await useAuthStore.getState().usernameAvailable('anyone')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/20260217140000_profiles_username_rpc/)
  })

  it('register checks username_available before signUp', async () => {
    ctx.auth.signUp.mockResolvedValueOnce({
      data: { session: null, user: { id: 'u1' } },
      error: null,
    })
    const r = await useAuthStore.getState().register('a@b.com', 'secret', 'my_user', SAMPLE_E164)
    expect(r.ok).toBe(true)
    expect(ctx.rpc).toHaveBeenCalledWith('username_available', { p_username: 'my_user' })
    expect(ctx.auth.signUp).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'secret',
      options: { data: { username: 'my_user', phone_e164: SAMPLE_E164 } },
    })
  })

  it('register rejects taken username without calling signUp', async () => {
    ctx.rpc.mockResolvedValueOnce({ data: false, error: null })
    const r = await useAuthStore.getState().register('a@b.com', 'secret', 'taken', SAMPLE_E164)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/already taken/)
    expect(ctx.auth.signUp).not.toHaveBeenCalled()
  })

  it('register maps duplicate email to friendly message', async () => {
    ctx.auth.signUp.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { message: 'User already registered' },
    })
    const r = await useAuthStore.getState().register('a@b.com', 'secret', 'new_user', SAMPLE_E164)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/already exists/)
  })

  it('register sets needsEmailConfirmation when session is null', async () => {
    ctx.auth.signUp.mockResolvedValueOnce({
      data: { session: null, user: { id: 'u1' } },
      error: null,
    })
    const r = await useAuthStore.getState().register('a@b.com', 'secret', 'user_one', SAMPLE_E164)
    expect(r.ok).toBe(true)
    expect(r.needsEmailConfirmation).toBe(true)
  })

  it('register skips needsEmailConfirmation when session exists', async () => {
    ctx.auth.signUp.mockResolvedValueOnce({
      data: {
        session: { access_token: 'x' } as unknown as import('@supabase/supabase-js').Session,
        user: { id: 'u1' },
      },
      error: null,
    })
    ctx.auth.getSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'x',
          user: { id: 'u1', email: 'a@b.com', user_metadata: { username: 'user_one' } },
        } as unknown as import('@supabase/supabase-js').Session,
      },
    })
    const r = await useAuthStore.getState().register('a@b.com', 'secret', 'user_one', SAMPLE_E164)
    expect(r.ok).toBe(true)
    expect(r.needsEmailConfirmation).toBe(false)
    expect(ctx.auth.updateUser).toHaveBeenCalledWith({ phone: SAMPLE_E164 })
  })

  it('signInWithOAuth passes provider and redirectTo when window is defined', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost:5173', pathname: '/' },
    } as Window)
    const r = await useAuthStore.getState().signInWithOAuth('google')
    expect(r.ok).toBe(true)
    expect(ctx.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'http://localhost:5173/',
      },
    })
    vi.unstubAllGlobals()
  })

  it('signInWithOAuth maps disabled-provider errors to a clear message', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost:5173', pathname: '/' },
    } as Window)
    ctx.auth.signInWithOAuth.mockResolvedValueOnce({
      data: null,
      error: {
        message: JSON.stringify({
          code: 400,
          error_code: 'validation_failed',
          msg: 'Unsupported provider: provider is not enabled',
        }),
      },
    })
    const r = await useAuthStore.getState().signInWithOAuth('github')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Authentication → Providers/)
    vi.unstubAllGlobals()
  })

  it('signInWithOAuth fails when Supabase env is not configured', async () => {
    ctx.configured = false
    const r = await useAuthStore.getState().signInWithOAuth('github')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Supabase is not configured/)
    expect(ctx.auth.signInWithOAuth).not.toHaveBeenCalled()
  })

  it('sendLoginOtp uses signInWithOtp with shouldCreateUser false', async () => {
    const r = await useAuthStore.getState().sendLoginOtp('who@example.com')
    expect(r.ok).toBe(true)
    expect(ctx.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'who@example.com',
      options: { shouldCreateUser: false },
    })
  })

  it('verifyLoginOtp calls verifyOtp with type email', async () => {
    const r = await useAuthStore.getState().verifyLoginOtp('who@example.com', '12345678')
    expect(r.ok).toBe(true)
    expect(ctx.auth.verifyOtp).toHaveBeenCalledWith({
      email: 'who@example.com',
      token: '12345678',
      type: 'email',
    })
  })

  it('sendLoginOtp maps email rate limit to a clear message', async () => {
    ctx.auth.signInWithOtp.mockResolvedValueOnce({
      error: { message: 'email rate limit exceeded', code: 'over_email_send_rate_limit' },
    })
    const r = await useAuthStore.getState().sendLoginOtp('a@b.com')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Too many verification emails/)
    expect(r.tone).toBe('warning')
  })

  it('verifyLoginOtp maps wrong or expired OTP', async () => {
    ctx.auth.verifyOtp.mockResolvedValueOnce({
      error: { message: 'Token has expired or is invalid', code: 'otp_expired' },
    })
    const r = await useAuthStore.getState().verifyLoginOtp('a@b.com', '99999999')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/incorrect or expired/)
  })

  it('requestPasswordReset calls resetPasswordForEmail with reset path', async () => {
    const r = await useAuthStore.getState().requestPasswordReset('r@example.com')
    expect(r.ok).toBe(true)
    expect(ctx.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'r@example.com',
      expect.objectContaining({
        redirectTo: expect.stringMatching(/\/reset-password$/),
      }),
    )
  })

  it('updateRecoveryPassword updates user and refreshes session state', async () => {
    ctx.auth.getSession.mockResolvedValueOnce({
      data: {
        session: {
          user: { id: 'u1', email: 'a@b.com', user_metadata: { username: 'bob' } },
        } as unknown as import('@supabase/supabase-js').Session,
      },
    })
    const r = await useAuthStore.getState().updateRecoveryPassword('Aa1!newpass')
    expect(r.ok).toBe(true)
    expect(ctx.auth.updateUser).toHaveBeenCalledWith({ password: 'Aa1!newpass' })
    expect(useAuthStore.getState().displayUsername).toBe('bob')
    expect(useAuthStore.getState().email).toBe('a@b.com')
  })

  it('usernameAvailable returns RPC result', async () => {
    ctx.rpc.mockResolvedValueOnce({ data: true, error: null })
    const r = await useAuthStore.getState().usernameAvailable('  free_name  ')
    expect(r.ok).toBe(true)
    expect(r.available).toBe(true)
    expect(ctx.rpc).toHaveBeenCalledWith('username_available', { p_username: 'free_name' })
  })

  it('logout clears state and calls signOut', async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      email: 'x@y.com',
      userId: 'id1',
      displayUsername: 'alice',
    })
    await useAuthStore.getState().logout()
    expect(ctx.auth.signOut).toHaveBeenCalled()
    expect(useAuthStore.getState().email).toBeNull()
    expect(useAuthStore.getState().displayUsername).toBeNull()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})
