import { useEffect, useState } from 'react'
import { api } from '../lib/api'

type Health = { status: string; db: string }

export function HealthStatus() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<Health>('/health')
      .then(setHealth)
      .catch((e: Error) => setError(e.message))
  }, [])

  if (error) return <p className="status status--down">API unreachable: {error}</p>
  if (!health) return <p className="status">Checking API…</p>

  return (
    <p className={`status ${health.db === 'up' ? 'status--up' : 'status--down'}`}>
      API: {health.status} · DB: {health.db}
    </p>
  )
}
