import { useEffect, useId, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSupabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import { evaluatePasswordStrength, isPasswordStrong } from '../../lib/authValidation'
import { PasswordStrengthMeter } from './PasswordStrengthMeter'
import { useAuthStore } from '../../store/authStore'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const id = useId()
  const pwId = `${id}-pw`
  const confirmId = `${id}-confirm`

  const updateRecoveryPassword = useAuthStore((s) => s.updateRecoveryPassword)

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(true)
  const [hasSession, setHasSession] = useState(false)

  useEffect(() => {
    void (async () => {
      if (!isSupabaseConfigured() || !getSupabase()) {
        setChecking(false)
        setHasSession(false)
        return
      }
      const { data } = await getSupabase()!.auth.getSession()
      setHasSession(!!data.session)
      setChecking(false)
    })()
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const c = evaluatePasswordStrength(password)
    if (!isPasswordStrong(c)) {
      setError('Choose a stronger password that meets every requirement below.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    const result = await updateRecoveryPassword(password)
    if (!result.ok) {
      setError(result.error ?? 'Could not update password.')
      return
    }
    navigate('/', { replace: true })
  }

  if (checking) {
    return (
      <div className="login-shell">
        <div className="login-shell__bg" aria-hidden="true" />
        <div className="boot-screen">Checking reset link…</div>
      </div>
    )
  }

  if (!isSupabaseConfigured()) {
    return (
      <div className="login-shell">
        <div className="login-shell__bg" aria-hidden="true" />
        <div className="boot-screen error">
          Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local.
        </div>
      </div>
    )
  }

  if (!hasSession) {
    return (
      <div className="login-shell">
        <div className="login-shell__bg" aria-hidden="true" />
        <div className="login-shell__inner">
          <section className="login-card-panel">
            <h2 className="login-card-panel__title">Reset link invalid or expired</h2>
            <p className="muted" style={{ marginBottom: 16 }}>
              Open the password reset link from your email again, or request a new reset from the sign-in page.
            </p>
            <button type="button" className="login-submit" onClick={() => navigate('/', { replace: true })}>
              Back to sign in
            </button>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="login-shell">
      <div className="login-shell__bg" aria-hidden="true" />
      <div className="login-shell__inner">
        <section className="login-card-panel">
          <h2 className="login-card-panel__title">Create new password</h2>
          <p className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
            Choose a strong password for your account.
          </p>
          <form onSubmit={(e) => void handleSubmit(e)} className="login-form">
            <div className="login-form__field">
              <label htmlFor={pwId} className="sr-only">
                New password
              </label>
              <input
                id={pwId}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="New password"
                required
              />
            </div>
            <PasswordStrengthMeter password={password} idPrefix={id} />
            <div className="login-form__field">
              <label htmlFor={confirmId} className="sr-only">
                Confirm password
              </label>
              <input
                id={confirmId}
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm password"
                required
              />
            </div>
            <button type="submit" className="login-submit">
              Update password
            </button>
            {error ? <p className="form-error login-form__error">{error}</p> : null}
          </form>
        </section>
      </div>
    </div>
  )
}
