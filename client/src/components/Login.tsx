import { useState } from 'react'
import { api, describeError } from '../lib/api'
import type { LoginResponse } from '../lib/types'

export function Login({ onLogin }: { onLogin: (res: LoginResponse) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      onLogin(await api.post<LoginResponse>('/auth/login', { email, password }))
    } catch (err) {
      setError(describeError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="container container--narrow">
      <h1>Ops Analytics</h1>
      <form className="card stack" onSubmit={handleSubmit} aria-describedby="login-hint">
        <h2>Sign in</h2>
        <label>
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="state state--error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {import.meta.env.DEV && (
        <p id="login-hint" className="hint">
          Dev seed users (password <code>Password123!</code>): admin@acme.test, analyst@acme.test, admin@globex.test,
          analyst@globex.test
        </p>
      )}
    </main>
  )
}
