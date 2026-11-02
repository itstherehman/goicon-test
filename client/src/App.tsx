import { useCallback, useEffect, useState } from 'react'
import { api, hasToken, setToken, setUnauthorizedHandler } from './lib/api'
import type { LoginResponse, User } from './lib/types'
import { Login } from './components/Login'
import { Dashboard } from './components/Dashboard'
import { EventsTable } from './components/EventsTable'
import { HealthStatus } from './components/HealthStatus'
import { ErrorMessage, Loading } from './components/StateMessage'

type Tab = 'dashboard' | 'events'
type Session = { status: 'anonymous' } | { status: 'restoring' } | { status: 'error'; error: unknown } | { status: 'ready'; user: User }

function App() {
  const [session, setSession] = useState<Session>(() => (hasToken() ? { status: 'restoring' } : { status: 'anonymous' }))
  const [tab, setTab] = useState<Tab>('dashboard')

  const logout = useCallback(() => {
    setToken(null)
    setSession({ status: 'anonymous' })
  }, [])

  // Any 401 (expired/invalid token) drops back to the login screen.
  useEffect(() => setUnauthorizedHandler(logout), [logout])

  // Restore a session from a token kept in sessionStorage.
  useEffect(() => {
    if (session.status !== 'restoring') return
    api
      .get<{ user: User }>('/auth/me')
      .then(({ user }) => setSession({ status: 'ready', user }))
      .catch((error: unknown) => {
        if (hasToken()) setSession({ status: 'error', error })
      })
  }, [session.status])

  function handleLogin({ token, user }: LoginResponse) {
    setToken(token)
    setSession({ status: 'ready', user })
  }

  if (session.status === 'anonymous') return <Login onLogin={handleLogin} />
  if (session.status === 'restoring') return <main className="container"><Loading label="Restoring session…" /></main>
  if (session.status === 'error') {
    return (
      <main className="container">
        <ErrorMessage error={session.error} onRetry={() => setSession({ status: 'restoring' })} />
        <button type="button" onClick={logout}>Sign out</button>
      </main>
    )
  }

  const { user } = session
  return (
    <>
      <header className="topbar">
        <div className="container topbar__inner">
          <strong>Ops Analytics</strong>
          <span>
            {user.organization.name} · {user.email} · <span className="badge">{user.role}</span>
          </span>
          <button type="button" onClick={logout}>Sign out</button>
        </div>
      </header>

      <main className="container stack">
        <nav aria-label="Sections" className="tabs">
          <button type="button" aria-current={tab === 'dashboard' ? 'page' : undefined} onClick={() => setTab('dashboard')}>
            Dashboard
          </button>
          <button type="button" aria-current={tab === 'events' ? 'page' : undefined} onClick={() => setTab('events')}>
            Events
          </button>
        </nav>

        {tab === 'dashboard' ? <Dashboard /> : <EventsTable />}

        <footer>
          <HealthStatus />
        </footer>
      </main>
    </>
  )
}

export default App
