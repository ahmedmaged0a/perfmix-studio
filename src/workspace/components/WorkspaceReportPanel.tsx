import { useEffect, useMemo, useRef } from 'react'
import type { RequestDefinition } from '../../models/types'
import { tauriReadRunReportHtml } from '../../desktop/tauriBridge'
import { extractAggregateMetricsExcludingReport } from '../../k6/summaryPerRequest'

type Props = {
  summaryJson: string | null
  runId: string | null
  reportHtmlPath: string | null
  request: RequestDefinition | null
  embedded?: boolean
  /** Collection runs: KPIs use tagged metrics and omit perfmix_report=0 from aggregate. */
  aggregateKpisExcludeHiddenRequests?: boolean
}

type Summary = Record<string, unknown>

function toScenarioKey(name: string) {
  return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  return null
}

function metricNumber(summary: Summary | null, path: string[]): number | null {
  let cur: unknown = summary
  for (const p of path) {
    if (!cur || typeof cur !== 'object') return null
    cur = (cur as Record<string, unknown>)[p]
  }
  return num(cur)
}

function metricAuto(summary: Summary | null, metricName: string, field: string): number | null {
  const withValues = metricNumber(summary, ['metrics', metricName, 'values', field])
  if (withValues != null) return withValues
  return metricNumber(summary, ['metrics', metricName, field])
}

function parseSummary(raw: string | null): Summary | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as Summary
  } catch {
    return null
  }
}

