import { useEffect, useMemo, useState } from 'react'
import type { K6RunHistoryEntry, RequestDefinition } from '../../models/types'
import { buildRunHistoryHtml } from '../reporting/exportHistoryHtml'
import { WorkspaceReportPanel } from './WorkspaceReportPanel'

type Props = {
  request: RequestDefinition | null
  history: K6RunHistoryEntry[]
  onDeleteEntry: (entryId: string) => void
}

function diffLabel(prev: number | null, cur: number | null) {
  if (prev == null || cur == null) return '—'
  const d = cur - prev
  const sign = d > 0 ? '+' : ''
  return `${sign}${d.toFixed(1)}`
}

export function WorkspaceReportingPanel(props: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const rows = useMemo(() => [...props.history].reverse(), [props.history])
  const selected = rows.find((r) => r.id === selectedId) ?? rows[0] ?? null

  useEffect(() => {
    setSelectedId(null)
  }, [props.request?.id])

  const download = () => {
    if (!props.request) return
    const html = buildRunHistoryHtml(props.request.name, props.history)
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const dateStr = new Date().toISOString().slice(0, 10)
    a.download = `${props.request.name.replace(/\s+/g, '_')}_history_${dateStr}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="ws-reporting">
      <div className="ws-reporting-head">
        <div>
          <div className="ws-title">Reporting</div>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Timeline for <span className="mono">{props.request?.name ?? '—'}</span>. Pick a row to compare against the previous run.
          </p>
        </div>
        <button type="button" className="ws-btn" disabled={!props.request || !props.history.length} onClick={download}>
          Download history HTML
        </button>
      </div>

      {!props.request || !props.history.length ? (
        <div className="ws-muted-panel">No saved runs for this request yet. Run k6 from the top bar to build history.</div>
      ) : (
        <div className="ws-reporting-body">
          <div className="ws-history-list">
            {rows.map((e, idx) => {
              const prev = rows[idx + 1]
              const active = selected?.id === e.id
              return (
                <div key={e.id} className={`ws-history-item${active ? ' active' : ''}`} style={{ position: 'relative' }}>
                  <button type="button" style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }} onClick={() => setSelectedId(e.id)}>
                    <div className="ws-history-when">{new Date(e.at).toLocaleString()}</div>
                    <div className="ws-history-meta">
                      <span className={`pill ws-run-status ws-run-status--${e.status}`}>{e.status}</span>
                      <span className="muted tiny">{e.scope}</span>
                    </div>
                    <div className="ws-history-metrics">
                      <span>Avg {e.metrics.avgMs == null ? '—' : `${e.metrics.avgMs.toFixed(0)}ms`}</span>
                      <span className="muted">
                        Δ {diffLabel(prev?.metrics.avgMs ?? null, e.metrics.avgMs)} ms vs prev
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="ws-btn-icon danger"
                    title="Delete this run"
                    style={{ position: 'absolute', top: 6, right: 6 }}
                    onClick={(ev) => { ev.stopPropagation(); props.onDeleteEntry(e.id) }}
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
          <div className="ws-reporting-detail">
            {selected ? (
              <>
                <div className="ws-title">Selected run</div>
                <p className="muted tiny">
                  Run id <span className="mono">{selected.runId}</span> at {new Date(selected.at).toLocaleString()}
                </p>
                {(() => {
                  const idx = rows.findIndex((x) => x.id === selected.id)
                  const prev = idx >= 0 ? rows[idx + 1] : undefined
                  if (!prev) return <p className="muted">No previous run to diff against.</p>
                  return (
                    <table className="ws-diff">
                      <thead>
                        <tr>
                          <th>Metric</th>
                          <th>Previous</th>
                          <th>Current</th>
                          <th>Δ</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Avg</td>
                          <td>{prev.metrics.avgMs?.toFixed(1) ?? '—'}</td>
                          <td>{selected.metrics.avgMs?.toFixed(1) ?? '—'}</td>
                          <td>{diffLabel(prev.metrics.avgMs, selected.metrics.avgMs)}</td>
                        </tr>
                        <tr>
                          <td>p95</td>
                          <td>{prev.metrics.p95Ms?.toFixed(1) ?? '—'}</td>
                          <td>{selected.metrics.p95Ms?.toFixed(1) ?? '—'}</td>
                          <td>{diffLabel(prev.metrics.p95Ms, selected.metrics.p95Ms)}</td>
                        </tr>
                        <tr>
                          <td>Errors</td>
                          <td>{prev.metrics.errorRate == null ? '—' : `${(prev.metrics.errorRate * 100).toFixed(3)}%`}</td>
                          <td>{selected.metrics.errorRate == null ? '—' : `${(selected.metrics.errorRate * 100).toFixed(3)}%`}</td>
                          <td>
                            {prev.metrics.errorRate != null && selected.metrics.errorRate != null
                              ? `${((selected.metrics.errorRate - prev.metrics.errorRate) * 100).toFixed(3)} pp`
                              : '—'}
                          </td>
                        </tr>
                        <tr>
                          <td>RPS</td>
                          <td>{prev.metrics.rps?.toFixed(2) ?? '—'}</td>
                          <td>{selected.metrics.rps?.toFixed(2) ?? '—'}</td>
                          <td>{diffLabel(prev.metrics.rps, selected.metrics.rps)}</td>
                        </tr>
                      </tbody>
                    </table>
                  )
                })()}
                <div style={{ marginTop: 14 }}>
                  <WorkspaceReportPanel summaryJson={selected.summaryJson ?? null} runId={selected.runId} reportHtmlPath={null} request={props.request} embedded />
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
