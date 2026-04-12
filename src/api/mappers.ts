import type { AppData, Project } from '../models/types'
import type { AppDataDto } from './dto'

export function fromAppDataDto(dto: AppDataDto): AppData {
  return {
    schemaVersion: dto.schema_version,
    activeProjectId: dto.active_project_id,
    projects: (dto.projects as Project[] | undefined) ?? undefined,
    projectName: dto.project_name,
    environment: dto.environment,
    runner: dto.runner,
    metrics: dto.metrics,
    apiRequests: dto.api_requests.map((item) => ({
      id: item.id,
      folder: item.folder,
      name: item.name,
      method: item.method,
      url: item.url,
      headers: item.headers,
      body: item.body,
      testCases: (item.test_cases ?? []).map((tc) => ({
        id: tc.id,
        name: tc.name,
        vus: tc.vus,
        duration: tc.duration,
        rampUp: tc.ramp_up,
        thinkTimeMs: tc.think_time_ms,
        criteria: tc.criteria
          ? {
              maxAvgMs: tc.criteria.max_avg_ms,
              maxP95Ms: tc.criteria.max_p95_ms,
              maxP99Ms: tc.criteria.max_p99_ms,
              maxErrorRate: tc.criteria.max_error_rate,
              minThroughputRps: tc.criteria.min_throughput_rps,
            }
          : undefined,
        maxAvgMs: tc.max_avg_ms,
        maxP95Ms: tc.max_p95_ms,
        maxErrorRate: tc.max_error_rate,
      })),
    })),
    scenarios: dto.scenarios.map((item) => ({
      id: item.id,
      name: item.name,
      flow: item.flow,
      vus: item.vus,
      duration: item.duration,
      rampUp: item.ramp_up,
      thinkTimeMs: item.think_time_ms,
    })),
    matrixRows: dto.matrix_rows.map((item) => ({
      id: item.id,
      name: item.name,
      vus: item.vus,
      duration: item.duration,
      expectedAvg: item.expected_avg,
      expectedError: item.expected_error,
    })),
    thresholdRows: dto.threshold_rows,
    runSamples: dto.run_samples.map((item) => ({
      minute: item.minute,
      rps: item.rps,
      p95: item.p95,
      errorRate: item.error_rate,
    })),
    envVariables: dto.env_variables ?? {},
    sharedVariables: dto.shared_variables ?? {},
    dataCsv: dto.data_csv ?? '',
    csvRows: dto.csv_rows ?? [],
  }
}

export function toAppDataDto(data: AppData): AppDataDto {
  return {
    schema_version: data.schemaVersion,
    active_project_id: data.activeProjectId,
    projects: data.projects as unknown,
    project_name: data.projectName,
    environment: data.environment,
    runner: data.runner,
    metrics: data.metrics,
    api_requests: data.apiRequests.map((item) => ({
      id: item.id,
      folder: item.folder,
      name: item.name,
      method: item.method,
      url: item.url,
      headers: item.headers,
      body: item.body,
      test_cases: item.testCases.map((tc) => ({
        id: tc.id,
        name: tc.name,
        vus: tc.vus,
        duration: tc.duration,
        ramp_up: tc.rampUp,
        think_time_ms: tc.thinkTimeMs,
        criteria: tc.criteria
          ? {
              max_avg_ms: tc.criteria.maxAvgMs,
              max_p95_ms: tc.criteria.maxP95Ms,
              max_p99_ms: tc.criteria.maxP99Ms,
              max_error_rate: tc.criteria.maxErrorRate,
              min_throughput_rps: tc.criteria.minThroughputRps,
            }
          : undefined,
        max_avg_ms: tc.maxAvgMs,
        max_p95_ms: tc.maxP95Ms,
        max_error_rate: tc.maxErrorRate,
      })),
    })),
    scenarios: data.scenarios.map((item) => ({
      id: item.id,
      name: item.name,
      flow: item.flow,
      vus: item.vus,
      duration: item.duration,
      ramp_up: item.rampUp,
      think_time_ms: item.thinkTimeMs,
    })),
    matrix_rows: data.matrixRows.map((item) => ({
      id: item.id,
      name: item.name,
      vus: item.vus,
      duration: item.duration,
      expected_avg: item.expectedAvg,
      expected_error: item.expectedError,
    })),
    threshold_rows: data.thresholdRows,
    run_samples: data.runSamples.map((item) => ({
      minute: item.minute,
      rps: item.rps,
      p95: item.p95,
      error_rate: item.errorRate,
    })),
    env_variables: data.envVariables,
    shared_variables: data.sharedVariables,
    data_csv: data.dataCsv,
    csv_rows: data.csvRows,
  }
}
