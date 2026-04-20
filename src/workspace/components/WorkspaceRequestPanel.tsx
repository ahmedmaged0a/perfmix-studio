import { useState } from 'react'
import { MousePointerClick, Plus, Trash2, Zap } from 'lucide-react'
import { KeyValueTable } from '../../components/ui/KeyValueTable'
import { AppSelect, MethodSelect } from '../../components/ui/AppSelect'
import type {
  AssertionType,
  BodyType,
  CriteriaToggleKey,
  JmeterJsr223PostProcessor,
  PerfCriteriaPatch,
  RequestAssertion,
  RequestDefinition,
  RequestTestCase,
} from '../../models/types'
import { isCriteriaToggleOn } from '../../models/types'
import { DURATION_PRESETS, RAMP_PRESETS } from '../durationPresets'
import { BodyMonacoEditor } from './BodyMonacoEditor'
import { PmScriptMonacoEditor } from './PmScriptMonacoEditor'
import { inferStoredPayloadBodyType } from '../inferRequestBodyType'
import { parseDurationToSeconds } from '../durationParse'

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem ? `${m}m ${rem}s` : `${m}m`
}

function totalRunTime(tc: RequestTestCase): string {
  const ramp = parseDurationToSeconds(tc.rampUp)
  const dur = parseDurationToSeconds(tc.duration)
  let rampDownSec = 0
  if (tc.rampDownEnabled) {
    const rd = (tc.rampDown ?? '').trim()
    rampDownSec = rd ? parseDurationToSeconds(rd) : 0
  }
  const total = ramp + dur + rampDownSec
  return formatSeconds(total)
}

type Props = {
  request: RequestDefinition | null
  testCase: RequestTestCase | null
  uiTheme: 'dark' | 'light'
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

const BODY_TYPES: { value: BodyType; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'form-data', label: 'Form Data' },
  { value: 'x-www-form-urlencoded', label: 'x-www-form-urlencoded' },
  { value: 'json', label: 'JSON' },
  { value: 'xml', label: 'XML' },
  { value: 'text', label: 'Text' },
  { value: 'binary', label: 'Binary' },
  { value: 'graphql', label: 'GraphQL' },
  { value: 'msgpack', label: 'Msgpack' },
]

