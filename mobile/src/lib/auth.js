import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { createContext, createElement, useCallback, useContext, useEffect, useState } from 'react'
import { api, normalizeServerUrl, setSession, setUnauthorizedHandler } from './api'

// The login token is a secret -> SecureStore. Server address and user details are not -> AsyncStorage.
const TOKEN_KEY = 'bd_token'
const SERVER_KEY = 'bd.server'
const USER_KEY = 'bd.user'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, server: '', notice: '' })

  const signOut = useCallback(async (notice = '') => {
    setSession(state.server, '')
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {})
    await AsyncStorage.removeItem(USER_KEY).catch(() => {})
    setState((s) => ({ ...s, user: null, notice }))
  }, [state.server])

  // Restore the saved login on app start; check it's still valid if the server is reachable.
  useEffect(() => {
    ;(async () => {
      const [server, token, userJson] = await Promise.all([
        AsyncStorage.getItem(SERVER_KEY).catch(() => null),
        SecureStore.getItemAsync(TOKEN_KEY).catch(() => null),
        AsyncStorage.getItem(USER_KEY).catch(() => null),
      ])
      let user = null
      if (server && token && userJson) {
        setSession(server, token)
        try {
          user = await api.me()
          await AsyncStorage.setItem(USER_KEY, JSON.stringify(user))
        } catch (e) {
          // Offline / PC switched off: keep the saved login; screens will show the connection error.
          user = e.status === 401 ? null : JSON.parse(userJson)
          if (!user) await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {})
        }
      }
      setState({ loading: false, user, server: server || '', notice: '' })
    })()
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => signOut('Your login has expired. Please log in again.'))
  }, [signOut])

  const login = useCallback(async (serverInput, username, password) => {
    const server = normalizeServerUrl(serverInput)
    const status = await api.authStatus(server)
    if (status.setup_required) {
      throw new Error('This server has no admin account yet. Create it on the website first.')
    }
    const me = await api.login(server, username.trim(), password)
    setSession(server, me.token)
    await SecureStore.setItemAsync(TOKEN_KEY, me.token)
    const { token, ...user } = me
    await AsyncStorage.multiSet([
      [SERVER_KEY, server],
      [USER_KEY, JSON.stringify(user)],
    ])
    setState({ loading: false, user, server, notice: '' })
  }, [])

  const register = useCallback(async (serverInput, body) => {
    const server = normalizeServerUrl(serverInput)
    await api.register(server, body)
    await AsyncStorage.setItem(SERVER_KEY, server)
    setState((s) => ({ ...s, server }))
  }, [])

  const logout = useCallback(async () => {
    await api.logout().catch(() => {})
    await signOut('')
  }, [signOut])

  return createElement(AuthContext.Provider, { value: { ...state, login, register, logout } }, children)
}

// Renders the screen only while someone is logged in (screens read user.role / user.id directly).
export function withUser(Screen) {
  return function LoggedInOnly(props) {
    const auth = useContext(AuthContext)
    return auth?.user ? createElement(Screen, props) : null
  }
}
