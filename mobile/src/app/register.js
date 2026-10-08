import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Banner, Button, Card, Field, Muted, Screen } from '../components/ui'
import { useAuth } from '../lib/auth'

// New workers ask for an account; an admin must approve it before they can log in.
export default function RegisterScreen() {
  const { register, server: savedServer } = useAuth()
  const params = useLocalSearchParams()
  const [form, setForm] = useState({
    server: params.server || savedServer || '',
    full_name: '',
    phone: '',
    username: '',
    password: '',
    confirm: '',
  })
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }))

  async function submit() {
    setError('')
    const phone = form.phone.trim()
    const username = form.username.trim()
    if (!/^[0-9+\- ]{7,20}$/.test(phone)) return setError('Enter a valid phone number.')
    if (!/^[A-Za-z0-9._-]{3,30}$/.test(username)) {
      return setError('Username must be 3–30 characters: letters, numbers, . _ - (no spaces).')
    }
    if (form.password.length < 6) return setError('Password must be at least 6 characters.')
    if (form.password !== form.confirm) return setError('Passwords do not match.')
    setBusy(true)
    try {
      await register(form.server, { full_name: form.full_name.trim(), phone, username, password: form.password })
      setDone(`Registration sent for “${username}”. You can log in once the admin approves it.`)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Screen>
        <Card>
          <Banner type="success">{done}</Banner>
          <Button title="Back to login" onPress={() => router.back()} />
        </Card>
      </Screen>
    )
  }

  return (
    <Screen>
      <Card>
        <Muted>Ask for an account. The admin must approve it before you can log in.</Muted>
        <Field label="Server address" value={form.server} onChangeText={set('server')} placeholder="192.168.1.20:8000"
          autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        <Field label="Full name" value={form.full_name} onChangeText={set('full_name')} autoComplete="name" />
        <Field label="Phone number" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
        <Field label="Username (letters, numbers, . _ -)" value={form.username} onChangeText={set('username')}
          autoCapitalize="none" autoCorrect={false} />
        <Field label="Password (min 6 characters)" value={form.password} onChangeText={set('password')} secureTextEntry />
        <Field label="Confirm password" value={form.confirm} onChangeText={set('confirm')} secureTextEntry />
        <Banner type="error">{error}</Banner>
        <Button
          title="Register"
          onPress={submit}
          loading={busy}
          disabled={!form.server || !form.full_name || !form.phone || !form.username || !form.password}
        />
      </Card>
    </Screen>
  )
}
