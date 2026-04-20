import { useCallback } from 'react'
import { ToastHost } from '../components/ui/ToastHost'
import { useAuthStore } from '../store/authStore'
import { useAppStore } from '../store/appStore'
import { WorkspaceApp } from '../workspace/WorkspaceApp'

export function AppLayout() {
  const diagnostics = useAppStore((state) => state.diagnostics)
  const loadDiagnostics = useAppStore((state) => state.loadDiagnostics)
  const resetApp = useAppStore((state) => state.reset)
  const userEmail = useAuthStore((state) => state.email)
  const displayUsername = useAuthStore((state) => state.displayUsername)
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
        userEmail={userEmail}
        userDisplay={displayUsername ?? userEmail}
      />
      <ToastHost />
    </div>
  )
}
