import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'

const OnboardingPage = lazy(() => import('../pages/pages').then((m) => ({ default: m.OnboardingPage })))
const DashboardPage = lazy(() => import('../pages/pages').then((m) => ({ default: m.DashboardPage })))
const CollectionsPage = lazy(() => import('../pages/pages').then((m) => ({ default: m.CollectionsPage })))
const ScenariosPage = lazy(() => import('../pages/pages').then((m) => ({ default: m.ScenariosPage })))
const MatrixPage = lazy(() => import('../pages/pages').then((m) => ({ default: m.MatrixPage })))
const ThresholdsPage = lazy(() => import('../pages/pages').then((m) => ({ default: m.ThresholdsPage })))
const CodegenPage = lazy(() => import('../pages/pages').then((m) => ({ default: m.CodegenPage })))
const RunsPage = lazy(() => import('../pages/pages').then((m) => ({ default: m.RunsPage })))
const ReportsPage = lazy(() => import('../pages/pages').then((m) => ({ default: m.ReportsPage })))
const IntegrationsPage = lazy(() => import('../pages/pages').then((m) => ({ default: m.IntegrationsPage })))
const AssistantPage = lazy(() => import('../pages/pages').then((m) => ({ default: m.AssistantPage })))
const SettingsPage = lazy(() => import('../pages/pages').then((m) => ({ default: m.SettingsPage })))

export function AppRoutes() {
  return (
    <Suspense fallback={<div className="route-loading">Loading page...</div>}>
      <Routes>
        <Route path="/" element={<OnboardingPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/collections" element={<CollectionsPage />} />
        <Route path="/scenarios" element={<ScenariosPage />} />
        <Route path="/matrix" element={<MatrixPage />} />
        <Route path="/thresholds" element={<ThresholdsPage />} />
        <Route path="/codegen" element={<CodegenPage />} />
        <Route path="/runs" element={<RunsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/assistant" element={<AssistantPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Suspense>
  )
}
