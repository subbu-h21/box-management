import { useState } from 'react'
import { useAuth } from '../auth.jsx'

// Shown only the very first time, when no user accounts exist yet.
export default function SetupPage() {
  const { setup } = useAuth()
  const [form, setForm] = useState({ full_name: '', username: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (form.password.length < 6) return setError('Password must be at least 6 characters.')
    if (form.password !== form.confirm) return setError('Passwords do not match.')
    setBusy(true)
    try {
      await setup({ full_name: form.full_name.trim(), username: form.username.trim(), password: form.password })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <form className="card auth-card" onSubmit={handleSubmit}>
        <h1>Welcome to Box Dispatch</h1>
        <p className="muted">Create the admin account. You can add worker accounts after this.</p>
        <label className="field">
          <span>Your name</span>
          <input value={form.full_name} onChange={set('full_name')} autoFocus />
        </label>
        <label className="field">
          <span>Username (letters, numbers, . _ -)</span>
          <input value={form.username} onChange={set('username')} autoComplete="username" />
        </label>
        <label className="field">
          <span>Password (min 6 characters)</span>
          <input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
        </label>
        <label className="field">
          <span>Confirm password</span>
          <input type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
        </label>
        {error && <p className="error">{error}</p>}
        <button
          className="primary block"
          type="submit"
          disabled={busy || !form.full_name || !form.username || !form.password}
        >
          {busy ? 'Creating…' : 'Create admin account'}
        </button>
      </form>
    </div>
  )
}
