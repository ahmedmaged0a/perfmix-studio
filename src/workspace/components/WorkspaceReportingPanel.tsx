import { useEffect, useMemo, useState } from 'react'
import { BarChart2, Trash2, Download, GitCompare, X, TrendingDown, TrendingUp, Minus } from 'lucide-react'
import type { AppData, Collection, K6RunHistoryEntry, RequestDefinition } from '../../models/types'
import { buildRunHistoryHtml } from '../reporting/exportHistoryHtml'
import { exportHtmlFile, formatExportSuccessToast } from '../../lib/exportHtmlFile'
import { useToastStore } from '../../store/toastStore'
import { WorkspaceReportPanel } from './WorkspaceReportPanel'
import { extractPerRequestMetricsFromSummary } from '../../k6/summaryPerRequest'
import { WorkspaceConfirmModal } from './WorkspaceConfirmModal'

type Props = {
  mode: 'request' | 'collection'
  request: RequestDefinition | null
  collection: Collection | null
  data: AppData | null
  onDeleteEntry: (requestId: string, entryId: string) => void
  onDeleteRunById: (runId: string) => void
}

// ── Diff helpers ───────────────────────────────────────────────────────────────
type DiffDir = 'better' | 'worse' | 'neutral'

function diffDir(metric: 'ms' | 'pct' | 'rps', prev: number | null, cur: number | null): DiffDir {
  if (prev == null || cur == null) return 'neutral'
  const delta = cur - prev
  if (Math.abs(delta) < 0.001) return 'neutral'
  if (metric === 'rps') return delta > 0 ? 'better' : 'worse'
  // ms and pct: lower is better
  return delta < 0 ? 'better' : 'worse'
}

function DiffCell({
  prev,
  cur,
  metric,
  fmt,
}: {
  prev: number | null
  cur: number | null
  metric: 'ms' | 'pct' | 'rps'
  fmt: (v: number) => string
}) {
  const dir = diffDir(metric, prev, cur)
  if (prev == null || cur == null) return <td className="ws-diff-neutral">—</td>
  const delta = cur - prev
  const sign = delta > 0 ? '+' : ''
  const label = `${sign}${fmt(delta)}`
  const Icon = dir === 'better' ? TrendingDown : dir === 'worse' ? TrendingUp : Minus
  return (
    <td className={`ws-diff-${dir}`}>
      <span className="ws-diff-inner">
        <Icon size={11} />
        {label}
      </span>
    </td>
  )
}

function pickLatestCollectionRun(data: AppData | null, collection: Collection | null): K6RunHistoryEntry | null {
  if (!data || !collection) return null
  let best: K6RunHistoryEntry | null = null
  for (const r of collection.requests) {
    const list = data.k6RunHistoryByRequest?.[r.id] ?? []
    for (const e of list) {
      if (e.scope !== 'collection' || e.collectionId !== collection.id) continue
      if (!best || e.at > best.at) best = e
    }
  }
  return best
}

