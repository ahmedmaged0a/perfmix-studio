import { useMemo, useState } from 'react'
import { MousePointerClick, Plus, Trash2, Zap } from 'lucide-react'
import { KeyValueTable } from '../../components/ui/KeyValueTable'
import type {
  AssertionType,
  CriteriaToggleKey,
  PerfCriteriaPatch,
  RequestAssertion,
  RequestDefinition,
  RequestTestCase,
} from '../../models/types'
import { isCriteriaToggleOn } from '../../models/types'
import { DURATION_PRESETS, RAMP_PRESETS } from '../durationPresets'
import { BodyMonacoEditor } from './BodyMonacoEditor'
import { PmScriptMonacoEditor } from './PmScriptMonacoEditor'

function parseDurationToSeconds(d: string): number {
  let s = 0
  const mMatch = d.match(/(\d+)\s*m/)
  const sMatch = d.match(/(\d+)\s*s/)
  if (mMatch) s += parseInt(mMatch[1]) * 60
  if (sMatch) s += parseInt(sMatch[1])
  if (s === 0 && /^\d+$/.test(d.trim())) s = parseInt(d.trim())
  return s
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem ? `${m}m ${rem}s` : `${m}m`
}

function totalRunTime(tc: RequestTestCase): string {
  const ramp = parseDurationToSeconds(tc.rampUp)
  const dur = parseDurationToSeconds(tc.duration)
  const total = ramp + dur + 15
  return formatSeconds(total)
}

type Props = {
  request: RequestDefinition | null
  testCase: RequestTestCase | null
  onChangeRequest: (patch: Partial<RequestDefinition>) => void
  onAddTestCase: () => void
  onDeleteTestCase: (id: string) => void
  onSelectTestCase: (id: string) => void
  onChangeTestCase: (id: string, patch: Partial<RequestTestCase>) => void
  onChangeCriteria: (id: string, patch: PerfCriteriaPatch) => void
  onSetCriterionToggle: (tcId: string, key: CriteriaToggleKey, enabled: boolean) => void
  onSetThinkTimeEnabled: (tcId: string, enabled: boolean) => void
  onCommitTestCases: () => void
  onSend: () => void | Promise<void>
  sending: boolean
}

const ASSERTION_TYPES: { value: AssertionType; label: string }[] = [
  { value: 'status_code', label: 'Status code equals' },
  { value: 'body_equals', label: 'Body equals' },
  { value: 'body_contains', label: 'Body contains' },
  { value: 'header_contains', label: 'Header contains value' },
  { value: 'header_visible', label: 'Header is present' },
  { value: 'header_value_equals', label: 'Header value equals' },
]

