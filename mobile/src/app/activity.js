import { useCallback, useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import AdminOnly from '../components/AdminOnly'
import SelectModal from '../components/SelectModal'
import { Badge, Banner, Button, C, Card, H2, Muted, Row, Screen, Segmented, SelectRow } from '../components/ui'
import { api } from '../lib/api'
import { addDays, formatDateTime } from '../lib/format'
import { withUser } from '../lib/auth'

const PAGE = 40
const ENTITIES = [
  { id: '', name: 'All changes' },
  { id: 'dispatch', name: 'Lists' },
  { id: 'shop', name: 'Shops' },
  { id: 'transporter', name: 'Transporters' },
  { id: 'sticker', name: 'Sticker layouts' },
  { id: 'user', name: 'Users' },
]
const ACTION_TONE = { create: 'ok', update: 'info', delete: 'bad' }

function ActivityScreen() {
  return (
    <AdminOnly>
      <Activity />
    </AdminOnly>
  )
}

function Activity() {
  const [today, setToday] = useState('')
  const [days, setDays] = useState('7')
  const [summary, setSummary] = useState([])
  const [userId, setUserId] = useState('')
  const [entity, setEntity] = useState('')
  const [pickEntity, setPickEntity] = useState(false)
  const [log, setLog] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [openId, setOpenId] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.today().then((t) => setToday(t.date)).catch((e) => setError(e.message))
  }, [])

  const range = today ? { date_from: addDays(today, -(Number(days) - 1)), date_to: today } : null

  const load = useCallback(async () => {
    if (!today) return
    const r = { date_from: addDays(today, -(Number(days) - 1)), date_to: today }
    setLoading(true)
    setError('')
    try {
      const [s, l] = await Promise.all([
        api.activitySummary(r),
        api.activityLog({ ...r, user_id: userId, entity, limit: PAGE, offset: 0 }),
      ])
      setSummary(s)
      setLog(l.items)
      setHasMore(l.has_more)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [today, days, userId, entity])

  useEffect(() => {
    load()
  }, [load])

  const shown = summary.filter((u) => u.total_actions > 0 || u.active)
  const who = summary.find((u) => String(u.id) === userId)

  return (
    <Screen onRefresh={load} refreshing={loading}>
      <Segmented
        options={[
          { value: '1', label: 'Today' },
          { value: '7', label: '7 days' },
          { value: '30', label: '30 days' },
        ]}
        value={days}
        onChange={setDays}
      />
      <Banner type="error">{error}</Banner>

      <H2>By worker</H2>
      <Muted style={{ fontSize: 13 }}>Boxes and bags are credited per change. Tap a person to see only their changes.</Muted>
      {shown.map((u) => {
        const on = String(u.id) === userId
        return (
          <Pressable key={u.id} onPress={() => setUserId(on ? '' : String(u.id))}>
            <Card style={on && { borderColor: C.primary, borderWidth: 2 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Row>
                  <Text style={a.name}>{u.full_name}</Text>
                  <Badge tone={u.role === 'admin' ? 'admin' : 'neutral'}>{u.role}</Badge>
                </Row>
                <Muted style={{ fontSize: 12 }}>{u.last_action_at ? formatDateTime(u.last_action_at) : 'no activity'}</Muted>
              </Row>
              <View style={a.grid}>
                <Stat label="Lists created" value={u.lists_created} />
                <Stat label="Lists edited" value={u.lists_edited} />
                <Stat label="Net boxes" value={u.boxes_net} sub={`+${u.boxes_added} / −${u.boxes_removed}`} />
                <Stat label="Net bags" value={u.bags_net} sub={`+${u.bags_added} / −${u.bags_removed}`} />
                <Stat label="Auto-saved" value={u.auto_saves} />
                <Stat label="Deletes" value={u.deletes} />
              </View>
              <Muted style={{ fontSize: 12 }}>
                Shops added/edited {u.shops_added}/{u.shops_edited} · Transporters {u.transporters_added}/{u.transporters_edited}
              </Muted>
            </Card>
          </Pressable>
        )
      })}

      <H2>Change log{who ? ` — ${who.full_name}` : ''}</H2>
      <SelectRow value={ENTITIES.find((x) => x.id === entity).name} onPress={() => setPickEntity(true)} />
      {!log.length && !loading ? <Muted>No activity in this period.</Muted> : null}
      {log.map((e) => {
        const changes = e.details?.changes
        const open = openId === e.id
        return (
          <Pressable key={e.id} onPress={() => changes?.length && setOpenId(open ? null : e.id)}>
            <Card style={{ gap: 6 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Badge tone={ACTION_TONE[e.action]}>{e.action}</Badge>
                <Muted style={{ fontSize: 12 }}>
                  {formatDateTime(e.at)} · {e.user_name || '—'}
                </Muted>
              </Row>
              <Text style={a.summary}>{e.summary}</Text>
              {e.boxes_added || e.boxes_removed || e.bags_added || e.bags_removed ? (
                <Text style={a.delta}>
                  {e.boxes_added ? <Text style={{ color: C.success }}>+{e.boxes_added} boxes </Text> : null}
                  {e.boxes_removed ? <Text style={{ color: C.danger }}>−{e.boxes_removed} boxes </Text> : null}
                  {e.bags_added ? <Text style={{ color: C.success }}>+{e.bags_added} bags </Text> : null}
                  {e.bags_removed ? <Text style={{ color: C.danger }}>−{e.bags_removed} bags</Text> : null}
                </Text>
              ) : null}
              {open
                ? changes.map((c) => (
                    <View key={c.shop_id} style={a.change}>
                      <Text style={{ fontWeight: '700', color: C.text }}>{c.shop}</Text>
                      <Text style={{ color: C.muted }}>
                        Boxes {beforeAfter(c.from, c.to)} · Bags {beforeAfter(c.bags_from, c.bags_to)}
                        {c.remarks_from !== c.remarks_to && (c.remarks_from || c.remarks_to)
                          ? ` · Remark ${beforeAfter(c.remarks_from, c.remarks_to, true)}`
                          : ''}
                      </Text>
                    </View>
                  ))
                : changes?.length
                  ? <Muted style={{ fontSize: 12 }}>Tap for shop-by-shop details</Muted>
                  : null}
            </Card>
          </Pressable>
        )
      })}
      {hasMore && range ? (
        <Button
          variant="secondary"
          title="Load more"
          onPress={async () => {
            try {
              const r = await api.activityLog({ ...range, user_id: userId, entity, limit: PAGE, offset: log.length })
              setLog((l) => [...l, ...r.items])
              setHasMore(r.has_more)
            } catch (e) {
              setError(e.message)
            }
          }}
        />
      ) : null}

      <SelectModal
        visible={pickEntity}
        title="Show changes to"
        items={ENTITIES}
        searchable={false}
        selectedId={entity}
        onSelect={(x) => {
          setEntity(x.id)
          setPickEntity(false)
        }}
        onClose={() => setPickEntity(false)}
      />
    </Screen>
  )
}

function beforeAfter(from, to, text = false) {
  if (from === undefined && to === undefined) return '—'
  const show = (v) => (text ? (v ? `"${v}"` : '—') : v ?? 0)
  return from === to ? String(show(to)) : `${show(from)} → ${show(to)}`
}

const Stat = ({ label, value, sub }) => (
  <View style={a.stat}>
    <Text style={a.statValue}>{value}</Text>
    <Text style={a.statLabel}>{label}</Text>
    {sub ? <Text style={a.statSub}>{sub}</Text> : null}
  </View>
)

const a = StyleSheet.create({
  name: { fontSize: 16, fontWeight: '700', color: C.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { width: '31%', backgroundColor: '#f6f8fa', borderRadius: 8, padding: 8 },
  statValue: { fontSize: 18, fontWeight: '800', color: C.text },
  statLabel: { fontSize: 11, color: C.muted, fontWeight: '600' },
  statSub: { fontSize: 11, color: C.muted },
  summary: { fontSize: 14, color: C.text },
  delta: { fontSize: 13, fontWeight: '700' },
  change: { borderTopWidth: 1, borderTopColor: '#eef1f4', paddingTop: 6 },
})

export default withUser(ActivityScreen)
