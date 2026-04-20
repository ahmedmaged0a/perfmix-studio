import { useEffect } from 'react'
import { AppLayout } from './app/layout'
import { LoginPage } from './components/auth/LoginPage'
import { tauriBootstrapRuntime } from './desktop/tauriBridge'
import { useBootstrap } from './hooks/useBootstrap'
import { useAuthStore } from './store/authStore'

function App() {
  const authReady = useAuthStore((state) => state.authReady)
  const hydrate = useAuthStore((state) => state.hydrate)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const { isLoading, error } = useBootstrap(isAuthenticated)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    if (isAuthenticated) {
      void tauriBootstrapRuntime()
    }
  }, [isAuthenticated])

  if (!authReady) {
    return <div className="boot-screen">Loading session…</div>
  }

  if (!isAuthenticated) {
    return <LoginPage />
  }

  if (isLoading) {
    return <div className="boot-screen">Loading application data...</div>
  }

  if (error) {
    return <div className="boot-screen error">{error}</div>
  }

  return <AppLayout />
}

export default App
