import { useId, useState, type FormEvent } from 'react'
import { useAuthStore } from '../../store/authStore'

export function LoginPage() {
  const id = useId()
  const usernameId = `${id}-username`
  const passwordId = `${id}-password`

  const login = useAuthStore((state) => state.login)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    const result = await login(username, password)
    if (!result.ok) {
      setError(result.error ?? 'Login failed.')
    }
  }

  return (
    <div className="login-shell">
      <div className="login-shell__bg" aria-hidden="true" />
      <div className="login-shell__inner">
        <header className="login-hero">
          <h1 className="login-hero__title">PerfMix Studio</h1>
          <p className="login-hero__tagline">
            Run High-Scale Performance Tests. Simulate traffic. Analyze bottlenecks. Ship faster.
          </p>
          <ul className="login-hero__pills" aria-label="Product focus">
            <li>Load Testing</li>
            <li>API Testing</li>
            <li>k6 Ready</li>
          </ul>
        </header>

        <section className="login-card-panel" aria-labelledby={`${id}-card-title`}>
          <h2 id={`${id}-card-title`} className="login-card-panel__title">
            Start Testing
          </h2>
          <form onSubmit={handleSubmit} className="login-form">
            <div className="login-form__field">
              <label htmlFor={usernameId} className="sr-only">
                Username
              </label>
              <input
                id={usernameId}
                name="username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Username"
              />
            </div>
            <div className="login-form__field">
              <label htmlFor={passwordId} className="sr-only">
                Password
              </label>
              <input
                id={passwordId}
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
              />
            </div>
            <button type="submit" className="login-submit">
              Login
            </button>
            {error ? <p className="form-error login-form__error">{error}</p> : null}
          </form>
        </section>
      </div>
    </div>
  )
}
