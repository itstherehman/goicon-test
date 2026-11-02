import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export type ApiState<T> =
  | { status: 'loading'; data?: T }
  | { status: 'error'; error: unknown; data?: T }
  | { status: 'success'; data: T }

type Result<T> = { id: string; ok: true; data: T } | { id: string; ok: false; error: unknown; data?: T }

/**
 * Runs `fetcher` whenever `key` changes; aborts the previous request so a slow
 * response for old filters can't overwrite a newer one. While loading, the last
 * data is kept so the UI can show it dimmed instead of flashing empty.
 */
export function useApi<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<Result<T> | null>(null)
  const id = `${attempt}:${key}`

  // Always call the latest fetcher without making it an effect dependency.
  const fetcherRef = useRef(fetcher)
  useLayoutEffect(() => {
    fetcherRef.current = fetcher
  })

  useEffect(() => {
    const controller = new AbortController()
    fetcherRef.current(controller.signal)
      .then((data) => setResult({ id, ok: true, data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult((prev) => ({ id, ok: false, error, data: prev?.data }))
      })
    return () => controller.abort()
  }, [id])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  let state: ApiState<T>
  if (!result || result.id !== id) state = { status: 'loading', data: result?.data }
  else if (result.ok) state = { status: 'success', data: result.data }
  else state = { status: 'error', error: result.error, data: result.data }

  return { state, retry }
}
