import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import type {
  AppData,
  Collection,
  CorrelationRule,
  CriteriaToggleKey,
  HttpBatchItem,
  HttpOutputPayload,
  K6RunHistoryEntry,
  K6RunHistoryMetrics,
  PerfCriteria,
  PerfCriteriaPatch,
  Project,
  RequestDefinition,
  RequestTestCase,
  RuntimeDiagnostics,
} from '../models/types'
import { extractGlobalMetricsFromSummary } from '../k6/summaryMetrics'
import { extractAggregateMetricsExcludingReport } from '../k6/summaryPerRequest'
import { buildWorkspaceCollectionK6Script, buildWorkspaceK6Script } from './k6/workspaceGenerator'
import { EMPTY_K6_PLACEHOLDER, isRunnableK6Script } from './k6ScriptRunnable'
import { buildPerfMixCollectionExportJson } from './collectionIo'
import { collectionToCurlSh, requestToCurl } from './curlExport'
import { ImportCollectionModal, ImportCurlModal, ImportJmxModal, ImportHarModal, ImportOpenApiModal, ImportPostmanModal, ImportUnifiedModal } from './components/WorkspaceImportDialogs'
import { WorkspaceConfirmModal, WorkspaceInputModal } from './components/WorkspaceConfirmModal'
import { buildTemplateContextFromAppState, runSingleRequestHttpPipeline } from './workspaceHttpPipeline'
import { applyJmeterJsr223PostProcessorShim } from './jmeterJsr223PostShim'
import {
  applyCorrelationRulesToRuntime,
  correlationRulesForCollectionRequests,
  maybeFillKeycloakExecutionFromAuthHtml,
  maybeFillEuumpAccessTokenFromAuthorizeTokenResponse,
  maybeFillAccessTokensFromRemappedAuthorizationHeader,
  maybeFillOAuthAuthorizationCodeFromLocationHeader,
  maybeFillOAuthRedirectUriFromAuthUrl,
  syncEuumpJwtFromRuntimeIntoCollectionVars,
} from './workspaceCorrelationRuntime'
import { WorkspaceTopBar } from './components/WorkspaceTopBar'
import { WorkspaceLeftSidebar } from './components/WorkspaceLeftSidebar'
import { WorkspaceRequestPanel } from './components/WorkspaceRequestPanel'
import { WorkspaceRightPanel } from './components/WorkspaceRightPanel'
import { WorkspaceBottomPanel } from './components/WorkspaceBottomPanel'
import { WorkspaceScriptViewer } from './components/WorkspaceScriptViewer'
import { WorkspaceAssistantPanel } from './components/WorkspaceAssistantPanel'
import { WorkspaceReportingPanel } from './components/WorkspaceReportingPanel'
import { WorkspaceDocsPanel } from './components/WorkspaceDocsPanel'
import { CommandPalette } from './components/CommandPalette'
import { buildWorkspaceRunLabelStem } from './runLabel'
import {
  DEFAULT_K6_LOAD_DURATION,
  DEFAULT_K6_LOAD_FIELDS,
  DEFAULT_K6_LOAD_RAMP_UP,
  DEFAULT_K6_LOAD_VUS,
} from './k6LoadDefaults'
import { tauriHttpCookieSessionDrop } from '../desktop/tauriBridge'

