import { useState } from 'react'
import { api } from '../lib/api'
import { dayRangeToInstants, formatDateTime } from '../lib/dates'
import { EVENT_TYPES, type EventItem, type EventPage } from '../lib/types'
import { useApi } from '../lib/useApi'
import { Empty, ErrorMessage, Loading } from './StateMessage'

const PAGE_SIZE = 25

type Filters = { from: string; to: string; eventType: string; source: string; q: string }
const EMPTY_FILTERS: Filters = { from: '', to: '', eventType: '', source: '', q: '' }

export function EventsTable() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS)
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS)
  const [cursor, setCursor] = useState<string | null>(null)
  const [rows, setRows] = useState<EventItem[]>([])

  const query = {
    ...dayRangeToInstants(applied.from, applied.to),
    eventType: applied.eventType || undefined,
    source: applied.source.trim() || undefined,
    q: applied.q.trim() || undefined,
    limit: PAGE_SIZE,
    cursor: cursor ?? undefined,
  }

  const { state, retry } = useApi(JSON.stringify(query), async (signal) => {
    const page = await api.get<EventPage>('/events', query, signal)
    setRows((prev) => (cursor ? [...prev, ...page.data] : page.data))
    return page
  })

  const update = (key: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }))

  function apply(e: React.FormEvent) {
    e.preventDefault()
    setRows([])
    setCursor(null)
    setApplied(draft)
  }

  const nextCursor = state.status === 'success' ? state.data.page.nextCursor : null
  const firstPageLoading = state.status === 'loading' && !cursor

  return (
    <section aria-labelledby="events-heading" className="stack">
      <h2 id="events-heading">Events</h2>

      <form onSubmit={apply}>
        <fieldset className="filters">
          <legend>Filters (UTC days, inclusive)</legend>
          <label>
            From
            <input type="date" value={draft.from} max={draft.to || undefined} onChange={update('from')} />
          </label>
          <label>
            To
            <input type="date" value={draft.to} min={draft.from || undefined} onChange={update('to')} />
          </label>
          <label>
            Event type
            <select value={draft.eventType} onChange={update('eventType')}>
              <option value="">All types</option>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            Source
            <input value={draft.source} maxLength={100} placeholder="e.g. billing-service" onChange={update('source')} />
          </label>
          <label>
            Search
            <input type="search" value={draft.q} minLength={2} maxLength={100} placeholder="id, reason…" onChange={update('q')} />
          </label>
          <button type="submit">Apply</button>
        </fieldset>
      </form>

      {firstPageLoading && <Loading label="Loading events…" />}
      {state.status === 'error' && <ErrorMessage error={state.error} onRetry={retry} />}
      {state.status === 'success' && rows.length === 0 && <Empty>No events match these filters.</Empty>}

      {rows.length > 0 && !firstPageLoading && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Occurred (UTC)</th>
                  <th scope="col">Type</th>
                  <th scope="col">Source</th>
                  <th scope="col">Metadata</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap">{formatDateTime(e.occurredAt)}</td>
                    <td>{e.eventType}</td>
                    <td>{e.source}</td>
                    <td>
                      <code className="metadata">{JSON.stringify(e.metadata)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" aria-live="polite">
            Showing {rows.length} event{rows.length === 1 ? '' : 's'}
          </p>
          {nextCursor && (
            <button type="button" onClick={() => setCursor(nextCursor)}>
              Load more
            </button>
          )}
          {state.status === 'loading' && cursor && <Loading label="Loading more…" />}
        </>
      )}
    </section>
  )
}