export function WorkspaceRequestPanel(props: Props) {
  const [requestSubTab, setRequestSubTab] = useState<
    'params' | 'headers' | 'body' | 'assertions' | 'preScript' | 'postScript' | 'jsr223'
  >('params')

  const request = props.request


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

  const activeBodyType = request.bodyType ?? 'none'
  const storedPayloadBodyType = inferStoredPayloadBodyType(request)
  const bodyTypeMismatch =
    storedPayloadBodyType != null && storedPayloadBodyType !== activeBodyType

  const jsr223Blocks = request.jmeterJsr223PostProcessors ?? []
  const jsr223HasContent = jsr223Blocks.some((b) => (b.script ?? '').trim().length > 0)

  return (
    <section className="ws-center">
      <div className="ws-panel">
        <div className="ws-urlbar">
          <MethodSelect
            value={request.method}
            onChange={(m) => props.onChangeRequest({ method: m })}
          />
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
          {request.jmeterThreadGroupKind === 'teardown' ? (
            <p className="muted" style={{ marginTop: 12, fontSize: 12, lineHeight: 1.35 }}>
              <strong>Teardown</strong> (from JMX PostThreadGroup). This phase is excluded from the main k6 loop; full
              teardown parity is not generated yet.
            </p>
          ) : (
            <>
              <label className="ws-k6-report-banner-checkbox" style={{ marginTop: 12 }}>
                <input
                  type="checkbox"
                  checked={request.jmeterThreadGroupKind === 'setup'}
                  onChange={(e) =>
                    props.onChangeRequest({
                      jmeterThreadGroupKind: e.target.checked ? 'setup' : undefined,
                    })
                  }
                />
                <span>Run once in k6 setup (before VU iterations)</span>
              </label>
              <p className="muted" style={{ marginTop: 6, fontSize: 12, lineHeight: 1.35 }}>
                When checked, this request is emitted inside <code>export function setup()</code> for a <strong>sequential journey</strong>{' '}
                export (with other non-setup requests in the per-iteration loop). Unchecked means the normal main journey
                (every iteration). Parallel collection export does not split setup — use sequential if you rely on this.
              </p>
            </>
          )}
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
            {bodyTypeMismatch ? (
              <span className="ws-subtab-dot" title="Body content does not match the selected body type — open Body to see the highlighted type" />
            ) : null}
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
          <button type="button" className={requestSubTab === 'jsr223' ? 'ws-subtab active' : 'ws-subtab'} onClick={() => setRequestSubTab('jsr223')}>
            JSR223 (JMeter)
            {(jsr223Blocks.length > 0 || jsr223HasContent) && (
              <span className="ws-subtab-dot" title="JMeter JSR223 PostProcessor script(s)" />
            )}
          </button>
        </div>

        {requestSubTab === 'params' ? (
          <div className="ws-field">
            <KeyValueTable
              value={request.query}
              onChange={(next) => props.onChangeRequest({ query: next })}
              keyLabel="Key"
              valueLabel="Value"
              keyPlaceholder="field"
              valuePlaceholder="value or {{variable}}"
            />
          </div>
        ) : null}

        {requestSubTab === 'headers' ? (
          <div className="ws-field">
            <KeyValueTable
              value={request.headers}
              onChange={(next) => props.onChangeRequest({ headers: next })}
              keyLabel="Key"
              valueLabel="Value"
              keyPlaceholder="field"
              valuePlaceholder="value or {{variable}}"
            />
          </div>
        ) : null}

        {requestSubTab === 'body' ? (
          <div className="ws-body-tab">
            {/* Body type selector */}
            <div className="ws-body-type-bar">
              {BODY_TYPES.map((bt) => {
                const isActive = activeBodyType === bt.value
                const showPayloadHint =
                  storedPayloadBodyType != null &&
                  storedPayloadBodyType === bt.value &&
                  !isActive
                return (
                  <button
                    key={bt.value}
                    type="button"
                    className={`ws-body-type-btn${isActive ? ' active' : ''}${showPayloadHint ? ' ws-body-type-btn--payload' : ''}`}
                    onClick={() => props.onChangeRequest({ bodyType: bt.value })}
                  >
                    {bt.label}
                  </button>
                )
              })}
            </div>

            {/* Body content based on selected type */}
            {activeBodyType === 'none' && storedPayloadBodyType ? (
              <div className="ws-muted-panel ws-body-none">
                <p style={{ margin: '0 0 8px' }}>
                  Selected type is <strong>None</strong>, but this request still has payload data (best match:{' '}
                  <strong>{storedPayloadBodyType}</strong>). Click the highlighted type above to view or edit it.
                </p>
              </div>
            ) : activeBodyType === 'none' ? (
              <div className="ws-muted-panel ws-body-none">
                No body — this request sends no payload.
              </div>
            ) : activeBodyType === 'form-data' || activeBodyType === 'x-www-form-urlencoded' ? (
              <div className="ws-field">
                <KeyValueTable
                  value={request.bodyFormData ?? {}}
                  onChange={(next) => props.onChangeRequest({ bodyFormData: next })}
                  keyLabel="Key"
                  valueLabel="Value"
                  keyPlaceholder="field"
                  valuePlaceholder="value or {{variable}}"
                />
              </div>
            ) : activeBodyType === 'binary' ? (
              <div className="ws-body-binary">
                <p className="muted" style={{ marginBottom: 8 }}>
                  Select a file to send as the raw binary body.
                </p>
                <input
                  type="file"
                  className="ws-body-binary-input"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) props.onChangeRequest({ bodyText: file.name })
                  }}
                />
                {request.bodyText ? (
                  <p className="muted tiny" style={{ marginTop: 6 }}>
                    Selected: <span className="mono">{request.bodyText}</span>
                  </p>
                ) : null}
              </div>
            ) : (
              <BodyMonacoEditor
                key={`${request.id}-${activeBodyType}`}
                requestKey={request.id}
                uiTheme={props.uiTheme}
                bodyType={activeBodyType as RequestDefinition['bodyType']}
                value={request.bodyText ?? ''}
                onChange={(v) => props.onChangeRequest({ bodyText: v })}
                contentType={
                  Object.entries(request.headers ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1]
                }
              />
            )}
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
              uiTheme={props.uiTheme}
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
              uiTheme={props.uiTheme}
              phase="post"
              value={request.postRequestScript ?? ''}
              onChange={(v) => props.onChangeRequest({ postRequestScript: v })}
              placeholder="// const j = pm.response.json();"
            />
          </div>
        ) : null}

        {requestSubTab === 'jsr223' ? (
          <div className="ws-field">
            <p className="muted tiny" style={{ marginTop: 0 }}>
              Scripts imported from JMeter <strong>JSR223 PostProcessor</strong> elements (Groovy/Java). PerfMix does not run full Groovy: on{' '}
              <strong>Send</strong>, the shim runs <strong>after</strong> extractors <em>and</em> built-in EUUM token handling so lines like{' '}
              <span className="mono">props.put(&quot;token&quot;, vars.get(&quot;accessToken&quot;))</span> see{' '}
              <span className="mono">accessToken</span> from the token response. It applies <span className="mono">props.put</span> /{' '}
              <span className="mono">vars.put</span> with <span className="mono">vars.get(&quot;…&quot;)</span> or string literals into RUNTIME (
              <span className="mono">{'{{token}}'}</span>).
            </p>
            {jsr223Blocks.length === 0 ? (
              <div className="ws-empty-state ws-empty-state--sm" style={{ marginTop: 8 }}>
                <Zap size={22} className="ws-empty-state-icon" />
                <p className="ws-empty-state-title">No JSR223 PostProcessors</p>
                <p className="ws-empty-state-text">Import a JMX that attaches processors after this sampler, or add a block manually.</p>
                <button
                  type="button"
                  className="ws-btn ws-btn--outline-accent"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    const block: JmeterJsr223PostProcessor = {
                      id: `jsr-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
                      script: '// props.put("token", vars.get("accessToken"))\n',
                    }
                    props.onChangeRequest({ jmeterJsr223PostProcessors: [block] })
                  }}
                >
                  <Plus size={13} strokeWidth={2.5} style={{ marginRight: 4 }} />
                  Add JSR223 processor
                </button>
              </div>
            ) : (
              <div className="ws-field" style={{ marginTop: 8 }}>
                {jsr223Blocks.map((p, i) => (
                  <div
                    key={p.id}
                    style={{
                      marginBottom: 16,
                      paddingBottom: 16,
                      borderBottom: i < jsr223Blocks.length - 1 ? '1px solid var(--ws-border, #2a2a2e)' : undefined,
                    }}
                  >
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                      <input
                        className="ws-input grow"
                        placeholder="Label (optional, from JMeter testname)"
                        value={p.label ?? ''}
                        onChange={(e) => {
                          const next = [...jsr223Blocks]
                          next[i] = { ...next[i], label: e.target.value || undefined }
                          props.onChangeRequest({ jmeterJsr223PostProcessors: next })
                        }}
                      />
                      <button
                        type="button"
                        className="ws-btn ws-btn--outline-accent"
                        title="Remove this processor"
                        onClick={() => {
                          const next = jsr223Blocks.filter((_, j) => j !== i)
                          props.onChangeRequest({
                            jmeterJsr223PostProcessors: next.length ? next : undefined,
                          })
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    {p.language ? (
                      <p className="muted tiny" style={{ marginTop: 0 }}>
                        Language (import): <span className="mono">{p.language}</span>
                      </p>
                    ) : null}
                    <PmScriptMonacoEditor
                      key={`jsr-${request.id}-${p.id}`}
                      requestKey={`${request.id}-${p.id}`}
                      uiTheme={props.uiTheme}
                      phase="jsr223"
                      value={p.script ?? ''}
                      onChange={(v) => {
                        const next = [...jsr223Blocks]
                        next[i] = { ...next[i], script: v }
                        props.onChangeRequest({ jmeterJsr223PostProcessors: next })
                      }}
                      placeholder="// props.put(&quot;token&quot;, vars.get(&quot;accessToken&quot;))"
                    />
                  </div>
                ))}
                <button
                  type="button"
                  className="ws-btn ws-btn--outline-accent"
                  style={{ marginTop: 4 }}
                  onClick={() => {
                    const block: JmeterJsr223PostProcessor = {
                      id: `jsr-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
                      script: '',
                    }
                    props.onChangeRequest({ jmeterJsr223PostProcessors: [...jsr223Blocks, block] })
                  }}
                >
                  <Plus size={13} strokeWidth={2.5} style={{ marginRight: 4 }} />
                  Add another processor
                </button>
              </div>
            )}
          </div>
        ) : null}

        {requestSubTab === 'assertions' ? (
          <div className="ws-field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span className="muted">Assertions run on Send and are generated as k6 checks in performance tests.</span>
              <button type="button" className="ws-btn ws-btn--outline-accent" onClick={() => {
                const a: RequestAssertion = { id: `assert-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, type: 'status_code', enabled: true, target: '200' }
                props.onChangeRequest({ assertions: [...(request.assertions ?? []), a] })
              }}>
                <Plus size={13} strokeWidth={2.5} style={{ marginRight: 4 }} />
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
                          <AppSelect
                            value={a.type}
                            onChange={(v) => {
                              const next = (request.assertions ?? []).map((x) => x.id === a.id ? { ...x, type: v as AssertionType } : x)
                              props.onChangeRequest({ assertions: next })
                            }}
                            options={ASSERTION_TYPES}
                            className="ws-app-select--table"
                          />
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
            <div className="muted">Optional. Each test case maps to a k6 scenario.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="ws-btn ws-btn--outline-accent" onClick={props.onAddTestCase}>
              <Plus size={13} strokeWidth={2.5} style={{ marginRight: 4 }} />
              Test case
            </button>
            <button type="button" className="ws-btn primary" onClick={props.onCommitTestCases}>
              Save
            </button>
          </div>
        </div>

        {request.testCases.length ? (
          <div className="ws-testcase-list">
            {request.testCases.map((tc) => {
              const active = props.testCase?.id === tc.id
              const c = tc.criteria ?? {}
              const durPreset = (DURATION_PRESETS as readonly string[]).includes(tc.duration)
              const rampPreset = (RAMP_PRESETS as readonly string[]).includes(tc.rampUp)
              const rampDownPreset = (RAMP_PRESETS as readonly string[]).includes(tc.rampDown ?? '')
              return (
                <article
                  key={tc.id}
                  className={`ws-testcase-card${active ? ' active' : ''}`}
                  onClick={() => props.onSelectTestCase(tc.id)}
                >
                  <div className="ws-testcase-card-head">
                    <label className="ws-testcase-field ws-testcase-field--grow">
                      <span className="ws-testcase-field-label">Name</span>
                      <input
                        className="ws-input"
                        value={tc.name}
                        onChange={(e) => props.onChangeTestCase(tc.id, { name: e.target.value })}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </label>
                    <button
                      type="button"
                      className="ws-btn-icon danger"
                      title="Delete test case"
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onDeleteTestCase(tc.id)
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  <div className="ws-testcase-card-grid" onClick={(e) => e.stopPropagation()}>
                    <label className="ws-testcase-field">
                      <span className="ws-testcase-field-label">VUs</span>
                      <input
                        className="ws-input"
                        type="number"
                        min={1}
                        value={tc.vus}
                        onChange={(e) => props.onChangeTestCase(tc.id, { vus: Number(e.target.value) })}
                      />
                    </label>
                    <div className="ws-testcase-field">
                      <span className="ws-testcase-field-label">Duration</span>
                      <div className="ws-testcase-stack">
                        <AppSelect
                          value={durPreset ? tc.duration : 'custom'}
                          onChange={(v) => {
                            if (v === 'custom') {
                              props.onChangeTestCase(tc.id, { duration: '' })
                              return
                            }
                            props.onChangeTestCase(tc.id, { duration: v })
                          }}
                          options={[
                            ...DURATION_PRESETS.map((d) => ({ value: d, label: d })),
                            { value: 'custom', label: 'Custom…' },
                          ]}
                          className="ws-app-select--block"
                        />
                        {!durPreset ? (
                          <input
                            className="ws-input"
                            value={tc.duration}
                            onChange={(e) => props.onChangeTestCase(tc.id, { duration: e.target.value })}
                            placeholder="e.g. 7m30s"
                          />
                        ) : null}
                      </div>
                    </div>
                    <div className="ws-testcase-field">
                      <span className="ws-testcase-field-label">Ramp-up</span>
                      <div className="ws-testcase-stack">
                        <AppSelect
                          value={rampPreset ? tc.rampUp : 'custom'}
                          onChange={(v) => {
                            if (v === 'custom') {
                              props.onChangeTestCase(tc.id, { rampUp: '' })
                              return
                            }
                            props.onChangeTestCase(tc.id, { rampUp: v })
                          }}
                          options={[
                            ...RAMP_PRESETS.map((d) => ({ value: d, label: d })),
                            { value: 'custom', label: 'Custom…' },
                          ]}
                          className="ws-app-select--block"
                        />
                        {!rampPreset ? (
                          <input
                            className="ws-input"
                            value={tc.rampUp}
                            onChange={(e) => props.onChangeTestCase(tc.id, { rampUp: e.target.value })}
                            placeholder="e.g. 45s"
                          />
                        ) : null}
                      </div>
                    </div>
                    <div className="ws-testcase-field">
                      <span className="ws-testcase-field-label">Ramp-down</span>
                      <div className="ws-testcase-stack">
                        <label
                          style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}
                        >
                          <input
                            type="checkbox"
                            checked={!!tc.rampDownEnabled}
                            onChange={(e) => {
                              const on = e.target.checked
                              props.onChangeTestCase(tc.id, {
                                rampDownEnabled: on,
                                ...(on && !(tc.rampDown ?? '').trim() ? { rampDown: '15s' } : {}),
                              })
                            }}
                          />
                          <span>Enable</span>
                        </label>
                        {tc.rampDownEnabled ? (
                          <>
                            <AppSelect
                              value={rampDownPreset ? tc.rampDown ?? '15s' : 'custom'}
                              onChange={(v) => {
                                if (v === 'custom') {
                                  props.onChangeTestCase(tc.id, { rampDown: '' })
                                  return
                                }
                                props.onChangeTestCase(tc.id, { rampDown: v })
                              }}
                              options={[
                                ...RAMP_PRESETS.map((d) => ({ value: d, label: d })),
                                { value: 'custom', label: 'Custom…' },
                              ]}
                              className="ws-app-select--block"
                            />
                            {!rampDownPreset ? (
                              <input
                                className="ws-input"
                                value={tc.rampDown ?? ''}
                                onChange={(e) => props.onChangeTestCase(tc.id, { rampDown: e.target.value })}
                                placeholder="e.g. 15s"
                              />
                            ) : null}
                          </>
                        ) : (
                          <span className="muted">Off</span>
                        )}
                      </div>
                    </div>
                    <div className="ws-testcase-field">
                      <span
                        className="ws-testcase-field-label"
                        title="Ramp-up + steady duration (+ ramp-down when enabled)"
                      >
                        Total run
                      </span>
                      <div className="ws-testcase-total mono muted">{totalRunTime(tc)}</div>
                    </div>
                  </div>

                  <div className="ws-testcase-thresholds" onClick={(e) => e.stopPropagation()}>
                    <div className="ws-testcase-threshold">
                      <label className="ws-testcase-threshold-head">
                        <input
                          type="checkbox"
                          title="Enable avg latency threshold"
                          checked={isCriteriaToggleOn(tc, 'maxAvgMs')}
                          onChange={(e) => props.onSetCriterionToggle(tc.id, 'maxAvgMs', e.target.checked)}
                        />
                        <span>Avg max (ms)</span>
                      </label>
                      {isCriteriaToggleOn(tc, 'maxAvgMs') ? (
                        <input
                          className="ws-input"
                          type="number"
                          value={c.maxAvgMs ?? ''}
                          onChange={(e) => {
                            const raw = e.target.value.trim()
                            props.onChangeCriteria(tc.id, { maxAvgMs: raw === '' ? null : Number(raw) })
                          }}
                        />
                      ) : null}
                    </div>
                    <div className="ws-testcase-threshold">
                      <label className="ws-testcase-threshold-head">
                        <input
                          type="checkbox"
                          title="Enable p95 threshold"
                          checked={isCriteriaToggleOn(tc, 'maxP95Ms')}
                          onChange={(e) => props.onSetCriterionToggle(tc.id, 'maxP95Ms', e.target.checked)}
                        />
                        <span>p95 max (ms)</span>
                      </label>
                      {isCriteriaToggleOn(tc, 'maxP95Ms') ? (
                        <input
                          className="ws-input"
                          type="number"
                          value={c.maxP95Ms ?? ''}
                          onChange={(e) => {
                            const raw = e.target.value.trim()
                            props.onChangeCriteria(tc.id, { maxP95Ms: raw === '' ? null : Number(raw) })
                          }}
                        />
                      ) : null}
                    </div>
                    <div className="ws-testcase-threshold">
                      <label className="ws-testcase-threshold-head">
                        <input
                          type="checkbox"
                          title="Enable max error rate threshold"
                          checked={isCriteriaToggleOn(tc, 'maxErrorRate')}
                          onChange={(e) => props.onSetCriterionToggle(tc.id, 'maxErrorRate', e.target.checked)}
                        />
                        <span>Err rate max</span>
                      </label>
                      {isCriteriaToggleOn(tc, 'maxErrorRate') ? (
                        <input
                          className="ws-input"
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
                    <div className="ws-testcase-threshold">
                      <label className="ws-testcase-threshold-head">
                        <input
                          type="checkbox"
                          title="Enable minimum RPS threshold"
                          checked={isCriteriaToggleOn(tc, 'minThroughputRps')}
                          onChange={(e) => props.onSetCriterionToggle(tc.id, 'minThroughputRps', e.target.checked)}
                        />
                        <span>RPS min</span>
                      </label>
                      {isCriteriaToggleOn(tc, 'minThroughputRps') ? (
                        <input
                          className="ws-input"
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
                  </div>
                </article>
              )
            })}
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
