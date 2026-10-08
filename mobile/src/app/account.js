import { useState } from 'react'
import Constants from 'expo-constants'
import { Banner, Button, Card, Field, H2, Muted, Screen } from '../components/ui'
import { api } from '../lib/api'
import { useAuth, withUser } from '../lib/auth'

function AccountScreen() {
  const { user, server } = useAuth()
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }))

  async function change() {
    setError('')
    setDone('')
    if (form.next.length < 6) return setError('New password must be at least 6 characters.')
    if (form.next !== form.confirm) return setError('New passwords do not match.')
    setBusy(true)
    try {
      await api.changePassword(form.current, form.next)
      setForm({ current: '', next: '', confirm: '' })
      setDone('Password changed. Your other devices have been logged out.')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Card>
        <H2>{user.full_name}</H2>
        <Muted>
          Username: {user.username} · {user.role}
        </Muted>
        <Muted>Server: {server}</Muted>
        <Muted>App version {Constants.expoConfig?.version}</Muted>
      </Card>
      <Card>
        <H2>Change password</H2>
        <Field label="Current password" value={form.current} onChangeText={set('current')} secureTextEntry />
        <Field label="New password (min 6)" value={form.next} onChangeText={set('next')} secureTextEntry />
        <Field label="Confirm new password" value={form.confirm} onChangeText={set('confirm')} secureTextEntry />
        <Banner type="error">{error}</Banner>
        <Banner type="success">{done}</Banner>
        <Button title="Change password" onPress={change} loading={busy} disabled={!form.current || !form.next} />
      </Card>
    </Screen>
  )
}

export default withUser(AccountScreen)
