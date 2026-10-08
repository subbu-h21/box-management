import { useCallback, useEffect, useRef, useState } from 'react'
import { api, formatDateTime } from '../api.js'
import { useAuth } from '../auth.jsx'
import { ChoosePrinter, PrinterStatus, printerFor, PrintJobs, usePrintQueue } from '../components/PrintQueue.jsx'

const HISTORY_REFRESH_MS = 5000
const PAGE = 50
const STATUS_LABELS = {
  queued: 'Waiting',
  printing: 'Printing',
  done: 'Printed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

export default function PrinterPage() {
  const queue = usePrintQueue()
  const { status } = queue

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Printer</h2>
          <button className="secondary" onClick={() => queue.submit(api.printTest)}>
            Print test page
          </button>
        </div>
        <div className="printer-line">
          <PrinterStatus status={status} />
        </div>
        {status && (
          <dl className="facts">
            <dt>Printer PC</dt>
            <dd>
              {status.agent_online ? 'Online' : 'Offline'}
              {status.last_seen && <span className="muted small"> · last check-in {formatDateTime(status.last_seen)}</span>}
            </dd>
            <dt>Lists print on</dt>
            <dd>{printerFor(status, 'lists') || '—'}</dd>
            <dt>Stickers print on</dt>
            <dd>{printerFor(status, 'stickers') || '—'}</dd>
          </dl>
        )}
        <PrintJobs queue={queue} />
        {status && !status.agent_online && (
          <p className="muted small">
            The print agent runs on the main PC (the one with the printer) and is started by <b>start.bat</b>. Prints
            wait in the queue until it's running.
          </p>
        )}
        {status && <ChoosePrinter status={status} use="lists" onSaved={queue.refresh} />}
        {status && <p className="muted small">The printer for stickers is chosen on the Stickers page.</p>}
      </section>
      <JobHistory />
    </>
  )
}

function JobHistory() {
  const { user } = useAuth()
  const [filters, setFilters] = useState(null)
  const [jobs, setJobs] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const loadedCount = useRef(PAGE) // how many rows to keep fresh (grows with "Load more")

  useEffect(() => {
    api
      .today()
      .then((t) => setFilters({ date_from: t.date, date_to: t.date, status: '', mine: false }))
      .catch((e) => setError(e.message))
  }, [])

  const params = useCallback(
    (offset, limit) =>
      filters && {
        date_from: filters.date_from,
        date_to: filters.date_to,
        status: filters.status,
        user_id: filters.mine ? user.id : '',
        limit,
        offset,
      },
    [filters, user.id],
  )

  // Load, then keep the visible rows fresh (statuses change while printing).
  useEffect(() => {
    if (!filters) return
    let alive = true
    loadedCount.current = PAGE
    const load = () =>
      api
        .printJobs(params(0, Math.min(loadedCount.current, 200)))
        .then((r) => {
          if (!alive) return
          setJobs(r.items)
          setHasMore(r.has_more)
        })
        .catch((e) => alive && setError(e.message))
    load()
    const t = setInterval(load, HISTORY_REFRESH_MS)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [filters, params])

  async function loadMore() {
    try {
      const r = await api.printJobs(params(jobs.length, PAGE))
      loadedCount.current = jobs.length + r.items.length
      setJobs((js) => [...js, ...r.items])
      setHasMore(r.has_more)
    } catch (e) {
      setError(e.message)
    }
  }

  async function act(fn, ok) {
    setError('')
    setMessage('')
    try {
      const job = await fn()
      setMessage(ok(job))
      setJobs((js) => (js.some((j) => j.id === job.id) ? js.map((j) => (j.id === job.id ? job : j)) : [job, ...js]))
    } catch (e) {
      setError(e.message)
    }
  }

  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  return (
    <section className="card">
      <div className="card-head">
        <h2>Print history</h2>
        {filters && (
          <div className="row filters">
            <label className="field inline">
              <span>From</span>
              <input type="date" value={filters.date_from} onChange={set('date_from')} />
            </label>
            <label className="field inline">
              <span>To</span>
              <input type="date" value={filters.date_to} onChange={set('date_to')} />
            </label>
            <label className="field inline">
              <span>Status</span>
              <select value={filters.status} onChange={set('status')}>
                <option value="">All</option>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={filters.mine} onChange={set('mine')} /> Only mine
            </label>
          </div>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}
      {filters && jobs.length === 0 && <p className="muted">No print jobs in this period.</p>}

      {jobs.length > 0 && (
        <div className="table-scroll">
          <table className="list">
            <thead>
              <tr>
                <th>Time</th>
                <th>What</th>
                <th>By</th>
                <th>Status</th>
                <th>Printer</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="nowrap">{formatDateTime(j.created_at)}</td>
                  <td>{j.title}</td>
                  <td className="nowrap">{j.requested_by_name || '—'}</td>
                  <td>
                    <span className={`badge job-${j.status}`}>{STATUS_LABELS[j.status]}</span>
                    {j.status === 'failed' && j.error && <div className="error small">{j.error}</div>}
                  </td>
                  <td className="small">{j.printer || '—'}</td>
                  <td className="row-actions">
                    {j.status === 'queued' && (
                      <button
                        className="link danger"
                        onClick={() => act(() => api.cancelPrintJob(j.id), () => `"${j.title}" cancelled.`)}
                      >
                        Cancel
                      </button>
                    )}
                    {['done', 'failed', 'cancelled'].includes(j.status) && (
                      <button
                        className="link"
                        onClick={() => act(() => api.reprintJob(j.id), (nj) => `"${nj.title}" sent to the printer.`)}
                      >
                        Print again
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && (
        <button className="secondary" onClick={loadMore}>
          Load more
        </button>
      )}
    </section>
  )
}
