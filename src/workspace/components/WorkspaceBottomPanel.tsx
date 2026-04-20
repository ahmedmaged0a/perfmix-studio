import { useEffect, useRef, useState, useCallback } from 'react'
import { ChevronUp, ChevronDown, Square, Trash2, Activity, ScrollText, Search, Copy, CheckCheck, X } from 'lucide-react'
import type { HttpOutputPayload, K6RunHistoryMetrics, K6RunStatus, RuntimeDiagnostics } from '../../models/types'
import { WorkspaceOutputPanel } from './WorkspaceOutputPanel'
import { WorkspaceLiveMetrics } from './WorkspaceLiveMetrics'

type BottomTab = 'output' | 'logs'

type K6Payload = {
  at: string
  runId: string | null
  status: string
  metrics: K6RunHistoryMetrics
  hint?: string
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
  httpClientLogs?: string[]
  httpOutput: HttpOutputPayload | null
  httpSending?: boolean
  k6Output: K6Payload | null
  onStop: () => void
  collapsed: boolean
  onToggleCollapse: () => void
  onClearLogs: () => void
  onClearOutput: () => void
}

/** Strip `[  12.3s] ` prefix from desktop k6 logs before classifying. */
function stripLogElapsedPrefix(line: string): string {
  return line.replace(/^\[[\s\d.]+s\]\s*/, '')
}

