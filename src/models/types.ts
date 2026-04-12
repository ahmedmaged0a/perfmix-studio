export type NavItem = {
  label: string
  to: string
}

export type Metric = {
  label: string
  value: string
  trend: string
}

export type ApiRequestItem = {
  id: string
  folder: string
  name: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  headers: string
  body: string
  testCases: RequestTestCase[]
  assertions?: RequestAssertion[]
  /** When true, k6 tags perfmix_report=0; aggregate reporting ignores these requests. */
  excludeFromAggregateReport?: boolean
}

export type PerfCriteria = {
  maxAvgMs?: number
  maxP95Ms?: number
  maxP99Ms?: number
  maxErrorRate?: number
  minThroughputRps?: number
}

/** `null` in a patch removes that criterion key when persisting. */
export type PerfCriteriaPatch = Partial<{ [K in keyof PerfCriteria]: PerfCriteria[K] | null }>

/** Keys mirrored in test-case table + p99; toggled off hides UI and omits k6 thresholds. */
export type CriteriaToggleKey = keyof Pick<PerfCriteria, 'maxAvgMs' | 'maxP95Ms' | 'maxP99Ms' | 'maxErrorRate' | 'minThroughputRps'>

export const CRITERIA_TOGGLE_KEYS: CriteriaToggleKey[] = ['maxAvgMs', 'maxP95Ms', 'maxP99Ms', 'maxErrorRate', 'minThroughputRps']

export function criteriaToggleValue(tc: RequestTestCase, key: CriteriaToggleKey): number | undefined {
  const crit = tc.criteria ?? {}
  if (typeof crit[key] === 'number' && Number.isFinite(crit[key] as number)) return crit[key] as number
  if (key === 'maxAvgMs' && typeof tc.maxAvgMs === 'number' && Number.isFinite(tc.maxAvgMs)) return tc.maxAvgMs
  if (key === 'maxP95Ms' && typeof tc.maxP95Ms === 'number' && Number.isFinite(tc.maxP95Ms)) return tc.maxP95Ms
  if (key === 'maxErrorRate' && typeof tc.maxErrorRate === 'number' && Number.isFinite(tc.maxErrorRate)) return tc.maxErrorRate
  return undefined
}

/** UI + generator: metric participates when toggle is true, or legacy data with no toggles and a finite value. */
export function isCriteriaToggleOn(tc: RequestTestCase, key: CriteriaToggleKey): boolean {
  const explicit = tc.criteriaToggles?.[key]
  if (explicit === false) return false
  if (explicit === true) return true
  const v = criteriaToggleValue(tc, key)
  return typeof v === 'number' && Number.isFinite(v)
}

export function thinkTimeMsForK6(tc: RequestTestCase): number {
  if (tc.thinkTimeEnabled === false) return 0
  return Number.isFinite(tc.thinkTimeMs) ? tc.thinkTimeMs : 0
}

export function migrateRequestTestCaseToggles(tc: RequestTestCase): RequestTestCase {
  if (tc.criteriaToggles != null && Object.keys(tc.criteriaToggles).length > 0) {
    return tc.thinkTimeEnabled === undefined ? { ...tc, thinkTimeEnabled: true } : tc
  }
  const criteriaToggles: Partial<Record<CriteriaToggleKey, boolean>> = {}
  for (const key of CRITERIA_TOGGLE_KEYS) {
    criteriaToggles[key] = typeof criteriaToggleValue(tc, key) === 'number'
  }
  return {
    ...tc,
    criteriaToggles,
    thinkTimeEnabled: tc.thinkTimeEnabled !== undefined ? tc.thinkTimeEnabled : true,
  }
}

export type AssertionType =
  | 'status_code'
  | 'body_equals'
  | 'body_contains'
  | 'header_contains'
  | 'header_visible'
  | 'header_value_equals'

export type RequestAssertion = {
  id: string
  type: AssertionType
  enabled: boolean
  /** For status_code: "200"; body_equals/contains: the expected string; header_*: header name */
  target: string
  /** For header_value_equals: the expected value */
  expected?: string
}

export type RequestTestCase = {
  id: string
  name: string
  vus: number
  duration: string
  rampUp: string
  thinkTimeMs: number
  criteria?: PerfCriteria
  /** When false, omit k6 threshold for that metric even if criteria still holds a number. */
  criteriaToggles?: Partial<Record<CriteriaToggleKey, boolean>>
  /** When false, generated script uses sleep(0) for this test case. */
  thinkTimeEnabled?: boolean
  /**
   * @deprecated legacy flat thresholds (kept for migration / older persisted data)
   */
  maxAvgMs?: number
  maxP95Ms?: number
  maxErrorRate?: number
}

export type HttpExecuteResponse = {
  ok: boolean
  status: number
  statusText: string
  responseHeaders: [string, string][]
  body: string
  error?: string
  /** Round-trip time for the HTTP call (client-measured), ms */
  durationMs?: number
}

export type HttpAssertionResult = { assertion: RequestAssertion; pass: boolean; detail: string }

