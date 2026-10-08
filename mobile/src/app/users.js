import { useFocusEffect } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AdminOnly from '../components/AdminOnly'
import { Badge, Banner, Button, C, Card, Field, H2, Label, Muted, Row, Screen, Segmented } from '../components/ui'
import { api } from '../lib/api'
import { useAuth, withUser } from '../lib/auth'
import { confirm } from '../lib/confirm'
import { formatDateTime } from '../lib/format'

function UsersScreen() {
  return (
    <AdminOnly>
      <Users />
    </AdminOnly>
  )
}

function Users() {
  const { user: me, logout } = useAuth()
  const [users, setUsers] = useState([])
  const [editing, setEditing] = useState(null) // user, or {} for a new one
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      setUsers(await api.listUsers())
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  async function run(fn, ok) {
    setError('')
    setMessage('')
    try {
      await fn()
      setMessage(ok)
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  const pending = users.filter((u) => u.pending)
  const accounts = users.filter((u) => !u.pending)

  return (
    <>
      <Screen
        onRefresh={async () => {
          setRefreshing(true)
          await load()
          setRefreshing(false)
        }}
        refreshing={refreshing}
      >
        <Banner type="error">{error}</Banner>
        <Banner type="success">{message}</Banner>

        {pending.length ? (
          <Card style={{ backgroundColor: C.warnSoft, borderColor: '#ffe082' }}>
            <H2>Pending registrations ({pending.length})</H2>
            {pending.map((u) => (
              <View key={u.id} style={x.pending}>
                <Text style={x.name}>{u.full_name}</Text>
                <Muted>
                  {u.username} · {u.phone} · {formatDateTime(u.created_at)}
                </Muted>
                <Row>
                  <Button small title="Approve" onPress={() => run(() => api.approveUser(u.id), `${u.full_name} approved. They can log in now.`)} />
                  <Button
                    small
                    variant="danger"
                    title="Reject"
                    onPress={async () => {
                      if (await confirm('Reject', `Reject the registration from ${u.full_name}?`, { ok: 'Reject', destructive: true })) {
                        run(() => api.rejectUser(u.id), `Registration from ${u.full_name} rejected.`)
                      }
                    }}
                  />
                </Row>
              </View>
            ))}
          </Card>
        ) : null}

        <Button title="+ Add user" onPress={() => setEditing({})} />

        <Card style={{ padding: 0, gap: 0 }}>
          {accounts.map((u, i) => (
            <Pressable
              key={u.id}
              onPress={() => setEditing(u)}
              style={({ pressed }) => [x.item, i > 0 && x.divider, pressed && { backgroundColor: C.primarySoft }]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Row>
                  <Text style={[x.name, !u.active && { color: C.muted }]}>
                    {u.full_name}
                    {u.id === me.id ? ' (you)' : ''}
                  </Text>
                  <Badge tone={u.role === 'admin' ? 'admin' : 'neutral'}>{u.role}</Badge>
                  {!u.active ? <Badge tone="bad">disabled</Badge> : null}
                </Row>
                <Muted style={{ fontSize: 13 }}>
                  {u.username}
                  {u.phone ? ` · ${u.phone}` : ''}
                </Muted>
              </View>
              <Text style={x.chev}>Edit ›</Text>
            </Pressable>
          ))}
        </Card>
        <Muted style={{ fontSize: 12 }}>
          Accounts are never deleted, only disabled, so their history stays in the Activity log.
        </Muted>
      </Screen>

      {editing ? (
        <UserForm
          user={editing}
          isMe={editing.id === me.id}
          onClose={() => setEditing(null)}
          onDone={async (msg, selfChanged) => {
            setEditing(null)
            setMessage(msg)
            if (selfChanged) {
              // Own role or status changed: log in again so the app shows the right menus.
              await logout()
              return
            }
            load()
          }}
        />
      ) : null}
    </>
  )
}

function UserForm({ user, isMe, onClose, onDone }) {
  const isNew = !user.id
  const [form, setForm] = useState({
    full_name: user.full_name || '',
    phone: user.phone || '',
    username: '',
    password: '',
    role: user.role || 'worker',
    active: user.active ?? true,
  })
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    setError('')
    if (!form.full_name.trim()) return setError('Full name is required.')
    setBusy(true)
    try {
      if (isNew) {
        if (form.password.length < 6) throw new Error('Password must be at least 6 characters.')
        await api.createUser({
          full_name: form.full_name.trim(),
          phone: form.phone.trim(),
          username: form.username.trim(),
          password: form.password,
          role: form.role,
        })
        onDone(`Account “${form.username.trim()}” created.`)
      } else {
        await api.updateUser(user.id, {
          full_name: form.full_name.trim(),
          phone: form.phone.trim(),
          role: form.role,
          active: form.active,
        })
        onDone('User updated.', isMe && (form.role !== user.role || !form.active))
      }
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  async function resetPassword() {
    setError('')
    if (newPassword.length < 6) return setError('New password must be at least 6 characters.')
    setBusy(true)
    try {
      await api.resetPassword(user.id, newPassword)
      onDone(`Password for “${user.username}” reset. They have been logged out everywhere.`)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <StatusBar style="dark" />
        <View style={x.head}>
          <Text style={x.headTitle}>{isNew ? 'Add user' : `Edit ${user.username}`}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={x.close}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Field label="Full name *" value={form.full_name} onChangeText={set('full_name')} />
          <Field label="Phone" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
          {isNew ? (
            <>
              <Field label="Username *" value={form.username} onChangeText={set('username')} autoCapitalize="none" autoCorrect={false} />
              <Field label="Password * (min 6)" value={form.password} onChangeText={set('password')} secureTextEntry />
            </>
          ) : null}
          <Label>Role</Label>
          <Segmented
            options={[
              { value: 'worker', label: 'Worker' },
              { value: 'admin', label: 'Admin' },
            ]}
            value={form.role}
            onChange={set('role')}
          />
          {!isNew ? (
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 16, color: C.text }}>Active (can log in)</Text>
              <Switch value={form.active} onValueChange={set('active')} />
            </Row>
          ) : null}
          <Banner type="error">{error}</Banner>
          <Button title={isNew ? 'Add user' : 'Save changes'} onPress={save} loading={busy} />

          {!isNew ? (
            <Card style={{ marginTop: 8 }}>
              <H2>Reset password</H2>
              <Field placeholder="New password (min 6)" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
              <Button variant="secondary" title="Set new password" onPress={resetPassword} disabled={busy || !newPassword} />
            </Card>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

const x = StyleSheet.create({
  pending: { borderTopWidth: 1, borderTopColor: '#ffe9a8', paddingTop: 10, gap: 6 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, minHeight: 60 },
  divider: { borderTopWidth: 1, borderTopColor: '#eef1f4' },
  name: { fontSize: 16, fontWeight: '700', color: C.text },
  chev: { color: C.primary, fontWeight: '700' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.border },
  headTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  close: { color: C.primary, fontWeight: '700', fontSize: 16 },
})

export default withUser(UsersScreen)
