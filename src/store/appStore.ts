import { create } from 'zustand'
import { apiClient } from '../api/client'
import { appDataMock } from '../api/mockData'
import type {
  ApiRequestItem,
  AppData,
  Collection,
  K6RunHistoryEntry,
  K6RunStatus,
  Project,
  RequestDefinition,
  RuntimeDiagnostics,
  ScenarioDefinition,
  ScenarioMatrixRow,
  ThresholdRow,
} from '../models/types'
import { migrateRequestTestCaseToggles } from '../models/types'
import { extractGlobalMetricsFromSummary } from '../k6/summaryMetrics'
import { metricsForRequestId, extractPerRequestMetricsFromSummary } from '../k6/summaryPerRequest'
import { useAuthStore } from './authStore'

const STORAGE_PREFIX = 'perfmix-app-data-v4-'

function buildId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

function headersTextToRecord(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of String(raw ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const k = line.slice(0, idx).trim()
    const v = line.slice(idx + 1).trim()
    if (!k) continue
    out[k] = v
  }
  return out
}

function migrateLegacyRequestsToProject(data: AppData): AppData {
  if ((data.projects?.length ?? 0) > 0) return data
  const legacy = data.apiRequests ?? []
  if (!legacy.length) {
    const emptyProject: Project = {
      id: buildId('proj'),
      name: data.projectName?.trim() ? data.projectName : 'My Project',
      collections: [{ id: buildId('col'), name: 'Default', requests: [], variables: {} }],
      correlationRules: [],
      csvMappings: [],
      csvRows: [],
      variables: {},
    }
    return {
      ...data,
      schemaVersion: 2,
      projects: [emptyProject],
      activeProjectId: emptyProject.id,
    }
  }

  const folders = new Map<string, RequestDefinition[]>()
  for (const req of legacy) {
    const folder = req.folder?.trim() || 'Default'
    const list = folders.get(folder) ?? []
    list.push({
      id: req.id,
      name: req.name,
      method: req.method,
      url: req.url,
      query: {},
      headers: headersTextToRecord(req.headers),
      bodyText: req.body,
      testCases: req.testCases ?? [],
    })
    folders.set(folder, list)
  }

  const collections: Collection[] = []
  for (const [name, reqs] of folders.entries()) {
    collections.push({ id: buildId('col'), name, requests: reqs, variables: {} })
  }

  const project: Project = {
    id: buildId('proj'),
    name: data.projectName?.trim() ? data.projectName : 'My Project',
    collections,
    correlationRules: [],
    csvMappings: [],
    csvRows: data.csvRows?.length ? data.csvRows : data.dataCsv.split('\n').map((l) => l.trim()).filter(Boolean),
    variables: {},
  }

  return {
    ...data,
    schemaVersion: 2,
    projects: [project],
    activeProjectId: project.id,
  }
}

function storageKeyForUser(): string | null {
  const email = useAuthStore.getState().username?.trim()
  if (!email) return null
  return `${STORAGE_PREFIX}${email}`
}

