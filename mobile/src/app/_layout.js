import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { Loading } from '../components/ui'
import { AuthProvider, useAuth } from '../lib/auth'

function RootNavigator() {
  const { loading, user } = useAuth()
  if (loading) return <Loading />

  // Protected groups: app screens only exist while logged in, login/register only while logged out.
  // The router switches between them by itself when the user logs in or out.
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0d47a1' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="printer" options={{ title: 'Printer' }} />
        <Stack.Screen name="shops" options={{ title: 'Transporters & Shops' }} />
        <Stack.Screen name="history" options={{ title: 'History' }} />
        <Stack.Screen name="activity" options={{ title: 'Activity' }} />
        <Stack.Screen name="users" options={{ title: 'Users' }} />
        <Stack.Screen name="account" options={{ title: 'My account' }} />
      </Stack.Protected>
      <Stack.Protected guard={!user}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="register" options={{ title: 'Register' }} />
      </Stack.Protected>
    </Stack>
  )
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  )
}
