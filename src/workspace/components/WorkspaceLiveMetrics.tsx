/**
 * Real-time k6 run metrics panel.
 *
 * Parses k6 stdout log lines to build a live timeline:
 *   - Progress line: "running (Xm Y.Zs), N/M VUs, K complete and J interrupted"
 *   - Percentage line: "default ↓ [ XX% ] N VUs  MMmSSs/MMmSSs"
 *   - Final summary metric lines parsed for avg/p95/error-rate/rps
 *
 * Renders:
 *   - Live KPI cards (elapsed, VUs, iterations, est. rate)
 *   - ECharts sparklines: VU count + iteration count over time
 *   - Animated progress bar when percentage is available
 */

import { useMemo, useRef, useEffect } from 'react'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { K6RunStatus } from '../../models/types'

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

/** ECharts canvas cannot use `var(--token)55` — resolve to concrete rgb/rgba. */
function parseRgbComponents(s: string): [number, number, number] | null {
  const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i)
  if (!m) return null
  const r = Number(m[1])
  const g = Number(m[2])
  const b = Number(m[3])
  if (![r, g, b].every((x) => Number.isFinite(x))) return null
  return [r, g, b]
}

function parseHexColor(hex: string): [number, number, number] | null {
  const h = hex.trim().replace(/^#/, '')
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16)
    const g = parseInt(h[1] + h[1], 16)
    const b = parseInt(h[2] + h[2], 16)
    return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) ? [r, g, b] : null
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) ? [r, g, b] : null
  }
  return null
}

/** Resolve any CSS color (hex, rgb, or var(--x)) to RGB for Canvas-safe gradients. */
function resolveColorForCanvas(color: string, fallback: [number, number, number]): [number, number, number] {
  const trimmed = color.trim()
  if (trimmed.startsWith('#')) {
    const p = parseHexColor(trimmed)
    if (p) return p
  }
  const rgb = parseRgbComponents(trimmed)
  if (rgb) return rgb
  if (typeof document !== 'undefined' && trimmed.startsWith('var(')) {
    const probe = document.createElement('span')
    probe.style.cssText = 'position:absolute;left:-9999px;visibility:hidden;color:' + trimmed
    document.body.appendChild(probe)
    const resolved = getComputedStyle(probe).color
    probe.remove()
    const p = parseRgbComponents(resolved)
    if (p) return p
  }
  return fallback
}

// ── Log line parsers ──────────────────────────────────────────────────────────

/** Strip `[  12.3s] ` prefix from desktop k6 log lines (see Rust `append_log`). */
function stripElapsedPrefix(line: string): string {
  return line.replace(/^\[[\s\d.]+s\]\s*/, '')
}

type ProgressPoint = {
  elapsedSec: number
  currentVus: number
  maxVus: number
  completed: number
  interrupted: number
}

// "running (00m05.0s), 2/5 VUs, 23 complete and 0 interrupted iterations"
const PROGRESS_RE =
  /running \((?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)s\),\s*(\d+)\/(\d+)\s*VUs?,\s*(\d+)\s*complete(?:\s*and\s*(\d+)\s*interrupted)?(?:\s*iterations)?/i

// "default ↓ [  17% ] 2 VUs  00m05s/00m30s"  /  executor detail with stage duration
const PERCENT_RE = /\[\s*(\d+)%\s*\]/

// Summary metric lines
const METRIC_RE =
  /^[\s✓✗]*(\w[\w_]+)\.*:\s+avg=([^\s]+).*?p\(95\)=([^\s]+)/

const FAILED_RE = /^[\s✓✗]*http_req_failed\.*:\s+([\d.]+)%/
const RPS_RE = /^[\s✓✗]*http_reqs\.*:.*?([\d.]+)\/s/

function parseElapsedSec(h?: string, m?: string, s?: string): number {
  return (parseInt(h ?? '0', 10) * 3600) +
    (parseInt(m ?? '0', 10) * 60) +
    parseFloat(s ?? '0')
}