function normalizeData(data: AppData): AppData {
  const base: AppData = {
    ...data,
    schemaVersion: data.schemaVersion ?? 1,
    activeProjectId: data.activeProjectId,
    projects: data.projects ?? [],
    apiRequests: (data.apiRequests ?? []).map((item) => ({
      ...item,
      id: item.id || buildId('req'),
      testCases: (item.testCases ?? []).map((tc) =>
        migrateRequestTestCaseToggles({
          ...tc,
          id: tc.id || buildId('tc'),
          criteria:
            tc.criteria ??
            (tc.maxAvgMs || tc.maxP95Ms || tc.maxErrorRate
              ? {
                  maxAvgMs: tc.maxAvgMs,
                  maxP95Ms: tc.maxP95Ms,
                  maxErrorRate: tc.maxErrorRate,
                }
              : undefined),
        }),
      ),
    })),
    scenarios: (data.scenarios ?? []).map((item) => ({
      ...item,
      id: item.id || buildId('scn'),
    })),
    matrixRows: (data.matrixRows ?? []).map((item) => ({
      ...item,
      id: item.id || buildId('mx'),
    })),
    thresholdRows: (data.thresholdRows ?? []).map((item) => ({
      ...item,
      id: item.id || buildId('th'),
    })),
    envVariables: data.envVariables ?? {},
    sharedVariables: data.sharedVariables ?? {},
    dataCsv: data.dataCsv ?? '',
    csvRows: data.csvRows ?? [],
    k6RunHistoryByRequest: data.k6RunHistoryByRequest ?? {},
  }

  const migrated = migrateLegacyRequestsToProject(base)
  return {
    ...migrated,
    projects: (migrated.projects ?? []).map((p) => ({
      ...p,
      variables: p.variables ?? {},
      collections: (p.collections ?? []).map((c) => ({
        ...c,
        variables: c.variables ?? {},
        requests: (c.requests ?? []).map((r) => ({
          ...r,
          testCases: (r.testCases ?? []).map((tc) => migrateRequestTestCaseToggles(tc)),
        })),
      })),
    })),
  }
}

type AppStore = {
  data: AppData | null
  isLoading: boolean
  error: string | null
  generatedScript: string
  lastRunStatus: K6RunStatus | 'idle'
  runLogs: string[]
  lastRunId: string | null
  lastSummaryPath: string | null
  lastReportHtmlPath: string | null
  lastSummaryJson: string | null
  k6VerboseLogs: boolean
  diagnostics: RuntimeDiagnostics | null
  loadData: () => Promise<void>
  reset: () => void
  loadDiagnostics: () => Promise<void>
  setGeneratedScript: (script: string) => void
  setK6VerboseLogs: (verbose: boolean) => void
  clearRunLogs: () => void
  replaceWorkspaceData: (next: AppData) => void
  setEnvVariables: (envVariables: AppData['envVariables']) => void
  setSharedVariables: (sharedVariables: AppData['sharedVariables']) => void
  setDataCsv: (dataCsv: string) => void
  appendK6RunHistory: (input: {
    requestIds: string[]
    collectionId?: string
    scope: 'request' | 'collection'
    runId: string
    status: K6RunStatus
    summaryJson: string | null
  }) => void
  deleteK6RunHistoryEntry: (requestId: string, entryId: string) => void
  /** Removes every history entry with this run id (used for collection runs stored per request). */
  deleteK6RunHistoryEntriesByRunId: (runId: string) => void
  stopK6Run: () => Promise<void>
  executeK6Run: () => Promise<{ runId: string | null; status: K6RunStatus | 'idle' | 'failed'; summaryJson: string | null }>
  initializeProject: (name: string, environment: string, runner: string) => void
  updateWorkspaceMeta: (environment: string, runner: string) => void
  createScenario: (input: Omit<ScenarioDefinition, 'id'>) => void
  updateScenario: (id: string, input: Omit<ScenarioDefinition, 'id'>) => void
  addApiRequest: (input: Omit<ApiRequestItem, 'id'>) => void
  updateApiRequest: (id: string, input: Omit<ApiRequestItem, 'id'>) => void
  removeApiRequest: (id: string) => void
  addMatrixRow: (input: Omit<ScenarioMatrixRow, 'id'>) => void
  updateMatrixRow: (id: string, input: Omit<ScenarioMatrixRow, 'id'>) => void
  removeMatrixRow: (id: string) => void
  addThreshold: (input: Omit<ThresholdRow, 'id'>) => void
  updateThreshold: (id: string, input: Omit<ThresholdRow, 'id'>) => void
  removeThreshold: (id: string) => void
  toggleThreshold: (id: string) => void
}

function saveData(data: AppData) {
  const key = storageKeyForUser()
  if (!key) return
  localStorage.setItem(key, JSON.stringify(data))
}

