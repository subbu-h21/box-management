import { Fragment, useEffect, useState } from 'react'
import { addDays, api, formatDateTime } from '../api.js'

const PAGE = 100

// "5 → 7", or just "5" if unchanged. Older log entries have no bag/remark data.
function beforeAfter(from, to, text = false) {
  if (from === undefined && to === undefined) return '—'
  const show = (v) => (text ? (v ? `"${v}"` : '—') : v ?? 0)
  return from === to ? show(to) : `${show(from)} → ${show(to)}`
}
const ENTITY_LABELS = {
  dispatch: 'Lists',
  shop: 'Shops',
  transporter: 'Transporters',
  sticker: 'Sticker layouts',
  user: 'Users',
}

export default function ActivityPage() {
  const [range, setRange] = useState(null) // { date_from, date_to }
  const [summary, setSummary] = useState([])
  const [userId, setUserId] = useState('')
  const [entity, setEntity] = useState('')
  const [log, setLog] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [openId, setOpenId] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api
      .today()
      .then((t) => setRange({ date_from: addDays(t.date, -6), date_to: t.date }))
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!range) return
    let ignore = false
    api
      .activitySummary(range)
      .then((s) => !ignore && setSummary(s))
      .catch((e) => !ignore && setError(e.message))
    return () => {
      ignore = true
    }
  }, [range])

  useEffect(() => {
    if (!range) return
    let ignore = false
    setLoading(true)
    api
      .activityLog({ ...range, user_id: userId, entity, limit: PAGE, offset: 0 })
      .then((r) => {
        if (ignore) return
        setLog(r.items)
        setHasMore(r.has_more)
      })
      .catch((e) => !ignore && setError(e.message))
      .finally(() => !ignore && setLoading(false))
    return () => {
      ignore = true
    }
  }, [range, userId, entity])

  async function loadMore() {
    try {
      const r = await api.activityLog({ ...range, user_id: userId, entity, limit: PAGE, offset: log.length })
      setLog((l) => [...l, ...r.items])
      setHasMore(r.has_more)
    } catch (e) {
      setError(e.message)
    }
  }

  const setDate = (k) => (e) => e.target.value && setRange({ ...range, [k]: e.target.value })
  const shown = summary.filter((u) => u.total_actions > 0 || u.active)

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Activity by worker</h2>
          {range && (
            <div className="row">
              <label className="field inline">
                <span>From</span>
                <input type="date" value={range.date_from} onChange={setDate('date_from')} />
              </label>
              <label className="field inline">
                <span>To</span>
                <input type="date" value={range.date_to} onChange={setDate('date_to')} />
              </label>
            </div>
          )}
        </div>
        {error && <p className="error">{error}</p>}

        <div className="table-scroll">
          <table className="list stats">
            <thead>
              <tr>
                <th>Worker</th>
                <th className="num" title="Lists created">Lists created</th>
                <th className="num" title="Times an existing list was edited">Lists edited</th>
                <th className="num" title="Boxes added across all saves">Boxes +</th>
                <th className="num" title="Boxes removed across all saves">Boxes −</th>
                <th className="num" title="Boxes added minus removed">Net boxes</th>
                <th className="num" title="Carry bags added / removed across all saves">Bags + / −</th>
                <th className="num" title="Carry bags added minus removed">Net bags</th>
                <th className="num" title="Lists saved automatically before an idle logout">Auto-saved</th>
                <th className="num">Shops added / edited</th>
                <th className="num">Transporters added / edited</th>
                <th className="num">Deletes</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr
                  key={u.id}
                  className={String(u.id) === userId ? 'clickable editing' : 'clickable'}
                  onClick={() => setUserId(String(u.id) === userId ? '' : String(u.id))}
                  title="Show this person's log below"
                >
                  <td>
                    {u.full_name} <span className={`badge ${u.role}`}>{u.role}</span>
                    {!u.active && <span className="muted small"> (disabled)</span>}
                  </td>
                  <td className="num">{u.lists_created}</td>
                  <td className="num">{u.lists_edited}</td>
                  <td className="num plus">{u.boxes_added ? `+${u.boxes_added}` : 0}</td>
                  <td className="num minus">{u.boxes_removed ? `−${u.boxes_removed}` : 0}</td>
                  <td className="num total">{u.boxes_net}</td>
                  <td className="num nowrap">
                    <span className="plus">+{u.bags_added}</span> / <span className="minus">−{u.bags_removed}</span>
                  </td>
                  <td className="num total">{u.bags_net}</td>
                  <td className="num">{u.auto_saves}</td>
                  <td className="num">
                    {u.shops_added} / {u.shops_edited}
                  </td>
                  <td className="num">
                    {u.transporters_added} / {u.transporters_edited}
                  </td>
                  <td className="num">{u.deletes}</td>
                  <td className="muted small">{u.last_action_at ? formatDateTime(u.last_action_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Boxes and carry bags are credited per change: if one worker enters 10 boxes and another later changes it to
          12, the first gets +10 and the second +2. Click a row to see that person's log.
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Change log</h2>
          <div className="row">
            <select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Everyone</option>
              {summary.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
                </option>
              ))}
            </select>
            <select value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">All changes</option>
              {Object.entries(ENTITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading && <p className="muted">Loading…</p>}
        {!loading && log.length === 0 && <p className="muted">No activity in this period.</p>}

        {log.length > 0 && (
          <div className="table-scroll">
            <table className="list">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Who</th>
                  <th>What</th>
                  <th className="num">Boxes / bags</th>
                </tr>
              </thead>
              <tbody>
                {log.map((a) => {
                  const changes = a.details?.changes
                  const open = openId === a.id
                  return (
                    <Fragment key={a.id}>
                      <tr
                        className={changes?.length ? 'clickable' : undefined}
                        onClick={() => changes?.length && setOpenId(open ? null : a.id)}
                      >
                        <td className="nowrap">{formatDateTime(a.at)}</td>
                        <td className="nowrap">{a.user_name || '—'}</td>
                        <td>
                          <span className={`badge action-${a.action}`}>{a.action}</span> {a.summary}
                        </td>
                        <td className="num nowrap">
                          {a.boxes_added > 0 && <span className="plus">+{a.boxes_added} </span>}
                          {a.boxes_removed > 0 && <span className="minus">−{a.boxes_removed}</span>}
                          {(a.bags_added > 0 || a.bags_removed > 0) && (
                            <div className="small">
                              bags {a.bags_added > 0 && <span className="plus">+{a.bags_added} </span>}
                              {a.bags_removed > 0 && <span className="minus">−{a.bags_removed}</span>}
                            </div>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr className="detail">
                          <td colSpan={4}>
                            <table className="changes">
                              <thead>
                                <tr>
                                  <th>Shop</th>
                                  <th className="num">Boxes</th>
                                  <th className="num">Bags</th>
                                  <th>Remarks</th>
                                </tr>
                              </thead>
                              <tbody>
                                {changes.map((c) => (
                                  <tr key={c.shop_id}>
                                    <td>{c.shop}</td>
                                    <td className="num nowrap">{beforeAfter(c.from, c.to)}</td>
                                    <td className="num nowrap">{beforeAfter(c.bags_from, c.bags_to)}</td>
                                    <td>{beforeAfter(c.remarks_from, c.remarks_to, true)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
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
    </>
  )
}
