import { useAuth } from '../lib/auth'
import { Banner, Screen } from './ui'

export default function AdminOnly({ children }) {
  const { user } = useAuth()
  if (user?.role !== 'admin') {
    return (
      <Screen>
        <Banner type="notice">Only an admin can open this page.</Banner>
      </Screen>
    )
  }
  return children
}
