import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { autoSaveDraft } from './drafts.js'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

const ACTIVITY_KEY = 'bd.lastActivity' // shared across tabs so any active tab keeps everyone logged in
const LOGOUT_KEY = 'bd.logout' // written on logout so other tabs follow
const WARN_BEFORE_MS = 2 * 60 * 1000
const HEARTBEAT_MS = 60 * 1000 // tell the server we're active at most once a minute
const CHECK_MS = 5 * 1000

function readStored(key) {
  try {
    return Number(localStorage.getItem(key)) || 0
  } catch {
    return 0
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // ignore
  }
}

const AUTO_SAVE_MESSAGES = {
  saved: 'Your unsaved list was saved automatically.',
  'nothing-to-save': 'Your unfinished list was kept. It will be offered again when you log in.',
  conflict: 'Your unsaved list could not be saved because someone else changed it. It will be offered again when you log in.',
  failed: 'Your unsaved list could not be saved. It will be offered again when you log in.',
}

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, setupRequired: false })
  const [notice, setNotice] = useState('') // shown on the login screen
  const [idleWarning, setIdleWarning] = useState(0) // ms left before idle logout, 0 = no warning
  const user = state.user

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { setup_required } = await api.authStatus()
        if (setup_required) return !cancelled && setState({ loading: false, user: null, setupRequired: true })
        const me = await api.me().catch(() => null)
        if (!cancelled) setState({ loading: false, user: me, setupRequired: false })
      } catch (e) {
        if (!cancelled) {
          setNotice(e.message)
          setState({ loading: false, user: null, setupRequired: false })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const signedIn = useCallback((me) => {
    writeStored(ACTIVITY_KEY, Date.now())
    setNotice('')
    setState({ loading: false, user: me, setupRequired: false })
  }, [])

  const login = useCallback(async (username, password) => signedIn(await api.login(username, password)), [signedIn])
  const setup = useCallback(async (body) => signedIn(await api.setup(body)), [signedIn])

  const endSession = useCallback((message) => {
    setIdleWarning(0)
    setNotice(message || '')
    setState((s) => ({ ...s, user: null }))
  }, [])

  const logout = useCallback(async () => {
    await api.logout().catch(() => {})
    writeStored(LOGOUT_KEY, Date.now())
    endSession('')
  }, [endSession])

  // ---- Session ended elsewhere: 401 from the server, or logout in another tab ----
  useEffect(() => {
    if (!user) return
    const onExpired = () => endSession('Your session has ended. Please log in again.')
    const onStorage = (e) => {
      if (e.key === LOGOUT_KEY) endSession('You were logged out.')
    }
    window.addEventListener('auth:expired', onExpired)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('auth:expired', onExpired)
      window.removeEventListener('storage', onStorage)
    }
  }, [user, endSession])

  // ---- Idle timeout (web only): auto-save the unsaved list, then log out ----
  const loggingOut = useRef(false)
  useEffect(() => {
    if (!user || !user.idle_minutes) return
    const idleMs = user.idle_minutes * 60 * 1000
    let lastLocal = Date.now()
    let lastWrite = 0
    let lastPing = Date.now()
    loggingOut.current = false

    const onActivity = () => {
      const t = Date.now()
      lastLocal = t
      if (t - lastWrite > 5000) {
        lastWrite = t
        writeStored(ACTIVITY_KEY, t)
      }
      if (t - lastPing > HEARTBEAT_MS) {
        lastPing = t
        api.me().catch(() => {}) // keeps the server-side session alive while the user is active
      }
    }

    const check = async () => {
      if (loggingOut.current) return
      const last = Math.max(lastLocal, readStored(ACTIVITY_KEY))
      const left = idleMs - (Date.now() - last)
      if (left > WARN_BEFORE_MS) return setIdleWarning(0)
      if (left > 0) return setIdleWarning(left)

      loggingOut.current = true
      const result = await autoSaveDraft(user.id)
      await api.logout().catch(() => {})
      writeStored(LOGOUT_KEY, Date.now())
      endSession(
        `You were logged out after ${user.idle_minutes} minutes of inactivity. ${AUTO_SAVE_MESSAGES[result] || ''}`.trim(),
      )
    }

    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true, capture: true }))
    document.addEventListener('visibilitychange', check) // e.g. PC woke from sleep
    const timer = setInterval(check, CHECK_MS)
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }))
      document.removeEventListener('visibilitychange', check)
      clearInterval(timer)
    }
  }, [user, endSession])

  return (
    <AuthContext.Provider value={{ ...state, notice, idleWarning, login, setup, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