export function WorkspaceRequestPanel(props: Props) {
  const [requestSubTab, setRequestSubTab] = useState<
    'params' | 'headers' | 'body' | 'assertions' | 'preScript' | 'postScript'
  >('params')

  const request = props.request

  const methodOptions = useMemo(() => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const, [])

  if (!request) {
    return (
      <section className="ws-center">
        <div className="ws-panel ws-empty">
          <div className="ws-empty-state">
            <MousePointerClick size={36} className="ws-empty-state-icon" />
            <p className="ws-empty-state-title">No request selected</p>
            <p className="ws-empty-state-text">
              Select a request from the sidebar, or create a new one to start building.
            </p>
          </div>
        </div>
      </section>
    )
  }

  const crit = props.testCase?.criteria ?? {}

  return (
    <section className="ws-center">
      <div className="ws-panel">
        <div className="ws-urlbar">
          <select
            className="ws-select"
            value={request.method}
            onChange={(e) => props.onChangeRequest({ method: e.target.value as RequestDefinition['method'] })}
          >
            {methodOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            className="ws-input grow"
            value={request.url}
            onChange={(e) => props.onChangeRequest({ url: e.target.value })}
            placeholder="https://api.example.com/path"
          />
          <button
            type="button"
            className="ws-btn primary"
            disabled={props.sending}
            title="Send request (Ctrl+Enter)"
            onClick={() => void props.onSend()}
          >
            {props.sending ? 'Sending…' : 'Send'}
          </button>
        </div>

        <div className="ws-k6-report-banner">
          <div className="ws-k6-report-banner-title">Collection k6 and reporting</div>
          <p className="ws-k6-report-banner-lead">
            For a <strong>whole-collection</strong> k6 run, every request is measured separately. Use the option below when this step is only setup or
            teardown (for example login or logout) and you do not want it in combined averages on the Reporting tab.
          </p>
          <label className="ws-k6-report-banner-checkbox">
            <input
              type="checkbox"
              checked={!!request.excludeFromAggregateReport}
              onChange={(e) => props.onChangeRequest({ excludeFromAggregateReport: e.target.checked })}
            />
            <span>Exclude from aggregate charts and KPIs</span>
          </label>
          <p className="ws-k6-report-banner-hint muted">
            The request still runs in the generated script and keeps its place in the list order above. Only summary rollups ignore it.
          </p>
        </div>

        <div className="ws-subtabs">
          {/* Params */}
          <button type="button" className={requestSubTab === 'params' ? 'ws-subtab active' : 'ws-subtab'} onClick={() => setRequestSubTab('params')}>
            Params
            {Object.keys(request.query ?? {}).length > 0 && (
              <span className="ws-subtab-badge">{Object.keys(request.query).length}</span>
            )}
          </button>
          {/* Headers */}
          <button type="button" className={requestSubTab === 'headers' ? 'ws-subtab active' : 'ws-subtab'} onClick={() => setRequestSubTab('headers')}>
            Headers
            {Object.keys(request.headers ?? {}).length > 0 && (
              <span className="ws-subtab-badge">{Object.keys(request.headers).length}</span>
            )}
          </button>
          {/* Body */}
          <button type="button" className={requestSubTab === 'body' ? 'ws-subtab active' : 'ws-subtab'} onClick={() => setRequestSubTab('body')}>
            Body
            {request.bodyText && <span className="ws-subtab-dot" title="Body has content" />}
          </button>
          {/* Assertions */}
          <button type="button" className={requestSubTab === 'assertions' ? 'ws-subtab active' : 'ws-subtab'} onClick={() => setRequestSubTab('assertions')}>
            Assertions
            {(request.assertions?.length ?? 0) > 0 && (
              <span className="ws-subtab-badge">{request.assertions!.length}</span>
            )}
          </button>
          {/* Pre-request */}
          <button type="button" className={requestSubTab === 'preScript' ? 'ws-subtab active' : 'ws-subtab'} onClick={() => setRequestSubTab('preScript')}>
            Pre-request
            {request.preRequestScript?.trim() && <span className="ws-subtab-dot" title="Script has content" />}
          </button>
          {/* Post-request */}
          <button type="button" className={requestSubTab === 'postScript' ? 'ws-subtab active' : 'ws-subtab'} onClick={() => setRequestSubTab('postScript')}>
            Post-request
            {request.postRequestScript?.trim() && <span className="ws-subtab-dot" title="Script has content" />}
          </button>
        </div>

        {requestSubTab === 'params' ? (
          <div className="ws-field">
            <span className="muted">Query parameters</span>
            <KeyValueTable value={request.query} onChange={(next) => props.onChangeRequest({ query: next })} />
          </div>
        ) : null}

        {requestSubTab === 'headers' ? (
          <div className="ws-field">
            <span className="muted">Headers</span>
            <KeyValueTable value={request.headers} onChange={(next) => props.onChangeRequest({ headers: next })} />
          </div>
        ) : null}

        {requestSubTab === 'body' ? (
          <div className="ws-field">
            <BodyMonacoEditor
              key={request.id}
              requestKey={request.id}
              value={request.bodyText ?? ''}
              onChange={(v) => props.onChangeRequest({ bodyText: v })}
              contentType={
                Object.entries(request.headers ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1]
              }
            />
          </div>
        ) : null}

        {requestSubTab === 'preScript' ? (
          <div className="ws-field">
            <p className="muted tiny" style={{ marginTop: 0 }}>
              Runs in-app before <strong>Send</strong> only (not in exported k6). Uses a Postman-style <span className="mono">pm</span> object; user scripts run in a restricted JS context. Editor includes JavaScript highlighting and completions for <span className="mono">pm</span>.
            </p>
            <PmScriptMonacoEditor
              key={`pre-${request.id}`}
              requestKey={request.id}
              phase="pre"
              value={request.preRequestScript ?? ''}
              onChange={(v) => props.onChangeRequest({ preRequestScript: v })}
              placeholder="// pm.collectionVariables.set('token', '…')"
            />
          </div>
        ) : null}

        {requestSubTab === 'postScript' ? (
          <div className="ws-field">
            <p className="muted tiny" style={{ marginTop: 0 }}>
              Runs after the HTTP response. Use <span className="mono">pm.response.json()</span>, <span className="mono">pm.response.text()</span>, etc.
            </p>
            <PmScriptMonacoEditor
              key={`post-${request.id}`}
              requestKey={request.id}
              phase="post"
              value={request.postRequestScript ?? ''}
              onChange={(v) => props.onChangeRequest({ postRequestScript: v })}
              placeholder="// const j = pm.response.json();"
            />
          </div>
        ) : null}

        {requestSubTab === 'assertions' ? (
          <div className="ws-field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span className="muted">Assertions run on Send and are generated as k6 checks in performance tests.</span>
              <button type="button" className="ws-btn ghost" onClick={() => {
                const a: RequestAssertion = { id: `assert-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, type: 'status_code', enabled: true, target: '200' }
                props.onChangeRequest({ assertions: [...(request.assertions ?? []), a] })
              }}>
                <Plus size={13} style={{ marginRight: 4 }} />
                Assertion
              </button>
            </div>
            {(request.assertions ?? []).length === 0 ? (
              <div className="ws-empty-state ws-empty-state--sm">
                <Zap size={22} className="ws-empty-state-icon" />
                <p className="ws-empty-state-title">No assertions yet</p>
                <p className="ws-empty-state-text">Assertions validate responses on Send and become k6 checks in load tests.</p>
              </div>
            ) : (
              <div className="ws-table-wrap">
                <table className="ws-table">
                  <thead>
                    <tr>
                      <th style={{ width: 30 }}></th>
                      <th>Type</th>
                      <th>Target / Value</th>
                      <th>Expected</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(request.assertions ?? []).map((a) => (
                      <tr key={a.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={a.enabled}
                            onChange={(e) => {
                              const next = (request.assertions ?? []).map((x) => x.id === a.id ? { ...x, enabled: e.target.checked } : x)
                              props.onChangeRequest({ assertions: next })
                            }}
                          />
                        </td>
                        <td>
                          <select
                            className="ws-select table"
                            value={a.type}
                            onChange={(e) => {
                              const next = (request.assertions ?? []).map((x) => x.id === a.id ? { ...x, type: e.target.value as AssertionType } : x)
                              props.onChangeRequest({ assertions: next })
                            }}
                          >
                            {ASSERTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                        </td>
                        <td>
                          <input
                            className="ws-input table"
                            value={a.target}
                            placeholder={a.type === 'status_code' ? '200' : a.type.startsWith('header') ? 'Header-Name' : 'expected text'}
                            onChange={(e) => {
                              const next = (request.assertions ?? []).map((x) => x.id === a.id ? { ...x, target: e.target.value } : x)
                              props.onChangeRequest({ assertions: next })
                            }}
                          />
                        </td>
                        <td>
                          {a.type === 'header_value_equals' || a.type === 'header_contains' ? (
                            <input
                              className="ws-input table"
                              value={a.expected ?? ''}
                              placeholder="expected value"
                              onChange={(e) => {
                                const next = (request.assertions ?? []).map((x) => x.id === a.id ? { ...x, expected: e.target.value } : x)
                                props.onChangeRequest({ assertions: next })
                              }}
                            />
                          ) : <span className="muted">—</span>}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="ws-btn-icon danger"
                            title="Remove assertion"
                            onClick={() => {
                              const next = (request.assertions ?? []).filter((x) => x.id !== a.id)
                              props.onChangeRequest({ assertions: next })
                            }}
                          ><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        <div className="ws-section-head">
          <div>
            <div className="ws-title">Test cases</div>
            <div className="muted">Optional. Each row maps to a k6 scenario.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="ws-btn primary" onClick={props.onCommitTestCases}>
              Save
            </button>
            <button type="button" className="ws-btn ghost" onClick={props.onAddTestCase}>
              + Test case
            </button>
          </div>
        </div>

        {request.testCases.length ? (
          <div className="ws-table-wrap">
            <table className="ws-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>VUs</th>
                  <th>Duration</th>
                  <th>Ramp</th>
                  <th title="Total = Ramp-up + Duration + 15s ramp-down">Total</th>
                  <th>Avg max (ms)</th>
                  <th>p95 max (ms)</th>
                  <th>Err rate max</th>
                  <th>RPS min</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {request.testCases.map((tc) => {
                  const active = props.testCase?.id === tc.id
                  const c = tc.criteria ?? {}
                  const durPreset = (DURATION_PRESETS as readonly string[]).includes(tc.duration)
                  const rampPreset = (RAMP_PRESETS as readonly string[]).includes(tc.rampUp)
                  return (
                    <tr key={tc.id} className={active ? 'active' : ''} onClick={() => props.onSelectTestCase(tc.id)}>
                      <td>
                        <input
                          className="ws-input table"
                          value={tc.name}
                          onChange={(e) => props.onChangeTestCase(tc.id, { name: e.target.value })}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td>
                        <input
                          className="ws-input table"
                          type="number"
                          value={tc.vus}
                          onChange={(e) => props.onChangeTestCase(tc.id, { vus: Number(e.target.value) })}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="ws-td-stack">
                          <select
                            className="ws-select table"
                            value={durPreset ? tc.duration : 'custom'}
                            onChange={(e) => {
                              const v = e.target.value
                              if (v === 'custom') {
                                props.onChangeTestCase(tc.id, { duration: '' })
                                return
                              }
                              props.onChangeTestCase(tc.id, { duration: v })
                            }}
                          >
                            {DURATION_PRESETS.map((d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            ))}
                            <option value="custom">Custom…</option>
                          </select>
                          {!durPreset ? (
                            <input
                              className="ws-input table"
                              value={tc.duration}
                              onChange={(e) => props.onChangeTestCase(tc.id, { duration: e.target.value })}
                              placeholder="e.g. 7m30s"
                            />
                          ) : null}
                        </div>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="ws-td-stack">
                          <select
                            className="ws-select table"
                            value={rampPreset ? tc.rampUp : 'custom'}
                            onChange={(e) => {
                              const v = e.target.value
                              if (v === 'custom') {
                                props.onChangeTestCase(tc.id, { rampUp: '' })
                                return
                              }
                              props.onChangeTestCase(tc.id, { rampUp: v })
                            }}
                          >
                            {RAMP_PRESETS.map((d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            ))}
                            <option value="custom">Custom…</option>
                          </select>
                          {!rampPreset ? (
                            <input
                              className="ws-input table"
                              value={tc.rampUp}
                              onChange={(e) => props.onChangeTestCase(tc.id, { rampUp: e.target.value })}
                              placeholder="e.g. 45s"
                            />
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <span className="mono muted" title="Ramp-up + Duration + 15s ramp-down">{totalRunTime(tc)}</span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="ws-td-stack" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <input
                            type="checkbox"
                            title="Enable avg latency threshold"
                            checked={isCriteriaToggleOn(tc, 'maxAvgMs')}
                            onChange={(e) => props.onSetCriterionToggle(tc.id, 'maxAvgMs', e.target.checked)}
                          />
                          {isCriteriaToggleOn(tc, 'maxAvgMs') ? (
                            <input
                              className="ws-input table"
                              type="number"
                              value={c.maxAvgMs ?? ''}
                              onChange={(e) => {
                                const raw = e.target.value.trim()
                                props.onChangeCriteria(tc.id, { maxAvgMs: raw === '' ? null : Number(raw) })
                              }}
                            />
                          ) : null}
                        </div>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="ws-td-stack" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <input
                            type="checkbox"
                            title="Enable p95 threshold"
                            checked={isCriteriaToggleOn(tc, 'maxP95Ms')}
                            onChange={(e) => props.onSetCriterionToggle(tc.id, 'maxP95Ms', e.target.checked)}
                          />
                          {isCriteriaToggleOn(tc, 'maxP95Ms') ? (
                            <input
                              className="ws-input table"
                              type="number"
                              value={c.maxP95Ms ?? ''}
                              onChange={(e) => {
                                const raw = e.target.value.trim()
                                props.onChangeCriteria(tc.id, { maxP95Ms: raw === '' ? null : Number(raw) })
                              }}
                            />
                          ) : null}
                        </div>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="ws-td-stack" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <input
                            type="checkbox"
                            title="Enable max error rate threshold"
                            checked={isCriteriaToggleOn(tc, 'maxErrorRate')}
                            onChange={(e) => props.onSetCriterionToggle(tc.id, 'maxErrorRate', e.target.checked)}
                          />
                          {isCriteriaToggleOn(tc, 'maxErrorRate') ? (
                            <input
                              className="ws-input table"
                              type="number"
                              step="0.001"
                              value={c.maxErrorRate ?? ''}
                              onChange={(e) => {
                                const raw = e.target.value.trim()
                                props.onChangeCriteria(tc.id, { maxErrorRate: raw === '' ? null : Number(raw) })
                              }}
                            />
                          ) : null}
                        </div>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="ws-td-stack" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <input
                            type="checkbox"
                            title="Enable minimum RPS threshold"
                            checked={isCriteriaToggleOn(tc, 'minThroughputRps')}
                            onChange={(e) => props.onSetCriterionToggle(tc.id, 'minThroughputRps', e.target.checked)}
                          />
                          {isCriteriaToggleOn(tc, 'minThroughputRps') ? (
                            <input
                              className="ws-input table"
                              type="number"
                              step="0.1"
                              value={c.minThroughputRps ?? ''}
                              onChange={(e) => {
                                const raw = e.target.value.trim()
                                props.onChangeCriteria(tc.id, { minThroughputRps: raw === '' ? null : Number(raw) })
                              }}
                            />
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="ws-btn-icon danger"
                          title="Delete test case"
                          onClick={(e) => { e.stopPropagation(); props.onDeleteTestCase(tc.id) }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="ws-muted-panel">No test cases yet. Runs will use the default scenario from the generator.</div>
        )}

        {props.testCase ? (
          <div className="ws-perf">
            <div className="ws-title">Performance criteria (selected test case)</div>
            <div className="ws-perf-grid">
              <label className="ws-field">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    title="Enable think time between iterations"
                    checked={props.testCase.thinkTimeEnabled !== false}
                    onChange={(e) => props.onSetThinkTimeEnabled(props.testCase!.id, e.target.checked)}
                  />
                  <span className="muted">Think time (ms)</span>
                </div>
                {props.testCase.thinkTimeEnabled !== false ? (
                  <input
                    className="ws-input"
                    type="number"
                    value={props.testCase.thinkTimeMs}
                    onChange={(e) => props.onChangeTestCase(props.testCase!.id, { thinkTimeMs: Number(e.target.value) })}
                  />
                ) : (
                  <span className="muted tiny">Off (no pause between iterations in generated k6)</span>
                )}
              </label>
              <label className="ws-field">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    title="Enable p99 latency threshold"
                    checked={isCriteriaToggleOn(props.testCase, 'maxP99Ms')}
                    onChange={(e) => props.onSetCriterionToggle(props.testCase!.id, 'maxP99Ms', e.target.checked)}
                  />
                  <span className="muted">p99 max (ms)</span>
                </div>
                {isCriteriaToggleOn(props.testCase, 'maxP99Ms') ? (
                  <input
                    className="ws-input"
                    type="number"
                    value={crit.maxP99Ms ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value.trim()
                      props.onChangeCriteria(props.testCase!.id, { maxP99Ms: raw === '' ? null : Number(raw) })
                    }}
                  />
                ) : null}
              </label>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
