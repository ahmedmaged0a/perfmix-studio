import type { K6RunHistoryMetrics } from '../models/types'

type Summary = Record<string, unknown>

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  return null
}

function metricAuto(summary: Summary | null, metricName: string, field: string): number | null {
  if (!summary) return null
  let cur: unknown = summary
  const path = ['metrics', metricName, 'values', field]
  for (const p of path) {
    if (!cur || typeof cur !== 'object') return null
    cur = (cur as Record<string, unknown>)[p]
  }
  const v = num(cur)
  if (v != null) return v
  cur = summary
  const path2 = ['metrics', metricName, field]
  for (const p of path2) {
    if (!cur || typeof cur !== 'object') return null
    cur = (cur as Record<string, unknown>)[p]
  }
  return num(cur)
}

/** Parse `name{tag1:val1,tag2:val2}` → map */
export function parseMetricKeyTags(metricKey: string): Record<string, string> | null {
  const open = metricKey.indexOf('{')
  const close = metricKey.lastIndexOf('}')
  if (open === -1 || close <= open) return null
  const inner = metricKey.slice(open + 1, close).trim()
  if (!inner) return {}
  const out: Record<string, string> = {}
  // k6 uses "tag:value" pairs; values are unquoted, no commas in values for our tags
  for (const part of inner.split(',')) {
    const idx = part.indexOf(':')
    if (idx === -1) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) out[k] = v
  }
  return out
}

export type PerRequestMetricRow = K6RunHistoryMetrics & {
  requestId: string
  requestName?: string
  reportingExcluded: boolean
}

/**
 * Reads k6 summary JSON sub-metrics tagged with perfmix_request_id (from generated scripts).
 */
export function extractPerRequestMetricsFromSummary(summaryJson: string | null): PerRequestMetricRow[] {
  if (!summaryJson) return []
  let summary: Summary
  try {
    summary = JSON.parse(summaryJson) as Summary
  } catch {
    return []
  }
  const metrics = summary.metrics
  if (!metrics || typeof metrics !== 'object') return []

  const byId = new Map<string, PerRequestMetricRow>()

  for (const [key, raw] of Object.entries(metrics as Record<string, unknown>)) {
    if (!key.startsWith('http_req_duration{') || !raw || typeof raw !== 'object') continue
    const tags = parseMetricKeyTags(key)
    if (!tags) continue
    const requestId = tags.perfmix_request_id
    if (!requestId) continue
    const row = raw as Record<string, unknown>
    const vals = (row.values as Record<string, unknown> | undefined) ?? row
    const avgMs = num(vals.avg)
    const p95Ms = num(vals['p(95)']) ?? num(vals.p95)
    const reportingExcluded = tags.perfmix_report === '0'

    const existing = byId.get(requestId)
    const next: PerRequestMetricRow = {
      requestId,
      requestName: tags.perfmix_request_name,
      reportingExcluded,
      avgMs: avgMs ?? existing?.avgMs ?? null,
      p95Ms: p95Ms ?? existing?.p95Ms ?? null,
      errorRate: existing?.errorRate ?? null,
      rps: existing?.rps ?? null,
    }
    byId.set(requestId, next)
  }

  for (const [key, raw] of Object.entries(metrics as Record<string, unknown>)) {
    if (!key.startsWith('http_req_failed{') || !raw || typeof raw !== 'object') continue
    const tags = parseMetricKeyTags(key)
    const requestId = tags?.perfmix_request_id
    if (!requestId) continue
    const row = raw as Record<string, unknown>
    const vals = (row.values as Record<string, unknown> | undefined) ?? row
    const cur = byId.get(requestId)
    const errorRate = num(vals.rate)
    byId.set(requestId, {
      ...(cur ?? {
        requestId,
        reportingExcluded: tags?.perfmix_report === '0',
        avgMs: null,
        p95Ms: null,
        errorRate: null,
        rps: null,
      }),
      errorRate: errorRate ?? cur?.errorRate ?? null,
      reportingExcluded: cur?.reportingExcluded ?? tags?.perfmix_report === '0',
    })
  }

  for (const [key, raw] of Object.entries(metrics as Record<string, unknown>)) {
    if (!key.startsWith('http_reqs{') || !raw || typeof raw !== 'object') continue
    const tags = parseMetricKeyTags(key)
    const requestId = tags?.perfmix_request_id
    if (!requestId) continue
    const row = raw as Record<string, unknown>
    const vals = (row.values as Record<string, unknown> | undefined) ?? row
    const cur = byId.get(requestId)
    const rps = num(vals.rate)
    byId.set(requestId, {
      ...(cur ?? {
        requestId,
        reportingExcluded: tags?.perfmix_report === '0',
        avgMs: null,
        p95Ms: null,
        errorRate: null,
        rps: null,
      }),
      rps: rps ?? cur?.rps ?? null,
      reportingExcluded: cur?.reportingExcluded ?? tags?.perfmix_report === '0',
    })
  }

  return [...byId.values()]
}

