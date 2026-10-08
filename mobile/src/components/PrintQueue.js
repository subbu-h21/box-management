import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/format'
import SelectModal from './SelectModal'
import { Button, C, Muted, SelectRow } from './ui'

const JOB_POLL_MS = 1500
const STATUS_POLL_MS = 10000
const DONE_HIDE_MS = 15000

// Sends prints to the shop printer (print agent on the main PC) and follows the jobs.
export function usePrintQueue() {
  const [jobs, setJobs] = useState([])
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const jobsRef = useRef(jobs)
  jobsRef.current = jobs
  const alive = useRef(true)

  const refresh = useCallback(
    () => api.printStatus().then((s) => alive.current && setStatus(s)).catch(() => {}),
    [],
  )

  useEffect(() => {
    alive.current = true
    refresh()
    const t = setInterval(refresh, STATUS_POLL_MS)
    return () => {
      alive.current = false
      clearInterval(t)
    }
  }, [refresh])

  useEffect(() => {
    const t = setInterval(async () => {
      const active = jobsRef.current.filter((j) => j.status === 'queued' || j.status === 'printing')
      if (active.length) {
        const fresh = await Promise.all(active.map((j) => api.printJob(j.id).catch(() => j)))
        const byId = Object.fromEntries(fresh.map((j) => [j.id, { ...j, seenAt: Date.now() }]))
        setJobs((js) => js.map((j) => (byId[j.id] ? { ...j, ...byId[j.id] } : j)))
      }
      setJobs((js) => js.filter((j) => !['done', 'cancelled'].includes(j.status) || Date.now() - j.seenAt < DONE_HIDE_MS))
    }, JOB_POLL_MS)
    return () => clearInterval(t)
  }, [])

  const submit = useCallback(async (send) => {
    setError('')
    try {
      const job = await send()
      setJobs((js) => [{ ...job, seenAt: Date.now() }, ...js])
    } catch (e) {
      setError(e.message)
    }
  }, [])

  const cancel = useCallback(async (id) => {
    try {
      const job = await api.cancelPrintJob(id)
      setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...job, seenAt: Date.now() } : j)))
    } catch (e) {
      setError(e.message)
    }
  }, [])

  const dismiss = useCallback((id) => setJobs((js) => js.filter((j) => j.id !== id)), [])

  return { jobs, status, error, submit, cancel, dismiss, refresh }
}

const CHOICE = {
  lists: { field: 'selected_printer', by: 'selected_by', at: 'selected_at', label: 'Printer for lists & test pages' },
  stickers: { field: 'sticker_printer', by: 'sticker_selected_by', at: 'sticker_selected_at', label: 'Printer for stickers' },
}

export const printerFor = (status, use = 'lists') => status?.[CHOICE[use].field] || status?.default_printer || ''

export function PrinterStatus({ status, use = 'lists' }) {
  if (!status) return null
  let ok = false
  let text
  if (!status.agent_online) {
    text = 'Printer PC offline: prints will wait until it is back'
  } else {
    const name = printerFor(status, use)
    const st = status.printer_states?.[name]
    if (!name) text = 'No printer chosen and no Windows default printer'
    else if (!st) text = `Printer problem: ${name} is not on the printer PC`
    else if (!st.ok) text = `Printer problem: ${name}: ${st.message}`
    else {
      ok = true
      text = `Printer ready: ${name}`
    }
  }
  return (
    <View style={[p.pill, ok ? p.ok : p.bad]}>
      <Text style={[p.pillText, { color: ok ? C.success : C.warn }]}>{text}</Text>
    </View>
  )
}

const STATUS_TEXT = { queued: 'Waiting for the printer PC…', printing: 'Printing…', done: 'Printed ✓', cancelled: 'Cancelled' }

export function PrintJobs({ queue }) {
  const { jobs, error, cancel, dismiss } = queue
  if (!jobs.length && !error) return null
  return (
    <View style={{ gap: 6 }}>
      {error ? (
        <View style={[p.job, p.jobFailed]}>
          <Text style={[p.jobText, { color: C.danger }]}>{error}</Text>
        </View>
      ) : null}
      {jobs.map((j) => (
        <View key={j.id} style={[p.job, JOB_STYLE[j.status]]}>
          <Text style={[p.jobText, j.status === 'failed' && { color: C.danger }, j.status === 'done' && { color: C.success }]}>
            <Text style={{ fontWeight: '700' }}>{j.title}</Text>
            {' — '}
            {j.status === 'failed' ? `Not printed: ${j.error}` : STATUS_TEXT[j.status]}
          </Text>
          {j.status === 'queued' && (
            <Pressable onPress={() => cancel(j.id)} hitSlop={10}>
              <Text style={{ color: C.danger, fontWeight: '700' }}>Cancel</Text>
            </Pressable>
          )}
          {j.status === 'failed' && (
            <Pressable onPress={() => dismiss(j.id)} hitSlop={10}>
              <Text style={{ color: C.primary, fontWeight: '700' }}>Dismiss</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  )
}

// Pick from the printers on the main PC (found by the print agent); saved per kind of printing.
export function ChoosePrinter({ status, use = 'lists', onSaved }) {
  const c = CHOICE[use]
  const current = status?.[c.field] ?? ''
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!status) return null

  const printers = status.printers || []
  const items = [
    { id: '__default', name: '', label: `Windows default printer${status.default_printer ? ` (${status.default_printer})` : ''}` },
    ...printers.map((n) => ({
      id: n,
      name: n,
      label: n + (status.printer_states?.[n] && !status.printer_states[n].ok ? ' (not ready)' : ''),
    })),
  ]
  const shown = items.find((i) => i.name === current)?.label || `${current} (not found)`

  async function choose(item) {
    setOpen(false)
    if (item.name === current) return
    setError('')
    setBusy(true)
    try {
      await api.choosePrinter(item.name, use)
      onSaved?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ gap: 4 }}>
      <SelectRow label={busy ? `${c.label} (saving…)` : c.label} value={shown} onPress={() => printers.length && setOpen(true)} />
      {!printers.length && <Muted>The list of printers appears once the printer PC has checked in.</Muted>}
      {status[c.by] ? (
        <Muted style={{ fontSize: 12 }}>
          Last changed by {status[c.by]} on {formatDateTime(status[c.at])}
        </Muted>
      ) : null}
      {error ? <Text style={{ color: C.danger, fontWeight: '600' }}>{error}</Text> : null}
      <SelectModal
        visible={open}
        title={c.label}
        items={items}
        searchable={false}
        getText={(i) => i.label}
        selectedId={items.find((i) => i.name === current)?.id}
        onSelect={choose}
        onClose={() => setOpen(false)}
      />
    </View>
  )
}

export const PrintButton = (props) => <Button small variant="secondary" {...props} />

const JOB_STYLE = {
  queued: { borderColor: '#90caf9', backgroundColor: C.primarySoft },
  printing: { borderColor: '#90caf9', backgroundColor: C.primarySoft },
  done: { borderColor: '#a5d6a7', backgroundColor: C.successSoft },
  failed: { borderColor: '#ef9a9a', backgroundColor: C.dangerSoft },
  cancelled: {},
}

const p = StyleSheet.create({
  pill: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start' },
  ok: { backgroundColor: C.successSoft },
  bad: { backgroundColor: '#fff3e0' },
  pillText: { fontSize: 13, fontWeight: '700' },
  job: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#fafbfc',
  },
  jobFailed: { borderColor: '#ef9a9a', backgroundColor: C.dangerSoft },
  jobText: { flex: 1, fontSize: 14, color: C.text },
})
