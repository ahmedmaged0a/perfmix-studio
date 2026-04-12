import { useState, type FormEvent } from 'react'
import { useAuthStore } from '../../store/authStore'

export function LoginPage() {
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
      <div className="login-card">
        <h1>PerfMix Studio</h1>
        <p className="muted">Sign in to create and run performance scripts.</p>
        <form onSubmit={handleSubmit} className="form-grid login-form">
          <label>
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="test" />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="****" />
          </label>
          <button type="submit">Login</button>
        </form>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </div>
  )
}
