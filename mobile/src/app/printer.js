import { useFocusEffect } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { ChoosePrinter, printerFor, PrinterStatus, PrintJobs, usePrintQueue } from '../components/PrintQueue'
import { Badge, Banner, Button, C, Card, H2, Muted, Row, Screen, Segmented } from '../components/ui'
import { api } from '../lib/api'
import { useAuth, withUser } from '../lib/auth'
import { addDays, formatDateTime } from '../lib/format'

const PAGE = 30
const STATUS = {
  queued: ['Waiting', 'info'],
  printing: ['Printing', 'info'],
  done: ['Printed', 'ok'],
  failed: ['Failed', 'bad'],
  cancelled: ['Cancelled', 'neutral'],
}

function PrinterScreen() {
  const { user } = useAuth()
  const queue = usePrintQueue()
  const { status } = queue
  const [range, setRange] = useState('today')
  const [mine, setMine] = useState('all')
  const [jobs, setJobs] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const todayRef = useRef('')
  const loaded = useRef(PAGE) // rows to keep fresh (grows with "Load more")

  const params = useCallback(
    (offset, limit = PAGE) => {
      const t = todayRef.current
      return {
        date_from: range === 'today' ? t : addDays(t, -6),
        date_to: t,
        user_id: mine === 'mine' ? user.id : '',
        limit,
        offset,
      }
    },
    [range, mine, user.id],
  )

  const load = useCallback(async () => {
    setError('')
    try {
      if (!todayRef.current) todayRef.current = (await api.today()).date
      const r = await api.printJobs(params(0, Math.min(loaded.current, 200)))
      setJobs(r.items)
      setHasMore(r.has_more)
    } catch (e) {
      setError(e.message)
    }
  }, [params])

  useFocusEffect(
    useCallback(() => {
      loaded.current = PAGE
      load()
      const t = setInterval(load, 8000) // statuses change while printing
      return () => clearInterval(t)
    }, [load]),
  )

  async function act(fn, ok) {
    setError('')
    setMessage('')
    try {
      const job = await fn()
      setMessage(ok(job))
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <Screen
      onRefresh={async () => {
        setRefreshing(true)
        await Promise.all([load(), queue.refresh()])
        setRefreshing(false)
      }}
      refreshing={refreshing}
    >
      <Card>
        <PrinterStatus status={status} use="lists" />
        {status ? (
          <View style={{ gap: 4 }}>
            <Muted>
              Printer PC: {status.agent_online ? 'online' : 'offline'}
              {status.last_seen ? ` · last check-in ${formatDateTime(status.last_seen)}` : ''}
            </Muted>
            <Muted>Lists print on: {printerFor(status, 'lists') || '—'}</Muted>
            <Muted>Stickers print on: {printerFor(status, 'stickers') || '—'}</Muted>
          </View>
        ) : null}
        <Button variant="secondary" title="Print test page" onPress={() => queue.submit(api.printTest)} />
        <PrintJobs queue={queue} />
        {status && !status.agent_online ? (
          <Muted style={{ fontSize: 13 }}>
            The print agent runs on the main PC and is started by start.bat. Prints wait until it is running.
          </Muted>
        ) : null}
      </Card>

      <Card>
        <ChoosePrinter status={status} use="lists" onSaved={queue.refresh} />
        <ChoosePrinter status={status} use="stickers" onSaved={queue.refresh} />
      </Card>

      <Card>
        <H2>Print history</H2>
        <Segmented
          options={[
            { value: 'today', label: 'Today' },
            { value: 'week', label: 'Last 7 days' },
          ]}
          value={range}
          onChange={setRange}
        />
        <Segmented
          options={[
            { value: 'all', label: 'Everyone' },
            { value: 'mine', label: 'Only mine' },
          ]}
          value={mine}
          onChange={setMine}
        />
        <Banner type="error">{error}</Banner>
        <Banner type="success">{message}</Banner>
        {!jobs.length && !error ? <Muted>No print jobs in this period.</Muted> : null}
        {jobs.map((j) => (
          <View key={j.id} style={h.job}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={h.title}>{j.title}</Text>
              <Badge tone={STATUS[j.status][1]}>{STATUS[j.status][0]}</Badge>
            </Row>
            <Muted style={{ fontSize: 13 }}>
              {formatDateTime(j.created_at)} · {j.requested_by_name || '—'}
              {j.printer ? ` · ${j.printer}` : ''}
            </Muted>
            {j.status === 'failed' && j.error ? <Text style={h.err}>{j.error}</Text> : null}
            <Row>
              {j.status === 'queued' ? (
                <Button small variant="danger" title="Cancel" onPress={() => act(() => api.cancelPrintJob(j.id), () => `“${j.title}” cancelled.`)} />
              ) : null}
              {['done', 'failed', 'cancelled'].includes(j.status) ? (
                <Button small variant="secondary" title="Print again" onPress={() => act(() => api.reprintJob(j.id), (nj) => `“${nj.title}” sent to the printer.`)} />
              ) : null}
            </Row>
          </View>
        ))}
        {hasMore ? (
          <Button
            variant="secondary"
            title="Load more"
            onPress={async () => {
              try {
                const r = await api.printJobs(params(jobs.length))
                loaded.current = jobs.length + r.items.length
                setJobs((js) => [...js, ...r.items])
                setHasMore(r.has_more)
              } catch (e) {
                setError(e.message)
              }
            }}
          />
        ) : null}
      </Card>
    </Screen>
  )
}

const h = StyleSheet.create({
  job: { borderTopWidth: 1, borderTopColor: '#eef1f4', paddingTop: 10, gap: 6 },
  title: { fontSize: 15, fontWeight: '700', color: C.text, flex: 1 },
  err: { color: C.danger, fontWeight: '600', fontSize: 13 },
})

export default withUser(PrinterScreen)
