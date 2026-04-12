import { create } from 'zustand'
import { tauriAuthLogin } from '../desktop/tauriBridge'

type AuthState = {
  isAuthenticated: boolean
  username: string | null
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => void
}

const AUTH_KEY = 'perfmix-auth-v1'

function normalizeStoredAuth(raw: string | null) {
  if (!raw) return { isAuthenticated: false, username: null as string | null }
  try {
    const parsed = JSON.parse(raw) as {
      isAuthenticated?: boolean
      username?: string | null
      // legacy
      userEmail?: string | null
    }

    const username = (parsed.username ?? parsed.userEmail ?? null) as string | null
    return { isAuthenticated: Boolean(parsed.isAuthenticated), username }
  } catch {
    return { isAuthenticated: false, username: null as string | null }
  }
}

function readAuth() {
  const raw = localStorage.getItem(AUTH_KEY)
  const normalized = normalizeStoredAuth(raw)
  // One-time migration from older persisted shape.
  if (raw && raw.includes('"userEmail"') && !raw.includes('"username"')) {
    saveAuth({ isAuthenticated: normalized.isAuthenticated, username: normalized.username })
  }
  return normalized
}

function saveAuth(state: { isAuthenticated: boolean; username: string | null }) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(state))
}

function coerceInvokeErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === 'string') return msg
  }
  return 'Login failed.'
}

const initial = readAuth()

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: initial.isAuthenticated,
  username: initial.username,
  login: async (username, password) => {
    if (!username.trim() || !password.trim()) {
      return { ok: false, error: 'Username and password are required.' }
    }

    try {
      const tauri = await tauriAuthLogin(username, password)
      if (tauri) {
        const next = { isAuthenticated: true, username: tauri.username }
        saveAuth(next)
        set(next)
        return { ok: true }
      }

      // Browser/dev fallback (no sqlite): allow any non-empty login.
      const next = { isAuthenticated: true, username: username.trim() }
      saveAuth(next)
      set(next)
      return { ok: true }
    } catch (err) {
      const msg = coerceInvokeErrorMessage(err)
      if (msg.toLowerCase().includes('invalid credentials')) {
        return { ok: false, error: 'Invalid credentials' }
      }
      return { ok: false, error: msg }
    }
  },
  logout: () => {
    const next = { isAuthenticated: false, username: null }
    saveAuth(next)
    set(next)
  },
}))
