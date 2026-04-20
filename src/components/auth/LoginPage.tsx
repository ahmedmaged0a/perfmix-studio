import { useEffect, useId, useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, LineChart, Moon, Rocket, Sun, Target, Zap } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import {
  isPasswordStrong,
  validateUsernameFormat,
  evaluatePasswordStrength,
} from '../../lib/authValidation'
import { DEFAULT_PHONE_DIAL } from '../../lib/phoneCountries'
import { validatePhoneParts } from '../../lib/phoneValidation'
import { PasswordStrengthMeter } from './PasswordStrengthMeter'
import { PhoneCountryInput } from './PhoneCountryInput'
import { EMAIL_OTP_DIGIT_COUNT, OtpDigitGroup } from './OtpDigitGroup'

const REMEMBER_EMAIL_KEY = 'perfmix-login-email'
/** After a successful "Send code", block rapid resends to avoid Supabase email rate limits. */
const OTP_RESEND_COOLDOWN_SEC = 90

const USERNAME_TAKEN_MSG = 'This username is already taken.'

type MainTab = 'signIn' | 'register' | 'emailCode'
type OtpStep = 'email' | 'code'

export function LoginPage() {
  const id = useId()

  const login = useAuthStore((state) => state.login)
  const register = useAuthStore((state) => state.register)
  const sendLoginOtp = useAuthStore((state) => state.sendLoginOtp)
  const verifyLoginOtp = useAuthStore((state) => state.verifyLoginOtp)
  const requestPasswordReset = useAuthStore((state) => state.requestPasswordReset)
  const signInWithOAuth = useAuthStore((state) => state.signInWithOAuth)
  const usernameAvailable = useAuthStore((state) => state.usernameAvailable)

  const [mainTab, setMainTab] = useState<MainTab>('signIn')
  const [forgotOpen, setForgotOpen] = useState(false)
  const [otpStep, setOtpStep] = useState<OtpStep>('email')

  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [phoneDial, setPhoneDial] = useState(DEFAULT_PHONE_DIAL)
  const [phoneNational, setPhoneNational] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const t = localStorage.getItem('perfmix-theme') as 'dark' | 'light' | null
      if (t === 'light' || t === 'dark') return t
    } catch { /* ignore */ }
    return 'dark'
  })

  const [error, setError] = useState('')
  /** Shown on the Sign in tab after successful registration (email confirmation flow). */
  const [signInNotice, setSignInNotice] = useState<string | null>(null)
  const [forgotHint, setForgotHint] = useState<string | null>(null)
  const [otpHint, setOtpHint] = useState<string | null>(null)
  const [usernameCheck, setUsernameCheck] = useState<'idle' | 'ok' | 'bad'>('idle')
  const [oauthBusy, setOauthBusy] = useState<'google' | 'github' | null>(null)
  const [otpCooldownSec, setOtpCooldownSec] = useState(0)
  const [otpSubmitting, setOtpSubmitting] = useState(false)
  /** Email-code tab only: warning = rate limit (amber), error = validation / other */
  const [otpErrorTone, setOtpErrorTone] = useState<'warning' | 'error'>('error')

  useEffect(() => {
    if (otpCooldownSec <= 0) return
    const id = window.setInterval(() => {
      setOtpCooldownSec((s) => (s <= 1 ? 0 : s - 1))
    }, 1000)
    return () => window.clearInterval(id)
  }, [otpCooldownSec])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_EMAIL_KEY)
      if (saved) {
        setEmail(saved)
        setRememberMe(true)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('perfmix-theme', theme)
    } catch { /* ignore */ }
  }, [theme])

  const resetErrors = () => {
    setError('')
    setForgotHint(null)
    setOtpHint(null)
    setSignInNotice(null)
    setOtpErrorTone('error')
  }

  const goTab = (next: MainTab) => {
    if (mainTab === 'register' && next !== 'register') {
      setPhoneDial(DEFAULT_PHONE_DIAL)
      setPhoneNational('')
    }
    setMainTab(next)
    setForgotOpen(false)
    setError('')
    setForgotHint(null)
    setOtpHint(null)
    if (next !== 'signIn') {
      setSignInNotice(null)
    }
    setUsernameCheck('idle')
    setOtpStep('email')
    setOtpCode('')
    setOtpErrorTone('error')
    if (next !== 'emailCode') {
      setOtpCooldownSec(0)
    }
  }

  const clearUsernameTakenError = () => {
    setError((prev) => (prev === USERNAME_TAKEN_MSG ? '' : prev))
  }

  const handleBlurUsername = async () => {
    const v = validateUsernameFormat(username)
    if (!v.ok) {
      setUsernameCheck('bad')
      return
    }
    const res = await usernameAvailable(username.trim())
    if (!res.ok) {
      setUsernameCheck('bad')
      return
    }
    setUsernameCheck(res.available ? 'ok' : 'bad')
    if (res.available) {
      clearUsernameTakenError()
    } else {
      setError(USERNAME_TAKEN_MSG)
    }
  }

  const persistRememberEmail = (ok: boolean, em: string) => {
    try {
      if (ok && em.trim()) {
        localStorage.setItem(REMEMBER_EMAIL_KEY, em.trim())
      } else {
        localStorage.removeItem(REMEMBER_EMAIL_KEY)
      }
    } catch { /* ignore */ }
  }

  const handleLoginSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    resetErrors()
    const result = await login(email, password)
    if (!result.ok) {
      setError(result.error ?? 'Login failed.')
      return
    }
    persistRememberEmail(rememberMe, email)
  }

  const handleOAuth = async (provider: 'google' | 'github') => {
    resetErrors()
    setOauthBusy(provider)
    const r = await signInWithOAuth(provider)
    setOauthBusy(null)
    if (!r.ok) {
      setError(r.error ?? 'Could not start sign-in.')
    }
  }

  const handleEmailOtpSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    resetErrors()

    if (otpStep === 'email') {
      if (otpCooldownSec > 0) return
      setOtpSubmitting(true)
      try {
        const result = await sendLoginOtp(email)
        if (!result.ok) {
          setError(result.error ?? 'Could not send code.')
          setOtpErrorTone(result.tone === 'warning' ? 'warning' : 'error')
          return
        }
        setOtpStep('code')
        setOtpHint('Check your inbox and spam folder. It can take a minute to arrive.')
        setOtpCode('')
        setOtpCooldownSec(OTP_RESEND_COOLDOWN_SEC)
      } finally {
        setOtpSubmitting(false)
      }
      return
    }

    const token = otpCode.replace(/\D/g, '').slice(0, EMAIL_OTP_DIGIT_COUNT)
    if (token.length !== EMAIL_OTP_DIGIT_COUNT) {
      setOtpErrorTone('error')
      setError(`Enter the full ${EMAIL_OTP_DIGIT_COUNT}-digit code.`)
      return
    }

    setOtpSubmitting(true)
    try {
      const result = await verifyLoginOtp(email, token)
      if (!result.ok) {
        setOtpErrorTone('error')
        setError(result.error ?? 'Invalid code.')
      }
    } finally {
      setOtpSubmitting(false)
    }
  }

  const handleRegisterSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    resetErrors()

    const u = validateUsernameFormat(username)
    if (!u.ok) {
      setError(u.message)
      return
    }

    const strength = evaluatePasswordStrength(password)
    if (!isPasswordStrong(strength)) {
      setError('Password must meet every strength requirement below.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    const avail = await usernameAvailable(username.trim())
    if (!avail.ok) {
      setError(avail.error ?? 'Could not verify username.')
      return
    }
    if (!avail.available) {
      setError(USERNAME_TAKEN_MSG)
      return
    }

    const phoneParts = validatePhoneParts(phoneDial, phoneNational)
    if (!phoneParts.ok) {
      setError(phoneParts.message)
      return
    }

    const result = await register(email, password, username.trim(), phoneParts.e164)
    if (!result.ok) {
      setError(result.error ?? 'Registration failed.')
      return
    }

    if (result.needsEmailConfirmation) {
      setPassword('')
      setConfirmPassword('')
      setPhoneDial(DEFAULT_PHONE_DIAL)
      setPhoneNational('')
      setSignInNotice(
        'Registration successful. We emailed you a confirmation link — open it, then sign in below.',
      )
      goTab('signIn')
      return
    }
  }

  const handleForgotSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    resetErrors()
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Enter your email.')
      return
    }
    const result = await requestPasswordReset(trimmed)
    if (!result.ok) {
      setError(result.error ?? 'Request failed.')
      return
    }
    setForgotHint(
      'If an account exists for this email, you will receive a reset link. Open it to set a new password.',
    )
  }

  const cardTitle =
    mainTab === 'register'
      ? 'Create your account'
      : mainTab === 'emailCode'
        ? 'Sign in with email code'
        : forgotOpen
          ? 'Reset password'
          : 'Welcome back'

  const cardSubtitle =
    mainTab === 'register'
      ? 'Join PerfMix Studio to run and analyze load tests.'
      : mainTab === 'emailCode'
        ? otpStep === 'code'
          ? 'We sent a one-time code to your inbox.'
          : 'Use a one-time code instead of a password.'
        : forgotOpen
          ? 'We will email you a link if an account exists.'
          : 'Sign in to continue to PerfMix Studio.'

  const year = new Date().getFullYear()

  return (
    <div className="login-shell" data-login-page>
      <div className="login-shell__bg" aria-hidden="true" />
      <header className="login-topbar">
        <div className="login-topbar__brand">
          <Zap className="login-topbar__logo" aria-hidden strokeWidth={2.25} size={22} />
          <span className="login-topbar__name">PerfMix Studio</span>
        </div>
        <button
          type="button"
          className="login-theme-toggle"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </header>

      <div className="login-shell__inner">
        <div className="login-hero-column">
          <div className="login-hero__brand-row">
            <Zap className="login-hero__bolt" aria-hidden strokeWidth={2.25} size={28} />
            <span className="login-hero__brand-text">PerfMix Studio</span>
          </div>
          <h1 className="login-hero__headline">
            Performance testing made{' '}
            <span className="login-hero__gradient">simple</span>, shipping{' '}
            <span className="login-hero__gradient-alt">made faster</span>.
          </h1>
          <p className="login-hero__tagline login-hero__tagline--wide">
            Run high-scale performance tests. Simulate traffic. Analyze bottlenecks. Ship faster with confidence.
          </p>
          <ul className="login-hero__features">
            <li>
              <LineChart size={18} aria-hidden />
              <span>
                <strong>High-scale testing</strong>
                <span className="login-hero__feat-sub">Stress APIs and workflows at realistic load.</span>
              </span>
            </li>
            <li>
              <Target size={18} aria-hidden />
              <span>
                <strong>Deep insights</strong>
                <span className="login-hero__feat-sub">Spot latency, errors, and throughput trends.</span>
              </span>
            </li>
            <li>
              <Rocket size={18} aria-hidden />
              <span>
                <strong>Ship faster</strong>
                <span className="login-hero__feat-sub">k6-ready scripts from your collections.</span>
              </span>
            </li>
          </ul>
          <div className="login-hero-preview" aria-hidden="true">
            <div className="login-hero-preview__ring" />
            <div className="login-hero-preview__card">
              <div className="login-hero-preview__bars">
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="login-hero-preview__metrics">
                <span>Requests</span>
                <span>Avg. response</span>
                <span>Error rate</span>
              </div>
            </div>
          </div>
        </div>

        <div className="login-auth-column">
          <section className="login-card-panel" aria-labelledby={`${id}-card-title`}>
            <h2 id={`${id}-card-title`} className="login-card-panel__title">
              {cardTitle}
            </h2>
            <p className="login-card-panel__subtitle">{cardSubtitle}</p>

            <div className="login-card-tabs" role="tablist" aria-label="Authentication mode">
              <button
                type="button"
                role="tab"
                aria-selected={mainTab === 'signIn'}
                className={`login-card-tab${mainTab === 'signIn' ? ' login-card-tab--active' : ''}`}
                onClick={() => goTab('signIn')}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mainTab === 'register'}
                className={`login-card-tab${mainTab === 'register' ? ' login-card-tab--active' : ''}`}
                onClick={() => goTab('register')}
              >
                Register
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mainTab === 'emailCode'}
                className={`login-card-tab${mainTab === 'emailCode' ? ' login-card-tab--active' : ''}`}
                onClick={() => goTab('emailCode')}
              >
                Email code
              </button>
            </div>

            {mainTab === 'signIn' && forgotOpen ? (
              <form onSubmit={(e) => void handleForgotSubmit(e)} className="login-form">
                <div className="login-form__field">
                  <label htmlFor={`${id}-forgot-email`} className="sr-only">
                    Email
                  </label>
                  <div className="login-input-wrap">
                    <span className="login-input-wrap__icon" aria-hidden>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                        <polyline points="22,6 12,13 2,6" />
                      </svg>
                    </span>
                    <input
                      id={`${id}-forgot-email`}
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                </div>
                <button type="submit" className="login-submit login-submit--with-icon">
                  Send reset link
                  <ArrowRight size={18} aria-hidden />
                </button>
                <button
                  type="button"
                  className="login-back-link linkish"
                  onClick={() => {
                    setForgotOpen(false)
                    setForgotHint(null)
                    setError('')
                  }}
                >
                  Back to sign in
                </button>
                {forgotHint ? (
                  <p className="login-form__error login-form__success">{forgotHint}</p>
                ) : null}
                {error ? <p className="form-error login-form__error">{error}</p> : null}
              </form>
            ) : null}

            {mainTab === 'signIn' && !forgotOpen ? (
              <>
                {signInNotice ? (
                  <p className="login-form__error login-form__success login-sign-in-notice" role="status">
                    {signInNotice}
                  </p>
                ) : null}
                <form onSubmit={(e) => void handleLoginSubmit(e)} className="login-form">
                  <div className="login-form__field">
                    <label htmlFor={`${id}-login-email`} className="sr-only">
                      Email
                    </label>
                    <div className="login-input-wrap">
                      <span className="login-input-wrap__icon" aria-hidden>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                          <polyline points="22,6 12,13 2,6" />
                        </svg>
                      </span>
                      <input
                        id={`${id}-login-email`}
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                      />
                    </div>
                  </div>

                  <div className="login-form__field">
                    <label htmlFor={`${id}-login-pw`} className="sr-only">
                      Password
                    </label>
                    <div className="login-input-wrap login-input-wrap--password">
                      <span className="login-input-wrap__icon" aria-hidden>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      </span>
                      <input
                        id={`${id}-login-pw`}
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        required
                      />
                      <button
                        type="button"
                        className="login-input-wrap__toggle"
                        tabIndex={-1}
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  <div className="login-row-between">
                    <label className="login-checkbox">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                      />
                      <span>Remember me</span>
                    </label>
                    <button
                      type="button"
                      className="linkish login-forgot-btn"
                      onClick={() => {
                        setForgotOpen(true)
                        setForgotHint(null)
                        setError('')
                      }}
                    >
                      Forgot password?
                    </button>
                  </div>

                  <button type="submit" className="login-submit login-submit--with-icon">
                    Sign in
                    <ArrowRight size={18} aria-hidden />
                  </button>
                  {error ? <p className="form-error login-form__error">{error}</p> : null}
                </form>

                <div className="login-divider">
                  <span>or continue with</span>
                </div>

                <div className="login-oauth-row">
                  <button
                    type="button"
                    className="login-oauth-btn"
                    disabled={oauthBusy !== null}
                    onClick={() => void handleOAuth('google')}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
                      <path
                        fill="currentColor"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="currentColor"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    {oauthBusy === 'google' ? 'Redirecting…' : 'Continue with Google'}
                  </button>
                  <button
                    type="button"
                    className="login-oauth-btn"
                    disabled={oauthBusy !== null}
                    onClick={() => void handleOAuth('github')}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.167 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.866-.013-1.7-2.782.604-3.369-1.342-3.369-1.342-.454-1.154-1.11-1.463-1.11-1.463-.908-.620.069-.607.069-.607 1.004.071 1.531 1.032 1.531 1.032.892 1.528 2.341 1.086 2.912.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.112-4.555-4.951 0-1.094.39-1.988 1.029-2.688-.103-.253-.446-1.271.097-2.651 0 0 .84-.269 2.752 1.026A9.582 9.582 0 0112 6.836c.851.004 1.709.115 2.511.337 1.912-1.294 2.752-1.026 2.752-1.026.544 1.379.402 2.398.196 2.651.642.699 1.029 1.594 1.029 2.688 0 3.849-2.337 4.694-4.563 4.943.358.309.677.917.677 1.849 0 1.336-.013 2.415-.013 2.743 0 .267.18.578.688.48C19.138 20.162 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
                    </svg>
                    {oauthBusy === 'github' ? 'Redirecting…' : 'Continue with GitHub'}
                  </button>
                </div>

                <p className="login-card-footer-hint">
                  Don&apos;t have an account?{' '}
                  <button type="button" className="linkish" onClick={() => goTab('register')}>
                    Register
                  </button>
                </p>
              </>
            ) : null}

            {mainTab === 'emailCode' ? (
              <form onSubmit={(e) => void handleEmailOtpSubmit(e)} className="login-form">
                <div className="login-form__field">
                  <label htmlFor={`${id}-otp-email`} className="sr-only">
                    Email
                  </label>
                  <div className="login-input-wrap">
                    <span className="login-input-wrap__icon" aria-hidden>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                        <polyline points="22,6 12,13 2,6" />
                      </svg>
                    </span>
                    <input
                      id={`${id}-otp-email`}
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                      disabled={otpStep === 'code'}
                    />
                  </div>
                </div>

                {otpStep === 'code' ? (
                  <>
                    <p className="login-otp-instruction">
                      Enter the {EMAIL_OTP_DIGIT_COUNT}-digit code sent to{' '}
                      <strong>{email.trim() || 'your email'}</strong>
                    </p>
                    <div className="login-form__field login-form__field--otp">
                      <OtpDigitGroup
                        idPrefix={`${id}-otp`}
                        value={otpCode}
                        onChange={setOtpCode}
                      />
                    </div>
                  </>
                ) : (
                  <p className="muted login-otp-help">
                    We&apos;ll email you an {EMAIL_OTP_DIGIT_COUNT}-digit code.
                  </p>
                )}

                <button
                  type="submit"
                  className="login-submit login-submit--with-icon"
                  disabled={
                    otpSubmitting || (otpStep === 'email' && otpCooldownSec > 0)
                  }
                >
                  {otpStep === 'email'
                    ? otpCooldownSec > 0
                      ? `Wait ${otpCooldownSec}s to send again`
                      : 'Send code'
                    : otpSubmitting
                      ? 'Verifying…'
                      : 'Verify code'}
                  <ArrowRight size={18} aria-hidden />
                </button>
                {otpStep === 'code' ? (
                  <button
                    type="button"
                    className="linkish login-back-link"
                    onClick={() => {
                      setOtpStep('email')
                      setOtpCode('')
                      setOtpHint(null)
                      setError('')
                      setOtpErrorTone('error')
                      setOtpCooldownSec(0)
                    }}
                  >
                    Use a different email
                  </button>
                ) : null}
                {otpHint ? (
                  <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                    {otpHint}
                  </p>
                ) : null}
                {error ? (
                  <p
                    className={`login-form__error ${
                      otpErrorTone === 'warning' ? 'login-form__notice-warn' : 'form-error'
                    }`}
                    role={otpErrorTone === 'warning' ? 'status' : undefined}
                  >
                    {error}
                  </p>
                ) : null}
              </form>
            ) : null}

            {mainTab === 'register' ? (
              <form onSubmit={(e) => void handleRegisterSubmit(e)} className="login-form">
                <div className="login-form__field">
                  <label htmlFor={`${id}-reg-user`} className="sr-only">
                    Username
                  </label>
                  <div className="login-input-wrap">
                    <span className="login-input-wrap__icon" aria-hidden>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    </span>
                    <input
                      id={`${id}-reg-user`}
                      autoComplete="username"
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value)
                        setUsernameCheck('idle')
                        clearUsernameTakenError()
                      }}
                      onBlur={() => void handleBlurUsername()}
                      placeholder="Username"
                      required
                    />
                  </div>
                  {usernameCheck === 'ok' ? (
                    <p className="login-field-hint login-field-hint--ok">Username looks available.</p>
                  ) : null}
                </div>
                <div className="login-form__field">
                  <label htmlFor={`${id}-reg-email`} className="sr-only">
                    Email
                  </label>
                  <div className="login-input-wrap">
                    <span className="login-input-wrap__icon" aria-hidden>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                        <polyline points="22,6 12,13 2,6" />
                      </svg>
                    </span>
                    <input
                      id={`${id}-reg-email`}
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Email"
                      required
                    />
                  </div>
                </div>
                <div className="login-form__field">
                  <span className="sr-only">Phone number</span>
                  <PhoneCountryInput
                    idPrefix={`${id}-reg`}
                    dialCode={phoneDial}
                    nationalDigits={phoneNational}
                    onDialChange={setPhoneDial}
                    onNationalChange={setPhoneNational}
                  />
                  <p className="login-field-hint muted">Country code first, then mobile number.</p>
                </div>
                <div className="login-form__field">
                  <label htmlFor={`${id}-reg-pw`} className="sr-only">
                    Password
                  </label>
                  <div className="login-input-wrap login-input-wrap--password">
                    <span className="login-input-wrap__icon" aria-hidden>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </span>
                    <input
                      id={`${id}-reg-pw`}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password"
                      required
                    />
                    <button
                      type="button"
                      className="login-input-wrap__toggle"
                      tabIndex={-1}
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
                <PasswordStrengthMeter password={password} idPrefix={`${id}-reg`} />
                <div className="login-form__field">
                  <label htmlFor={`${id}-reg-confirm`} className="sr-only">
                    Confirm password
                  </label>
                  <div className="login-input-wrap login-input-wrap--password">
                    <span className="login-input-wrap__icon" aria-hidden>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </span>
                    <input
                      id={`${id}-reg-confirm`}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm password"
                      required
                    />
                  </div>
                </div>
                <button type="submit" className="login-submit login-submit--with-icon">
                  Create account
                  <ArrowRight size={18} aria-hidden />
                </button>
                {error ? <p className="form-error login-form__error">{error}</p> : null}
              </form>
            ) : null}
          </section>
        </div>
      </div>

      <footer className="login-page-footer">
        <span className="login-page-footer__copy">© {year} PerfMix Studio. All rights reserved.</span>
        <nav className="login-page-footer__links" aria-label="Footer">
          <a href="#">Docs</a>
          <a href="#">Pricing</a>
          <a href="#">Support</a>
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
        </nav>
        <span className="login-page-footer__status" title="Decorative status indicator">
          <span className="login-page-footer__dot" aria-hidden />
          All systems operational
        </span>
      </footer>
    </div>
  )
}
