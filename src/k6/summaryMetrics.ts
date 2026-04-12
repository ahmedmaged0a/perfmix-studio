import type { K6RunHistoryMetrics } from '../models/types'

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  return null
}

function metric(summary: Record<string, unknown> | null, path: string[]): number | null {
  let cur: unknown = summary
  for (const p of path) {
    if (!cur || typeof cur !== 'object') return null
    cur = (cur as Record<string, unknown>)[p]
  }
  return num(cur)
}

function metricAuto(summary: Record<string, unknown>, metricName: string, field: string): number | null {
  const withValues = metric(summary, ['metrics', metricName, 'values', field])
  if (withValues != null) return withValues
  return metric(summary, ['metrics', metricName, field])
}

export function extractGlobalMetricsFromSummary(summaryJson: string | null): K6RunHistoryMetrics {
  if (!summaryJson) {
    return { avgMs: null, p95Ms: null, errorRate: null, rps: null }
  }
  try {
    const summary = JSON.parse(summaryJson) as Record<string, unknown>
    const checksPasses = metricAuto(summary, 'checks', 'passes')
    const checksFails = metricAuto(summary, 'checks', 'fails')
    const checksTotal = (checksPasses ?? 0) + (checksFails ?? 0)
    const httpReqFailedCount = metricAuto(summary, 'http_req_failed', 'passes')
    const httpReqsCount = metricAuto(summary, 'http_reqs', 'count')

    return {
      avgMs: metricAuto(summary, 'http_req_duration', 'avg'),
      p95Ms: metricAuto(summary, 'http_req_duration', 'p(95)'),
      errorRate: metricAuto(summary, 'http_req_failed', 'rate'),
      rps: metricAuto(summary, 'http_reqs', 'rate'),
      checksTotal: checksTotal || null,
      checksPassed: checksPasses,
      checksFailed: checksFails,
      httpReqFailed: httpReqFailedCount,
      httpReqs: httpReqsCount,
    }
  } catch {
    return { avgMs: null, p95Ms: null, errorRate: null, rps: null }
  }
}