function persistData(data: AppData) {
  saveData(data)
  const username = useAuthStore.getState().username?.trim() ?? ''
  void apiClient.saveAppData(username, data)
}

export const useAppStore = create<AppStore>((set, get) => ({
  data: null,
  isLoading: false,
  error: null,
  generatedScript: '',
  lastRunStatus: 'idle',
  runLogs: [],
  lastRunId: null,
  lastSummaryPath: null,
  lastReportHtmlPath: null,
  lastSummaryJson: null,
  k6VerboseLogs: false,
  diagnostics: null,
  loadData: async () => {
    set({ isLoading: true, error: null })
    try {
      const key = storageKeyForUser()
      if (!key) {
        set({ error: 'Missing user session.', isLoading: false })
        return
      }

      const cached = localStorage.getItem(key)
      if (cached) {
        const parsed = normalizeData(JSON.parse(cached) as AppData)
        persistData(parsed)
        set({ data: parsed, isLoading: false })
        return
      }

      const username = useAuthStore.getState().username?.trim() ?? ''
      const remote = await apiClient.getAppData(username)
      const normalized = normalizeData(remote ?? appDataMock)
      persistData(normalized)
      set({ data: normalized, isLoading: false })
    } catch {
      set({ error: 'Failed to load application data.', isLoading: false })
    }
  },

  reset: () => {
    set({
      data: null,
      isLoading: false,
      error: null,
      generatedScript: '',
      lastRunStatus: 'idle',
      runLogs: [],
      lastRunId: null,
      lastSummaryPath: null,
      lastReportHtmlPath: null,
      lastSummaryJson: null,
      k6VerboseLogs: false,
      diagnostics: null,
    })
  },

  loadDiagnostics: async () => {
    try {
      const diagnostics = await apiClient.getRuntimeDiagnostics()
      set({ diagnostics })
    } catch {
      set({
        diagnostics: {
          tauriAvailable: false,
          k6Path: 'unknown',
          mode: 'unavailable',
          canExecute: false,
          runsDirWritable: false,
          k6Version: 'unknown',
          issues: ['Failed to load runtime diagnostics.'],
        },
      })
    }
  },

  setGeneratedScript: (script) => {
    set({ generatedScript: script })
  },

  setK6VerboseLogs: (verbose) => {
    set({ k6VerboseLogs: verbose })
  },

  clearRunLogs: () => {
    set({ runLogs: [] })
  },

  replaceWorkspaceData: (next) => {
    const normalized = normalizeData(next)
    persistData(normalized)
    set({ data: normalized })
  },

  setEnvVariables: (envVariables) => {
    const current = get().data
    if (!current) return
    const next: AppData = { ...current, envVariables }
    persistData(next)
    set({ data: next })
  },

  setSharedVariables: (sharedVariables) => {
    const current = get().data
    if (!current) return
    const next: AppData = { ...current, sharedVariables }
    persistData(next)
    set({ data: next })
  },

  setDataCsv: (dataCsv) => {
    const current = get().data
    if (!current) return
    const next: AppData = { ...current, dataCsv }
    persistData(next)
    set({ data: next })
  },

  appendK6RunHistory: (input) => {
    const current = get().data
    if (!current) return
    const hist: Record<string, K6RunHistoryEntry[]> = { ...(current.k6RunHistoryByRequest ?? {}) }
    const perRows =
      input.scope === 'collection' ? extractPerRequestMetricsFromSummary(input.summaryJson) : []
    for (const requestId of input.requestIds) {
      const list = hist[requestId] ?? []
      const scoped =
        input.scope === 'collection' && perRows.length
          ? metricsForRequestId(perRows, requestId)
          : null
      const metrics = scoped ?? extractGlobalMetricsFromSummary(input.summaryJson)
      const entry: K6RunHistoryEntry = {
        id: buildId('rh'),
        runId: input.runId,
        at: new Date().toISOString(),
        requestId,
        collectionId: input.collectionId,
        scope: input.scope,
        status: input.status,
        metrics,
        summaryJson: input.summaryJson,
      }
      hist[requestId] = [...list, entry].slice(-80)
    }
    const next: AppData = { ...current, k6RunHistoryByRequest: hist }
    persistData(next)
    set({ data: next })
  },

  deleteK6RunHistoryEntry: (requestId, entryId) => {
    const current = get().data
    if (!current) return
    const hist: Record<string, K6RunHistoryEntry[]> = { ...(current.k6RunHistoryByRequest ?? {}) }
    const list = hist[requestId] ?? []
    hist[requestId] = list.filter((e) => e.id !== entryId)
    const next: AppData = { ...current, k6RunHistoryByRequest: hist }
    persistData(next)
    set({ data: next })
  },

  deleteK6RunHistoryEntriesByRunId: (runId) => {
    const current = get().data
    if (!current) return
    const hist: Record<string, K6RunHistoryEntry[]> = { ...(current.k6RunHistoryByRequest ?? {}) }
    for (const key of Object.keys(hist)) {
      hist[key] = hist[key].filter((e) => e.runId !== runId)
    }
    const next: AppData = { ...current, k6RunHistoryByRequest: hist }
    persistData(next)
    set({ data: next })
  },

  stopK6Run: async () => {
    const runId = get().lastRunId
    if (!runId) return
    try {
      await apiClient.stopK6Run(runId)
      set({ lastRunStatus: 'failed', runLogs: [...get().runLogs, 'Run stopped by user.'] })
    } catch {
      set({ runLogs: [...get().runLogs, 'Failed to stop the run.'] })
    }
  },

  executeK6Run: async () => {
    const script = get().generatedScript
    if (!script.trim()) {
      set({ error: 'Generate K6 script first.' })
      return { runId: null, status: 'idle', summaryJson: null }
    }
    const diagnostics = get().diagnostics
    if (diagnostics && (!diagnostics.canExecute || !diagnostics.runsDirWritable)) {
      set({
        lastRunStatus: 'failed',
        runLogs: ['Runtime health check failed.', ...diagnostics.issues],
        error: 'Runtime health check failed.',
      })
      return { runId: null, status: 'failed', summaryJson: null }
    }
    set({ lastRunStatus: 'queued', runLogs: ['Submitting run...'], error: null })
    let activeRunId: string | null = null
    try {
      const username = useAuthStore.getState().username?.trim() ?? ''
      const quiet = !get().k6VerboseLogs
      const start = await apiClient.startK6Run(script, username, quiet)
      activeRunId = start.runId
      set({ lastRunId: start.runId, lastSummaryPath: null, lastReportHtmlPath: null, lastSummaryJson: null })
      for (let i = 0; i < 2400; i += 1) {
        const status = await apiClient.getK6RunStatus(start.runId)
        set({
          lastRunStatus: status.status,
          runLogs: status.logs,
          lastSummaryPath: status.summaryPath ?? null,
          lastReportHtmlPath: status.reportHtmlPath ?? null,
          lastSummaryJson: status.summaryJson ?? null,
        })
        if (status.status === 'passed' || status.status === 'failed') {
          return { runId: start.runId, status: status.status, summaryJson: status.summaryJson ?? null }
        }
        await new Promise((resolve) => setTimeout(resolve, 700))
      }
      set({ lastRunStatus: 'failed', runLogs: ['Run timeout while polling status.'] })
      return { runId: activeRunId, status: 'failed', summaryJson: get().lastSummaryJson }
    } catch {
      set({ lastRunStatus: 'failed', runLogs: ['Failed to execute k6 run.'] })
      return { runId: activeRunId, status: 'failed', summaryJson: get().lastSummaryJson }
    }
  },

  initializeProject: (name, environment, runner) => {
    const current = get().data
    if (!current) return
    const next: AppData = {
      ...current,
      projectName: name.trim(),
      environment: environment.trim(),
      runner: runner.trim(),
      metrics: [
        { label: 'Runs (7d)', value: '0', trend: '0%' },
        { label: 'Pass Rate', value: '0%', trend: '0%' },
        { label: 'Avg p95', value: '0ms', trend: '0%' },
        { label: 'Failing Scenarios', value: '0', trend: '0' },
      ],
    }
    persistData(next)
    set({ data: next })
  },

  updateWorkspaceMeta: (environment, runner) => {
    const current = get().data
    if (!current) return
    const next: AppData = {
      ...current,
      environment: environment.trim(),
      runner: runner.trim(),
    }
    persistData(next)
    set({ data: next })
  },

  createScenario: (input) => {
    const current = get().data
    if (!current) return

    const next: AppData = {
      ...current,
      scenarios: [...current.scenarios, { id: buildId('scn'), ...input }],
    }
    persistData(next)
    set({ data: next })
  },

  updateScenario: (id, input) => {
    const current = get().data
    if (!current) return

    const next: AppData = {
      ...current,
      scenarios: current.scenarios.map((item) => (item.id === id ? { id, ...input } : item)),
    }
    persistData(next)
    set({ data: next })
  },

  addApiRequest: (input) => {
    const current = get().data
    if (!current) return
    const next: AppData = {
      ...current,
      apiRequests: [
        ...current.apiRequests,
        {
          ...input,
          id: buildId('req'),
          testCases: input.testCases ?? [],
        },
      ],
    }
    persistData(next)
    set({ data: next })
  },

  updateApiRequest: (id, input) => {
    const current = get().data
    if (!current) return
    const next: AppData = {
      ...current,
      apiRequests: current.apiRequests.map((item) => (item.id === id ? { id, ...input } : item)),
    }
    persistData(next)
    set({ data: next })
  },

  removeApiRequest: (id) => {
    const current = get().data
    if (!current) return
    const next: AppData = {
      ...current,
      apiRequests: current.apiRequests.filter((item) => item.id !== id),
    }
    persistData(next)
    set({ data: next })
  },

  addMatrixRow: (input) => {
    const current = get().data
    if (!current) return

    const next: AppData = {
      ...current,
      matrixRows: [...current.matrixRows, { id: buildId('mx'), ...input }],
    }
    persistData(next)
    set({ data: next })
  },

  updateMatrixRow: (id, input) => {
    const current = get().data
    if (!current) return

    const next: AppData = {
      ...current,
      matrixRows: current.matrixRows.map((item) => (item.id === id ? { id, ...input } : item)),
    }
    persistData(next)
    set({ data: next })
  },

  removeMatrixRow: (id) => {
    const current = get().data
    if (!current) return

    const next: AppData = {
      ...current,
      matrixRows: current.matrixRows.filter((row) => row.id !== id),
    }
    persistData(next)
    set({ data: next })
  },

  addThreshold: (input) => {
    const current = get().data
    if (!current) return

    const next: AppData = {
      ...current,
      thresholdRows: [...current.thresholdRows, { id: buildId('th'), ...input }],
    }
    persistData(next)
    set({ data: next })
  },

  updateThreshold: (id, input) => {
    const current = get().data
    if (!current) return

    const next: AppData = {
      ...current,
      thresholdRows: current.thresholdRows.map((item) => (item.id === id ? { id, ...input } : item)),
    }
    persistData(next)
    set({ data: next })
  },

  removeThreshold: (id) => {
    const current = get().data
    if (!current) return

    const next: AppData = {
      ...current,
      thresholdRows: current.thresholdRows.filter((row) => row.id !== id),
    }
    persistData(next)
    set({ data: next })
  },

  toggleThreshold: (id) => {
    const current = get().data
    if (!current) return

    const next: AppData = {
      ...current,
      thresholdRows: current.thresholdRows.map((row) =>
        row.id === id ? { ...row, enabled: !row.enabled } : row,
      ),
    }
    persistData(next)
    set({ data: next })
  },
}))
