import { useEffect, useState } from 'react'
import { api } from './api.js'
import { useAuth } from './auth.jsx'
import AndroidAppDialog from './components/AndroidAppDialog.jsx'
import ChangePasswordDialog from './components/ChangePasswordDialog.jsx'
import ActivityPage from './pages/ActivityPage.jsx'
import DailyListPage from './pages/DailyListPage.jsx'
import EntryPage from './pages/EntryPage.jsx'
import HistoryPage from './pages/HistoryPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import ManagePage from './pages/ManagePage.jsx'
import StickersPage from './pages/StickersPage.jsx'
import PrinterPage from './pages/PrinterPage.jsx'
import RegisterPage from './pages/RegisterPage.jsx'
import SetupPage from './pages/SetupPage.jsx'
import UsersPage from './pages/UsersPage.jsx'

const TABS = [
  { id: 'entry', label: 'New Entry', Page: EntryPage },
  { id: 'daily', label: 'Daily List', Page: DailyListPage },
  { id: 'printer', label: 'Printer', Page: PrinterPage },
  { id: 'stickers', label: 'Stickers', Page: StickersPage },
  { id: 'history', label: 'History', Page: HistoryPage, adminOnly: true },
  { id: 'manage', label: 'Transporters & Shops', Page: ManagePage },
  { id: 'activity', label: 'Activity', Page: ActivityPage, adminOnly: true },
  { id: 'users', label: 'Users', Page: UsersPage, adminOnly: true },
]

export default function App() {
  const { loading, user, setupRequired } = useAuth()
  if (loading) return <p className="muted center">Loading…</p>
  if (setupRequired) return <SetupPage />
  if (!user) return <LoggedOut />
  return <Shell key={user.id} />
}

function LoggedOut() {
  const [registering, setRegistering] = useState(false)
  const [info, setInfo] = useState('')
  if (registering) {
    return (
      <RegisterPage
        onBack={() => setRegistering(false)}
        onDone={(msg) => {
          setInfo(msg)
          setRegistering(false)
        }}
      />
    )
  }
  return (
    <LoginPage
      info={info}
      onRegister={() => {
        setInfo('')
        setRegistering(true)
      }}
    />
  )
}

function Shell() {
  const { user, logout, idleWarning } = useAuth()
  const [tab, setTab] = useState('entry')
  const [entryTarget, setEntryTarget] = useState(null) // transporter to open when going to New Entry
  const [changingPassword, setChangingPassword] = useState(false)
  const [showApp, setShowApp] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)

  // Admins: show how many registrations are waiting, refreshed whenever the tab changes.
  useEffect(() => {
    if (user.role !== 'admin') return
    let ignore = false
    api
      .listUsers()
      .then((us) => !ignore && setPendingCount(us.filter((u) => u.pending).length))
      .catch(() => {})
    return () => {
      ignore = true
    }
  }, [user.role, tab])
  const tabs = TABS.filter((t) => !t.adminOnly || user.role === 'admin')
  const { Page } = tabs.find((t) => t.id === tab) || tabs[0]

  return (
    <div className="app">
      <header className="topbar no-print">
        <div className='grid gap-y-1'>
          <h1>Box Dispatch</h1>
          {/* <p>by Kapila Pharma </p> */}
        </div> 

        <nav>
          {tabs.map((t) => (
            <button
              key={t.id}
              className={t.id === tab ? 'tab active' : 'tab'}
              onClick={() => {
                setEntryTarget(null)
                setTab(t.id)
              }}
            >
              {t.label}
              {t.id === 'users' && pendingCount > 0 && <span className="count-badge">{pendingCount}</span>}
            </button>
          ))}
        </nav>
        <div className="user-menu">
          <span>
            {user.full_name} <span className="role">{user.role}</span>
          </span>
          <button className="tab" onClick={() => setShowApp(true)}>
            Android app
          </button>
          <button className="tab" onClick={() => setChangingPassword(true)}>
            Change password
          </button>
          <button className="tab" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      {idleWarning > 0 && (
        <div className="idle-warning no-print">
          No activity — you will be logged out in {Math.ceil(idleWarning / 1000)} s. Move the mouse or press a key
          to stay logged in. Unsaved lists are saved automatically.
        </div>
      )}
      <main>
        <Page
          key={tab}
          onUsersChanged={setPendingCount}
          initialTransporterId={tab === 'entry' ? entryTarget : null}
          onNavigate={(to, opts = {}) => {
            setEntryTarget(opts.transporterId ?? null)
            setTab(to)
          }}
        />
      </main>
      {changingPassword && <ChangePasswordDialog onClose={() => setChangingPassword(false)} />}
      {showApp && <AndroidAppDialog onClose={() => setShowApp(false)} />}
    </div>
  )
}
