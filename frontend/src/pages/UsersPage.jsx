import { useEffect, useState } from 'react'
import { api, formatDateTime } from '../api.js'
import { useAuth } from '../auth.jsx'

const EMPTY = { full_name: '', phone: '', username: '', password: '', role: 'worker' }

export default function UsersPage({ onUsersChanged }) {
  const { user: me } = useAuth()
  const [users, setUsers] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [editing, setEditing] = useState(null) // { id, full_name, phone, role, active }
  const [resetting, setResetting] = useState(null) // { id, username, password }
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = () =>
    api
      .listUsers()
      .then((us) => {
        setUsers(us)
        onUsersChanged?.(us.filter((u) => u.pending).length)
      })
      .catch((e) => setError(e.message))
  useEffect(() => {
    reload()
  }, [])

  const run = async (fn, okMessage) => {
    setError('')
    setMessage('')
    setBusy(true)
    try {
      await fn()
      if (okMessage) setMessage(okMessage)
      await reload()
      return true
    } catch (e) {
      setError(e.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (form.password.length < 6) return setError('Password must be at least 6 characters.')
    const ok = await run(
      () =>
        api.createUser({
          ...form,
          full_name: form.full_name.trim(),
          phone: form.phone.trim(),
          username: form.username.trim(),
        }),
      `Account '${form.username.trim()}' created.`,
    )
    if (ok) setForm(EMPTY)
  }

  async function handleUpdate(e) {
    e.preventDefault()
    const { id, ...body } = editing
    if (await run(() => api.updateUser(id, { ...body, full_name: body.full_name.trim(), phone: body.phone.trim() }), 'User updated.')) {
      setEditing(null)
      if (id === me.id) window.location.reload() // own role/name changed: reload menus and permissions
    }
  }

  async function handleReset(e) {
    e.preventDefault()
    if (resetting.password.length < 6) return setError('Password must be at least 6 characters.')
    if (await run(() => api.resetPassword(resetting.id, resetting.password),
      `Password for '${resetting.username}' reset. They have been logged out everywhere.`)) {
      setResetting(null)
    }
  }

  const approve = (u) => run(() => api.approveUser(u.id), `${u.full_name} approved. They can log in now.`)
  const reject = (u) =>
    confirm(`Reject the registration from ${u.full_name} (${u.username})?`) &&
    run(() => api.rejectUser(u.id), `Registration from ${u.full_name} rejected.`)

  const pending = users.filter((u) => u.pending)
  const accounts = users.filter((u) => !u.pending)

  const setF = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  return (
    <section className="card">
      <div className="card-head">
        <h2>Users</h2>
        <span className="muted">{accounts.filter((u) => u.active).length} active</span>
      </div>

      {pending.length > 0 && (
        <div className="pending-box">
          <h3>Pending registrations ({pending.length})</h3>
          <table className="list">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Username</th>
                <th>Requested</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name}</td>
                  <td>{u.phone}</td>
                  <td>{u.username}</td>
                  <td className="muted small">{formatDateTime(u.created_at)}</td>
                  <td className="row-actions">
                    <button className="primary small-btn" onClick={() => approve(u)} disabled={busy}>
                      Approve
                    </button>
                    <button className="link danger" onClick={() => reject(u)} disabled={busy}>
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form className="crud-form" onSubmit={handleCreate}>
        <label className="field">
          <span>Full name *</span>
          <input value={form.full_name} onChange={setF('full_name')} />
        </label>
        <label className="field">
          <span>Phone</span>
          <input value={form.phone} onChange={setF('phone')} inputMode="tel" />
        </label>
        <label className="field">
          <span>Username *</span>
          <input value={form.username} onChange={setF('username')} autoComplete="off" />
        </label>
        <label className="field">
          <span>Password * (min 6)</span>
          <input type="password" value={form.password} onChange={setF('password')} autoComplete="new-password" />
        </label>
        <label className="field">
          <span>Role</span>
          <select value={form.role} onChange={setF('role')}>
            <option value="worker">Worker</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <div className="actions">
          <button className="primary" type="submit" disabled={busy || !form.full_name || !form.username || !form.password}>
            Add user
          </button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      <table className="list">
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone</th>
            <th>Username</th>
            <th>Role</th>
            <th>Status</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((u) =>
            editing?.id === u.id ? (
              <tr key={u.id} className="editing">
                <td>
                  <input value={editing.full_name} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} />
                </td>
                <td>
                  <input
                    value={editing.phone}
                    onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                    inputMode="tel"
                    size={12}
                  />
                </td>
                <td>{u.username}</td>
                <td>
                  <select value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })}>
                    <option value="worker">Worker</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={editing.active}
                      onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                    />{' '}
                    Active
                  </label>
                </td>
                <td></td>
                <td className="row-actions">
                  <button className="link" onClick={handleUpdate} disabled={busy || !editing.full_name.trim()}>
                    Save
                  </button>
                  <button className="link" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </td>
              </tr>
            ) : (
              <tr key={u.id} className={u.active ? undefined : 'inactive'}>
                <td>
                  {u.full_name}
                  {u.id === me.id && <span className="muted"> (you)</span>}
                </td>
                <td>{u.phone || <span className="muted">—</span>}</td>
                <td>{u.username}</td>
                <td>
                  <span className={`badge ${u.role}`}>{u.role}</span>
                </td>
                <td>{u.active ? 'Active' : 'Disabled'}</td>
                <td className="muted small">{formatDateTime(u.created_at)}</td>
                <td className="row-actions">
                  <button
                    className="link"
                    onClick={() => {
                      setResetting(null)
                      setEditing({ id: u.id, full_name: u.full_name, phone: u.phone, role: u.role, active: u.active })
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="link"
                    onClick={() => {
                      setEditing(null)
                      setResetting({ id: u.id, username: u.username, password: '' })
                    }}
                  >
                    Reset password
                  </button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>

      {resetting && (
        <form className="reset-box" onSubmit={handleReset}>
          <b>New password for {resetting.username}</b>
          <input
            type="password"
            value={resetting.password}
            onChange={(e) => setResetting({ ...resetting, password: e.target.value })}
            autoFocus
            autoComplete="new-password"
            placeholder="Min 6 characters"
          />
          <button className="primary" type="submit" disabled={busy || !resetting.password}>
            Set password
          </button>
          <button type="button" className="link" onClick={() => setResetting(null)}>
            Cancel
          </button>
        </form>
      )}

      <p className="muted small">
        Accounts are never deleted, only disabled, so their history in the Activity log stays intact. Disabling an
        account logs it out immediately.
      </p>
    </section>
  )
}
