import { useEffect, useRef } from 'react'
import type { HttpOutputPayload, K6RunHistoryMetrics, K6RunStatus, RuntimeDiagnostics } from '../../models/types'
import { WorkspaceOutputPanel } from './WorkspaceOutputPanel'

type BottomTab = 'output' | 'logs'

type K6Payload = {
  at: string
  runId: string | null
  status: string
  metrics: K6RunHistoryMetrics
}

type Props = {
  bottomTab: BottomTab
  onBottomTab: (tab: BottomTab) => void
  verbose: boolean
  onVerboseChange: (next: boolean) => void
  diagnostics: RuntimeDiagnostics | null
  lastRunStatus: K6RunStatus | 'idle'
  lastRunId: string | null
  logs: string[]
  /** In-app HTTP script console lines (prepended in the Logs tab). */
  httpClientLogs?: string[]
  httpOutput: HttpOutputPayload | null
  k6Output: K6Payload | null
  onStop: () => void
  collapsed: boolean
  onToggleCollapse: () => void
  onClearLogs: () => void
  onClearOutput: () => void
}

export function WorkspaceBottomPanel(props: Props) {
  const logsEndRef = useRef<HTMLDivElement>(null)
  const logsContainerRef = useRef<HTMLPreElement>(null)
  const wasAtBottom = useRef(true)

  useEffect(() => {
    if (props.bottomTab !== 'logs') return
    if (!wasAtBottom.current) return
    logsEndRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [props.logs, props.httpClientLogs, props.bottomTab])

  const handleLogsScroll = () => {
    const el = logsContainerRef.current
    if (!el) return
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    wasAtBottom.current = gap < 40
  }

  const isRunning = props.lastRunStatus === 'running' || props.lastRunStatus === 'queued'

  const healthTone = !props.diagnostics
    ? 'warn'
    : props.diagnostics.canExecute && props.diagnostics.runsDirWritable
      ? props.diagnostics.mode === 'bundled'
        ? 'ok'
        : 'warn'
      : 'fail'

  const healthLabel = !props.diagnostics
    ? 'Checking runtime'
    : props.diagnostics.canExecute && props.diagnostics.runsDirWritable
      ? props.diagnostics.mode === 'bundled'
        ? 'Runtime healthy'
        : 'Runtime fallback'
      : 'Runtime issue'

  return (
    <footer className={`ws-bottom${props.collapsed ? ' collapsed' : ''}`}>
      <div className="ws-bottom-head">
        <div className="ws-bottom-tabs">
          <button
            type="button"
            className="ws-btn-icon"
            title={props.collapsed ? 'Expand panel' : 'Collapse panel'}
            onClick={props.onToggleCollapse}
            style={{ fontSize: '0.85rem', marginRight: 4 }}
          >
            {props.collapsed ? '▲' : '▼'}
          </button>
          <button type="button" className={props.bottomTab === 'output' ? 'ws-bottom-tab active' : 'ws-bottom-tab'} onClick={() => { if (props.collapsed) props.onToggleCollapse(); props.onBottomTab('output') }}>
            Request output
          </button>
          <button type="button" className={props.bottomTab === 'logs' ? 'ws-bottom-tab active' : 'ws-bottom-tab'} onClick={() => { if (props.collapsed) props.onToggleCollapse(); props.onBottomTab('logs') }}>
            Logs
            {(props.httpClientLogs?.length ?? 0) + props.logs.length > 0
              ? ` (${(props.httpClientLogs?.length ?? 0) + props.logs.length})`
              : ''}
          </button>
        </div>

        <div className="ws-bottom-meta">
          <span className={`health-badge health-${healthTone}`}>{healthLabel}</span>
          {isRunning ? (
            <button type="button" className="ws-btn stop" onClick={props.onStop} style={{ padding: '4px 10px', fontSize: '0.82rem' }}>
              Stop
            </button>
          ) : null}
          <button type="button" className="ws-btn ghost" style={{ padding: '4px 10px', fontSize: '0.82rem' }} onClick={props.onClearOutput}>
            Clear output
          </button>
          <button type="button" className="ws-btn ghost" style={{ padding: '4px 10px', fontSize: '0.82rem' }} onClick={props.onClearLogs}>
            Clear logs
          </button>
          <span className="muted">
            Run: <span className="mono">{props.lastRunId ?? '—'}</span>
          </span>
          <span className="muted">
            Status: <span className="mono">{props.lastRunStatus}</span>
          </span>
          <label className="ws-inline">
            <span className="muted">Verbose logs</span>
            <input type="checkbox" checked={props.verbose} onChange={(e) => props.onVerboseChange(e.target.checked)} />
          </label>
        </div>
      </div>

      {!props.collapsed ? (
        props.bottomTab === 'output' ? (
          <WorkspaceOutputPanel http={props.httpOutput} k6={props.k6Output} />
        ) : (
          <pre className="ws-logs" ref={logsContainerRef} onScroll={handleLogsScroll}>
            {[...(props.httpClientLogs ?? []), ...props.logs].join('\n')}
            <div ref={logsEndRef} />
          </pre>
        )
      ) : null}
    </footer>
  )
}
