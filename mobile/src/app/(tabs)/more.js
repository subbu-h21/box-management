import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Badge, Button, C, Card, Muted, Screen } from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { confirm } from '../../lib/confirm'

export default function MoreScreen() {
  const { user, server, logout } = useAuth()
  const isAdmin = user.role === 'admin'
  const [pending, setPending] = useState(0)

  useFocusEffect(
    useCallback(() => {
      if (!isAdmin) return
      api
        .listUsers()
        .then((us) => setPending(us.filter((u) => u.pending).length))
        .catch(() => {})
    }, [isAdmin]),
  )

  const items = [
    { title: 'Printer', sub: 'Printer status, choose printers, print history', path: '/printer', icon: '🖨️' },
    { title: 'Transporters & Shops', sub: 'Add and edit transporters and medical shops', path: '/shops', icon: '🚚' },
    ...(isAdmin
      ? [
          { title: 'History', sub: 'Past dispatch lists', path: '/history', icon: '🗓️' },
          { title: 'Activity', sub: 'Who did what, boxes per worker', path: '/activity', icon: '📊' },
          { title: 'Users', sub: 'Accounts and registration requests', path: '/users', icon: '👥', badge: pending },
        ]
      : []),
    { title: 'My account', sub: 'Change password', path: '/account', icon: '👤' },
  ]

  return (
    <Screen>
      <Card>
        <View style={m.who}>
          <Text style={m.name}>{user.full_name}</Text>
          <Badge tone={isAdmin ? 'admin' : 'neutral'}>{user.role}</Badge>
        </View>
        <Muted>Server: {server}</Muted>
      </Card>

      <Card style={{ padding: 0, gap: 0 }}>
        {items.map((it, i) => (
          <Pressable
            key={it.path}
            onPress={() => router.push(it.path)}
            style={({ pressed }) => [m.item, i > 0 && m.divider, pressed && { backgroundColor: C.primarySoft }]}
          >
            <Text style={m.icon}>{it.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={m.title}>{it.title}</Text>
              <Muted style={{ fontSize: 13 }}>{it.sub}</Muted>
            </View>
            {it.badge ? (
              <View style={m.count}>
                <Text style={m.countText}>{it.badge}</Text>
              </View>
            ) : null}
            <Text style={m.chev}>›</Text>
          </Pressable>
        ))}
      </Card>

      <Button
        variant="danger"
        title="Log out"
        onPress={async () => {
          if (await confirm('Log out', 'Log out of Box Dispatch on this phone?', { ok: 'Log out' })) logout()
        }}
      />
    </Screen>
  )
}

const m = StyleSheet.create({
  who: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 18, fontWeight: '700', color: C.text },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14, minHeight: 64 },
  divider: { borderTopWidth: 1, borderTopColor: '#eef1f4' },
  icon: { fontSize: 22, width: 30, textAlign: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: C.text },
  chev: { fontSize: 24, color: C.muted },
  count: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: '#ff7043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  countText: { color: '#fff', fontWeight: '800', fontSize: 12 },
})