function newHttpCookieSessionId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `http-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
  }
}

/** Persist only collection variable keys that existed before this Send (no runtime-only keys). */
function pickPersistedCollectionVariables(
  keysAtStart: ReadonlySet<string>,
  shared: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of keysAtStart) {
    if (Object.prototype.hasOwnProperty.call(shared, k)) out[k] = shared[k] ?? ''
  }
  return out
}

function buildId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

/** Resolve active project/collection/request from persisted workspace data (avoids stale React closure after Zustand updates). */
function resolveWorkspaceForRegen(
  data: AppData | null | undefined,
  activeProjectId: string | null,
  activeCollectionId: string | null,
  activeRequestId: string | null,
): { project: Project | null; collection: Collection | null; request: RequestDefinition | null } {
  if (!data?.projects?.length) return { project: null, collection: null, request: null }
  const pid = activeProjectId ?? data.activeProjectId ?? data.projects[0]?.id
  const project = data.projects.find((p) => p.id === pid) ?? data.projects[0] ?? null
  if (!project) return { project: null, collection: null, request: null }
  const cid = activeCollectionId ?? project.collections[0]?.id ?? null
  const collection = project.collections.find((c) => c.id === cid) ?? project.collections[0] ?? null
  if (!collection) return { project, collection: null, request: null }
  const rid = activeRequestId ?? collection.requests[0]?.id ?? null
  const request =
    (rid != null ? collection.requests.find((r) => r.id === rid) : null) ?? collection.requests[0] ?? null
  return { project, collection, request }
}

type MainTab = 'builder' | 'script' | 'assistant' | 'reporting' | 'docs'
type BottomTab = 'output' | 'logs'

type Props = {
  userEmail: string | null
  /** Shown in top bar: username when available, else email */
  userDisplay: string | null
  diagnostics: RuntimeDiagnostics | null
  onLoadDiagnostics: () => void
  onLogout: () => void
}

export function WorkspaceApp(props: Props) {
  const data = useAppStore((state) => state.data)
  const replaceWorkspaceData = useAppStore((state) => state.replaceWorkspaceData)
  const setGeneratedScript = useAppStore((state) => state.setGeneratedScript)
  const executeK6Run = useAppStore((state) => state.executeK6Run)
  const stopK6Run = useAppStore((state) => state.stopK6Run)
  const appendK6RunHistory = useAppStore((state) => state.appendK6RunHistory)
  const deleteK6RunHistoryEntry = useAppStore((state) => state.deleteK6RunHistoryEntry)
  const deleteK6RunHistoryEntriesByRunId = useAppStore((state) => state.deleteK6RunHistoryEntriesByRunId)
  const setK6VerboseLogs = useAppStore((state) => state.setK6VerboseLogs)
  const k6VerboseLogs = useAppStore((state) => state.k6VerboseLogs)
  const lastRunStatus = useAppStore((state) => state.lastRunStatus)
  const lastRunId = useAppStore((state) => state.lastRunId)
  const runLogs = useAppStore((state) => state.runLogs)
  const clearRunLogs = useAppStore((state) => state.clearRunLogs)

  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null)
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
  const [activeTcId, setActiveTcId] = useState<string | null>(null)
  const [mainTab, setMainTab] = useState<MainTab>('builder')
  const [bottomTab, setBottomTab] = useState<BottomTab>('output')
  const [runPurpose, setRunPurpose] = useState<'performance' | 'smoke'>('performance')
  const [exportTarget, setExportTarget] = useState<'request' | 'collection'>('request')
  const [generatedScript, setLocalScript] = useState('')
  const [bottomCollapsed, setBottomCollapsed] = useState(false)
  const [bottomHeight, setBottomHeight] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const [httpOutput, setHttpOutput] = useState<HttpOutputPayload | null>(null)
  const [httpSending, setHttpSending] = useState(false)
  const [httpClientLogs, setHttpClientLogs] = useState<string[]>([])
  const [importCurlOpen, setImportCurlOpen] = useState(false)
  const [importCollectionOpen, setImportCollectionOpen] = useState(false)
  const [importJmxOpen, setImportJmxOpen] = useState(false)
  const [importHarOpen, setImportHarOpen] = useState(false)
  const [importOpenApiOpen, setImportOpenApiOpen] = useState(false)
  const [importPostmanOpen, setImportPostmanOpen] = useState(false)
  const [importUnifiedOpen, setImportUnifiedOpen] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      return (localStorage.getItem('perfmix-theme') as 'dark' | 'light') ?? 'dark'
    } catch { return 'dark' }
  })
  const [removeRequestTarget, setRemoveRequestTarget] = useState<{ collectionId: string; requestId: string } | null>(null)
  const [removeCollectionTarget, setRemoveCollectionTarget] = useState<string | null>(null)
  const [createCollectionModalOpen, setCreateCollectionModalOpen] = useState(false)
  const [createProjectModalOpen, setCreateProjectModalOpen] = useState(false)
  const [deleteAllModalOpen, setDeleteAllModalOpen] = useState(false)
  const [k6Output, setK6Output] = useState<{
    at: string
    runId: string | null
    status: string
    metrics: K6RunHistoryMetrics
    hint?: string
  } | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const toastHideTimer = useRef<number | null>(null)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    const startY = e.clientY
    const startH = bottomHeight ?? rootRef.current?.querySelector<HTMLElement>('.ws-bottom')?.offsetHeight ?? 200

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return
      const delta = startY - ev.clientY
      const next = Math.max(48, Math.min(startH + delta, window.innerHeight * 0.7))
      setBottomHeight(next)
      setBottomCollapsed(false)
    }
    const onUp = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [bottomHeight])

  const regenTimer = useRef<number | null>(null)
  const flushRegenerateRef = useRef<() => void>(() => {})

  useEffect(() => {
    void props.onLoadDiagnostics()
    const timer = window.setInterval(() => {
      void props.onLoadDiagnostics()
    }, 60000)
    return () => window.clearInterval(timer)
  }, [props.onLoadDiagnostics])

  // Global keyboard shortcut: Ctrl+K / Cmd+K → command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setCommandPaletteOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    return () => {
      if (toastHideTimer.current) window.clearTimeout(toastHideTimer.current)
    }
  }, [])

  // Apply theme to root element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('perfmix-theme', theme) } catch { /* ignore */ }
  }, [theme])

  const handleThemeToggle = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }, [])

  useEffect(() => {
    if (!data?.activeProjectId) return
    setActiveProjectId(data.activeProjectId)
  }, [data?.activeProjectId])

  const project = useMemo(() => {
    if (!data?.projects?.length) return null
    const id = activeProjectId ?? data.activeProjectId ?? data.projects[0]?.id
    return data.projects.find((p) => p.id === id) ?? data.projects[0]
  }, [data?.projects, activeProjectId, data?.activeProjectId])

  const collection = useMemo(() => {
    if (!project) return null
    const id = activeCollectionId ?? project.collections[0]?.id ?? null
    return project.collections.find((c) => c.id === id) ?? project.collections[0] ?? null
  }, [project, activeCollectionId])

  const request = useMemo(() => {
    if (!collection) return null
    const id = activeRequestId ?? collection.requests[0]?.id ?? null
    return collection.requests.find((r) => r.id === id) ?? collection.requests[0] ?? null
  }, [collection, activeRequestId])

  const correlationRulesForActiveCollection = useMemo(
    () =>
      correlationRulesForCollectionRequests(
        project?.correlationRules,
        new Set((collection?.requests ?? []).map((r) => r.id)),
      ),
    [project?.correlationRules, collection?.requests],
  )

  const testCase = useMemo(() => {
    if (!request) return null
    if (!request.testCases.length) return null
    const id = activeTcId ?? request.testCases[0]?.id
    return request.testCases.find((t) => t.id === id) ?? request.testCases[0]
  }, [request, activeTcId])

  const requestFingerprint = useMemo(() => {
    if (!request) return ''
    return JSON.stringify({
      id: request.id,
      name: request.name,
      method: request.method,
      url: request.url,
      query: request.query,
      headers: request.headers,
      bodyText: request.bodyText,
      testCases: request.testCases.map((tc) => ({
        id: tc.id,
        name: tc.name,
        vus: tc.vus,
        duration: tc.duration,
        rampUp: tc.rampUp,
        thinkTimeMs: tc.thinkTimeMs,
        thinkTimeEnabled: tc.thinkTimeEnabled,
        criteria: tc.criteria,
        criteriaToggles: tc.criteriaToggles,
      })),
      assertions: request.assertions,
      preRequestScript: request.preRequestScript,
      postRequestScript: request.postRequestScript,
      jmeterJsr223PostProcessors: request.jmeterJsr223PostProcessors,
      excludeFromAggregateReport: request.excludeFromAggregateReport,
    })
  }, [request])

  const collectionFingerprint = useMemo(() => {
    if (!collection) return ''
    return JSON.stringify({
      k6CollectionExecution: collection.k6CollectionExecution ?? 'parallel',
      k6LoadVus: collection.k6LoadVus,
      k6LoadDuration: collection.k6LoadDuration,
      k6LoadRampUp: collection.k6LoadRampUp,
      requests: collection.requests.map((r) => ({
        id: r.id,
        name: r.name,
        method: r.method,
        url: r.url,
        query: r.query,
        headers: r.headers,
        bodyText: r.bodyText,
        excludeFromAggregateReport: r.excludeFromAggregateReport,
        testCases: r.testCases.map((tc) => ({
          id: tc.id,
          name: tc.name,
          vus: tc.vus,
          duration: tc.duration,
          rampUp: tc.rampUp,
          thinkTimeMs: tc.thinkTimeMs,
          thinkTimeEnabled: tc.thinkTimeEnabled,
          criteria: tc.criteria,
          criteriaToggles: tc.criteriaToggles,
        })),
        assertions: r.assertions,
        preRequestScript: r.preRequestScript,
        postRequestScript: r.postRequestScript,
        jmeterJsr223PostProcessors: r.jmeterJsr223PostProcessors,
      })),
    })
  }, [collection])

  const projectVarFingerprint = useMemo(() => JSON.stringify(project?.variables ?? {}), [project])
  const collectionVarFingerprint = useMemo(() => JSON.stringify(collection?.variables ?? {}), [collection])

  const persistProjects = (nextProjects: Project[], nextActiveProjectId?: string) => {
    if (!data) return
    const next = {
      ...data,
      projects: nextProjects,
      activeProjectId: nextActiveProjectId ?? project?.id ?? nextProjects[0]?.id ?? data.activeProjectId,
      schemaVersion: 2,
    }
    replaceWorkspaceData(next)
  }

  const updateProject = (mutator: (draft: Project) => void) => {
    if (!data || !project) return
    const draft = structuredClone(project)
    mutator(draft)
    const nextProjects = (data.projects ?? []).map((p) => (p.id === draft.id ? draft : p))
    persistProjects(nextProjects)
  }

  const renameCollection = (collectionId: string, name: string) => {
    updateProject((draft) => {
      const c = draft.collections.find((x) => x.id === collectionId)
      if (c) c.name = name
    })
  }

  const renameRequest = (collectionId: string, requestId: string, name: string) => {
    updateProject((draft) => {
      const col = draft.collections.find((c) => c.id === collectionId)
      const r = col?.requests.find((x) => x.id === requestId)
      if (r) r.name = name
    })
  }

  const createProject = () => {
    if (!data) return
    setCreateProjectModalOpen(true)
  }

  const handleCreateProjectConfirm = (name: string) => {
    if (!data) return
    const p: Project = {
      id: buildId('proj'),
      name,
      collections: [{ id: buildId('col'), name: 'Default', requests: [], variables: {}, ...DEFAULT_K6_LOAD_FIELDS }],
      correlationRules: [],
      csvMappings: [],
      csvRows: [],
      variables: {},
    }
    persistProjects([...(data.projects ?? []), p], p.id)
    setActiveProjectId(p.id)
  }

  const createCollection = () => {
    if (!project) return
    setCreateCollectionModalOpen(true)
  }

  const handleCreateCollectionConfirm = (name: string) => {
    if (!project) return
    updateProject((draft) => {
      draft.collections.push({ id: buildId('col'), name, requests: [], variables: {}, ...DEFAULT_K6_LOAD_FIELDS })
    })
    setActiveCollectionId(null)
  }

  const createRequest = () => {
    if (!project || !collection) return
    const req: RequestDefinition = {
      id: buildId('req'),
      name: 'New request',
      method: 'GET',
      url: 'https://example.com',
      query: {},
      headers: { 'Content-Type': 'application/json' },
      bodyText: '',
      testCases: [],
      assertions: [],
    }
    updateProject((draft) => {
      const col = draft.collections.find((c) => c.id === collection.id)
      if (!col) return
      col.requests.push(req)
    })
    setActiveRequestId(req.id)
  }

  const openRemoveRequestConfirm = (collectionId: string, requestId: string) => {
    setRemoveRequestTarget({ collectionId, requestId })
  }

  const removeRequestDetails = useMemo(() => {
    if (!removeRequestTarget || !project) return null
    const col = project.collections.find((c) => c.id === removeRequestTarget.collectionId)
    const req = col?.requests.find((r) => r.id === removeRequestTarget.requestId)
    if (!col || !req) return null
    return { collectionName: col.name, method: req.method, name: req.name }
  }, [removeRequestTarget, project])

  const confirmRemoveRequest = () => {
    if (!removeRequestTarget) return
    const { collectionId, requestId } = removeRequestTarget
    updateProject((draft) => {
      const col = draft.collections.find((c) => c.id === collectionId)
      if (!col) return
      col.requests = col.requests.filter((r) => r.id !== requestId)
      draft.correlationRules = draft.correlationRules.filter((r) => r.fromRequestId !== requestId)
    })
    if (activeRequestId === requestId) setActiveRequestId(null)
    queueMicrotask(() => flushRegenerateRef.current())
  }

  const removeCollectionDetails = useMemo(() => {
    if (!removeCollectionTarget || !project) return null
    const col = project.collections.find((c) => c.id === removeCollectionTarget)
    if (!col) return null
    return { name: col.name, requestCount: col.requests.length }
  }, [removeCollectionTarget, project])

  const confirmRemoveCollection = () => {
    if (!data || !project || !removeCollectionTarget) return
    if (project.collections.length < 2) return
    const colId = removeCollectionTarget
    const targetCol = project.collections.find((c) => c.id === colId)
    if (!targetCol) return
    const requestIds = targetCol.requests.map((r) => r.id)
    const remaining = project.collections.filter((c) => c.id !== colId)
    const nextProject = structuredClone(project)
    nextProject.collections = nextProject.collections.filter((c) => c.id !== colId)
    nextProject.correlationRules = nextProject.correlationRules.filter((r) => !requestIds.includes(r.fromRequestId))
    const nextProjects = (data.projects ?? []).map((p) => (p.id === nextProject.id ? nextProject : p))
    const hist: Record<string, K6RunHistoryEntry[]> = { ...(data.k6RunHistoryByRequest ?? {}) }
    for (const rid of requestIds) delete hist[rid]
    replaceWorkspaceData({
      ...data,
      projects: nextProjects,
      k6RunHistoryByRequest: hist,
      schemaVersion: 2,
    })
    if (collection?.id === colId) {
      setActiveCollectionId(remaining[0]?.id ?? null)
    }
    queueMicrotask(() => flushRegenerateRef.current())
  }

  const moveRequest = (collectionId: string, requestId: string, direction: 'up' | 'down') => {
    updateProject((draft) => {
      const col = draft.collections.find((c) => c.id === collectionId)
      if (!col) return
      const idx = col.requests.findIndex((r) => r.id === requestId)
      if (idx === -1) return
      const j = direction === 'up' ? idx - 1 : idx + 1
      if (j < 0 || j >= col.requests.length) return
      const list = col.requests
      const tmp = list[idx]
      list[idx] = list[j]
      list[j] = tmp
    })
  }

  const reorderRequests = (collectionId: string, newRequestIds: string[]) => {
    updateProject((draft) => {
      const col = draft.collections.find((c) => c.id === collectionId)
      if (!col) return
      const map = new Map(col.requests.map((r) => [r.id, r]))
      const reordered = newRequestIds.map((id) => map.get(id)).filter(Boolean) as typeof col.requests
      col.requests = reordered
    })
  }

  const deleteAllCollections = () => {
    setDeleteAllModalOpen(true)
  }

  const handleDeleteAllConfirm = () => {
    const newCol = {
      id: buildId('col'),
      name: 'Default',
      requests: [] as RequestDefinition[],
      variables: {},
      ...DEFAULT_K6_LOAD_FIELDS,
    }
    updateProject((draft) => {
      draft.collections = [newCol]
      draft.correlationRules = []
    })
    setActiveCollectionId(newCol.id)
    setActiveRequestId(null)
  }

  const patchActiveCollectionK6 = (
    patch: Partial<Pick<Collection, 'k6CollectionExecution' | 'k6LoadVus' | 'k6LoadDuration' | 'k6LoadRampUp'>>,
  ) => {
    if (!collection) return
    updateProject((draft) => {
      const col = draft.collections.find((c) => c.id === collection.id)
      if (!col) return
      if (patch.k6CollectionExecution !== undefined) col.k6CollectionExecution = patch.k6CollectionExecution
      if (patch.k6LoadVus !== undefined) col.k6LoadVus = patch.k6LoadVus
      if (patch.k6LoadDuration !== undefined) col.k6LoadDuration = patch.k6LoadDuration
      if (patch.k6LoadRampUp !== undefined) col.k6LoadRampUp = patch.k6LoadRampUp
    })
  }

  const updateRequest = (patch: Partial<RequestDefinition>) => {
    if (!project || !collection || !request) return
    updateProject((draft) => {
      const col = draft.collections.find((c) => c.id === collection.id)
      const r = col?.requests.find((x) => x.id === request.id)
      if (!r) return
      const row = r as Record<string, unknown>
      for (const key of Object.keys(patch) as (keyof RequestDefinition)[]) {
        const v = patch[key]
        if (v === undefined) delete row[key as string]
        else row[key as string] = v
      }
    })
  }

  const deleteTestCase = (tcId: string) => {
    if (!project || !collection || !request) return
    updateProject((draft) => {
      const col = draft.collections.find((c) => c.id === collection.id)
      const r = col?.requests.find((x) => x.id === request.id)
      if (!r) return
      r.testCases = r.testCases.filter((t) => t.id !== tcId)
    })
    if (activeTcId === tcId) setActiveTcId(null)
  }

  const addTestCase = () => {
    if (!project || !collection || !request) return
    const tc: RequestTestCase = {
      id: buildId('tc'),
      name: `TC ${request.testCases.length + 1}`,
      vus: 5,
      duration: '10m',
      rampUp: '30s',
      thinkTimeMs: 150,
      thinkTimeEnabled: true,
      criteria: {
        maxAvgMs: 800,
        maxP95Ms: 1200,
        maxErrorRate: 0.01,
        minThroughputRps: 1,
      },
      criteriaToggles: {
        maxAvgMs: true,
        maxP95Ms: true,
        maxP99Ms: false,
        maxErrorRate: true,
        minThroughputRps: true,
      },
    }
    updateProject((draft) => {
      const col = draft.collections.find((c) => c.id === collection.id)
      const r = col?.requests.find((x) => x.id === request.id)
      if (!r) return
      r.testCases.push(tc)
    })
    setActiveTcId(tc.id)
  }

  const updateTestCase = (tcId: string, patch: Partial<RequestTestCase>) => {
    if (!project || !collection || !request) return
    updateProject((draft) => {
      const col = draft.collections.find((c) => c.id === collection.id)
      const r = col?.requests.find((x) => x.id === request.id)
      const tc = r?.testCases.find((t) => t.id === tcId)
      if (!tc) return
      Object.assign(tc, patch)
    })
  }

  const updateCriteria = (tcId: string, patch: PerfCriteriaPatch) => {
    if (!project || !collection || !request) return
    updateProject((draft) => {
      const col = draft.collections.find((c) => c.id === collection.id)
      const r = col?.requests.find((x) => x.id === request.id)
      const tc = r?.testCases.find((t) => t.id === tcId)
      if (!tc) return
      const cur: PerfCriteria = { ...(tc.criteria ?? {}) }
      for (const [rawKey, v] of Object.entries(patch) as [keyof PerfCriteria, number | null | undefined][]) {
        if (v === null) {
          delete cur[rawKey]
          if (rawKey === 'maxAvgMs') delete tc.maxAvgMs
          if (rawKey === 'maxP95Ms') delete tc.maxP95Ms
          if (rawKey === 'maxErrorRate') delete tc.maxErrorRate
        } else if (typeof v === 'number' && Number.isFinite(v)) {
          cur[rawKey] = v
        } else if (typeof v === 'number' && Number.isNaN(v)) {
          delete cur[rawKey]
        }
      }
      tc.criteria = Object.keys(cur).length ? cur : undefined
    })
  }

  const setCriterionMetricEnabled = (tcId: string, key: CriteriaToggleKey, enabled: boolean) => {
    if (!project || !collection || !request) return
    updateProject((draft) => {
      const col = draft.collections.find((c) => c.id === collection.id)
      const r = col?.requests.find((x) => x.id === request.id)
      const tc = r?.testCases.find((t) => t.id === tcId)
      if (!tc) return
      tc.criteriaToggles = { ...(tc.criteriaToggles ?? {}), [key]: enabled }
      if (!enabled) {
        const cur: PerfCriteria = { ...(tc.criteria ?? {}) }
        delete cur[key]
        tc.criteria = Object.keys(cur).length ? cur : undefined
        if (key === 'maxAvgMs') delete tc.maxAvgMs
        if (key === 'maxP95Ms') delete tc.maxP95Ms
        if (key === 'maxErrorRate') delete tc.maxErrorRate
      }
    })
  }

  const setThinkTimeEnabled = (tcId: string, enabled: boolean) => {
    if (!project || !collection || !request) return
    updateProject((draft) => {
      const col = draft.collections.find((c) => c.id === collection.id)
      const r = col?.requests.find((x) => x.id === request.id)
      const tc = r?.testCases.find((t) => t.id === tcId)
      if (!tc) return
      tc.thinkTimeEnabled = enabled
    })
  }

  const addCorrelationRule = () => {
    if (!project || !request) return
    const rule: CorrelationRule = {
      id: buildId('corr'),
      variableName: 'auth_token',
      fromRequestId: request.id,
      kind: 'jsonpath',
      jsonPath: '$.token',
    }
    updateProject((draft) => {
      draft.correlationRules.push(rule)
    })
  }

  const updateCorrelationRule = (id: string, patch: Partial<CorrelationRule>) => {
    if (!project) return
    updateProject((draft) => {
      const r = draft.correlationRules.find((x) => x.id === id)
      if (!r) return
      Object.assign(r, patch)
    })
  }

  const removeCorrelationRule = (id: string) => {
    if (!project) return
    updateProject((draft) => {
      draft.correlationRules = draft.correlationRules.filter((r) => r.id !== id)
    })
  }

  const doRegenerate = useCallback(() => {
    const d = useAppStore.getState().data
    const { project: proj, collection: col, request: req } = resolveWorkspaceForRegen(
      d,
      activeProjectId,
      activeCollectionId,
      activeRequestId,
    )
    if (!d || !proj || !col) return
    const csvRows = d.csvRows ?? proj.csvRows ?? []
    let script = ''
    if (exportTarget === 'collection') {
      script = !col.requests.length
        ? EMPTY_K6_PLACEHOLDER
        : buildWorkspaceCollectionK6Script({
            project: proj,
            collection: col,
            activeEnvironment: d.environment,
            envVariables: d.envVariables,
            sharedVariables: d.sharedVariables,
            csvRows,
            runPurpose,
          })
    } else if (!req) {
      script = EMPTY_K6_PLACEHOLDER
    } else {
      script = buildWorkspaceK6Script({
        project: proj,
        collection: col,
        request: req,
        activeEnvironment: d.environment,
        envVariables: d.envVariables,
        sharedVariables: d.sharedVariables,
        csvRows,
        runPurpose,
      })
    }
    setLocalScript(script)
    setGeneratedScript(script)
  }, [activeProjectId, activeCollectionId, activeRequestId, exportTarget, runPurpose, setGeneratedScript])

  const flushRegenerate = useCallback(() => {
    if (regenTimer.current) {
      window.clearTimeout(regenTimer.current)
      regenTimer.current = null
    }
    doRegenerate()
  }, [doRegenerate])

  flushRegenerateRef.current = flushRegenerate

  useEffect(() => {
    if (regenTimer.current) window.clearTimeout(regenTimer.current)
    regenTimer.current = window.setTimeout(() => {
      doRegenerate()
    }, 350)
    return () => {
      if (regenTimer.current) window.clearTimeout(regenTimer.current)
    }
  }, [
    doRegenerate,
    data?.environment,
    exportTarget,
    requestFingerprint,
    collectionFingerprint,
    projectVarFingerprint,
    collectionVarFingerprint,
  ])

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg)
    if (toastHideTimer.current) window.clearTimeout(toastHideTimer.current)
    toastHideTimer.current = window.setTimeout(() => {
      setToastMessage(null)
      toastHideTimer.current = null
    }, 3200)
  }, [])

  const commitTestCasesAndNotify = useCallback(() => {
    flushRegenerate()
    showToast('Test cases saved — script updated')
  }, [flushRegenerate, showToast])

  const sendCollectionHttp = useCallback(
    async (collectionId: string) => {
      if (!data || !project) return
      const col = project.collections.find((c) => c.id === collectionId)
      if (!col?.requests.length) return
      setHttpSending(true)
      const sharedCollectionVars = { ...(col.variables ?? {}) }
      const collectionVarKeysAtStart = new Set(Object.keys(col.variables ?? {}))
      const cookieSessionId = newHttpCookieSessionId()
      const sharedRuntimeEnv: Record<string, string> = {}
      const sharedVariableOverrides: Record<string, string> = {}
      const batchLogs: string[] = []
      const scopedCorrelation = correlationRulesForCollectionRequests(
        project.correlationRules,
        new Set(col.requests.map((r) => r.id)),
      )
      try {
        const at = new Date().toISOString()
        const items: HttpBatchItem[] = []
        for (const req of col.requests) {
          const templateCtx = buildTemplateContextFromAppState({
            activeEnvironment: data.environment,
            envVariables: data.envVariables,
            sharedVariables: data.sharedVariables,
            collectionVariables: sharedCollectionVars,
            projectVariables: project.variables ?? {},
          })
          templateCtx.runtimeVarOverrides = sharedRuntimeEnv
          templateCtx.variableOverrides = sharedVariableOverrides
          templateCtx.httpCookieSessionId = cookieSessionId
          const pipeline = await runSingleRequestHttpPipeline({ request: req, templateCtx, cookieSessionId })
          applyCorrelationRulesToRuntime(
            sharedRuntimeEnv,
            scopedCorrelation,
            req.id,
            pipeline.result,
            pipeline.resolvedUrl,
          )
          maybeFillKeycloakExecutionFromAuthHtml(sharedRuntimeEnv, pipeline.result)
          maybeFillOAuthRedirectUriFromAuthUrl(sharedRuntimeEnv, pipeline.resolvedUrl)
          maybeFillOAuthAuthorizationCodeFromLocationHeader(sharedRuntimeEnv, pipeline.result)
          maybeFillEuumpAccessTokenFromAuthorizeTokenResponse(sharedRuntimeEnv, pipeline.result, pipeline.resolvedUrl)
          maybeFillAccessTokensFromRemappedAuthorizationHeader(
            sharedRuntimeEnv,
            pipeline.result,
            pipeline.resolvedUrl,
          )
          syncEuumpJwtFromRuntimeIntoCollectionVars(sharedRuntimeEnv, sharedCollectionVars)
          const jsr223Logs: string[] = []
          applyJmeterJsr223PostProcessorShim(sharedRuntimeEnv, jsr223Logs, req.jmeterJsr223PostProcessors)
          batchLogs.push(`--- ${req.name} ---`, ...pipeline.scriptLogs)
          if (jsr223Logs.length) batchLogs.push(...jsr223Logs)
          items.push({
            requestName: req.name,
            method: pipeline.method,
            url: pipeline.resolvedUrl,
            result: pipeline.result,
            requestHeaders: pipeline.requestHeaders,
            requestBody: pipeline.requestBody,
            assertionResults: pipeline.assertionResults,
            scriptError: pipeline.scriptError,
            scriptLogs: pipeline.scriptLogs.length ? pipeline.scriptLogs : undefined,
          })
        }
        setHttpClientLogs((prev) => [...prev, ...batchLogs])
        startTransition(() => {
          setHttpOutput({ kind: 'batch', at, collectionName: col.name, items })
          setBottomTab('output')
        })
      } finally {
        updateProject((draft) => {
          const c = draft.collections.find((x) => x.id === collectionId)
          if (c) c.variables = pickPersistedCollectionVariables(collectionVarKeysAtStart, sharedCollectionVars)
        })
        void tauriHttpCookieSessionDrop(cookieSessionId)
        setHttpSending(false)
      }
    },
    [data, project],
  )

  const sendActiveRequest = useCallback(async () => {
    if (!data || !project || !collection || !request) return
    setHttpSending(true)
    const sharedCollectionVars = { ...(collection.variables ?? {}) }
    const collectionVarKeysAtStart = new Set(Object.keys(collection.variables ?? {}))
    const cookieSessionId = newHttpCookieSessionId()
    try {
      const sharedRuntimeEnv: Record<string, string> = {}
      const scopedCorrelation = correlationRulesForCollectionRequests(
        project.correlationRules,
        new Set(collection.requests.map((r) => r.id)),
      )
      const activeIdx = collection.requests.findIndex((r) => r.id === request.id)
      const prereqLogs: string[] = []
      for (let i = 0; i < activeIdx; i++) {
        const rq = collection.requests[i]
        const preCtx = buildTemplateContextFromAppState({
          activeEnvironment: data.environment,
          envVariables: data.envVariables,
          sharedVariables: data.sharedVariables,
          collectionVariables: sharedCollectionVars,
          projectVariables: project.variables ?? {},
        })
        preCtx.runtimeVarOverrides = sharedRuntimeEnv
        preCtx.variableOverrides = {}
        preCtx.httpCookieSessionId = cookieSessionId
        const prePipe = await runSingleRequestHttpPipeline({ request: rq, templateCtx: preCtx, cookieSessionId })
        applyCorrelationRulesToRuntime(
          sharedRuntimeEnv,
          scopedCorrelation,
          rq.id,
          prePipe.result,
          prePipe.resolvedUrl,
        )
        maybeFillKeycloakExecutionFromAuthHtml(sharedRuntimeEnv, prePipe.result)
        maybeFillOAuthRedirectUriFromAuthUrl(sharedRuntimeEnv, prePipe.resolvedUrl)
        maybeFillOAuthAuthorizationCodeFromLocationHeader(sharedRuntimeEnv, prePipe.result)
        maybeFillEuumpAccessTokenFromAuthorizeTokenResponse(sharedRuntimeEnv, prePipe.result, prePipe.resolvedUrl)
        maybeFillAccessTokensFromRemappedAuthorizationHeader(
          sharedRuntimeEnv,
          prePipe.result,
          prePipe.resolvedUrl,
        )
        syncEuumpJwtFromRuntimeIntoCollectionVars(sharedRuntimeEnv, sharedCollectionVars)
        const jsr223PreLogs: string[] = []
        applyJmeterJsr223PostProcessorShim(sharedRuntimeEnv, jsr223PreLogs, rq.jmeterJsr223PostProcessors)
        prereqLogs.push(`--- ${rq.name} (prerequisite for Send) ---`, ...prePipe.scriptLogs)
        if (jsr223PreLogs.length) prereqLogs.push(...jsr223PreLogs)
      }

      const templateCtx = buildTemplateContextFromAppState({
        activeEnvironment: data.environment,
        envVariables: data.envVariables,
        sharedVariables: data.sharedVariables,
        collectionVariables: sharedCollectionVars,
        projectVariables: project.variables ?? {},
      })
      templateCtx.runtimeVarOverrides = sharedRuntimeEnv
      templateCtx.variableOverrides = {}
      templateCtx.httpCookieSessionId = cookieSessionId
      const pipeline = await runSingleRequestHttpPipeline({ request, templateCtx, cookieSessionId })
      maybeFillOAuthRedirectUriFromAuthUrl(sharedRuntimeEnv, pipeline.resolvedUrl)
      applyCorrelationRulesToRuntime(
        sharedRuntimeEnv,
        scopedCorrelation,
        request.id,
        pipeline.result,
        pipeline.resolvedUrl,
      )
      maybeFillKeycloakExecutionFromAuthHtml(sharedRuntimeEnv, pipeline.result)
      maybeFillOAuthAuthorizationCodeFromLocationHeader(sharedRuntimeEnv, pipeline.result)
      maybeFillEuumpAccessTokenFromAuthorizeTokenResponse(sharedRuntimeEnv, pipeline.result, pipeline.resolvedUrl)
      maybeFillAccessTokensFromRemappedAuthorizationHeader(
        sharedRuntimeEnv,
        pipeline.result,
        pipeline.resolvedUrl,
      )
      syncEuumpJwtFromRuntimeIntoCollectionVars(sharedRuntimeEnv, sharedCollectionVars)
      const jsr223ActiveLogs: string[] = []
      applyJmeterJsr223PostProcessorShim(sharedRuntimeEnv, jsr223ActiveLogs, request.jmeterJsr223PostProcessors)
      const allLogs = [...prereqLogs, `--- ${request.name} ---`, ...pipeline.scriptLogs, ...jsr223ActiveLogs]
      if (allLogs.length) {
        setHttpClientLogs((prev) => [...prev, ...allLogs])
      }
      startTransition(() => {
        setHttpOutput({
          kind: 'single',
          method: pipeline.method,
          url: pipeline.resolvedUrl,
          at: new Date().toISOString(),
          result: pipeline.result,
          requestHeaders: pipeline.requestHeaders,
          requestBody: pipeline.requestBody,
          assertionResults: pipeline.assertionResults,
          scriptError: pipeline.scriptError,
          scriptLogs: pipeline.scriptLogs.length ? pipeline.scriptLogs : undefined,
        })
        setBottomTab('output')
      })
    } finally {
      updateProject((draft) => {
        const c = draft.collections.find((x) => x.id === collection.id)
        if (c) c.variables = pickPersistedCollectionVariables(collectionVarKeysAtStart, sharedCollectionVars)
      })
      void tauriHttpCookieSessionDrop(cookieSessionId)
      setHttpSending(false)
    }
  }, [data, project, collection, request])

  const run = async () => {
    props.onLoadDiagnostics()
    flushRegenerate()
    const scriptAfterFlush = useAppStore.getState().generatedScript
    if (!isRunnableK6Script(scriptAfterFlush)) {
      const msg =
        'No executable k6 code to run. The script is empty, comments only, or still the “no requests” placeholder. Add requests (with a URL), then regenerate on the Generated k6 tab.'
      showToast(msg)
      useAppStore.setState({
        error: null,
        lastRunId: null,
        lastRunStatus: 'failed',
        lastSummaryJson: null,
        lastSummaryPath: null,
        lastReportHtmlPath: null,
        runLogs: [msg],
      })
      setK6Output({
        at: new Date().toISOString(),
        runId: null,
        status: 'failed',
        metrics: { avgMs: null, p95Ms: null, errorRate: null, rps: null },
        hint: msg,
      })
      setBottomTab('output')
      return
    }
    try {
      const runStem = buildWorkspaceRunLabelStem({
        exportTarget,
        collectionName: collection?.name ?? 'collection',
        requestName: request?.name,
      })
      const result = await executeK6Run(runStem)
      const st = useAppStore.getState()
      let metrics
      try {
        metrics =
          exportTarget === 'collection'
            ? extractAggregateMetricsExcludingReport(st.lastSummaryJson)
            : extractGlobalMetricsFromSummary(st.lastSummaryJson)
      } catch {
        metrics = { avgMs: null, p95Ms: null, errorRate: null, rps: null }
      }
      const hint =
        !result.runId && result.status === 'failed' && st.runLogs[0]
          ? st.runLogs[0]
          : undefined
      setK6Output({
        at: new Date().toISOString(),
        runId: result.runId,
        status: result.status,
        metrics,
        ...(hint ? { hint } : {}),
      })
      setBottomTab('output')

      if (result.runId && (result.status === 'passed' || result.status === 'failed') && request && collection) {
        const requestIds =
          exportTarget === 'collection' ? collection.requests.map((r) => r.id) : [request.id]
        appendK6RunHistory({
          requestIds,
          collectionId: collection.id,
          scope: exportTarget === 'collection' ? 'collection' : 'request',
          runId: result.runId,
          status: result.status,
          summaryJson: st.lastSummaryJson,
        })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      showToast(`Run failed unexpectedly: ${msg}`)
      setBottomTab('output')
    }
  }

  if (!data || !project) {
    return (
      <div className="boot-screen">
        <div>
          <p>Loading workspace…</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="ws-root"
      ref={rootRef}
      style={bottomHeight != null && !bottomCollapsed ? { gridTemplateRows: `auto 1fr auto ${bottomHeight}px` } : undefined}
    >
      <WorkspaceTopBar
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        userEmail={props.userEmail}
        userDisplay={props.userDisplay}
        projects={data.projects ?? []}
        activeProjectId={project.id}
        environment={data.environment}
        onSelectProject={(id) => {
          setActiveProjectId(id)
          persistProjects(data.projects ?? [], id)
        }}
        onCreateProject={createProject}
        onEnvironmentChange={(env) => {
          replaceWorkspaceData({ ...data, environment: env })
        }}
        onRun={() => void run()}
        exportTarget={exportTarget}
        onExportTargetChange={setExportTarget}
        onExport={() => {
          if (!collection) return
          if (exportTarget === 'request' && !request) return
          flushRegenerate()
          const csvRows = data.csvRows ?? project.csvRows ?? []
          const freshScript =
            exportTarget === 'collection'
              ? buildWorkspaceCollectionK6Script({ project, collection, activeEnvironment: data.environment, envVariables: data.envVariables, sharedVariables: data.sharedVariables, csvRows, runPurpose })
              : buildWorkspaceK6Script({ project, collection, request: request!, activeEnvironment: data.environment, envVariables: data.envVariables, sharedVariables: data.sharedVariables, csvRows, runPurpose })
          if (!freshScript.trim()) {
            showToast('No script generated — check that you have a valid request URL.')
            return
          }
          const blob = new Blob([freshScript], { type: 'text/javascript;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          const suffix =
            exportTarget === 'collection' ? `${project.name}_${collection.name}` : `${project.name}_${request!.name}`
          const dateStr = new Date().toISOString().slice(0, 10)
          a.download = `${suffix.replace(/\s+/g, '_')}_${dateStr}.k6.js`
          a.click()
          URL.revokeObjectURL(url)
          showToast('Downloaded to your default Downloads folder')
        }}
        onExportCurl={() => {
          if (!collection) return
          if (exportTarget === 'request' && !request) return
          const text = exportTarget === 'collection' ? collectionToCurlSh(collection) : requestToCurl(request!)
          const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          const suffix =
            exportTarget === 'collection' ? `${project.name}_${collection.name}` : `${project.name}_${request!.name}`
          const dateStr = new Date().toISOString().slice(0, 10)
          a.download = `${suffix.replace(/\s+/g, '_')}_${dateStr}.curl.sh`
          a.click()
          URL.revokeObjectURL(url)
          showToast('Exported cURL')
        }}
        onLogout={props.onLogout}
        runPurpose={runPurpose}
        onRunPurposeChange={setRunPurpose}
        collectionExecution={collection?.k6CollectionExecution ?? 'parallel'}
        onCollectionExecutionChange={(v) => patchActiveCollectionK6({ k6CollectionExecution: v })}
        collectionLoadVus={collection?.k6LoadVus ?? DEFAULT_K6_LOAD_VUS}
        collectionLoadDuration={collection?.k6LoadDuration ?? DEFAULT_K6_LOAD_DURATION}
        collectionLoadRampUp={collection?.k6LoadRampUp ?? DEFAULT_K6_LOAD_RAMP_UP}
        onCollectionLoadChange={(next) => patchActiveCollectionK6(next)}
        theme={theme}
        onThemeToggle={handleThemeToggle}
      />

      <div className="ws-body">
        <WorkspaceLeftSidebar
          project={project}
          activeCollectionId={collection?.id ?? null}
          activeRequestId={request?.id ?? null}
          onSelectCollection={(id) => setActiveCollectionId(id)}
          onSelectRequest={(id) => setActiveRequestId(id)}
          onCreateCollection={createCollection}
          onCreateRequest={createRequest}
          onRenameCollection={renameCollection}
          onRenameRequest={renameRequest}
          onSendCollectionRequests={(id) => void sendCollectionHttp(id)}
          onOpenImportCurl={() => setImportCurlOpen(true)}
          onOpenImportCollection={() => setImportCollectionOpen(true)}
          onOpenImportJmx={() => setImportJmxOpen(true)}
          onOpenImportHar={() => setImportHarOpen(true)}
          onOpenImportOpenApi={() => setImportOpenApiOpen(true)}
          onOpenImportPostman={() => setImportPostmanOpen(true)}
          onOpenImportUnified={() => setImportUnifiedOpen(true)}
          onExportCollectionJson={(collectionId) => {
            const col = project.collections.find((c) => c.id === collectionId)
            if (!col) return
            const scopedExportRules = correlationRulesForCollectionRequests(
              project.correlationRules,
              new Set(col.requests.map((r) => r.id)),
            )
            const blob = new Blob(
              [
                buildPerfMixCollectionExportJson(
                  col,
                  scopedExportRules.length ? scopedExportRules : undefined,
                ),
              ],
              { type: 'application/json;charset=utf-8' },
            )
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            const dateStr = new Date().toISOString().slice(0, 10)
            a.download = `${(col.name || 'collection').replace(/\s+/g, '_')}_${dateStr}.perfmix.json`
            a.click()
            URL.revokeObjectURL(url)
            showToast('Exported collection JSON')
          }}
          onDeleteRequest={openRemoveRequestConfirm}
          onDeleteCollection={(id) => setRemoveCollectionTarget(id)}
          onDeleteAllCollections={deleteAllCollections}
          onMoveRequest={moveRequest}
          onReorderRequests={reorderRequests}
        />

        <section className="ws-center-wrap">
          <div className="ws-main-tabs">
            <button type="button" className={mainTab === 'builder' ? 'ws-main-tab active' : 'ws-main-tab'} onClick={() => setMainTab('builder')}>
              Request
            </button>
            <button type="button" className={mainTab === 'script' ? 'ws-main-tab active' : 'ws-main-tab'} onClick={() => setMainTab('script')}>
              Generated k6
            </button>
            <button type="button" className={mainTab === 'reporting' ? 'ws-main-tab active' : 'ws-main-tab'} onClick={() => setMainTab('reporting')}>
              Reporting
            </button>
            <button type="button" className={mainTab === 'assistant' ? 'ws-main-tab active' : 'ws-main-tab'} onClick={() => setMainTab('assistant')}>
              AI assistant
            </button>
            <button type="button" className={mainTab === 'docs' ? 'ws-main-tab active' : 'ws-main-tab'} onClick={() => setMainTab('docs')}>
              Docs
            </button>
          </div>

          <div className="ws-main-body">
            {mainTab === 'builder' ? (
              <WorkspaceRequestPanel
                request={request}
                testCase={testCase}
                uiTheme={theme}
                onChangeRequest={updateRequest}
                onAddTestCase={addTestCase}
                onDeleteTestCase={deleteTestCase}
                onSelectTestCase={(id) => setActiveTcId(id)}
                onChangeTestCase={updateTestCase}
                onChangeCriteria={updateCriteria}
                onSetCriterionToggle={setCriterionMetricEnabled}
                onSetThinkTimeEnabled={setThinkTimeEnabled}
                onCommitTestCases={commitTestCasesAndNotify}
                onSend={() => sendActiveRequest()}
                sending={httpSending}
              />
            ) : null}

            {mainTab === 'script' ? <WorkspaceScriptViewer script={generatedScript} uiTheme={theme} /> : null}

            {mainTab === 'reporting' ? (
              <WorkspaceReportingPanel
                mode={exportTarget === 'collection' ? 'collection' : 'request'}
                request={request}
                collection={collection}
                data={data}
                onDeleteEntry={(requestId, entryId) => {
                  deleteK6RunHistoryEntry(requestId, entryId)
                }}
                onDeleteRunById={(runId) => {
                  deleteK6RunHistoryEntriesByRunId(runId)
                }}
              />
            ) : null}

            {mainTab === 'assistant' ? <WorkspaceAssistantPanel /> : null}

            {mainTab === 'docs' ? (
              <WorkspaceDocsPanel
                project={project}
                collection={collection}
                request={request}
                onChangeProjectDocs={(docs) => updateProject((draft) => { draft.docs = docs })}
                onChangeCollectionDocs={(docs) => {
                  if (!collection) return
                  updateProject((draft) => {
                    const col = draft.collections.find((c) => c.id === collection.id)
                    if (col) col.docs = docs
                  })
                }}
                onChangeRequestDocs={(docs) => {
                  if (!collection || !request) return
                  updateProject((draft) => {
                    const col = draft.collections.find((c) => c.id === collection.id)
                    const req = col?.requests.find((r) => r.id === request.id)
                    if (req) req.docs = docs
                  })
                }}
              />
            ) : null}
          </div>
        </section>

        <WorkspaceRightPanel
          activeEnvironment={data.environment}
          collectionName={collection?.name ?? null}
          collectionVariables={collection?.variables ?? {}}
          projectVariables={project.variables ?? {}}
          envVariables={data.envVariables}
          sharedVariables={data.sharedVariables}
          correlationRules={correlationRulesForActiveCollection}
          requests={collection?.requests ?? []}
          onChangeCollectionVars={(next) => {
            if (!collection) return
            updateProject((draft) => {
              const col = draft.collections.find((c) => c.id === collection.id)
              if (col) col.variables = next
            })
          }}
          onChangeProjectVars={(next) => {
            updateProject((draft) => {
              draft.variables = next
            })
          }}
          onChangeActiveEnvVars={(next) => {
            replaceWorkspaceData({
              ...data,
              envVariables: { ...data.envVariables, [data.environment]: next },
            })
          }}
          onChangeSharedVars={(next) => {
            replaceWorkspaceData({ ...data, sharedVariables: next })
          }}
          onChangeEnvJson={(json) => {
            try {
              const parsed = JSON.parse(json) as Record<string, Record<string, string>>
              replaceWorkspaceData({ ...data, envVariables: parsed })
            } catch {
              // ignore
            }
          }}
          onChangeSharedJson={(json) => {
            try {
              const parsed = JSON.parse(json) as Record<string, string>
              replaceWorkspaceData({ ...data, sharedVariables: parsed })
            } catch {
              // ignore
            }
          }}
          onAddCorrelation={addCorrelationRule}
          onChangeCorrelation={updateCorrelationRule}
          onRemoveCorrelation={removeCorrelationRule}
          onUploadCsv={(text) => {
            const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
            updateProject((draft) => {
              draft.csvRows = lines
            })
            replaceWorkspaceData({ ...data, dataCsv: lines.join('\n'), csvRows: lines })
          }}
        />
      </div>

      <div className="ws-resize-handle" onMouseDown={onDragStart} />

      <WorkspaceBottomPanel
        bottomTab={bottomTab}
        onBottomTab={setBottomTab}
        verbose={k6VerboseLogs}
        onVerboseChange={setK6VerboseLogs}
        diagnostics={props.diagnostics}
        lastRunStatus={lastRunStatus}
        lastRunId={lastRunId}
        logs={runLogs}
        httpClientLogs={httpClientLogs}
        httpOutput={httpOutput}
        httpSending={httpSending}
        k6Output={k6Output}
        onStop={() => void stopK6Run()}
        collapsed={bottomCollapsed}
        onToggleCollapse={() => setBottomCollapsed((p) => !p)}
        onClearLogs={() => {
          clearRunLogs()
          setHttpClientLogs([])
        }}
        onClearOutput={() => {
          setHttpOutput(null)
          setK6Output(null)
          setHttpClientLogs([])
        }}
      />

      <ImportCurlModal
        open={importCurlOpen}
        collections={project.collections}
        defaultCollectionId={collection?.id ?? null}
        onClose={() => setImportCurlOpen(false)}
        onConfirm={(collectionId, newReq) => {
          updateProject((draft) => {
            const col = draft.collections.find((c) => c.id === collectionId)
            if (col) col.requests.push(newReq)
          })
          setActiveCollectionId(collectionId)
          setActiveRequestId(newReq.id)
          showToast('Imported cURL request')
        }}
      />
      <ImportJmxModal
        open={importJmxOpen}
        onClose={() => setImportJmxOpen(false)}
        onConfirm={(newCol, newRules) => {
          updateProject((draft) => {
            draft.collections.push(newCol)
            for (const rule of newRules) {
              draft.correlationRules.push(rule)
            }
          })
          setActiveCollectionId(newCol.id)
          setActiveRequestId(newCol.requests[0]?.id ?? null)
          showToast(
            `Imported ${newCol.requests.length} request${newCol.requests.length !== 1 ? 's' : ''} from JMX` +
              (newRules.length ? ` + ${newRules.length} extract rule(s)` : ''),
          )
        }}
      />

      <ImportHarModal
        open={importHarOpen}
        onClose={() => setImportHarOpen(false)}
        onConfirm={(newCol) => {
          updateProject((draft) => { draft.collections.push(newCol) })
          setActiveCollectionId(newCol.id)
          setActiveRequestId(newCol.requests[0]?.id ?? null)
          showToast(`Imported ${newCol.requests.length} request${newCol.requests.length !== 1 ? 's' : ''} from HAR`)
        }}
      />

      <ImportOpenApiModal
        open={importOpenApiOpen}
        onClose={() => setImportOpenApiOpen(false)}
        onConfirm={(newCol) => {
          updateProject((draft) => { draft.collections.push(newCol) })
          setActiveCollectionId(newCol.id)
          setActiveRequestId(newCol.requests[0]?.id ?? null)
          showToast(`Imported ${newCol.requests.length} endpoint${newCol.requests.length !== 1 ? 's' : ''} from OpenAPI spec`)
        }}
      />

      <ImportPostmanModal
        open={importPostmanOpen}
        onClose={() => setImportPostmanOpen(false)}
        onConfirm={(newCol) => {
          updateProject((draft) => { draft.collections.push(newCol) })
          setActiveCollectionId(newCol.id)
          setActiveRequestId(newCol.requests[0]?.id ?? null)
          showToast(`Imported ${newCol.requests.length} request${newCol.requests.length !== 1 ? 's' : ''} from Postman collection`)
        }}
      />

      <ImportCollectionModal
        open={importCollectionOpen}
        onClose={() => setImportCollectionOpen(false)}
        onConfirm={(newCol, importedRules) => {
          updateProject((draft) => {
            draft.collections.push(newCol)
            if (importedRules?.length) {
              for (const rule of importedRules) {
                draft.correlationRules.push(rule)
              }
            }
          })
          setActiveCollectionId(newCol.id)
          setActiveRequestId(newCol.requests[0]?.id ?? null)
          showToast(
            importedRules?.length
              ? `Imported collection + ${importedRules.length} correlation rule(s)`
              : 'Imported collection',
          )
        }}
      />

      {/* Unified import modal (opened from sidebar) */}
      <ImportUnifiedModal
        open={importUnifiedOpen}
        collections={project?.collections ?? []}
        defaultCollectionId={collection?.id ?? null}
        onClose={() => setImportUnifiedOpen(false)}
        onConfirmCurl={(collectionId, req) => {
          updateProject((draft) => {
            const col = draft.collections.find((c) => c.id === collectionId)
            if (col) { col.requests.push(req) }
            else if (draft.collections[0]) { draft.collections[0].requests.push(req) }
          })
          setActiveCollectionId(collectionId)
          setActiveRequestId(req.id)
          showToast('Imported cURL request')
          setImportUnifiedOpen(false)
        }}
        onConfirmCollection={(newCol, importedRules) => {
          updateProject((draft) => {
            draft.collections.push(newCol)
            if (importedRules?.length) {
              for (const rule of importedRules) {
                draft.correlationRules.push(rule)
              }
            }
          })
          setActiveCollectionId(newCol.id)
          setActiveRequestId(newCol.requests[0]?.id ?? null)
          showToast(
            importedRules?.length
              ? `Imported collection + ${importedRules.length} correlation rule(s)`
              : 'Imported collection',
          )
          setImportUnifiedOpen(false)
        }}
        onConfirmJmx={(newCol, newRules) => {
          updateProject((draft) => {
            draft.collections.push(newCol)
            for (const rule of newRules) {
              draft.correlationRules.push(rule)
            }
          })
          setActiveCollectionId(newCol.id)
          setActiveRequestId(newCol.requests[0]?.id ?? null)
          showToast(
            `Imported ${newCol.requests.length} requests from JMX` + (newRules.length ? ` + ${newRules.length} extract(s)` : ''),
          )
          setImportUnifiedOpen(false)
        }}
        onConfirmHar={(newCol) => {
          updateProject((draft) => { draft.collections.push(newCol) })
          setActiveCollectionId(newCol.id)
          setActiveRequestId(newCol.requests[0]?.id ?? null)
          showToast(`Imported ${newCol.requests.length} requests from HAR`)
          setImportUnifiedOpen(false)
        }}
        onConfirmOpenApi={(newCol) => {
          updateProject((draft) => { draft.collections.push(newCol) })
          setActiveCollectionId(newCol.id)
          setActiveRequestId(newCol.requests[0]?.id ?? null)
          showToast(`Imported ${newCol.requests.length} endpoints from OpenAPI`)
          setImportUnifiedOpen(false)
        }}
        onConfirmPostman={(newCol) => {
          updateProject((draft) => { draft.collections.push(newCol) })
          setActiveCollectionId(newCol.id)
          setActiveRequestId(newCol.requests[0]?.id ?? null)
          showToast(`Imported ${newCol.requests.length} requests from Postman`)
          setImportUnifiedOpen(false)
        }}
      />

      {/* Create collection modal */}
      <WorkspaceInputModal
        open={createCollectionModalOpen}
        titleId="ws-create-collection-title"
        title="New collection"
        label="Collection name"
        placeholder="e.g. Auth API, Checkout flow…"
        defaultValue="New Collection"
        confirmLabel="Create"
        onClose={() => setCreateCollectionModalOpen(false)}
        onConfirm={handleCreateCollectionConfirm}
      />

      {/* Create project modal */}
      <WorkspaceInputModal
        open={createProjectModalOpen}
        titleId="ws-create-project-title"
        title="New project"
        label="Project name"
        placeholder="e.g. My API Project"
        defaultValue="New Project"
        confirmLabel="Create"
        onClose={() => setCreateProjectModalOpen(false)}
        onConfirm={handleCreateProjectConfirm}
      />

      {/* Delete all collections confirm */}
      <WorkspaceConfirmModal
        open={deleteAllModalOpen}
        titleId="ws-delete-all-title"
        title="Reset all collections?"
        confirmLabel="Reset collections"
        danger
        onClose={() => setDeleteAllModalOpen(false)}
        onConfirm={handleDeleteAllConfirm}
      >
        <p style={{ margin: 0, lineHeight: 1.5 }}>
          All collections and their requests will be replaced with one empty <strong>Default</strong> collection.
        </p>
        <p className="muted" style={{ margin: '10px 0 0' }}>This cannot be undone.</p>
      </WorkspaceConfirmModal>

      <WorkspaceConfirmModal
        open={!!removeRequestTarget}
        titleId="ws-remove-request-title"
        title="Remove this request?"
        confirmLabel="Remove request"
        danger
        onClose={() => setRemoveRequestTarget(null)}
        onConfirm={confirmRemoveRequest}
      >
        {removeRequestDetails ? (
          <p style={{ margin: 0, lineHeight: 1.5 }}>
            <strong>{removeRequestDetails.method}</strong> {removeRequestDetails.name}
            <span className="muted"> — collection &quot;{removeRequestDetails.collectionName}&quot;</span>
          </p>
        ) : (
          <p style={{ margin: 0 }}>This request will be removed from the collection.</p>
        )}
        <p className="muted" style={{ margin: '10px 0 0' }}>
          This cannot be undone.
        </p>
      </WorkspaceConfirmModal>

      <WorkspaceConfirmModal
        open={!!removeCollectionTarget}
        titleId="ws-remove-collection-title"
        title="Delete this collection?"
        confirmLabel="Delete collection"
        danger
        onClose={() => setRemoveCollectionTarget(null)}
        onConfirm={confirmRemoveCollection}
      >
        {removeCollectionDetails ? (
          <p style={{ margin: 0, lineHeight: 1.5 }}>
            Collection &quot;{removeCollectionDetails.name}&quot; with{' '}
            <strong>{removeCollectionDetails.requestCount}</strong> {removeCollectionDetails.requestCount === 1 ? 'request' : 'requests'} will be removed from this project.
          </p>
        ) : (
          <p style={{ margin: 0 }}>This collection will be removed from the project.</p>
        )}
        <p className="muted" style={{ margin: '10px 0 0' }}>
          This cannot be undone.
        </p>
      </WorkspaceConfirmModal>

      {toastMessage ? <div className="ws-toast">{toastMessage}</div> : null}

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        project={project}
        onSelectRequest={(collectionId, requestId) => {
          setActiveCollectionId(collectionId)
          setActiveRequestId(requestId)
          setMainTab('builder')
        }}
        onSelectCollection={(collectionId) => {
          setActiveCollectionId(collectionId)
        }}
        onCreateRequest={createRequest}
        onCreateCollection={createCollection}
        onRun={() => void run()}
        onExport={() => {
          if (!collection) return
          flushRegenerate()
          const csvRows = data.csvRows ?? project.csvRows ?? []
          const freshScript =
            exportTarget === 'collection'
              ? buildWorkspaceCollectionK6Script({ project, collection, activeEnvironment: data.environment, envVariables: data.envVariables, sharedVariables: data.sharedVariables, csvRows, runPurpose })
              : buildWorkspaceK6Script({ project, collection, request: request!, activeEnvironment: data.environment, envVariables: data.envVariables, sharedVariables: data.sharedVariables, csvRows, runPurpose })
          if (!freshScript.trim()) return
          const blob = new Blob([freshScript], { type: 'text/javascript;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${project.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.k6.js`
          a.click()
          URL.revokeObjectURL(url)
          showToast('Downloaded k6 script')
        }}
        onExportCurl={() => {
          if (!collection) return
          const text = exportTarget === 'collection' ? collectionToCurlSh(collection) : (request ? requestToCurl(request) : '')
          if (!text) return
          const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${project.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.curl.sh`
          a.click()
          URL.revokeObjectURL(url)
          showToast('Exported cURL')
        }}
      />
    </div>
  )
}