export function metricsForRequestId(rows: PerRequestMetricRow[], requestId: string): K6RunHistoryMetrics | null {
  const row = rows.find((r) => r.requestId === requestId)
  if (!row) return null
  return {
    avgMs: row.avgMs,
    p95Ms: row.p95Ms,
    errorRate: row.errorRate,
    rps: row.rps,
  }
}

/**
 * Aggregate from tagged http_req_duration where perfmix_report !== '0'.
 * Falls back to global summary row when no tagged duration metrics exist.
 */
export function extractAggregateMetricsExcludingReport(summaryJson: string | null): K6RunHistoryMetrics {
  let summary: Summary | null = null
  try {
    summary = summaryJson ? (JSON.parse(summaryJson) as Summary) : null
  } catch {
    summary = null
  }

  const rows = extractPerRequestMetricsFromSummary(summaryJson)
  const included = rows.filter((r) => !r.reportingExcluded && r.avgMs != null)
  if (!included.length) {
    return {
      avgMs: metricAuto(summary, 'http_req_duration', 'avg'),
      p95Ms: metricAuto(summary, 'http_req_duration', 'p(95)'),
      errorRate: metricAuto(summary, 'http_req_failed', 'rate'),
      rps: metricAuto(summary, 'http_reqs', 'rate'),
    }
  }

  const metrics = summary?.metrics as Record<string, unknown> | undefined
  let sumAvgCount = 0
  let sumCount = 0
  let maxP95 = 0
  let hasP95 = false

  for (const r of included) {
    if (!metrics) break
    let count: number | null = null
    let avg = r.avgMs
    for (const [mk, raw] of Object.entries(metrics)) {
      if (!mk.startsWith('http_req_duration{')) continue
      const tags = parseMetricKeyTags(mk)
      if (tags?.perfmix_request_id !== r.requestId || tags.perfmix_report === '0') continue
      if (!raw || typeof raw !== 'object') continue
      const vals = ((raw as Record<string, unknown>).values as Record<string, unknown> | undefined) ?? raw
      const c = num((vals as Record<string, unknown>).count)
      const av = num((vals as Record<string, unknown>).avg)
      if (c != null) count = (count ?? 0) + c
      if (av != null) avg = av
    }
    if (avg != null && count != null && count > 0) {
      sumAvgCount += avg * count
      sumCount += count
    } else if (avg != null) {
      sumAvgCount += avg
      sumCount += 1
    }
    if (r.p95Ms != null) {
      hasP95 = true
      maxP95 = Math.max(maxP95, r.p95Ms)
    }
  }

  const avgMs = sumCount > 0 ? sumAvgCount / sumCount : null

  let errNum = 0
  let errDen = 0
  for (const r of included) {
    if (r.errorRate != null) {
      errNum += r.errorRate
      errDen += 1
    }
  }
  const errorRate = errDen > 0 ? errNum / errDen : metricAuto(summary, 'http_req_failed', 'rate')

  let rpsSum = 0
  let rpsN = 0
  for (const r of included) {
    if (r.rps != null) {
      rpsSum += r.rps
      rpsN += 1
    }
  }
  const rps = rpsN > 0 ? rpsSum : metricAuto(summary, 'http_reqs', 'rate')

  return {
    avgMs,
    p95Ms: hasP95 ? maxP95 : metricAuto(summary, 'http_req_duration', 'p(95)'),
    errorRate,
    rps,
  }
}
