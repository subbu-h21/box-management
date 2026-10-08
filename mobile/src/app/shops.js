import { useFocusEffect } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Banner, Button, C, Card, Field, Muted, Screen, Segmented } from '../components/ui'
import { api } from '../lib/api'
import { useAuth, withUser } from '../lib/auth'
import { confirm } from '../lib/confirm'
import { fuzzyFilter } from '../lib/fuzzy'

const KINDS = {
  transporters: {
    title: 'Transporter',
    fields: [
      { name: 'code', label: 'Transporter ID', required: true, autoCapitalize: 'characters' },
      { name: 'name', label: 'Name', required: true },
      { name: 'phone', label: 'Phone', keyboardType: 'phone-pad' },
    ],
    list: api.listTransporters,
    create: api.createTransporter,
    update: api.updateTransporter,
    remove: api.deleteTransporter,
    text: (t) => `${t.code} ${t.name}`,
    line1: (t) => `${t.code} — ${t.name}`,
    line2: (t) => t.phone,
  },
  shops: {
    title: 'Medical shop',
    fields: [
      { name: 'name', label: 'Shop name', required: true },
      { name: 'area', label: 'Area / Town' },
      { name: 'phone', label: 'Phone', keyboardType: 'phone-pad' },
    ],
    list: api.listShops,
    create: api.createShop,
    update: api.updateShop,
    remove: api.deleteShop,
    text: (s) => `${s.name} ${s.area}`,
    line1: (s) => s.name,
    line2: (s) => [s.area, s.phone].filter(Boolean).join(' · '),
  },
}

function ShopsScreen() {
  const { user } = useAuth()
  const isAdmin = user.role === 'admin'
  const [kind, setKind] = useState('shops')
  const [items, setItems] = useState({ transporters: [], shops: [] })
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null) // {} for new, item for edit
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const k = KINDS[kind]

  const load = useCallback(async () => {
    setError('')
    try {
      const [transporters, shops] = await Promise.all([api.listTransporters(), api.listShops()])
      setItems({ transporters, shops })
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  const visible = useMemo(() => fuzzyFilter(items[kind], query, k.text), [items, kind, query, k])

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
        <Segmented
          options={[
            { value: 'shops', label: `Medical shops (${items.shops.length})` },
            { value: 'transporters', label: `Transporters (${items.transporters.length})` },
          ]}
          value={kind}
          onChange={(v) => {
            setKind(v)
            setQuery('')
          }}
        />
        <Field placeholder="Search…" value={query} onChangeText={setQuery} autoCorrect={false} autoCapitalize="none" />
        <Button title={`+ Add ${k.title.toLowerCase()}`} onPress={() => setEditing({})} />
        <Banner type="error">{error}</Banner>
        <Card style={{ padding: 0, gap: 0 }}>
          {visible.length === 0 ? <Muted style={{ padding: 14 }}>{items[kind].length ? 'No matches.' : 'Nothing added yet.'}</Muted> : null}
          {visible.map((it, i) => (
            <Pressable
              key={it.id}
              onPress={() => setEditing(it)}
              style={({ pressed }) => [s.item, i > 0 && s.divider, pressed && { backgroundColor: C.primarySoft }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.line1}>{k.line1(it)}</Text>
                {k.line2(it) ? <Muted style={{ fontSize: 13 }}>{k.line2(it)}</Muted> : null}
              </View>
              <Text style={s.chev}>Edit ›</Text>
            </Pressable>
          ))}
        </Card>
      </Screen>

      {editing ? (
        <EditForm
          k={k}
          item={editing}
          canDelete={isAdmin && editing.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      ) : null}
    </>
  )
}

function EditForm({ k, item, canDelete, onClose, onSaved }) {
  const [form, setForm] = useState(() => Object.fromEntries(k.fields.map((f) => [f.name, item[f.name] ?? ''])))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    setError('')
    const missing = k.fields.find((f) => f.required && !String(form[f.name]).trim())
    if (missing) return setError(`${missing.label} is required.`)
    setBusy(true)
    try {
      if (item.id) await k.update(item.id, form)
      else await k.create(form)
      onSaved()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  async function remove() {
    if (!(await confirm('Delete', `Delete “${item.name}”?`, { ok: 'Delete', destructive: true }))) return
    setBusy(true)
    try {
      await k.remove(item.id)
      onSaved()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <StatusBar style="dark" />
        <View style={s.head}>
          <Text style={s.headTitle}>{item.id ? `Edit ${k.title.toLowerCase()}` : `Add ${k.title.toLowerCase()}`}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={s.close}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }} keyboardShouldPersistTaps="handled">
          {k.fields.map((f) => (
            <Field
              key={f.name}
              label={f.label + (f.required ? ' *' : '')}
              value={form[f.name]}
              onChangeText={(v) => setForm((x) => ({ ...x, [f.name]: v }))}
              keyboardType={f.keyboardType}
              autoCapitalize={f.autoCapitalize}
            />
          ))}
          <Banner type="error">{error}</Banner>
          <Button title={item.id ? 'Save changes' : 'Add'} onPress={save} loading={busy} />
          {canDelete ? <Button variant="danger" title="Delete" onPress={remove} disabled={busy} /> : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

const s = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  divider: { borderTopWidth: 1, borderTopColor: '#eef1f4' },
  line1: { fontSize: 16, color: C.text, fontWeight: '600' },
  chev: { color: C.primary, fontWeight: '700' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.border },
  headTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  close: { color: C.primary, fontWeight: '700', fontSize: 16 },
})

export default withUser(ShopsScreen)
