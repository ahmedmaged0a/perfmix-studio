export type MetricDto = {
  label: string
  value: string
  trend: string
}

export type ApiRequestDto = {
  id: string
  folder: string
  name: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  headers: string
  body: string
  test_cases: RequestTestCaseDto[]
  /** Sequential journey k6 export: iteration guard for this step. */
  k6_scenario_iteration?: number | null
}

export type RequestTestCaseDto = {
  id: string
  name: string
  vus: number
  duration: string
  ramp_up: string
  ramp_down_enabled?: boolean
  ramp_down?: string
  think_time_ms: number
  criteria?: {
    max_avg_ms?: number
    max_p95_ms?: number
    max_p99_ms?: number
    max_error_rate?: number
    min_throughput_rps?: number
  }
  max_avg_ms?: number
  max_p95_ms?: number
  max_error_rate?: number
}

export type ScenarioDto = {
  id: string
  name: string
  flow: string
  vus: number
  duration: string
  ramp_up: string
  think_time_ms: number
}

export type MatrixRowDto = {
  id: string
  name: string
  vus: number
  duration: string
  expected_avg: string
  expected_error: string
}

export type ThresholdDto = {
  id: string
  scope: string
  metric: string
  rule: string
  severity: 'warn' | 'fail'
  enabled: boolean
}

export type RunSampleDto = {
  minute: string
  rps: number
  p95: number
  error_rate: number
}

export type AppDataDto = {
  schema_version?: number
  active_project_id?: string
  projects?: unknown
  project_name: string
  environment: string
  runner: string
  metrics: MetricDto[]
  api_requests: ApiRequestDto[]
  scenarios: ScenarioDto[]
  matrix_rows: MatrixRowDto[]
  threshold_rows: ThresholdDto[]
  run_samples: RunSampleDto[]
  env_variables?: Record<string, Record<string, string>>
  shared_variables?: Record<string, string>
  data_csv?: string
  csv_rows?: string[]
}
