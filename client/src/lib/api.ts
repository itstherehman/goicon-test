// Thin fetch wrapper. Mirrors the server's error shape: { error: { code, message, details? } }

export type ErrorDetail = { location: string; path: string; message: string }

export class ApiError extends Error {
  status: number
  code: string
  details?: ErrorDetail[]

  constructor(status: number, code: string, message: string, details?: ErrorDetail[]) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'
const TOKEN_KEY = 'ops-analytics.token'

// Token lives in memory, mirrored to sessionStorage so a reload keeps the session
// (cleared when the tab closes). Trade-off vs an httpOnly cookie is in the README.
let token: string | null = readStoredToken()
let onUnauthorized: () => void = () => {}

function readStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(value: string | null) {
  token = value
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value)
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // storage unavailable (private mode): in-memory token still works
  }
}

export const hasToken = () => token !== null

/** Called on any 401 so the app can drop back to the login screen. */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}

export type Query = Record<string, string | number | undefined>

export function toQueryString(query: Query): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...init.headers,
      },
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.')
  }

  const body = res.status === 204 ? null : await res.json().catch(() => null)

  if (!res.ok) {
    const err = body?.error
    if (res.status === 401 && token) onUnauthorized()
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? res.statusText, err?.details)
  }

  return body as T
}

export const api = {
  get: <T>(path: string, query: Query = {}, signal?: AbortSignal) =>
    request<T>(`${path}${toQueryString(query)}`, { signal }),
  post: <T>(path: string, data: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(data) }),
}

/** Human-readable message including per-field validation details. */
export function describeError(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Something went wrong.'
  if (!err.details?.length) return err.message
  return `${err.message}: ${err.details.map((d) => (d.path ? `${d.path} – ${d.message}` : d.message)).join('; ')}`
}
