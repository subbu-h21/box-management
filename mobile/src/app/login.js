import { router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Banner, Button, C, Card, Field, Muted, Screen } from '../components/ui'
import { useAuth } from '../lib/auth'

export default function LoginScreen() {
  const { login, server: savedServer, notice } = useAuth()
  const [server, setServer] = useState(savedServer)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (savedServer && !server) setServer(savedServer)
  }, [savedServer])

  async function submit() {
    setError('')
    setBusy(true)
    try {
      await login(server, username, password)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  const ready = server.trim() && username.trim() && password

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} style={l.center}>
      <StatusBar style="dark" />
      <View style={l.brand}>
        <Text style={l.logo}>📦</Text>
        <Text style={l.title}>Box Dispatch</Text>
        <Muted>Log in to continue</Muted>
      </View>
      <Card>
        <Banner type="notice">{notice}</Banner>
        <Field
          testID="server"
          label="Server address"
          hint="The main PC's address, shown on the website under “Android app”, e.g. 192.168.1.20:8000"
          value={server}
          onChangeText={setServer}
          placeholder="192.168.1.20:8000"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Field
          testID="username"
          label="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
        />
        <Field
          testID="password"
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          onSubmitEditing={() => ready && submit()}
        />
        <Banner type="error">{error}</Banner>
        <Button testID="login" title="Log in" onPress={submit} loading={busy} disabled={!ready} />
      </Card>
      <View style={l.switch}>
        <Muted>New worker?</Muted>
        <Button variant="link" title="Register" onPress={() => router.push({ pathname: '/register', params: { server } })} />
      </View>
    </Screen>
  )
}

const l = StyleSheet.create({
  center: { flexGrow: 1, justifyContent: 'center' },
  brand: { alignItems: 'center', gap: 4, marginBottom: 8 },
  logo: { fontSize: 44 },
  title: { fontSize: 28, fontWeight: '800', color: C.primaryDark },
  switch: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
})