export type HttpBatchItem = {
  requestName: string
  method: string
  url: string
  result: HttpExecuteResponse
  assertionResults?: HttpAssertionResult[]
  /** Pre/post script failure (HTTP may be skipped) */
  scriptError?: string
  scriptLogs?: string[]
}

/** Bottom-panel HTTP output: one Send or a collection Send-all batch */
export type HttpOutputPayload =
  | {
      kind: 'single'
      method: string
      url: string
      at: string
      result: HttpExecuteResponse
      assertionResults?: HttpAssertionResult[]
      scriptError?: string
      scriptLogs?: string[]
    }
  | { kind: 'batch'; at: string; collectionName: string; items: HttpBatchItem[] }

export type RequestDefinition = {
  id: string
  name: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  query: Record<string, string>
  headers: Record<string, string>
  bodyText: string
  testCases: RequestTestCase[]
  assertions?: RequestAssertion[]
  docs?: string
  /** In-app Send only; runs before HTTP (Postman-style `pm`). */
  preRequestScript?: string
  /** In-app Send only; runs after HTTP. */
  postRequestScript?: string
  /**
   * Collection k6 still runs this request, but per-request / aggregate charts omit it
   * (e.g. login/logout surrounding measured APIs).
   */
  excludeFromAggregateReport?: boolean
}

export type Collection = {
  id: string
  name: string
  requests: RequestDefinition[]
  /** Collection-scoped {{var}}; overridden by active environment for same key */
  variables?: Record<string, string>
  docs?: string
  /** Whole-collection k6: parallel scenarios vs one sequential journey. */
  k6CollectionExecution?: 'parallel' | 'sequential'
  /** Sequential journey load (ignored for parallel mode). */
  k6LoadVus?: number
  k6LoadDuration?: string
  k6LoadRampUp?: string
}

export type CorrelationRule = {
  id: string
  variableName: string
  fromRequestId: string
  jsonPath: string
}

export type CsvMapping = {
  id: string
  column: string
  variableName: string
}

export type Project = {
  id: string
  name: string
  collections: Collection[]
  correlationRules: CorrelationRule[]
  csvMappings: CsvMapping[]
  /**
   * Raw CSV lines (MVP). Prefer mapping columns -> variables via `csvMappings`.
   */
  csvRows: string[]
  /** Project-scoped {{var}}; overridden by collection then environment */
  variables?: Record<string, string>
  docs?: string
}

export type ScenarioMatrixRow = {
  id: string
  name: string
  vus: number
  duration: string
  expectedAvg: string
  expectedError: string
}

export type ThresholdRow = {
  id: string
  scope: string
  metric: string
  rule: string
  severity: 'warn' | 'fail'
  enabled: boolean
}

export type ScenarioDefinition = {
  id: string
  name: string
  flow: string
  vus: number
  duration: string
  rampUp: string
  thinkTimeMs: number
}

export type RunSample = {
  minute: string
  rps: number
  p95: number
  errorRate: number
}

export type K6RunStatus = 'queued' | 'running' | 'passed' | 'failed'

export type K6RunResult = {
  runId: string
  status: K6RunStatus
  logs: string[]
  summaryPath?: string
  reportHtmlPath?: string
  summaryJson?: string | null
}

export type RuntimeDiagnostics = {
  tauriAvailable: boolean
  k6Path: string
  mode: 'bundled' | 'path' | 'unavailable'
  canExecute: boolean
  runsDirWritable: boolean
  k6Version: string
  issues: string[]
}

export type K6RunHistoryMetrics = {
  avgMs: number | null
  p95Ms: number | null
  errorRate: number | null
  rps: number | null
  checksTotal?: number | null
  checksPassed?: number | null
  checksFailed?: number | null
  httpReqFailed?: number | null
  httpReqs?: number | null
}

export type K6RunHistoryEntry = {
  id: string
  runId: string
  at: string
  requestId: string
  collectionId?: string
  scope: 'request' | 'collection'
  status: K6RunStatus
  metrics: K6RunHistoryMetrics
  summaryJson?: string | null
}

export type AppData = {
  schemaVersion?: number
  activeProjectId?: string
  projects?: Project[]
  projectName: string
  environment: string
  runner: string
  metrics: Metric[]
  apiRequests: ApiRequestItem[]
  scenarios: ScenarioDefinition[]
  matrixRows: ScenarioMatrixRow[]
  thresholdRows: ThresholdRow[]
  runSamples: RunSample[]
  /**
   * Environment-specific variables (non-secret MVP).
   * Example: { dev: { baseUrl: "https://dev.api" }, staging: { baseUrl: "https://stage.api" } }
   */
  envVariables: Record<string, Record<string, string>>
  /**
   * Shared variables used when no environment-specific override exists.
   */
  sharedVariables: Record<string, string>
  /**
   * Simple CSV data-driven values (single column) referenced as {{data}} in URL/headers/body.
   * One value per line.
   */
  dataCsv: string
  /**
   * Optional multi-column CSV rows (MVP). If empty, falls back to `dataCsv` lines.
   */
  csvRows?: string[]
  /**
   * k6 run history keyed by request id (oldest → newest).
   */
  k6RunHistoryByRequest?: Record<string, K6RunHistoryEntry[]>
}
