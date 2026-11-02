// Response shapes of the API (kept in sync with server/src/modules/*).

export const EVENT_TYPES = [
  'job_completed',
  'job_failed',
  'payment_succeeded',
  'payment_failed',
  'user_invited',
  'workflow_delayed',
] as const

export type EventType = (typeof EVENT_TYPES)[number]
export type Role = 'ADMIN' | 'ANALYST'

export type User = {
  id: string
  email: string
  role: Role
  organization: { id: string; name: string }
}

export type LoginResponse = { token: string; expiresIn: number; user: User }

export type EventItem = {
  id: string
  eventType: EventType
  occurredAt: string
  source: string
  metadata: Record<string, unknown>
  idempotencyKey: string | null
  receivedAt: string
}

export type EventPage = {
  data: EventItem[]
  page: { limit: number; nextCursor: string | null; hasMore: boolean }
}

export type Summary = {
  range: { from: string; to: string; timezone: 'UTC' }
  filters: { eventType: EventType | null; source: string | null }
  total: number
  byType: { eventType: EventType; count: number }[]
  daily: { date: string; count: number }[]
}
