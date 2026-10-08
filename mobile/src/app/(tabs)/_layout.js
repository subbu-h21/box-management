import { Tabs } from 'expo-router/js-tabs'
import { Text } from 'react-native'
import { withUser } from '../../lib/auth'

const icon = (emoji) => ({ focused }) => <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.55 }}>{emoji}</Text>

function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: '#0d47a1' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: '#0d47a1',
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'New Entry', tabBarIcon: icon('📝') }} />
      <Tabs.Screen name="lists" options={{ title: 'Daily List', tabBarIcon: icon('📋') }} />
      <Tabs.Screen name="stickers" options={{ title: 'Stickers', tabBarIcon: icon('🏷️') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('☰') }} />
    </Tabs>
  )
}

export default withUser(TabsLayout)
