import { useState } from 'react'
import AndroidAppDialog from '../components/AndroidAppDialog.jsx'
import { useAuth } from '../auth.jsx'

export default function LoginPage({ info, onRegister }) {
  const { login, notice } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showApp, setShowApp] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(username.trim(), password)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <form className="card auth-card" onSubmit={handleSubmit}>
        <h1>Box Dispatch</h1>
        <p className="muted">Log in to continue</p>
        {info && <p className="success-box">{info}</p>}
        {notice && <p className="notice">{notice}</p>}
        <label className="field">
          <span>Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary block" type="submit" disabled={busy || !username || !password}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        <p className="auth-switch">
          New worker?{' '}
          <button type="button" className="link" onClick={onRegister}>
            Register
          </button>
        </p>
        <p className="auth-switch">
          <button type="button" className="link" onClick={() => setShowApp(true)}>
            📱 Get the Android app
          </button>
        </p>
      </form>
      {showApp && <AndroidAppDialog onClose={() => setShowApp(false)} />}
    </div>
  )
}
