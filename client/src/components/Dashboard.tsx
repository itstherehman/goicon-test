import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../lib/api'
import { addDays, todayUtc } from '../lib/dates'
import { EVENT_TYPES, type Summary } from '../lib/types'
import { useApi } from '../lib/useApi'
import { Empty, ErrorMessage, Loading } from './StateMessage'

export function Dashboard() {
  const [to, setTo] = useState(todayUtc)
  const [from, setFrom] = useState(() => addDays(todayUtc(), -29))
  const [eventType, setEventType] = useState('')

  const query = { from, to, eventType: eventType || undefined }
  const { state, retry } = useApi(JSON.stringify(query), (signal) =>
    api.get<{ data: Summary }>('/analytics/summary', query, signal).then((r) => r.data),
  )

  return (
    <section aria-labelledby="dashboard-heading" className="stack">
      <h2 id="dashboard-heading">Dashboard</h2>

      <fieldset className="filters">
        <legend>Filters (UTC days, inclusive)</legend>
        <label>
          From
          <input type="date" value={from} max={to} required onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} min={from} required onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          Event type
          <select value={eventType} onChange={(e) => setEventType(e.target.value)}>
            <option value="">All types</option>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      {state.status === 'loading' && <Loading label="Loading analytics…" />}
      {state.status === 'error' && <ErrorMessage error={state.error} onRetry={retry} />}
      {state.data && <SummaryView summary={state.data} stale={state.status !== 'success'} />}
    </section>
  )
}

function SummaryView({ summary, stale }: { summary: Summary; stale: boolean }) {
  return (
    <div className="stack" aria-busy={stale} style={{ opacity: stale ? 0.6 : 1 }}>
      <div className="card">
        <p className="metric-label">Total events</p>
        <p className="metric">{summary.total.toLocaleString()}</p>
        <p className="hint">
          {summary.range.from} → {summary.range.to} (UTC)
        </p>
      </div>

      {summary.total === 0 ? (
        <Empty>No events in this period. Try widening the date range or clearing the event type filter.</Empty>
      ) : (
        <div className="grid">
          <figure className="card">
            <figcaption>Events by type</figcaption>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={summary.byType} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="eventType" width={150} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#0969da" />
              </BarChart>
            </ResponsiveContainer>
            <DataTable caption="Events by type" rows={summary.byType.map((r) => [r.eventType, r.count])} />
          </figure>

          <figure className="card">
            <figcaption>Daily activity</figcaption>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={summary.daily}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} minTickGap={16} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="#0969da" dot={false} />
              </LineChart>
            </ResponsiveContainer>
            <DataTable caption="Daily activity" rows={summary.daily.map((r) => [r.date, r.count])} />
          </figure>
        </div>
      )}
    </div>
  )
}

/** Text alternative for a chart. */
function DataTable({ caption, rows }: { caption: string; rows: [string, number][] }) {
  return (
    <details>
      <summary>View data</summary>
      <table>
        <caption className="visually-hidden">{caption}</caption>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