function RunRow({
  entry,
  index,
  isSelected,
  isBaseline,
  isTarget,
  onSelect,
  onSetBaseline,
  onDelete,
}: {
  entry: K6RunHistoryEntry
  index: number
  isSelected: boolean
  isBaseline: boolean
  isTarget: boolean
  onSelect: () => void
  onSetBaseline: () => void
  onDelete: () => void
}) {
  return (
    <div className={`ws-history-item${isSelected ? ' active' : ''}${isBaseline ? ' ws-history-baseline' : ''}${isTarget ? ' ws-history-target' : ''}`}>
      <button
        type="button"
        className="ws-history-item-btn"
        onClick={onSelect}
        title="Select this run to view its report"
      >
        <div className="ws-history-badges">
          {isBaseline ? <span className="ws-compare-badge ws-compare-badge--base">Base</span> : null}
          {isTarget ? <span className="ws-compare-badge ws-compare-badge--target">Compare</span> : null}
          <span className={`pill ws-run-status ws-run-status--${entry.status}`}>{entry.status}</span>
          <span className="muted tiny">#{index + 1}</span>
        </div>
        <div className="ws-history-when">{new Date(entry.at).toLocaleString()}</div>
        <div className="ws-history-metrics">
          <span>Avg <strong>{entry.metrics.avgMs == null ? '—' : `${entry.metrics.avgMs.toFixed(0)} ms`}</strong></span>
          {entry.metrics.p95Ms != null ? <span className="muted">p95 {entry.metrics.p95Ms.toFixed(0)} ms</span> : null}
          {entry.metrics.errorRate != null ? (
            <span className={entry.metrics.errorRate > 0 ? 'log-error' : 'muted'}>
              err {(entry.metrics.errorRate * 100).toFixed(2)}%
            </span>
          ) : null}
        </div>
      </button>

      <div className="ws-history-item-actions">
        <button
          type="button"
          className={`ws-btn-icon ws-btn-icon--sm${isBaseline ? ' active' : ''}`}
          title={isBaseline ? 'Currently set as baseline' : 'Set as baseline for comparison'}
          onClick={(e) => { e.stopPropagation(); onSetBaseline() }}
        >
          <GitCompare size={12} />
        </button>
        <button
          type="button"
          className="ws-btn-icon ws-btn-icon--sm danger"
          title="Delete this run"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

export function WorkspaceReportingPanel(props: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [baselineId, setBaselineId] = useState<string | null>(null)
  const [compareMode, setCompareMode] = useState(false)
  // Confirm modals replacing window.confirm
  const [deleteCollectionRunId, setDeleteCollectionRunId] = useState<string | null>(null)
  const [deleteRowTarget, setDeleteRowTarget] = useState<K6RunHistoryEntry | null>(null)

  const history =
    props.mode === 'request' && props.request
      ? (props.data?.k6RunHistoryByRequest?.[props.request.id] ?? [])
      : []

  const rows = useMemo(() => [...history].reverse(), [history])
  const selected = rows.find((r) => r.id === selectedId) ?? rows[0] ?? null
  const baseline = rows.find((r) => r.id === baselineId) ?? null

  const latestCollectionRun = useMemo(
    () => (props.mode === 'collection' ? pickLatestCollectionRun(props.data, props.collection) : null),
    [props.mode, props.data, props.collection],
  )

  const perRequestRows = useMemo(() => {
    if (!latestCollectionRun?.summaryJson || !props.collection) return []
    const tagged = extractPerRequestMetricsFromSummary(latestCollectionRun.summaryJson)
    const byId = new Map(tagged.map((t) => [t.requestId, t]))
    return props.collection.requests.map((req) => {
      const row = byId.get(req.id)
      const excluded = !!req.excludeFromAggregateReport || row?.reportingExcluded
      return {
        id: req.id,
        name: req.name,
        avgMs: row?.avgMs ?? null,
        p95Ms: row?.p95Ms ?? null,
        errorRate: row?.errorRate ?? null,
        rps: row?.rps ?? null,
        excluded,
        noData: !row,
      }
    })
  }, [latestCollectionRun?.summaryJson, props.collection])

  const pushToast = useToastStore((s) => s.pushToast)

  useEffect(() => {
    setSelectedId(null)
    setBaselineId(null)
    setCompareMode(false)
  }, [props.request?.id, props.mode, props.collection?.id])

  const download = () => {
    if (!props.request) return
    const html = buildRunHistoryHtml(props.request.name, history)
    const dateStr = new Date().toISOString().slice(0, 10)
    const defaultFileName = `${props.request.name.replace(/\s+/g, '_')}_history_${dateStr}.html`
    void (async () => {
      const result = await exportHtmlFile({ html, defaultFileName })
      if (!result.ok) {
        if (result.reason === 'cancelled') {
          pushToast('Export cancelled.', 'info')
          return
        }
        pushToast(result.message, 'error')
        return
      }
      pushToast(formatExportSuccessToast(result), 'success')
    })()
  }

  const reportingModals = (
    <>
      <WorkspaceConfirmModal
        open={!!deleteCollectionRunId}
        titleId="ws-del-col-run-title"
        title="Delete collection run?"
        confirmLabel="Delete run"
        danger
        onClose={() => setDeleteCollectionRunId(null)}
        onConfirm={() => { if (deleteCollectionRunId) props.onDeleteRunById(deleteCollectionRunId) }}
      >
        <p style={{ margin: 0, lineHeight: 1.5 }}>
          This collection run will be removed from history for <strong>all requests</strong> in the collection.
        </p>
        <p className="muted" style={{ margin: '10px 0 0' }}>This cannot be undone.</p>
      </WorkspaceConfirmModal>

      <WorkspaceConfirmModal
        open={!!deleteRowTarget}
        titleId="ws-del-row-run-title"
        title="Delete collection run?"
        confirmLabel="Delete run"
        danger
        onClose={() => setDeleteRowTarget(null)}
        onConfirm={() => { if (deleteRowTarget) props.onDeleteRunById(deleteRowTarget.runId) }}
      >
        <p style={{ margin: 0, lineHeight: 1.5 }}>
          This collection run will be removed from history for <strong>all requests</strong> in the collection.
        </p>
        <p className="muted" style={{ margin: '10px 0 0' }}>This cannot be undone.</p>
      </WorkspaceConfirmModal>
    </>
  )

  // ── Collection mode ──────────────────────────────────────────────────────────
  if (props.mode === 'collection') {
    return (
      <>
      <div className="ws-reporting">
        <div className="ws-reporting-head">
          <div className="ws-reporting-title-group">
            <BarChart2 size={15} className="ws-reporting-title-icon" />
            <div>
              <div className="ws-title">Reporting — collection</div>
              <p className="muted ws-reporting-sub">
                Per-request metrics from the latest whole-collection k6 run.
              </p>
            </div>
          </div>
          {latestCollectionRun ? (
            <button
              type="button"
              className="ws-btn ws-btn--sm danger"
              onClick={() => setDeleteCollectionRunId(latestCollectionRun.runId)}
            >
              <Trash2 size={13} style={{ marginRight: 5 }} />
              Delete run
            </button>
          ) : null}
        </div>

        {!latestCollectionRun ? (
          <div className="ws-empty-state" style={{ paddingTop: 48 }}>
            <BarChart2 size={36} className="ws-empty-state-icon" />
            <p className="ws-empty-state-text">No collection runs yet</p>
            <p className="ws-empty-state-sub muted">Set Script scope to "Whole collection" and click Run from the top bar.</p>
          </div>
        ) : (
          <div className="ws-reporting-body ws-reporting-body--col">
            <p className="muted tiny">
              Run <span className="mono">{latestCollectionRun.runId}</span> &mdash; {new Date(latestCollectionRun.at).toLocaleString()}{' '}
              <span className={`pill ws-run-status ws-run-status--${latestCollectionRun.status}`}>{latestCollectionRun.status}</span>
            </p>

            <div className="ws-panel">
              <div className="ws-title" style={{ marginBottom: 10 }}>Per-request breakdown</div>
              <table className="ws-diff">
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Avg (ms)</th>
                    <th>p95 (ms)</th>
                    <th>Errors</th>
                    <th>RPS</th>
                    <th>Report</th>
                  </tr>
                </thead>
                <tbody>
                  {perRequestRows.map((row) => (
                    <tr key={row.id} className={row.excluded ? 'ws-diff-row--excluded' : ''}>
                      <td>{row.name}</td>
                      <td>{row.avgMs == null ? '—' : row.avgMs.toFixed(1)}</td>
                      <td>{row.p95Ms == null ? '—' : row.p95Ms.toFixed(1)}</td>
                      <td className={row.errorRate != null && row.errorRate > 0 ? 'log-error' : ''}>
                        {row.errorRate == null ? '—' : `${(row.errorRate * 100).toFixed(3)}%`}
                      </td>
                      <td>{row.rps == null ? '—' : row.rps.toFixed(2)}</td>
                      <td className="muted">{row.excluded ? 'Excluded' : 'Included'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <WorkspaceReportPanel
              summaryJson={latestCollectionRun.summaryJson ?? null}
              runId={latestCollectionRun.runId}
              reportHtmlPath={null}
              request={null}
              embedded
              aggregateKpisExcludeHiddenRequests
            />
          </div>
        )}
      </div>
      {reportingModals}
      </>
    )
  }

  // ── Request mode ─────────────────────────────────────────────────────────────
  const canCompare = rows.length >= 2

  // Comparison table between baseline and selected (or selected vs previous)
  const compareBase = compareMode && baseline ? baseline : (rows[rows.findIndex((x) => x.id === selected?.id) + 1] ?? null)
  const compareTarget = selected

  return (
    <>
    <div className="ws-reporting">
      <div className="ws-reporting-head">
        <div className="ws-reporting-title-group">
          <BarChart2 size={15} className="ws-reporting-title-icon" />
          <div>
            <div className="ws-title">Reporting</div>
            <p className="muted ws-reporting-sub">
              {props.request?.name ?? '—'} &mdash; {rows.length} run{rows.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="ws-reporting-head-actions">
          {canCompare ? (
            <button
              type="button"
              className={`ws-btn ws-btn--sm${compareMode ? '' : ' ghost'}`}
              title={compareMode ? 'Exit compare mode' : 'Compare any two runs side-by-side'}
              onClick={() => setCompareMode((p) => !p)}
            >
              {compareMode ? <X size={13} style={{ marginRight: 5 }} /> : <GitCompare size={13} style={{ marginRight: 5 }} />}
              {compareMode ? 'Exit compare' : 'Compare runs'}
            </button>
          ) : null}
          <button
            type="button"
            className="ws-btn ws-btn--sm ghost"
            disabled={!props.request || !history.length}
            onClick={download}
            title="Download run history as HTML report"
          >
            <Download size={13} style={{ marginRight: 5 }} />
            Export HTML
          </button>
        </div>
      </div>

      {compareMode ? (
        <div className="ws-compare-hint muted">
          Click <GitCompare size={11} /> on any run to set it as the <strong>baseline</strong>, then select another run to compare against it.
          {baseline ? (
            <> Baseline: <span className="mono">{new Date(baseline.at).toLocaleString()}</span></>
          ) : (
            <> No baseline selected yet — pick one from the list.</>
          )}
        </div>
      ) : null}

      {!props.request || !history.length ? (
        <div className="ws-empty-state" style={{ paddingTop: 48 }}>
          <BarChart2 size={36} className="ws-empty-state-icon" />
          <p className="ws-empty-state-text">No runs yet</p>
          <p className="ws-empty-state-sub muted">Run k6 from the top bar to build history for this request.</p>
        </div>
      ) : (
        <div className="ws-reporting-body">
          {/* Run list */}
          <div className="ws-history-list">
            {rows.map((e, idx) => (
              <RunRow
                key={e.id}
                entry={e}
                index={idx}
                isSelected={selected?.id === e.id}
                isBaseline={compareMode && baseline?.id === e.id}
                isTarget={compareMode && selected?.id === e.id && baseline?.id !== e.id}
                onSelect={() => setSelectedId(e.id)}
                onSetBaseline={() => setBaselineId(e.id)}
                onDelete={() => {
                  if (e.scope === 'collection') {
                    setDeleteRowTarget(e)
                  } else {
                    props.onDeleteEntry(props.request!.id, e.id)
                  }
                }}
              />
            ))}
          </div>

          {/* Detail pane */}
          <div className="ws-reporting-detail">
            {selected ? (
              <>
                <div className="ws-reporting-detail-head">
                  <div className="ws-title">
                    {compareMode && compareBase ? 'Comparison' : 'Run details'}
                  </div>
                  <span className="muted tiny">
                    <span className="mono">{selected.runId}</span> &mdash; {new Date(selected.at).toLocaleString()}
                  </span>
                </div>

                {/* Comparison table */}
                {compareBase ? (
                  <div className="ws-compare-table-wrap">
                    {compareMode && !baseline ? (
                      <p className="muted tiny">Set a baseline to enable detailed comparison.</p>
                    ) : (
                      <>
                        <div className="ws-compare-labels">
                          <span className="ws-compare-badge ws-compare-badge--base">
                            Base: {new Date(compareBase.at).toLocaleString()}
                          </span>
                          <span className="ws-compare-badge ws-compare-badge--target">
                            Compare: {new Date(selected.at).toLocaleString()}
                          </span>
                        </div>
                        <table className="ws-diff ws-diff--compare">
                          <thead>
                            <tr>
                              <th>Metric</th>
                              <th>Base</th>
                              <th>Compare</th>
                              <th>Change</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>Avg response</td>
                              <td>{compareBase.metrics.avgMs?.toFixed(1) ?? '—'} ms</td>
                              <td>{compareTarget?.metrics.avgMs?.toFixed(1) ?? '—'} ms</td>
                              <DiffCell
                                prev={compareBase.metrics.avgMs}
                                cur={compareTarget?.metrics.avgMs ?? null}
                                metric="ms"
                                fmt={(v) => `${v.toFixed(1)} ms`}
                              />
                            </tr>
                            <tr>
                              <td>p95 response</td>
                              <td>{compareBase.metrics.p95Ms?.toFixed(1) ?? '—'} ms</td>
                              <td>{compareTarget?.metrics.p95Ms?.toFixed(1) ?? '—'} ms</td>
                              <DiffCell
                                prev={compareBase.metrics.p95Ms}
                                cur={compareTarget?.metrics.p95Ms ?? null}
                                metric="ms"
                                fmt={(v) => `${v.toFixed(1)} ms`}
                              />
                            </tr>
                            <tr>
                              <td>Error rate</td>
                              <td>{compareBase.metrics.errorRate == null ? '—' : `${(compareBase.metrics.errorRate * 100).toFixed(3)}%`}</td>
                              <td>{compareTarget?.metrics.errorRate == null ? '—' : `${((compareTarget.metrics.errorRate) * 100).toFixed(3)}%`}</td>
                              <DiffCell
                                prev={compareBase.metrics.errorRate}
                                cur={compareTarget?.metrics.errorRate ?? null}
                                metric="pct"
                                fmt={(v) => `${(v * 100).toFixed(3)} pp`}
                              />
                            </tr>
                            <tr>
                              <td>Throughput</td>
                              <td>{compareBase.metrics.rps?.toFixed(2) ?? '—'} rps</td>
                              <td>{compareTarget?.metrics.rps?.toFixed(2) ?? '—'} rps</td>
                              <DiffCell
                                prev={compareBase.metrics.rps}
                                cur={compareTarget?.metrics.rps ?? null}
                                metric="rps"
                                fmt={(v) => `${v.toFixed(2)} rps`}
                              />
                            </tr>
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>
                ) : (
                  <p className="muted tiny" style={{ marginBottom: 12 }}>No previous run to compare. This is the earliest recorded run.</p>
                )}

                {/* Full report */}
                <div className="ws-reporting-detail-report">
                  <WorkspaceReportPanel
                    summaryJson={selected.summaryJson ?? null}
                    runId={selected.runId}
                    reportHtmlPath={null}
                    request={props.request}
                    embedded
                    aggregateKpisExcludeHiddenRequests={selected.scope === 'collection'}
                  />
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
    {reportingModals}
  </>
  )
}
