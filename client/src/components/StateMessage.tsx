import { describeError } from '../lib/api'

// Shared loading / empty / error states. role=status|alert so screen readers announce changes.

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="state" role="status" aria-live="polite">
      {label}
    </p>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="state" role="status">
      {children}
    </p>
  )
}

export function ErrorMessage({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="state state--error" role="alert">
      <p>{describeError(error)}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}
