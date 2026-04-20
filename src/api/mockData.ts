import type { AppData, NavItem } from '../models/types'

export const navItems: NavItem[] = [
  { label: 'Onboarding', to: '/' },
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Collections', to: '/collections' },
  { label: 'Scenario Builder', to: '/scenarios' },
  { label: 'Test Matrix', to: '/matrix' },
  { label: 'Thresholds', to: '/thresholds' },
  { label: 'Generated Code', to: '/codegen' },
  { label: 'Run Center', to: '/runs' },
  { label: 'Reports', to: '/reports' },
  { label: 'Integrations', to: '/integrations' },
  { label: 'AI Assistant', to: '/assistant' },
  { label: 'Settings', to: '/settings' },
]

export const appDataMock: AppData = {
  schemaVersion: 2,
  activeProjectId: undefined,
  projects: [],
  projectName: '',
  environment: 'staging',
  runner: 'local-k6',
  metrics: [],
  apiRequests: [],
  scenarios: [],
  matrixRows: [],
  thresholdRows: [],
  runSamples: [],
  envVariables: {
    dev: { baseUrl: 'https://dev.api.company.com' },
    staging: { baseUrl: 'https://staging.api.company.com' },
  },
  sharedVariables: {
    token: 'replace-me',
  },
  dataCsv: '',
  csvRows: [],
}
