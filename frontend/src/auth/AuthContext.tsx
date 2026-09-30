import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError, SESSION_EXPIRED_EVENT } from '../api/client.ts'
import { resetTrainerSettingsCache } from '../trainers/common.tsx'

export type User = { id: number; username: string; is_admin: boolean }

type AuthState = {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string, inviteCode?: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setUser(await api<User>('/auth/me'))
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setUser(null)
      else throw e
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh().catch(() => setLoading(false))
  }, [refresh])

  useEffect(() => {
    const expired = () => setUser(null)
    window.addEventListener(SESSION_EXPIRED_EVENT, expired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired)
  }, [])

  const login = async (username: string, password: string) => {
    resetTrainerSettingsCache()
    setUser(
      await api<User>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    )
  }

  const register = async (username: string, password: string, inviteCode?: string) => {
    resetTrainerSettingsCache()
    setUser(
      await api<User>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, password, invite_code: inviteCode || null }),
      }),
    )
  }

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' })
    resetTrainerSettingsCache()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
