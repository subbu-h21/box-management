import { useState } from 'react'
import { api } from '../api.js'

// Self-registration for new workers. The account stays pending until an admin approves it.
export default function RegisterPage({ onDone, onBack }) {
  const [form, setForm] = useState({ full_name: '', phone: '', username: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    const phone = form.phone.trim()
    if (!/^[0-9+\- ]{7,20}$/.test(phone)) return setError('Enter a valid phone number.')
    if (!/^[A-Za-z0-9._-]{3,30}$/.test(form.username.trim())) {
      return setError('Username must be 3–30 characters: letters, numbers, . _ - (no spaces).')
    }
    if (form.password.length < 6) return setError('Password must be at least 6 characters.')
    if (form.password !== form.confirm) return setError('Passwords do not match.')
    setBusy(true)
    try {
      await api.register({
        full_name: form.full_name.trim(),
        phone,
        username: form.username.trim(),
        password: form.password,
      })
      onDone(
        `Registration sent for '${form.username.trim()}'. You can log in once the admin approves it.`,
      )
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <form className="card auth-card" onSubmit={handleSubmit}>
        <h1>Register</h1>
        <p className="muted">New worker? Ask for an account. The admin must approve it before you can log in.</p>
        <label className="field">
          <span>Full name</span>
          <input value={form.full_name} onChange={set('full_name')} autoFocus autoComplete="name" />
        </label>
        <label className="field">
          <span>Phone number</span>
          <input value={form.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" />
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
          disabled={busy || !form.full_name || !form.phone || !form.username || !form.password}
        >
          {busy ? 'Sending…' : 'Register'}
        </button>
        <p className="auth-switch">
          Already have an account?{' '}
          <button type="button" className="link" onClick={onBack}>
            Log in
          </button>
        </p>
      </form>
    </div>
  )
}
