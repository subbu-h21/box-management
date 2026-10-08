import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Text } from 'react-native'
import DispatchCard from '../../components/DispatchCard'
import { PrinterStatus, PrintJobs, usePrintQueue } from '../../components/PrintQueue'
import { Banner, Button, C, Card, Muted, Row, Screen } from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { addDays, formatDate } from '../../lib/format'

export default function DailyListScreen() {
  const { user } = useAuth()
  const isAdmin = user.role === 'admin' // workers only see today
  const queue = usePrintQueue()
  const [today, setToday] = useState('')
  const [date, setDate] = useState('')
  const [lists, setLists] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (d) => {
    if (!d) return
    setLoading(true)
    setError('')
    try {
      setLists(await api.listDispatches({ date_from: d, date_to: d }))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    api
      .today()
      .then((t) => {
        setToday(t.date)
        setDate(t.date)
      })
      .catch((e) => setError(e.message))
  }, [])

  // Loads on open, when the date changes, and when coming back to this tab (lists change elsewhere).
  useFocusEffect(
    useCallback(() => {
      if (date) load(date)
    }, [date, load]),
  )

  const editable = date === today
  const boxes = lists.reduce((s, d) => s + d.total_boxes, 0)
  const bags = lists.reduce((s, d) => s + d.total_bags, 0)

  return (
    <Screen onRefresh={() => load(date)} refreshing={loading}>
      <Card>
        {isAdmin ? (
          <Row style={{ justifyContent: 'space-between' }}>
            <Button small variant="secondary" title="‹" onPress={() => setDate((d) => addDays(d, -1))} />
            <Text style={{ fontSize: 17, fontWeight: '700', color: C.text }}>
              {date ? (date === today ? `Today, ${formatDate(date)}` : formatDate(date)) : ' '}
            </Text>
            <Button small variant="secondary" title="›" onPress={() => setDate((d) => addDays(d, 1))} disabled={date >= today} />
          </Row>
        ) : (
          <Text style={{ fontSize: 17, fontWeight: '700', color: C.text }}>{date ? `Today, ${formatDate(date)}` : ' '}</Text>
        )}
        {isAdmin && date && date !== today ? <Button small variant="link" title="Back to today" onPress={() => setDate(today)} /> : null}
        <PrinterStatus status={queue.status} />
        <Button
          title="Print all on shop printer"
          onPress={() => queue.submit(() => api.printDaily(date))}
          disabled={!lists.length}
        />
        <PrintJobs queue={queue} />
        {lists.length ? (
          <Muted>
            {lists.length} transporter(s) · {boxes} box(es) · {bags} carry bag(s)
          </Muted>
        ) : null}
      </Card>

      <Banner type="error">{error}</Banner>
      {!loading && !error && !lists.length ? <Muted style={{ textAlign: 'center' }}>No lists for this date.</Muted> : null}

      {lists.map((d) => (
        <DispatchCard
          key={d.id}
          dispatch={d}
          actions={
            <>
              {editable ? (
                <Button
                  small
                  variant="secondary"
                  title="Edit"
                  onPress={() => router.navigate({ pathname: '/', params: { transporterId: String(d.transporter_id) } })}
                />
              ) : null}
              <Button small variant="secondary" title="Print" onPress={() => queue.submit(() => api.printDispatch(d.id))} />
            </>
          }
        />
      ))}
    </Screen>
  )
}
