import { useState } from 'react'
import { api } from '../api.js'

export default function ChangePasswordDialog({ onClose }) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (form.next.length < 6) return setError('New password must be at least 6 characters.')
    if (form.next !== form.confirm) return setError('New passwords do not match.')
    setBusy(true)
    try {
      await api.changePassword(form.current, form.next)
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="card modal" onSubmit={handleSubmit}>
        <h2>Change password</h2>
        {done ? (
          <>
            <p className="success">Password changed. Other devices have been logged out.</p>
            <div className="actions">
              <button type="button" className="primary" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="field">
              <span>Current password</span>
              <input type="password" value={form.current} onChange={set('current')} autoFocus autoComplete="current-password" />
            </label>
            <label className="field">
              <span>New password (min 6 characters)</span>
              <input type="password" value={form.next} onChange={set('next')} autoComplete="new-password" />
            </label>
            <label className="field">
              <span>Confirm new password</span>
              <input type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
            </label>
            {error && <p className="error">{error}</p>}
            <div className="actions">
              <button className="primary" type="submit" disabled={busy || !form.current || !form.next}>
                Change password
              </button>
              <button type="button" className="link" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}
