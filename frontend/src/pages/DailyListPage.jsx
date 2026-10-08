import { useEffect, useState } from 'react'
import { api, formatDate } from '../api.js'
import { useAuth } from '../auth.jsx'
import DispatchSheet from '../components/DispatchSheet.jsx'
import { PrinterStatus, PrintJobs, usePrintQueue } from '../components/PrintQueue.jsx'

// onNavigate(tab, options): switch tabs, e.g. open a list for editing in New Entry.
export default function DailyListPage({ onNavigate }) {
  const isAdmin = useAuth().user.role === 'admin' // workers only see today
  const [today, setToday] = useState('')
  const [date, setDate] = useState('')
  const [dispatches, setDispatches] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const printQueue = usePrintQueue()

  useEffect(() => {
    api
      .today()
      .then((t) => {
        setToday(t.date)
        setDate(t.date)
      })
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!date) return
    let ignore = false
    setLoading(true)
    setError('')
    api
      .listDispatches({ date_from: date, date_to: date })
      .then((d) => !ignore && setDispatches(d))
      .catch((e) => !ignore && setError(e.message))
      .finally(() => !ignore && setLoading(false))
    return () => {
      ignore = true
    }
  }, [date])

  // When set, only this dispatch's sheet is visible in the printout.
  const [printId, setPrintId] = useState(null)

  useEffect(() => {
    if (printId == null) return
    const clear = () => setPrintId(null)
    window.addEventListener('afterprint', clear)
    window.print()
    return () => window.removeEventListener('afterprint', clear)
  }, [printId])

  const grandTotal = dispatches.reduce((s, d) => s + d.total_boxes, 0)
  const grandBags = dispatches.reduce((s, d) => s + d.total_bags, 0)
  const editable = date === today // only today's lists can be edited

  return (
    <section className="card">
      <div className="card-head no-print">
        <h2>Daily List</h2>
        <div className="row">
          {isAdmin ? (
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          ) : (
            date && <span className="muted">Today, {formatDate(date)}</span>
          )}
          <button
            className="secondary"
            onClick={() => printQueue.submit(() => api.printDaily(date))}
            disabled={!dispatches.length}
            title="Print every list on the shop printer, one transporter per page"
          >
            Print all
          </button>
          <button className="link muted-link" onClick={() => window.print()} disabled={!dispatches.length}>
            Print all here
          </button>
        </div>
      </div>
      <div className="no-print printer-line">
        <PrinterStatus status={printQueue.status} />
      </div>
      <PrintJobs queue={printQueue} />

      {date && <h3 className="print-title">Dispatch list — {formatDate(date)}</h3>}
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && dispatches.length === 0 && <p className="muted">No records for this date.</p>}

      <div className={printId == null ? 'sheets' : 'sheets printing-one'}>
        {dispatches.map((d) => (
          <DispatchSheet
            key={d.id}
            dispatch={d}
            onPrint={() => printQueue.submit(() => api.printDispatch(d.id))}
            onPrintHere={() => setPrintId(d.id)}
            onEdit={editable ? () => onNavigate('entry', { transporterId: d.transporter_id }) : undefined}
            className={d.id === printId ? 'print-target' : ''}
          />
        ))}
      </div>

      {dispatches.length > 0 && (
        <p className={printId == null ? 'grand-total' : 'grand-total no-print'}>
          {dispatches.length} transporter(s) · {grandTotal} box(es) · {grandBags} carry bag(s) in total
        </p>
      )}
    </section>
  )
}