function parseMs(val: string): number | null {
  const lower = val.toLowerCase()
  const num = parseFloat(lower)
  if (isNaN(num)) return null
  if (lower.endsWith('µs') || lower.endsWith('us')) return num / 1000
  if (lower.endsWith('ms')) return num
  if (lower.endsWith('s')) return num * 1000
  return num
}

export type LiveMetrics = {
  points: ProgressPoint[]
  progressPct: number | null
  /** Executor / scenario label from the k6 progress line (if any). */
  scenarioLabel: string | null
  /** Raw stage duration tokens from the progress line, e.g. `44.0s` / `50.0s`. */
  stageElapsedToken: string | null
  stageMaxToken: string | null
  /** VU counts parsed from the `[n%] a/b VUs` segment when present. */
  scenarioVuCurrent: number | null
  scenarioVuMax: number | null
  finalAvgMs: number | null
  finalP95Ms: number | null
  finalErrorRate: number | null
  finalRps: number | null
}

function parseScenarioExecutorLine(text: string): {
  label: string
  pct: number
  vuCur: number
  vuMax: number
  stageA: string
  stageB: string
} | null {
  const idx = text.search(/\[\s*\d+%\s*\]/)
  if (idx <= 0) return null
  let label = text.slice(0, idx).trim().replace(/[↓↑·]+$/u, '').replace(/\.{2,}\s*$/u, '').trim()
  if (!label) return null
  const tail = text.slice(idx)
  const m = /\[\s*(\d+)%\s*\]\s*(\d+)\/(\d+)\s+VUs?\s+(\S+)\s*\/\s*(\S+)/i.exec(tail)
  if (!m) return null
  return {
    label,
    pct: parseInt(m[1], 10),
    vuCur: parseInt(m[2], 10),
    vuMax: parseInt(m[3], 10),
    stageA: m[4],
    stageB: m[5],
  }
}