/** Colorize a log line by severity keywords */
function logLineClass(line: string): string {
  const raw = stripLogElapsedPrefix(line)
  const l = raw.toLowerCase()
  if (/running\s*\(/i.test(raw) || /\[\s*\d+%\s*\]/.test(raw)) return 'log-k6-live'
  if (l.includes('error') || l.includes('fatal') || l.includes('fail')) return 'log-error'
  if (l.includes('warn')) return 'log-warn'
  if (l.includes('info') || l.includes('running') || l.includes('done') || l.includes('pass')) return 'log-info'
  return ''
}

export function WorkspaceBottomPanel(props: Props) {
  const logsEndRef = useRef<HTMLDivElement>(null)
  const logsContainerRef = useRef<HTMLPreElement>(null)
  const wasAtBottom = useRef(true)
  const [logSearch, setLogSearch] = useState('')
  const [copiedLogs, setCopiedLogs] = useState(false)

  const copyAllLogs = useCallback((lines: string[]) => {
    void navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopiedLogs(true)
      setTimeout(() => setCopiedLogs(false), 1500)
    })
  }, [])

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
    ? 'Checking runtime…'
    : props.diagnostics.canExecute && props.diagnostics.runsDirWritable
      ? props.diagnostics.mode === 'bundled'
        ? 'k6 ready'
        : 'k6 via PATH'
      : 'k6 not found'

  const healthTitle = !props.diagnostics
    ? 'Checking if the bundled k6 binary is available'
    : props.diagnostics.canExecute && props.diagnostics.runsDirWritable
      ? props.diagnostics.mode === 'bundled'
        ? 'Bundled k6 binary is available and the runs directory is writable'
        : 'Using system k6 from PATH (bundled binary not found)'
      : 'k6 binary not found — load tests cannot run. Check the docs to install k6.'

  const allLogs = [...(props.httpClientLogs ?? []), ...props.logs]
  const logCount = allLogs.length

  return (
    <footer className={`ws-bottom${props.collapsed ? ' collapsed' : ''}`}>
      <div className="ws-bottom-head">
        <div className="ws-bottom-tabs">
          <button
            type="button"
            className="ws-btn-icon ws-bottom-collapse-btn"
            title={props.collapsed ? 'Expand panel' : 'Collapse panel'}
            onClick={props.onToggleCollapse}
          >
            {props.collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          <button
            type="button"
            className={props.bottomTab === 'output' ? 'ws-bottom-tab active' : 'ws-bottom-tab'}
            onClick={() => {
              if (props.collapsed) props.onToggleCollapse()
              props.onBottomTab('output')
            }}
          >
            <Activity size={13} style={{ marginRight: 5 }} />
            Output
          </button>

          <button
            type="button"
            className={props.bottomTab === 'logs' ? 'ws-bottom-tab active' : 'ws-bottom-tab'}
            onClick={() => {
              if (props.collapsed) props.onToggleCollapse()
              props.onBottomTab('logs')
            }}
          >
            <ScrollText size={13} style={{ marginRight: 5 }} />
            Logs
            {logCount > 0 ? (
              <span className="ws-bottom-tab-badge">{logCount > 999 ? '999+' : logCount}</span>
            ) : null}
          </button>
        </div>

        <div className="ws-bottom-meta">
          <span
            className={`health-badge health-${healthTone}`}
            title={healthTitle}
          >
            {healthLabel}
          </span>

          {isRunning ? (
            <button
              type="button"
              className="ws-btn stop"
              title="Stop the running k6 test"
              onClick={props.onStop}
            >
              <Square size={12} fill="currentColor" style={{ marginRight: 4 }} />
              Stop
            </button>
          ) : null}

          <button
            type="button"
            className="ws-btn ghost ws-btn--sm"
            title="Clear request/response output"
            onClick={props.onClearOutput}
          >
            <Trash2 size={12} style={{ marginRight: 4 }} />
            Clear output
          </button>
          <button
            type="button"
            className="ws-btn ghost ws-btn--sm"
            title="Clear log lines"
            onClick={props.onClearLogs}
          >
            <Trash2 size={12} style={{ marginRight: 4 }} />
            Clear logs
          </button>

          {props.lastRunId ? (
            <span className="muted ws-bottom-run-id" title={`Run ID: ${props.lastRunId}`}>
              Run: <span className="mono">{props.lastRunId}</span>
            </span>
          ) : null}

          <span
            className={`ws-run-status-badge ws-run-status--${props.lastRunStatus}`}
            title={`k6 run status: ${props.lastRunStatus}`}
          >
            {props.lastRunStatus}
          </span>

          <label className="ws-inline" title="Show verbose HTTP and script logs in the Logs tab">
            <span className="muted">Verbose</span>
            <input
              type="checkbox"
              checked={props.verbose}
              onChange={(e) => props.onVerboseChange(e.target.checked)}
            />
          </label>
        </div>
      </div>

      {!props.collapsed ? (
        props.bottomTab === 'output' ? (
          <div className="ws-output-wrap">
            {(isRunning || props.lastRunStatus === 'passed' || props.lastRunStatus === 'failed') ? (
              <WorkspaceLiveMetrics
                logs={props.logs}
                status={props.lastRunStatus}
                runId={props.lastRunId}
              />
            ) : null}
            <WorkspaceOutputPanel http={props.httpOutput} k6={props.k6Output} httpSending={props.httpSending} />
          </div>
        ) : (
          <div className="ws-logs-wrap">
            {/* Log toolbar */}
            <div className="ws-logs-toolbar">
              <div className="ws-logs-search">
                <Search size={12} className="ws-logs-search-icon" />
                <input
                  className="ws-logs-search-input"
                  placeholder="Filter logs…"
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                />
                {logSearch ? (
                  <button className="ws-logs-search-clear" onClick={() => setLogSearch('')} title="Clear filter">
                    <X size={11} />
                  </button>
                ) : null}
              </div>
              <button
                className="ws-btn ghost ws-btn--sm"
                title="Copy all log lines to clipboard"
                onClick={() => copyAllLogs(allLogs)}
                disabled={allLogs.length === 0}
              >
                {copiedLogs ? <CheckCheck size={12} style={{ marginRight: 4 }} /> : <Copy size={12} style={{ marginRight: 4 }} />}
                {copiedLogs ? 'Copied!' : 'Copy all'}
              </button>
            </div>

            {/* Log lines */}
            <pre className="ws-logs" ref={logsContainerRef} onScroll={handleLogsScroll}>
              {(() => {
                const filtered = logSearch.trim()
                  ? allLogs.filter((l) => l.toLowerCase().includes(logSearch.toLowerCase()))
                  : allLogs
                if (filtered.length === 0) {
                  return (
                    <span className="muted" style={{ padding: '12px 16px', display: 'block', fontFamily: 'inherit' }}>
                      {allLogs.length === 0
                        ? 'No logs yet. Send a request or run a load test to see output here.'
                        : `No lines match "${logSearch}"`}
                    </span>
                  )
                }
                return filtered.map((line, i) => (
                  <span key={i} className={`ws-log-line ${logLineClass(line)}`}>
                    {line}{'\n'}
                  </span>
                ))
              })()}
              <div ref={logsEndRef} />
            </pre>
          </div>
        )
      ) : null}
    </footer>
  )
}
