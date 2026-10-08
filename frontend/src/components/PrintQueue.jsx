import { useCallback, useEffect, useRef, useState } from 'react'
import { api, formatDateTime } from '../api.js'

const JOB_POLL_MS = 1500
const STATUS_POLL_MS = 10000
const DONE_HIDE_MS = 15000 // printed jobs disappear from the list after a while

// Sends lists to the shop printer (via the print agent on the main PC) and tracks the jobs.
export function usePrintQueue() {
  const [jobs, setJobs] = useState([]) // newest first
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const jobsRef = useRef(jobs)
  jobsRef.current = jobs

  const alive = useRef(true)
  const refresh = useCallback(() => api.printStatus().then((s) => alive.current && setStatus(s)).catch(() => {}), [])

  useEffect(() => {
    alive.current = true
    refresh()
    const t = setInterval(refresh, STATUS_POLL_MS)
    return () => {
      alive.current = false
      clearInterval(t)
    }
  }, [refresh])

  // Follow jobs that aren't finished yet.
  useEffect(() => {
    const t = setInterval(async () => {
      const active = jobsRef.current.filter((j) => j.status === 'queued' || j.status === 'printing')
      if (!active.length) return
      const fresh = await Promise.all(active.map((j) => api.printJob(j.id).catch(() => j)))
      const byId = Object.fromEntries(fresh.map((j) => [j.id, { ...j, seenDoneAt: Date.now() }]))
      setJobs((js) => js.map((j) => (byId[j.id] ? { ...j, ...byId[j.id] } : j)))
    }, JOB_POLL_MS)
    return () => clearInterval(t)
  }, [])

  // Drop printed / cancelled jobs from the list after a while; keep failures visible.
  useEffect(() => {
    const t = setInterval(() => {
      setJobs((js) =>
        js.filter((j) => !['done', 'cancelled'].includes(j.status) || Date.now() - (j.seenDoneAt || 0) < DONE_HIDE_MS),
      )
    }, 3000)
    return () => clearInterval(t)
  }, [])

  const submit = useCallback(async (send) => {
    setError('')
    try {
      const job = await send()
      setJobs((js) => [{ ...job, seenDoneAt: Date.now() }, ...js])
    } catch (e) {
      setError(e.message)
    }
  }, [])

  const cancel = useCallback(async (id) => {
    try {
      const job = await api.cancelPrintJob(id)
      setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...job, seenDoneAt: Date.now() } : j)))
    } catch (e) {
      setError(e.message)
    }
  }, [])

  const dismiss = useCallback((id) => setJobs((js) => js.filter((j) => j.id !== id)), [])

  return { jobs, status, error, submit, cancel, dismiss, refresh }
}

// Which saved choice each kind of printing uses ('' = Windows default printer).
const CHOICE = {
  lists: { field: 'selected_printer', by: 'selected_by', at: 'selected_at', label: 'Printer for dispatch lists & test pages' },
  stickers: { field: 'sticker_printer', by: 'sticker_selected_by', at: 'sticker_selected_at', label: 'Printer for stickers' },
}

// The printer this kind of printing will go to.
export const printerFor = (status, use = 'lists') => status?.[CHOICE[use].field] || status?.default_printer || ''

export function PrinterStatus({ status, use = 'lists' }) {
  if (!status) return null
  if (!status.agent_online) {
    return (
      <span className="printer-status bad" title="Start the app on the main PC with start.bat">
        Printer PC offline: prints will wait until it's back
      </span>
    )
  }
  const name = printerFor(status, use)
  const state = status.printer_states?.[name]
  if (!name) return <span className="printer-status bad">No printer chosen and no Windows default printer</span>
  if (!state) return <span className="printer-status bad">Printer problem: {name} is not on the printer PC</span>
  return (
    <span className={`printer-status ${state.ok ? 'ok' : 'bad'}`}>
      {state.ok ? `Printer ready: ${name}` : `Printer problem: ${name}: ${state.message}`}
    </span>
  )
}

// Dropdown of the printers on the main PC (as found by the print agent), saved per kind of printing.
export function ChoosePrinter({ status, use = 'lists', onSaved }) {
  const c = CHOICE[use]
  const current = status[c.field]
  const [value, setValue] = useState(current)
  const [saved, setSaved] = useState(current)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Someone else may change it; follow the server unless we're mid-edit.
  useEffect(() => {
    setValue((v) => (v === saved ? current : v))
    setSaved(current)
  }, [current])

  const printers = status.printers || []
  const known = !value || printers.includes(value)

  async function save() {
    setError('')
    setBusy(true)
    try {
      const r = await api.choosePrinter(value, use)
      setSaved(use === 'stickers' ? r.sticker_printer : r.printer)
      onSaved?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="choose-printer">
      <label className="field inline">
        <span>{c.label}</span>
        <div className="row">
          <select value={value} onChange={(e) => setValue(e.target.value)} disabled={!printers.length}>
            <option value="">
              Windows default printer{status.default_printer ? ` (${status.default_printer})` : ''}
            </option>
            {printers.map((p) => (
              <option key={p} value={p}>
                {p}
                {status.printer_states?.[p] && !status.printer_states[p].ok ? ' (not ready)' : ''}
              </option>
            ))}
            {!known && <option value={value}>{value} (not found)</option>}
          </select>
          <button className="primary" onClick={save} disabled={busy || value === saved}>
            Save
          </button>
        </div>
      </label>
      {!printers.length && (
        <p className="muted small">The list of printers appears once the printer PC has checked in.</p>
      )}
      {status[c.by] && (
        <p className="muted small">
          Last changed by {status[c.by]} on {formatDateTime(status[c.at])}
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

const STATUS_TEXT = {
  queued: 'Waiting for the printer PC…',
  printing: 'Printing…',
  done: 'Printed ✓',
  cancelled: 'Cancelled',
}

export function PrintJobs({ queue }) {
  const { jobs, error, cancel, dismiss } = queue
  if (!jobs.length && !error) return null
  return (
    <div className="print-jobs no-print">
      {error && <div className="print-job failed">{error}</div>}
      {jobs.map((j) => (
        <div key={j.id} className={`print-job ${j.status}`}>
          <span>
            <b>{j.title}</b> — {j.status === 'failed' ? `Not printed: ${j.error}` : STATUS_TEXT[j.status]}
          </span>
          {j.status === 'queued' && (
            <button className="link danger" onClick={() => cancel(j.id)}>
              Cancel
            </button>
          )}
          {j.status === 'failed' && (
            <button className="link" onClick={() => dismiss(j.id)}>
              Dismiss
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
