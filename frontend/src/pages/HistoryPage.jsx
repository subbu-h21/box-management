import { Fragment, useEffect, useState } from 'react'
import { addDays, api, formatDate, formatDateTime, transporterLabel } from '../api.js'
import DispatchSheet from '../components/DispatchSheet.jsx'

export default function HistoryPage() {
  const [transporters, setTransporters] = useState([])
  const [filters, setFilters] = useState(null)
  const [dispatches, setDispatches] = useState([])
  const [openId, setOpenId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([api.today(), api.listTransporters()])
      .then(([t, tr]) => {
        setTransporters(tr)
        setFilters({ date_from: addDays(t.date, -30), date_to: t.date, transporter_id: '' })
      })
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!filters) return
    let ignore = false
    setLoading(true)
    setError('')
    api
      .listDispatches(filters)
      .then((d) => !ignore && setDispatches(d))
      .catch((e) => !ignore && setError(e.message))
      .finally(() => !ignore && setLoading(false))
    return () => {
      ignore = true
    }
  }, [filters])

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))

  return (
    <section className="card">
      <div className="card-head">
        <h2>History</h2>
      </div>

      {filters && (
        <div className="row filters">
          <label className="field inline">
            <span>From</span>
            <input type="date" value={filters.date_from} onChange={(e) => setFilter('date_from', e.target.value)} />
          </label>
          <label className="field inline">
            <span>To</span>
            <input type="date" value={filters.date_to} onChange={(e) => setFilter('date_to', e.target.value)} />
          </label>
          <label className="field inline">
            <span>Transporter</span>
            <select value={filters.transporter_id} onChange={(e) => setFilter('transporter_id', e.target.value)}>
              <option value="">All</option>
              {transporters.map((t) => (
                <option key={t.id} value={t.id}>
                  {transporterLabel(t)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && dispatches.length === 0 && <p className="muted">No records found.</p>}

      {dispatches.length > 0 && (
        <table className="list">
          <thead>
            <tr>
              <th>Date</th>
              <th>Transporter</th>
              <th className="num">Shops</th>
              <th className="num">Boxes</th>
              <th className="num">Bags</th>
              <th>Created by</th>
              <th>Last edited</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {dispatches.map((d) => (
              <Fragment key={d.id}>
                <tr>
                  <td>{formatDate(d.date)}</td>
                  <td>
                    {d.transporter_code} — {d.transporter_name}
                  </td>
                  <td className="num">{d.items.length}</td>
                  <td className="num">{d.total_boxes}</td>
                  <td className="num">{d.total_bags}</td>
                  <td>{d.created_by_name || '—'}</td>
                  <td>
                    {d.version > 1 ? (
                      <>
                        {d.updated_by_name || '—'}{' '}
                        <span className="muted small">{formatDateTime(d.updated_at)}</span>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <button className="link" onClick={() => setOpenId(openId === d.id ? null : d.id)}>
                      {openId === d.id ? 'Hide' : 'View'}
                    </button>
                  </td>
                </tr>
                {openId === d.id && (
                  <tr className="detail">
                    <td colSpan={8}>
                      <DispatchSheet dispatch={d} showDate />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
