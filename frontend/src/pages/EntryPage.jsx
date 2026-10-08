import { useEffect, useRef, useState } from 'react'
import { api, formatDate, formatDateTime, transporterLabel } from '../api.js'
import { useAuth } from '../auth.jsx'
import NumberStepper from '../components/NumberStepper.jsx'
import { ShopPicker } from '../components/SearchPicker.jsx'
import { clearDraft, loadDraft, qty, saveDraft } from '../drafts.js'

// Used to tell whether the rows on screen differ from the saved record.
const rowsSignature = (rows) =>
  rows
    .filter((r) => r.shopId || qty(r.boxes) !== 0 || qty(r.bags) !== 0 || r.remarks.trim())
    .map((r) => `${r.shopId}:${qty(r.boxes)}:${qty(r.bags)}:${r.remarks.trim()}`)
    .join('|')

const recordSignature = (d) =>
  d ? d.items.map((i) => `${i.shop_id}:${i.boxes}:${i.carry_bags}:${i.remarks}`).join('|') : ''

// initialTransporterId: open this transporter straight away (from the Daily List "Edit" link).
export default function EntryPage({ initialTransporterId = null }) {
  const { user } = useAuth()
  const isAdmin = user.role === 'admin'
  const [today, setToday] = useState('')
  const [transporters, setTransporters] = useState([])
  const [shops, setShops] = useState([])
  const [transporterId, setTransporterId] = useState('')
  const [rows, setRows] = useState([])
  const [existing, setExisting] = useState(null) // latest saved record from the server, if any
  const [baseVersion, setBaseVersion] = useState(null) // version these edits started from
  const [openedExisting, setOpenedExisting] = useState(false) // record already existed when transporter was selected
  const [pendingDraft, setPendingDraft] = useState(null) // unsaved list from earlier, waiting for restore/discard
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState('')
  const [message, setMessage] = useState('')
  const nextKey = useRef(1)
  const loadSeq = useRef(0)

  const newRow = (shopId = '', boxes = '', bags = '', remarks = '') => ({
    key: nextKey.current++,
    shopId,
    boxes,
    bags,
    remarks,
  })
  const rowsFrom = (d) =>
    d
      ? d.items.map((i) => newRow(String(i.shop_id), String(i.boxes), String(i.carry_bags), i.remarks))
      : [newRow()]

  useEffect(() => {
    Promise.all([api.today(), api.listTransporters(), api.listShops()])
      .then(([t, tr, sh]) => {
        setToday(t.date)
        setTransporters(tr)
        setShops(sh)
        let draft = loadDraft(user.id)
        if (draft && draft.date !== t.date) {
          clearDraft(user.id) // only today's drafts are kept
          draft = null
        }
        if (initialTransporterId && draft && String(draft.transporterId) === String(initialTransporterId)) {
          openTransporter(draft.transporterId, draft) // unsaved changes to this same list: carry on with them
        } else if (draft) {
          setPendingDraft(draft)
        } else if (initialTransporterId) {
          openTransporter(initialTransporterId)
        }
      })
      .catch((e) => setError(e.message))
  }, [user.id])

  const dirty = Boolean(transporterId) && !loading && rowsSignature(rows) !== recordSignature(existing)

  // Keep the unsaved list in browser storage so it survives tab switches, idle logout or a closed browser.
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

  function handleTransporterChange(tid) {
    if (pendingDraft) {
      if (!confirm(`Discard your unsaved list for ${pendingDraft.transporterLabel}?`)) return
      setPendingDraft(null)
      clearDraft(user.id)
    } else if (dirty) {
      if (!confirm('You have unsaved changes for this transporter. Discard them?')) return
      clearDraft(user.id)
    }
    openTransporter(tid)
  }

  function restoreDraft() {
    const draft = pendingDraft
    setPendingDraft(null)
    openTransporter(draft.transporterId, draft)
  }

  function discardDraft() {
    setPendingDraft(null)
    clearDraft(user.id)
  }

  function loadLatest() {
    clearDraft(user.id)
    openTransporter(transporterId)
  }

  const updateRow = (key, field, value) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)))
  const removeRow = (key) => setRows((rs) => rs.filter((r) => r.key !== key))

  const totalBoxes = rows.reduce((sum, r) => sum + (qty(r.boxes) || 0), 0)
  const totalBags = rows.reduce((sum, r) => sum + (qty(r.bags) || 0), 0)

  async function handleSave() {
    setError('')
    setMessage('')
    if (rows.length === 0) return setError('Add at least one medical shop.')
    for (const [i, r] of rows.entries()) {
      if (!r.shopId) return setError(`Row ${i + 1}: select a medical shop.`)
      const boxes = qty(r.boxes)
      const bags = qty(r.bags)
      if (Number.isNaN(boxes) || Number.isNaN(bags)) return setError(`Row ${i + 1}: use whole numbers only.`)
      if (boxes + bags === 0) return setError(`Row ${i + 1}: enter at least 1 box or 1 carry bag.`)
    }
    setSaving(true)
    try {
      const saved = await api.saveTodayDispatch(
        transporterId,
        rows.map((r) => ({
          shop_id: Number(r.shopId),
          boxes: qty(r.boxes),
          carry_bags: qty(r.bags),
          remarks: r.remarks.trim(),
        })),
        baseVersion,
      )
      setExisting(saved)
      setBaseVersion(saved.version)
      setRows(rowsFrom(saved))
      setConflict('')
      clearDraft(user.id)
      setMessage(
        `Saved for ${formatDate(saved.date)}: ${saved.items.length} shop(s), ${saved.total_boxes} box(es), ${saved.total_bags} carry bag(s).`,
      )
    } catch (e) {
      if (e.status === 409) setConflict(e.message)
      else setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!existing || !confirm("Delete today's record for this transporter?")) return
    setError('')
    try {
      await api.deleteDispatch(existing.id)
      clearDraft(user.id)
      await openTransporter(transporterId)
      setMessage("Today's record deleted.")
    } catch (e) {
      setError(e.message)
    }
  }

  const noMasterData = transporters.length === 0 || shops.length === 0

  return (
    <section className="card">
      <div className="card-head">
        <h2>New Entry</h2>
        {today && <span className="muted">Date: {formatDate(today)}</span>}
      </div>

      {noMasterData && !error && today && (
        <p className="notice">
          Add transporters and medical shops first in the <b>Transporters &amp; Shops</b> tab.
        </p>
      )}

      {pendingDraft && (
        <div className="notice draft-banner">
          <span>
            You have an unsaved list for <b>{pendingDraft.transporterLabel}</b> (
            {pendingDraft.rows.filter((r) => r.shopId).length} shop(s)).
          </span>
          <span className="row">
            <button className="primary" onClick={restoreDraft}>
              Restore
            </button>
            <button className="link danger" onClick={discardDraft}>
              Discard
            </button>
          </span>
        </div>
      )}

      <label className="field">
        <span>Transporter</span>
        <select value={transporterId} onChange={(e) => handleTransporterChange(e.target.value)}>
          <option value="">— Select transporter —</option>
          {transporters.map((t) => (
            <option key={t.id} value={t.id}>
              {transporterLabel(t)}
            </option>
          ))}
        </select>
      </label>

      {loading && <p className="muted">Loading…</p>}

      {transporterId && !loading && (
        <>
          {openedExisting && (
            <p className="notice">
              This transporter already has a record for today. You are editing it.
            </p>
          )}
          {existing && (
            <p className="muted small">
              Created by {existing.created_by_name || '—'} at {formatDateTime(existing.created_at).slice(11)}
              {existing.version > 1 &&
                ` · Last edited by ${existing.updated_by_name || '—'} at ${formatDateTime(existing.updated_at).slice(11)}`}
            </p>
          )}

          <div className="table-scroll">
          <table className="entry-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Medical shop</th>
                <th className="center-col">Boxes</th>
                <th className="center-col">Carry bags</th>
                <th>Remarks</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const takenElsewhere = new Set(rows.filter((o) => o.key !== r.key).map((o) => o.shopId))
                return (
                  <tr key={r.key}>
                    <td>{i + 1}</td>
                    <td>
                      <ShopPicker
                        shops={shops.filter((s) => !takenElsewhere.has(String(s.id)))}
                        value={r.shopId}
                        onChange={(id) => updateRow(r.key, 'shopId', id)}
                        autoFocus={r.focus}
                      />
                    </td>
                    <td>
                      <NumberStepper label="boxes" value={r.boxes} onChange={(v) => updateRow(r.key, 'boxes', v)} />
                    </td>
                    <td>
                      <NumberStepper label="carry bags" value={r.bags} onChange={(v) => updateRow(r.key, 'bags', v)} />
                    </td>
                    <td>
                      <input
                        className="remarks"
                        placeholder="Remarks (optional)"
                        maxLength={200}
                        value={r.remarks}
                        onChange={(e) => updateRow(r.key, 'remarks', e.target.value)}
                      />
                    </td>
                    <td>
                      <button className="link danger" onClick={() => removeRow(r.key)} title="Remove">
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td></td>
                <td>
                  <button
                    className="secondary"
                    onClick={() => setRows((rs) => [...rs, { ...newRow(), focus: true }])}
                    disabled={rows.length >= shops.length}
                  >
                    + Add medical shop
                  </button>
                </td>
                <td className="center-col total">{totalBoxes} boxes</td>
                <td className="center-col total">{totalBags} bags</td>
                <td></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          </div>

          {conflict && (
            <div className="error-box">
              <p>{conflict}</p>
              <button className="secondary" onClick={loadLatest}>
                Load latest version (discard my changes)
              </button>
            </div>
          )}

          <div className="actions">
            <button className="primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : existing ? 'Update' : 'Save'}
            </button>
            {dirty && <span className="muted small">Unsaved changes</span>}
            {existing && isAdmin && (
              <button className="link danger" onClick={handleDelete}>
                Delete today's record
              </button>
            )}
          </div>
        </>
      )}

      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}
    </section>
  )
}
