import { useCallback } from 'react'
import { ToastHost } from '../components/ui/ToastHost'
import { useAuthStore } from '../store/authStore'
import { useAppStore } from '../store/appStore'
import { WorkspaceApp } from '../workspace/WorkspaceApp'

export function AppLayout() {
  const diagnostics = useAppStore((state) => state.diagnostics)
  const loadDiagnostics = useAppStore((state) => state.loadDiagnostics)
  const resetApp = useAppStore((state) => state.reset)
  const username = useAuthStore((state) => state.username)
  const logout = useAuthStore((state) => state.logout)

  const onLoadDiagnostics = useCallback(() => {
    void loadDiagnostics()
  }, [loadDiagnostics])

  return (
    <div className="ws-app-shell">
      <WorkspaceApp
        diagnostics={diagnostics}
        onLoadDiagnostics={onLoadDiagnostics}
        onLogout={() => {
          resetApp()
          logout()
        }}
        username={username}
      />
      <ToastHost />
    </div>
  )
}
