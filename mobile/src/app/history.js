import { useCallback, useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import AdminOnly from '../components/AdminOnly'
import DispatchCard from '../components/DispatchCard'
import SelectModal from '../components/SelectModal'
import { Banner, C, Card, Muted, Row, Screen, Segmented, SelectRow } from '../components/ui'
import { api } from '../lib/api'
import { addDays, formatDate, formatDateTime, transporterLabel } from '../lib/format'
import { withUser } from '../lib/auth'

const ALL = { id: '', code: '', name: 'All transporters' }

function HistoryScreen() {
  return (
    <AdminOnly>
      <History />
    </AdminOnly>
  )
}

function History() {
  const [today, setToday] = useState('')
  const [days, setDays] = useState('7')
  const [transporters, setTransporters] = useState([])
  const [transporterId, setTransporterId] = useState('')
  const [picking, setPicking] = useState(false)
  const [lists, setLists] = useState([])
  const [open, setOpen] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([api.today(), api.listTransporters()])
      .then(([t, tr]) => {
        setToday(t.date)
        setTransporters(tr)
      })
      .catch((e) => setError(e.message))
  }, [])

  const load = useCallback(async () => {
    if (!today) return
    setLoading(true)
    setError('')
    try {
      setLists(
        await api.listDispatches({
          date_from: addDays(today, -(Number(days) - 1)),
          date_to: today,
          transporter_id: transporterId,
        }),
      )
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [today, days, transporterId])

  useEffect(() => {
    load()
  }, [load])

  const t = transporters.find((x) => String(x.id) === transporterId)

  return (
    <Screen onRefresh={load} refreshing={loading}>
      <Card>
        <Segmented
          options={[
            { value: '1', label: 'Today' },
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
          ]}
          value={days}
          onChange={setDays}
        />
        <SelectRow label="Transporter" value={t ? transporterLabel(t) : 'All transporters'} onPress={() => setPicking(true)} />
        <Muted>
          {lists.length} list(s) · {lists.reduce((s, d) => s + d.total_boxes, 0)} boxes · {lists.reduce((s, d) => s + d.total_bags, 0)} bags
        </Muted>
      </Card>
      <Banner type="error">{error}</Banner>
      {!loading && !lists.length && !error ? <Muted style={{ textAlign: 'center' }}>No lists in this period.</Muted> : null}

      {lists.map((d) =>
        open === d.id ? (
          <Pressable key={d.id} onPress={() => setOpen(null)}>
            <DispatchCard dispatch={d} showDate />
          </Pressable>
        ) : (
          <Pressable key={d.id} onPress={() => setOpen(d.id)} style={({ pressed }) => [h.row, pressed && { backgroundColor: C.primarySoft }]}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={h.title}>
                {formatDate(d.date)} · <Text style={{ fontWeight: '800' }}>{d.transporter_code}</Text> {d.transporter_name}
              </Text>
            </Row>
            <Text style={h.nums}>
              {d.items.length} shops · {d.total_boxes} boxes · {d.total_bags} bags
            </Text>
            <Muted style={{ fontSize: 12 }}>
              By {d.created_by_name || '—'}
              {d.version > 1 ? ` · edited by ${d.updated_by_name || '—'} ${formatDateTime(d.updated_at)}` : ''}
            </Muted>
          </Pressable>
        ),
      )}

      <SelectModal
        visible={picking}
        title="Transporter"
        items={[ALL, ...transporters]}
        getText={(x) => (x.id === '' ? x.name : transporterLabel(x))}
        selectedId={transporterId}
        onSelect={(x) => {
          setTransporterId(String(x.id))
          setPicking(false)
        }}
        onClose={() => setPicking(false)}
      />
    </Screen>
  )
}

const h = StyleSheet.create({
  row: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, gap: 4 },
  title: { fontSize: 15, color: C.text, flex: 1 },
  nums: { fontSize: 15, fontWeight: '700', color: C.text },
})

export default withUser(HistoryScreen)
