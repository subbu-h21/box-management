import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import SelectModal from '../../components/SelectModal'
import Stepper from '../../components/Stepper'
import { Banner, Button, C, Card, Field, Muted, Row, Screen, SelectRow } from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { confirm } from '../../lib/confirm'
import { clearDraft, loadDraft, saveDraft } from '../../lib/drafts'
import { formatDate, formatDateTime, qty, shopLabel, transporterLabel } from '../../lib/format'

// Same comparison as the website: do the rows on screen differ from the saved record?
const rowsSignature = (rows) =>
  rows
    .filter((r) => r.shopId || qty(r.boxes) !== 0 || qty(r.bags) !== 0 || r.remarks.trim())
    .map((r) => `${r.shopId}:${qty(r.boxes)}:${qty(r.bags)}:${r.remarks.trim()}`)
    .join('|')
const recordSignature = (d) =>
  d ? d.items.map((i) => `${i.shop_id}:${i.boxes}:${i.carry_bags}:${i.remarks}`).join('|') : ''

const renderShop = (s) => (
  <Text style={{ fontSize: 16, color: C.text }}>
    {s.name}
    {s.area ? <Text style={{ color: C.muted }}> — {s.area}</Text> : null}
  </Text>
)

export default function EntryScreen() {
  const { user } = useAuth()
  const isAdmin = user.role === 'admin'
  const params = useLocalSearchParams() // { transporterId } when opened from Daily List "Edit"
  const [today, setToday] = useState('')
  const [transporters, setTransporters] = useState([])
  const [shops, setShops] = useState([])
  const [transporterId, setTransporterId] = useState('')
  const [rows, setRows] = useState([])
  const [existing, setExisting] = useState(null)
  const [baseVersion, setBaseVersion] = useState(null)
  const [openedExisting, setOpenedExisting] = useState(false)
  const [pendingDraft, setPendingDraft] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState('')
  const [message, setMessage] = useState('')
  const [picker, setPicker] = useState(null) // 'transporter' | row key being given a shop
  const nextKey = useRef(1)
  const loadSeq = useRef(0)
  const ready = useRef(false)

  const newRow = (shopId = '', boxes = '', bags = '', remarks = '') => ({ key: nextKey.current++, shopId, boxes, bags, remarks })
  const rowsFrom = (d) =>
    d ? d.items.map((i) => newRow(String(i.shop_id), String(i.boxes), String(i.carry_bags), i.remarks)) : [newRow()]

  const loadMasters = useCallback(async () => {
    const [t, tr, sh] = await Promise.all([api.today(), api.listTransporters(), api.listShops()])
    setToday(t.date)
    setTransporters(tr)
    setShops(sh)
    return t.date
  }, [])

  async function openTransporter(tid, draft = null) {
    const seq = ++loadSeq.current
    setTransporterId(tid ? String(tid) : '')
    setError('')
    setConflict('')
    setMessage('')
    setExisting(null)
    setOpenedExisting(false)
    setRows([])
    if (!tid) return
    setLoading(true)
    try {
      const d = await api.getTodayDispatch(tid)
      if (seq !== loadSeq.current) return
      setExisting(d)
      setOpenedExisting(Boolean(d))
      if (draft) {
        setRows(draft.rows.map((r) => newRow(r.shopId, r.boxes ?? '', r.bags ?? '', r.remarks ?? '')))
        setBaseVersion(draft.baseVersion)
        if ((d?.version ?? null) !== draft.baseVersion) {
          setConflict(
            d
              ? `This list was changed by ${d.updated_by_name || 'someone'} at ${d.updated_at.slice(11, 16)} after your unsaved changes were made, so they can't be saved as they are.`
              : 'This list was deleted after your unsaved changes were made.',
          )
        }
      } else {
        setRows(rowsFrom(d))
        setBaseVersion(d?.version ?? null)
      }
    } catch (e) {
      if (seq === loadSeq.current) setError(e.message)
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }

  // First load: masters + any unsaved list kept on the phone.
  useEffect(() => {
    ;(async () => {
      try {
        const date = await loadMasters()
        const draft = await loadDraft(user.id)
        if (draft && draft.date !== date) await clearDraft(user.id)
        else if (draft) setPendingDraft(draft)
        ready.current = true
      } catch (e) {
        setError(e.message)
      }
    })()
  }, [user.id])

  const dirty = Boolean(transporterId) && !loading && rowsSignature(rows) !== recordSignature(existing)

  // Keep the unsaved list on the phone.
  useEffect(() => {
    if (!transporterId || loading || pendingDraft || !today) return
    if (dirty) {
      const t = transporters.find((x) => String(x.id) === String(transporterId))
      saveDraft(user.id, {
        date: today,
        transporterId: Number(transporterId),
        transporterLabel: t ? transporterLabel(t) : `#${transporterId}`,
        rows: rows.map(({ shopId, boxes, bags, remarks }) => ({ shopId, boxes, bags, remarks })),
        baseVersion,
      })
    } else {
      clearDraft(user.id)
    }
  }, [dirty, rows, transporterId, baseVersion, loading, pendingDraft, today, transporters, user.id])

  async function switchTo(tid) {
    if (String(tid) === transporterId) return true
    if (pendingDraft) {
      if (!(await confirm('Unsaved list', `Discard your unsaved list for ${pendingDraft.transporterLabel}?`, { ok: 'Discard', destructive: true }))) return false
      setPendingDraft(null)
      await clearDraft(user.id)
    } else if (dirty) {
      if (!(await confirm('Unsaved changes', 'You have unsaved changes for this transporter. Discard them?', { ok: 'Discard', destructive: true }))) return false
      await clearDraft(user.id)
    }
    await openTransporter(tid)
    return true
  }

  // Opened from Daily List "Edit".
  useEffect(() => {
    const tid = params.transporterId
    if (!tid || !today) return
    ;(async () => {
      if (pendingDraft && String(pendingDraft.transporterId) === String(tid)) {
        const d = pendingDraft
        setPendingDraft(null)
        await openTransporter(d.transporterId, d) // carry on with unsaved changes to the same list
      } else {
        await switchTo(tid)
      }
      router.setParams({ transporterId: undefined })
    })()
  }, [params.transporterId, today])

  async function restoreDraft() {
    const d = pendingDraft
    setPendingDraft(null)
    await openTransporter(d.transporterId, d)
  }
  async function discardDraft() {
    setPendingDraft(null)
    await clearDraft(user.id)
  }
  async function loadLatest() {
    await clearDraft(user.id)
    await openTransporter(transporterId)
  }

  const updateRow = (key, field, value) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)))
  const removeRow = (key) => setRows((rs) => rs.filter((r) => r.key !== key))
  const addRow = () => {
    const r = newRow()
    setRows((rs) => [...rs, r])
    setPicker(r.key) // go straight to choosing the shop
  }

  const totalBoxes = rows.reduce((sum, r) => sum + (qty(r.boxes) || 0), 0)
  const totalBags = rows.reduce((sum, r) => sum + (qty(r.bags) || 0), 0)

  async function save() {
    setError('')
    setMessage('')
    if (rows.length === 0) return setError('Add at least one medical shop.')
    for (const [i, r] of rows.entries()) {
      if (!r.shopId) return setError(`Shop ${i + 1}: choose a medical shop.`)
      const b = qty(r.boxes)
      const g = qty(r.bags)
      if (Number.isNaN(b) || Number.isNaN(g)) return setError(`Shop ${i + 1}: use whole numbers only.`)
      if (b + g === 0) return setError(`Shop ${i + 1}: enter at least 1 box or 1 carry bag.`)
    }
    setSaving(true)
    try {
      const saved = await api.saveTodayDispatch(
        transporterId,
        rows.map((r) => ({ shop_id: Number(r.shopId), boxes: qty(r.boxes), carry_bags: qty(r.bags), remarks: r.remarks.trim() })),
        baseVersion,
      )
      setExisting(saved)
      setBaseVersion(saved.version)
      setRows(rowsFrom(saved))
      setConflict('')
      await clearDraft(user.id)
      setMessage(`Saved: ${saved.items.length} shop(s), ${saved.total_boxes} box(es), ${saved.total_bags} carry bag(s).`)
    } catch (e) {
      if (e.status === 409) setConflict(e.message)
      else setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteRecord() {
    if (!existing) return
    if (!(await confirm('Delete list', "Delete today's record for this transporter?", { ok: 'Delete', destructive: true }))) return
    try {
      await api.deleteDispatch(existing.id)
      await clearDraft(user.id)
      await openTransporter(transporterId)
      setMessage("Today's record deleted.")
    } catch (e) {
      setError(e.message)
    }
  }

  async function onRefresh() {
    setRefreshing(true)
    try {
      await loadMasters()
      if (transporterId && !dirty) await openTransporter(transporterId)
    } catch (e) {
      setError(e.message)
    } finally {
      setRefreshing(false)
    }
  }

  const transporter = transporters.find((t) => String(t.id) === transporterId)
  const pickingRow = typeof picker === 'number' ? rows.find((r) => r.key === picker) : null
  const takenElsewhere = new Set(rows.filter((r) => r.key !== picker).map((r) => r.shopId))

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={e.date}>{today ? `Today, ${formatDate(today)}` : ' '}</Text>
        </Row>
        {pendingDraft && (
          <Banner
            type="notice"
            right={
              <Row>
                <Button small title="Restore" onPress={restoreDraft} />
                <Button small variant="dangerLink" title="Discard" onPress={discardDraft} />
              </Row>
            }
          >
            You have an unsaved list for {pendingDraft.transporterLabel} ({pendingDraft.rows.filter((r) => r.shopId).length} shop(s)).
          </Banner>
        )}
        <SelectRow
          testID="transporter"
          label="Transporter"
          value={transporter ? transporterLabel(transporter) : ''}
          placeholder="Choose transporter"
          onPress={() => setPicker('transporter')}
        />
        {!transporters.length && today ? (
          <Banner type="notice">Add transporters and medical shops first (More → Transporters &amp; Shops).</Banner>
        ) : null}
      </Card>

      {loading && <Muted style={{ textAlign: 'center' }}>Loading…</Muted>}

      {transporterId && !loading ? (
        <>
          {openedExisting && <Banner type="notice">This transporter already has a record for today. You are editing it.</Banner>}
          {existing ? (
            <Muted>
              Created by {existing.created_by_name || '—'} at {formatDateTime(existing.created_at).slice(11)}
              {existing.version > 1 ? ` · edited by ${existing.updated_by_name || '—'} at ${formatDateTime(existing.updated_at).slice(11)}` : ''}
            </Muted>
          ) : null}

          {rows.map((r, i) => {
            const shop = shops.find((s) => String(s.id) === r.shopId)
            return (
              <Card key={r.key}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={e.rowNo}>Shop {i + 1}</Text>
                  <Pressable onPress={() => removeRow(r.key)} hitSlop={10}>
                    <Text style={e.remove}>Remove</Text>
                  </Pressable>
                </Row>
                <SelectRow
                  testID={`shop-${i}`}
                  value={shop ? shopLabel(shop) : ''}
                  placeholder="Choose medical shop"
                  onPress={() => setPicker(r.key)}
                />
                <View style={e.steppers}>
                  <Stepper testID={`boxes-${i}`} label="Boxes" value={r.boxes} onChange={(v) => updateRow(r.key, 'boxes', v)} />
                  <Stepper testID={`bags-${i}`} label="Carry bags" value={r.bags} onChange={(v) => updateRow(r.key, 'bags', v)} />
                </View>
                <Field
                  placeholder="Remarks (optional)"
                  value={r.remarks}
                  maxLength={200}
                  onChangeText={(v) => updateRow(r.key, 'remarks', v)}
                />
              </Card>
            )
          })}

          <Button testID="add-shop" variant="secondary" title="+ Add medical shop" onPress={addRow} disabled={rows.length >= shops.length} />

          <Card style={e.totals}>
            <Text style={e.totalText}>
              {totalBoxes} boxes · {totalBags} bags
            </Text>
            {dirty ? <Muted>Unsaved changes</Muted> : null}
          </Card>

          {conflict ? (
            <Banner type="error" right={<Button small variant="secondary" title="Load latest version (discard my changes)" onPress={loadLatest} />}>
              {conflict}
            </Banner>
          ) : null}
          <Banner type="error">{error}</Banner>
          <Banner type="success">{message}</Banner>

          <Button testID="save" title={existing ? 'Update' : 'Save'} onPress={save} loading={saving} />
          {existing && isAdmin ? <Button variant="danger" title="Delete today's record" onPress={deleteRecord} /> : null}
        </>
      ) : (
        <Banner type="error">{error}</Banner>
      )}

      <SelectModal
        visible={picker === 'transporter'}
        title="Choose transporter"
        items={transporters}
        getText={transporterLabel}
        selectedId={transporterId}
        onSelect={async (t) => {
          setPicker(null)
          await switchTo(t.id)
        }}
        onClose={() => setPicker(null)}
      />
      <SelectModal
        visible={!!pickingRow}
        title="Choose medical shop"
        items={shops.filter((s) => !takenElsewhere.has(String(s.id)))}
        getText={shopLabel}
        renderItem={renderShop}
        placeholder="Type to search medical shop…"
        emptyText="No matching shop"
        selectedId={pickingRow?.shopId}
        onSelect={(s) => {
          updateRow(picker, 'shopId', String(s.id))
          setPicker(null)
        }}
        onClose={() => {
          // A new row closed without choosing a shop is removed again.
          if (pickingRow && !pickingRow.shopId && !pickingRow.boxes && !pickingRow.bags && rows.length > 1) removeRow(picker)
          setPicker(null)
        }}
      />
    </Screen>
  )
}

const e = StyleSheet.create({
  date: { fontSize: 15, fontWeight: '700', color: C.muted },
  rowNo: { fontSize: 15, fontWeight: '700', color: C.muted },
  remove: { color: C.danger, fontWeight: '700', fontSize: 15 },
  steppers: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  totals: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalText: { fontSize: 18, fontWeight: '800', color: C.text },
})