export function parseLogs(logs: string[]): LiveMetrics {
  const points: ProgressPoint[] = []
  let progressPct: number | null = null
  let scenarioLabel: string | null = null
  let stageElapsedToken: string | null = null
  let stageMaxToken: string | null = null
  let scenarioVuCurrent: number | null = null
  let scenarioVuMax: number | null = null
  let finalAvgMs: number | null = null
  let finalP95Ms: number | null = null
  let finalErrorRate: number | null = null
  let finalRps: number | null = null

  for (const line of logs) {
    const text = stripElapsedPrefix(line)

    const pm = PROGRESS_RE.exec(text)
    if (pm) {
      const elapsed = parseElapsedSec(pm[1], pm[2], pm[3])
      points.push({
        elapsedSec: elapsed,
        currentVus: parseInt(pm[4], 10),
        maxVus: parseInt(pm[5], 10),
        completed: parseInt(pm[6], 10),
        interrupted: parseInt(pm[7] ?? '0', 10),
      })
      continue
    }

    const scenario = parseScenarioExecutorLine(text)
    if (scenario) {
      scenarioLabel = scenario.label
      progressPct = scenario.pct
      scenarioVuCurrent = scenario.vuCur
      scenarioVuMax = scenario.vuMax
      stageElapsedToken = scenario.stageA
      stageMaxToken = scenario.stageB
      continue
    }

    const pp = PERCENT_RE.exec(text)
    if (pp) {
      progressPct = parseInt(pp[1], 10)
      continue
    }

    if (text.includes('http_req_failed')) {
      const fm = FAILED_RE.exec(text)
      if (fm) finalErrorRate = parseFloat(fm[1]) / 100
      continue
    }

    if (text.includes('http_reqs') && text.includes('/s')) {
      const rm = RPS_RE.exec(text)
      if (rm) finalRps = parseFloat(rm[1])
      continue
    }

    if (text.includes('http_req_duration')) {
      const mm = METRIC_RE.exec(text)
      if (mm) {
        finalAvgMs = parseMs(mm[2])
        finalP95Ms = parseMs(mm[3])
      }
    }
  }

  return {
    points,
    progressPct,
    scenarioLabel,
    stageElapsedToken,
    stageMaxToken,
    scenarioVuCurrent,
    scenarioVuMax,
    finalAvgMs,
    finalP95Ms,
    finalErrorRate,
    finalRps,
  }
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtElapsed(sec: number): string {
  if (sec < 60) return `${sec.toFixed(0)}s`
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

function fmtMs(ms: number | null): string {
  if (ms == null) return '—'
  return `${ms.toFixed(0)} ms`
}

// ── Micro ECharts sparkline ───────────────────────────────────────────────────

function Sparkline({
  data,
  color,
  height = 52,
}: {
  data: number[]
  color: string
  height?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    if (!chartRef.current) {
      chartRef.current = echarts.init(ref.current, null, { renderer: 'canvas' })
    }
    const chart = chartRef.current
    const [r, g, b] = resolveColorForCanvas(color, [45, 212, 191])
    const lineRgb = `rgb(${r},${g},${b})`
    const yMax = Math.max(...data, 1)
    const baseOption = {
      animation: false,
      grid: { top: 4, bottom: 4, left: 4, right: 4 },
      xAxis: { type: 'category' as const, show: false, data: data.map((_, i) => i) },
      yAxis: { type: 'value' as const, show: false, min: 0, max: yMax },
      series: [
        {
          type: 'line' as const,
          data,
          smooth: true,
          symbol: 'none' as const,
          lineStyle: { color: lineRgb, width: 2 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: `rgba(${r},${g},${b},0.33)` },
              { offset: 1, color: `rgba(${r},${g},${b},0)` },
            ]),
          },
        },
      ],
    }
    try {
      chart.setOption(baseOption, true)
    } catch {
      try {
        chart.setOption(
          {
            animation: false,
            grid: { top: 4, bottom: 4, left: 4, right: 4 },
            xAxis: { type: 'category', show: false, data: data.map((_, i) => i) },
            yAxis: { type: 'value', show: false, min: 0, max: yMax },
            series: [{ type: 'line', data, smooth: true, symbol: 'none', lineStyle: { color: lineRgb, width: 2 } }],
          },
          true,
        )
      } catch {
        /* ignore chart paint failure */
      }
    }
  }, [data, color])

  useEffect(() => {
    return () => { chartRef.current?.dispose(); chartRef.current = null }
  }, [])

  return <div ref={ref} style={{ width: '100%', height }} />
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function LiveKpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: boolean
}) {
  return (
    <div className={`live-kpi${accent ? ' live-kpi--accent' : ''}`}>
      <div className="live-kpi-label">{label}</div>
      <div className="live-kpi-value">{value}</div>
      {sub ? <div className="live-kpi-sub muted">{sub}</div> : null}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  logs: string[]
  status: K6RunStatus | 'idle'
  runId: string | null
}

export function WorkspaceLiveMetrics(props: Props) {
  const metrics = useMemo(() => parseLogs(props.logs), [props.logs])

  const latest = metrics.points[metrics.points.length - 1]
  const isRunning = props.status === 'running' || props.status === 'queued'
  const isDone = props.status === 'passed' || props.status === 'failed'

  const vuData = useMemo(() => metrics.points.map((p) => p.currentVus), [metrics.points])
  const iterData = useMemo(() => metrics.points.map((p) => p.completed), [metrics.points])

  // Estimate iteration rate from last 2 points
  const iterRate = useMemo(() => {
    if (metrics.points.length < 2) return null
    const a = metrics.points[metrics.points.length - 2]
    const b = metrics.points[metrics.points.length - 1]
    const dt = b.elapsedSec - a.elapsedSec
    if (dt <= 0) return null
    return (b.completed - a.completed) / dt
  }, [metrics.points])

  if (props.status === 'idle' && metrics.points.length === 0) return null

  return (
    <div className="live-metrics">
      {/* Header */}
      <div className="live-metrics-head">
        <div className="live-metrics-title">
          {isRunning ? (
            <span className="live-pulse-dot" aria-label="Running" />
          ) : null}
          <span>
            {props.status === 'queued' ? 'Starting…'
              : isRunning ? 'Running'
              : props.status === 'passed' ? 'Passed'
              : props.status === 'failed' ? 'Failed'
              : 'Run complete'}
          </span>
          {props.runId ? (
            <span className="muted tiny live-run-id">
              {props.runId}
            </span>
          ) : null}
        </div>

        {/* Progress bar */}
        {metrics.progressPct != null && isRunning ? (
          <div className="live-progress-bar-wrap" title={`${metrics.progressPct}% complete`}>
            <div
              className="live-progress-bar-fill"
              style={{ width: `${metrics.progressPct}%` }}
            />
            <span className="live-progress-pct">{metrics.progressPct}%</span>
          </div>
        ) : null}
      </div>

      {isRunning &&
      (metrics.scenarioLabel ||
        metrics.progressPct != null ||
        metrics.stageElapsedToken ||
        metrics.scenarioVuCurrent != null) ? (
        <div className="live-activity" aria-live="polite">
          <div className="live-activity-label">Live activity</div>
          <div className="live-activity-body">
            {metrics.scenarioLabel ? (
              <div className="live-activity-scenario-row" title={metrics.scenarioLabel}>
                <span className="live-activity-scenario">{metrics.scenarioLabel}</span>
              </div>
            ) : (
              <div className="live-activity-scenario-row">
                <span className="live-activity-scenario muted">Scenario —</span>
              </div>
            )}
            <div className="live-activity-meta">
              {metrics.progressPct != null ? (
                <span className="live-activity-pill">{metrics.progressPct}%</span>
              ) : null}
              {metrics.scenarioVuCurrent != null && metrics.scenarioVuMax != null ? (
                <span className="muted">
                  VUs {metrics.scenarioVuCurrent}/{metrics.scenarioVuMax} (executor line)
                </span>
              ) : null}
              {metrics.stageElapsedToken && metrics.stageMaxToken ? (
                <span className="muted">
                  Stage {metrics.stageElapsedToken} / {metrics.stageMaxToken}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* KPI row */}
      <div className="live-kpi-row">
        <LiveKpi
          label="Elapsed"
          value={latest ? fmtElapsed(latest.elapsedSec) : '—'}
        />
        <LiveKpi
          label="VUs"
          value={latest ? `${latest.currentVus}` : '—'}
          sub={latest ? `max ${latest.maxVus}` : undefined}
          accent={isRunning}
        />
        <LiveKpi
          label="Iterations"
          value={latest ? `${latest.completed}` : '—'}
          sub={iterRate != null ? `~${iterRate.toFixed(1)}/s` : undefined}
        />
        {isDone && metrics.finalAvgMs != null ? (
          <LiveKpi label="Avg resp" value={fmtMs(metrics.finalAvgMs)} />
        ) : null}
        {isDone && metrics.finalP95Ms != null ? (
          <LiveKpi label="p95 resp" value={fmtMs(metrics.finalP95Ms)} />
        ) : null}
        {isDone && metrics.finalErrorRate != null ? (
          <LiveKpi
            label="Error rate"
            value={`${(metrics.finalErrorRate * 100).toFixed(2)}%`}
            accent={metrics.finalErrorRate > 0}
          />
        ) : null}
        {isDone && metrics.finalRps != null ? (
          <LiveKpi label="Throughput" value={`${metrics.finalRps.toFixed(1)} rps`} />
        ) : null}
      </div>

      {/* Charts */}
      {vuData.length > 1 ? (
        <div className="live-charts">
          <div className="live-chart-block">
            <div className="live-chart-label muted">VUs over time</div>
            <Sparkline data={vuData} color="var(--color-accent)" />
          </div>
          <div className="live-chart-block">
            <div className="live-chart-label muted">Iterations over time</div>
            <Sparkline data={iterData} color="#22c55e" />
          </div>
        </div>
      ) : isRunning ? (
        <div className="live-waiting muted">
          Waiting for first progress update…
        </div>
      ) : null}
    </div>
  )
}