export function WorkspaceReportPanel(props: Props) {
  const summary = useMemo(() => parseSummary(props.summaryJson), [props.summaryJson])

  const chartRef = useRef<HTMLDivElement | null>(null)

  const adjusted = useMemo(() => {
    if (!props.aggregateKpisExcludeHiddenRequests || !props.summaryJson) return null
    return extractAggregateMetricsExcludingReport(props.summaryJson)
  }, [props.aggregateKpisExcludeHiddenRequests, props.summaryJson])

  const httpAvg = adjusted?.avgMs ?? metricAuto(summary, 'http_req_duration', 'avg')
  const httpP95 = adjusted?.p95Ms ?? metricAuto(summary, 'http_req_duration', 'p(95)')
  const httpP99 = metricAuto(summary, 'http_req_duration', 'p(99)')
  const failRate = adjusted?.errorRate ?? metricAuto(summary, 'http_req_failed', 'rate')
  const rps = adjusted?.rps ?? metricAuto(summary, 'http_reqs', 'rate')
  const iterations = metricAuto(summary, 'iterations', 'count')
  const checksPasses = metricAuto(summary, 'checks', 'passes')
  const checksFails = metricAuto(summary, 'checks', 'fails')
  const checksTotal = (checksPasses ?? 0) + (checksFails ?? 0)
  const httpReqs = metricAuto(summary, 'http_reqs', 'count')
  const httpReqFailedCount = metricAuto(summary, 'http_req_failed', 'passes')

  useEffect(() => {
    const el = chartRef.current
    if (!el || !props.summaryJson) return

    let cancelled = false
    let inst: import('echarts').ECharts | null = null
    let listenerAdded = false
    const onResize = () => inst?.resize()

    void (async () => {
      const echarts = await import('echarts')
      if (cancelled || !chartRef.current) return
      inst = echarts.init(chartRef.current, undefined, { renderer: 'canvas' })
      inst.setOption({
        backgroundColor: 'transparent',
        textStyle: { color: '#cbd5e1' },
        tooltip: { trigger: 'axis' },
        grid: { left: 40, right: 16, top: 24, bottom: 28 },
        xAxis: { type: 'category', data: ['avg', 'p95', 'p99'], axisLabel: { color: '#94a3b8' } },
        yAxis: { type: 'value', name: 'ms', axisLabel: { color: '#94a3b8' }, splitLine: { lineStyle: { color: '#1f2a44' } } },
        series: [
          {
            type: 'bar',
            data: [httpAvg ?? 0, httpP95 ?? 0, httpP99 ?? 0],
            itemStyle: { color: '#60a5fa' },
          },
        ],
      })
      if (cancelled) return
      window.addEventListener('resize', onResize)
      listenerAdded = true
    })()

    return () => {
      cancelled = true
      if (listenerAdded) {
        window.removeEventListener('resize', onResize)
      }
      inst?.dispose()
      inst = null
    }
  }, [httpAvg, httpP95, httpP99, props.summaryJson])

  const tcRows = useMemo(() => {
    const req = props.request
    if (!req) return []
    return req.testCases.map((tc) => {
      const scenarioKey = toScenarioKey(`${req.id}_${tc.id}_${tc.name}`)
      const scopedAvg =
        metricAuto(summary, `http_req_duration{scenario:${scenarioKey}}`, 'avg') ?? httpAvg
      const scopedP95 =
        metricAuto(summary, `http_req_duration{scenario:${scenarioKey}}`, 'p(95)') ?? httpP95
      const scopedFail =
        metricAuto(summary, `http_req_failed{scenario:${scenarioKey}}`, 'rate') ?? failRate
      const scopedRps = metricAuto(summary, `http_reqs{scenario:${scenarioKey}}`, 'rate') ?? rps

      const c = tc.criteria ?? {}
      const checks: { label: string; pass: boolean | null; detail: string }[] = []

      if (typeof c.maxAvgMs === 'number' && Number.isFinite(c.maxAvgMs)) {
        const pass = scopedAvg == null ? null : scopedAvg <= c.maxAvgMs
        checks.push({ label: 'Avg', pass, detail: `${scopedAvg == null ? 'n/a' : `${scopedAvg.toFixed(1)} ms`} ≤ ${c.maxAvgMs} ms` })
      }
      if (typeof c.maxP95Ms === 'number' && Number.isFinite(c.maxP95Ms)) {
        const pass = scopedP95 == null ? null : scopedP95 <= c.maxP95Ms
        checks.push({ label: 'p95', pass, detail: `${scopedP95 == null ? 'n/a' : `${scopedP95.toFixed(1)} ms`} ≤ ${c.maxP95Ms} ms` })
      }
      if (typeof c.maxErrorRate === 'number' && Number.isFinite(c.maxErrorRate)) {
        const pass = scopedFail == null ? null : scopedFail <= c.maxErrorRate
        checks.push({
          label: 'Errors',
          pass,
          detail: `${scopedFail == null ? 'n/a' : `${(scopedFail * 100).toFixed(3)}%`} ≤ ${(c.maxErrorRate * 100).toFixed(3)}%`,
        })
      }
      if (typeof c.minThroughputRps === 'number' && Number.isFinite(c.minThroughputRps)) {
        const pass = scopedRps == null ? null : scopedRps >= c.minThroughputRps
        checks.push({
          label: 'RPS',
          pass,
          detail: `${scopedRps == null ? 'n/a' : `${scopedRps.toFixed(2)} rps`} ≥ ${c.minThroughputRps.toFixed(2)} rps`,
        })
      }

      const decided = checks.filter((c) => c.pass !== null) as { pass: boolean }[]
      const overall: 'pass' | 'fail' | 'na' =
        checks.length === 0 ? 'na' : decided.some((x) => !x.pass) ? 'fail' : decided.every((x) => x.pass) ? 'pass' : 'na'

      return { tc, scenarioKey, checks, overall }
    })
  }, [props.request, summary, httpAvg, httpP95, failRate, rps])

  const downloadHtml = async () => {
    if (!props.runId) return
    const html = await tauriReadRunReportHtml(props.runId)
    if (!html) {
      window.alert('HTML report is not available in this runtime yet.')
      return
    }
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const reqName = (props.request?.name ?? 'report').replace(/\s+/g, '_')
    const dateStr = new Date().toISOString().slice(0, 10)
    a.download = `${reqName}_${dateStr}_${props.runId}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="ws-report">
      <div className="ws-report-top">
        <div className="ws-kpi-grid">
          <div className="ws-kpi">
            <div className="muted">Avg</div>
            <div className="ws-kpi-value">{httpAvg == null ? '—' : `${httpAvg.toFixed(1)} ms`}</div>
          </div>
          <div className="ws-kpi">
            <div className="muted">p95</div>
            <div className="ws-kpi-value">{httpP95 == null ? '—' : `${httpP95.toFixed(1)} ms`}</div>
          </div>
          <div className="ws-kpi">
            <div className="muted">Errors</div>
            <div className="ws-kpi-value">{failRate == null ? '—' : `${(failRate * 100).toFixed(3)}%`}</div>
          </div>
          <div className="ws-kpi">
            <div className="muted">RPS</div>
            <div className="ws-kpi-value">{rps == null ? '—' : `${rps.toFixed(2)}`}</div>
          </div>
          <div className="ws-kpi">
            <div className="muted">Iterations</div>
            <div className="ws-kpi-value">{iterations == null ? '—' : `${iterations.toFixed(0)}`}</div>
          </div>
          <div className="ws-kpi">
            <div className="muted">Requests</div>
            <div className="ws-kpi-value">{httpReqs == null ? '—' : httpReqs.toFixed(0)}</div>
            {httpReqFailedCount != null && httpReqFailedCount > 0 ? (
              <div style={{ color: '#f87171', fontSize: '0.78rem' }}>{httpReqFailedCount.toFixed(0)} failed</div>
            ) : null}
          </div>
          <div className="ws-kpi">
            <div className="muted">Checks</div>
            <div className="ws-kpi-value">{checksTotal === 0 ? '—' : `${checksPasses?.toFixed(0) ?? 0} / ${checksTotal}`}</div>
            {checksFails != null && checksFails > 0 ? (
              <div style={{ color: '#f87171', fontSize: '0.78rem' }}>{checksFails.toFixed(0)} failed</div>
            ) : null}
          </div>
        </div>

        {!props.embedded ? (
          <div className="ws-report-actions">
            <button type="button" className="ws-btn" disabled={!props.runId} onClick={() => void downloadHtml()}>
              Download HTML
            </button>
            <div className="muted tiny">
              Artifact: <span className="mono">{props.reportHtmlPath ?? 'n/a'}</span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="ws-report-mid">
        <div ref={chartRef} className="ws-chart" />
        <div className="ws-report-side">
          <div className="ws-title">Test case validation</div>
          {!props.request?.testCases?.length ? <div className="muted">No test cases configured for this request.</div> : null}
          <div className="ws-tc-list">
            {tcRows.map((row) => (
              <div key={row.tc.id} className={`ws-tc-card ${row.overall}`}>
                <div className="ws-tc-title">
                  <strong>{row.tc.name}</strong>
                  <span className="mono muted">{row.scenarioKey}</span>
                </div>
                {row.checks.length ? (
                  <ul className="ws-checks">
                    {row.checks.map((c) => (
                      <li key={c.label} className={c.pass == null ? 'na' : c.pass ? 'pass' : 'fail'}>
                        <span className="ws-check-label">{c.label}</span>
                        <span className="ws-check-detail">{c.detail}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="muted">No criteria set.</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
