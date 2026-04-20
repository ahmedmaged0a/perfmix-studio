import { useCallback, useEffect, useMemo, useState } from 'react'
import { Send, Zap, Copy, CheckCheck, Terminal, Loader2 } from 'lucide-react'
import type {
  HttpBatchItem,
  HttpExecuteResponse,
  HttpOutputPayload,
  K6RunHistoryMetrics,
  RequestAssertion,
} from '../../models/types'

type K6Payload = {
  at: string
  runId: string | null
  status: string
  metrics: K6RunHistoryMetrics
  /** Client-side skip or failure before k6 started (shown under snapshot). */
  hint?: string
}

type Props = {
  http: HttpOutputPayload | null
  k6: K6Payload | null
  /** True while Send or Send-all is awaiting HTTP completion */
  httpSending?: boolean
}

/** Above this, body `<details>` default closed to avoid huge paint. */
const BODY_COLLAPSE_BYTES = 64 * 1024
/** Above this, skip syntax highlight only; pretty-print still runs on expand (lazy). */
const BODY_NO_HIGHLIGHT_BYTES = 96 * 1024
/** First paint cap for very large bodies until user chooses Show full body. */
const BODY_TRUNCATE_CHARS = 250_000

function fmtMs(v: number | null) {
  if (v == null) return '—'
  return `${v.toFixed(1)} ms`
}

function prettyBody(raw: string): string {
  if (!raw) return '—'
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function statusColor(code: number): string {
  if (code >= 200 && code < 300) return '#4ade80'
  if (code >= 300 && code < 400) return '#facc15'
  if (code >= 400 && code < 500) return '#fb923c'
  return '#f87171'
}

function statusBg(code: number): string {
  if (code >= 200 && code < 300) return 'rgba(74,222,128,0.12)'
  if (code >= 300 && code < 400) return 'rgba(250,204,21,0.12)'
  if (code >= 400 && code < 500) return 'rgba(251,146,60,0.12)'
  return 'rgba(248,113,113,0.12)'
}

type JsonToken =
  | { type: 'key'; value: string }
  | { type: 'string'; value: string }
  | { type: 'number'; value: string }
  | { type: 'boolean'; value: string }
  | { type: 'null' }
  | { type: 'punct'; value: string }

function tokenizeJson(json: string): JsonToken[] {
  const tokens: JsonToken[] = []
  const re = /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|(true|false)|(null)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\]:,])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(json)) !== null) {
    if (m[1] !== undefined) {
      tokens.push({ type: 'key', value: m[1] })
      tokens.push({ type: 'punct', value: ':' })
    } else if (m[2] !== undefined) {
      tokens.push({ type: 'string', value: m[2] })
    } else if (m[3] !== undefined) {
      tokens.push({ type: 'boolean', value: m[3] })
    } else if (m[4] !== undefined) {
      tokens.push({ type: 'null' })
    } else if (m[5] !== undefined) {
      tokens.push({ type: 'number', value: m[5] })
    } else if (m[6] !== undefined) {
      tokens.push({ type: 'punct', value: m[6] })
    }
  }
  return tokens
}

const TOKEN_COLORS: Record<JsonToken['type'], string> = {
  key: '#93c5fd',
  string: '#86efac',
  number: '#fde68a',
  boolean: '#c4b5fd',
  null: '#94a3b8',
  punct: '#64748b',
}

function HighlightedJson({ text }: { text: string }) {
  const tokens = useMemo(() => tokenizeJson(text), [text])

  let charIdx = 0

  const elements: React.ReactNode[] = []

  for (const token of tokens) {
    const raw = token.type === 'null' ? 'null' : token.value
    const pos = text.indexOf(raw, charIdx)
    if (pos > charIdx) {
      elements.push(<span key={`ws-${charIdx}`}>{text.slice(charIdx, pos)}</span>)
    }
    elements.push(
      <span key={`t-${pos}-${raw.slice(0, 8)}`} style={{ color: TOKEN_COLORS[token.type] }}>
        {raw}
      </span>,
    )
    charIdx = pos + raw.length
  }

  if (charIdx < text.length) {
    elements.push(<span key="tail">{text.slice(charIdx)}</span>)
  }

  return <>{elements}</>
}

function isJsonString(s: string): boolean {
  if (!s) return false
  const t = s.trimStart()
  return t.startsWith('{') || t.startsWith('[')
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [text])

  return (
    <button
      type="button"
      className="ws-btn ghost"
      onClick={copy}
      title="Copy to clipboard"
      style={{ padding: '2px 8px', fontSize: '0.78rem', minWidth: 64, display: 'inline-flex', alignItems: 'center', gap: 4 }}
    >
      {copied ? <CheckCheck size={12} /> : <Copy size={12} />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

/** Never echo secrets in Output; make clear this is display-only, not a failed `{{token}}` resolve. */
function redactAuthorizationValueForDisplay(raw: string): string {
  const v = String(raw ?? '').trim()
  if (!v) return '(empty)'
  if (/\{\{\s*[a-zA-Z0-9_.-]+\s*\}\}/.test(v)) return v
  if (/^Bearer\s+/i.test(v)) return 'Bearer … (hidden in Output — full value was sent)'
  return '… (hidden in Output — full value was sent)'
}

function redactSensitiveRequestHeaders(pairs: [string, string][]): [string, string][] {
  return pairs.map(([k, v]) =>
    k.toLowerCase() === 'authorization' ? ([k, redactAuthorizationValueForDisplay(v)] as [string, string]) : [k, v],
  )
}

function RequestBodySummary({ raw }: { raw: string }) {
  const bodyIsJson = useMemo(() => isJsonString(raw), [raw])
  const formatted = useMemo(() => prettyBody(raw), [raw])
  return (
    <pre className="ws-pre ws-pre-json">
      {bodyIsJson && raw.length <= BODY_NO_HIGHLIGHT_BYTES ? <HighlightedJson text={formatted} /> : formatted}
    </pre>
  )
}

function ResponseBodyBlock({ result }: { result: HttpExecuteResponse }) {
  const raw = result.body ?? ''
  const [showFullBody, setShowFullBody] = useState(false)
  const [bodyOpen, setBodyOpen] = useState(false)

  useEffect(() => {
    setShowFullBody(false)
    setBodyOpen(false)
  }, [raw])

  const formattedBody = useMemo(() => {
    if (!bodyOpen) return ''
    if (!raw) return '—'
    if (raw.length > BODY_NO_HIGHLIGHT_BYTES) {
      if (showFullBody) return prettyBody(raw)
      if (raw.length <= BODY_TRUNCATE_CHARS) return prettyBody(raw)
      return `${raw.slice(0, BODY_TRUNCATE_CHARS)}\n\n… [Output truncated — use “Show full body” to load the rest in plain text.]`
    }
    return prettyBody(raw)
  }, [raw, showFullBody, bodyOpen])

  const bodyIsJson = useMemo(() => isJsonString(raw), [raw])
  const useSyntaxHighlight = bodyIsJson && raw.length <= BODY_NO_HIGHLIGHT_BYTES
  const largeBody = raw.length > BODY_NO_HIGHLIGHT_BYTES
  const truncatedFirstPaint = raw.length > BODY_TRUNCATE_CHARS && !showFullBody

  return (
    <details className="ws-details" open={bodyOpen} onToggle={(e) => setBodyOpen(e.currentTarget.open)}>
      <summary style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span>Body</span>
        {!bodyOpen && raw ? (
          <span className="muted tiny">
            {raw.length.toLocaleString()} chars{bodyIsJson ? ' · JSON' : ''}
          </span>
        ) : null}
        <CopyButton text={raw} />
        {truncatedFirstPaint ? (
          <button type="button" className="ws-btn ghost" style={{ padding: '2px 8px', fontSize: '0.78rem' }} onClick={() => setShowFullBody(true)}>
            Show full body
          </button>
        ) : null}
        {largeBody && showFullBody && raw.length > BODY_TRUNCATE_CHARS ? (
          <button type="button" className="ws-btn ghost" style={{ padding: '2px 8px', fontSize: '0.78rem' }} onClick={() => setShowFullBody(false)}>
            Truncated view
          </button>
        ) : null}
      </summary>
      {bodyOpen ? (
        <pre className="ws-pre ws-pre-json">
          {useSyntaxHighlight ? <HighlightedJson text={formattedBody} /> : formattedBody}
        </pre>
      ) : null}
    </details>
  )
}

function AssertionsBlock({
  assertionResults,
}: {
  assertionResults: { assertion: RequestAssertion; pass: boolean; detail: string }[]
}) {
  if (!assertionResults.length) return null
  return (
    <details className="ws-details" open>
      <summary>
        Assertions ({assertionResults.filter((a) => a.pass).length}/{assertionResults.length} passed)
      </summary>
      <ul className="ws-checks" style={{ margin: '6px 0' }}>
        {assertionResults.map((ar) => (
          <li key={ar.assertion.id} className={ar.pass ? 'pass' : 'fail'}>
            <span className="ws-check-label">{ar.assertion.type.replace(/_/g, ' ')}</span>
            <span className="ws-check-detail">{ar.detail}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function SingleResponseBlock(props: {
  method: string
  url: string
  at: string
  result: HttpExecuteResponse
  requestHeaders?: [string, string][]
  requestBody?: string
  assertionResults?: { assertion: RequestAssertion; pass: boolean; detail: string }[]
  title?: string
  scriptError?: string
  scriptLogs?: string[]
}) {
  const { method, url, at, result, assertionResults } = props
  const durationRounded = result.durationMs != null ? Math.round(result.durationMs) : null
  const badgeLine =
    durationRounded != null
      ? `${method} ${result.status} ${result.statusText} · ${durationRounded} ms`
      : `${method} ${result.status} ${result.statusText}`
  return (
    <div>
      {props.title ? <div className="ws-title" style={{ marginBottom: 8 }}>{props.title}</div> : null}
      <div className="ws-output-meta" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span
          className="ws-status-badge"
          style={{
            color: statusColor(result.status),
            background: statusBg(result.status),
            borderColor: statusColor(result.status),
          }}
        >
          {badgeLine}
        </span>
        <span className="muted tiny">{new Date(at).toLocaleString()}</span>
      </div>
      {durationRounded != null ? (
        <p className="muted tiny" style={{ margin: '6px 0 0' }}>
          This request took {durationRounded} ms (time until the full response was available).
        </p>
      ) : null}
      {result.status >= 300 &&
      result.status < 400 &&
      /login-actions\/authenticate/i.test(url) ? (
        <p className="muted tiny" style={{ margin: '6px 0 0' }}>
          Keycloak authenticate: a redirect here is expected when redirects are not followed; correlation should read the
          OAuth <code>code</code> from the <code>Location</code> response header.
        </p>
      ) : null}
      <div className="mono tiny ws-output-url">{url}</div>
      {props.scriptError ? <p className="form-error">Script: {props.scriptError}</p> : null}
      {props.scriptLogs?.length ? (
        <details className="ws-details" style={{ marginTop: 8 }}>
          <summary>Script console ({props.scriptLogs.length})</summary>
          <pre className="ws-pre">{props.scriptLogs.join('\n')}</pre>
        </details>
      ) : null}
      {result.error ? <p className="form-error">{result.error}</p> : null}
      {assertionResults ? <AssertionsBlock assertionResults={assertionResults} /> : null}
      {props.requestHeaders != null || props.requestBody != null ? (
        <>
          {props.requestHeaders != null ? (
            <details className="ws-details" open style={{ marginTop: 8 }}>
              <summary>Request headers</summary>
              {props.requestHeaders.some(([k]) => k.toLowerCase() === 'authorization') ? (
                <p className="muted tiny" style={{ margin: '4px 0 6px' }}>
                  Authorization is redacted here only; the request was sent with the resolved header value.
                </p>
              ) : null}
              {props.requestHeaders.length ? (
                <pre className="ws-pre">
                  {redactSensitiveRequestHeaders(props.requestHeaders).map(([k, v], i) => (
                    <span key={`${k}-${i}`}>
                      <span style={{ color: '#93c5fd' }}>{k}</span>
                      <span style={{ color: '#64748b' }}>: </span>
                      <span style={{ color: '#86efac' }}>{v}</span>
                      {'\n'}
                    </span>
                  ))}
                </pre>
              ) : (
                <p className="muted tiny" style={{ margin: '6px 0 0' }}>
                  (none)
                </p>
              )}
            </details>
          ) : null}
          {props.requestBody != null ? (
            <details
              className="ws-details"
              open={(props.requestBody ?? '').length < BODY_COLLAPSE_BYTES}
              style={{ marginTop: 8 }}
            >
              <summary style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>Request body</span>
                {props.requestBody ? (
                  <span className="muted tiny">{props.requestBody.length.toLocaleString()} chars</span>
                ) : null}
                {props.requestBody ? <CopyButton text={props.requestBody} /> : null}
              </summary>
              {props.requestBody.trim() ? (
                <RequestBodySummary raw={props.requestBody} />
              ) : (
                <p className="muted tiny" style={{ margin: '6px 0 0' }}>
                  (no body)
                </p>
              )}
            </details>
          ) : null}
        </>
      ) : null}
      <details className="ws-details" open={(result.body ?? '').length < BODY_COLLAPSE_BYTES}>
        <summary>Response headers</summary>
        <pre className="ws-pre">
          {result.responseHeaders.map(([k, v]) => (
            <span key={`${k}-${v}`}>
              <span style={{ color: '#93c5fd' }}>{k}</span>
              <span style={{ color: '#64748b' }}>: </span>
              <span style={{ color: '#86efac' }}>{v}</span>
              {'\n'}
            </span>
          ))}
        </pre>
      </details>
      <ResponseBodyBlock result={result} />
    </div>
  )
}

function BatchResponseBlock(props: { at: string; collectionName: string; items: HttpBatchItem[] }) {
  return (
    <div>
      <div className="ws-title" style={{ marginBottom: 6 }}>
        Collection send: <span className="mono">{props.collectionName}</span>
      </div>
      <p className="muted tiny" style={{ marginTop: 0 }}>
        {props.items.length} request(s) at {new Date(props.at).toLocaleString()}
      </p>
      <div className="ws-batch-list">
        {props.items.map((item, idx) => (
          <details key={`${item.url}-${idx}`} className="ws-batch-item" open={idx === 0}>
            <summary className="ws-batch-summary">
              <span className="ws-method">{item.method}</span>
              <span>{item.requestName}</span>
              <span className="mono muted" style={{ marginLeft: 6 }}>
                {item.result.status}
                {item.result.durationMs != null ? ` · ${Math.round(item.result.durationMs)} ms` : ''}
              </span>
            </summary>
            <div style={{ padding: '8px 0 0' }}>
              {item.scriptError ? <p className="form-error" style={{ marginBottom: 8 }}>Script: {item.scriptError}</p> : null}
              <SingleResponseBlock
                method={item.method}
                url={item.url}
                at={props.at}
                result={item.result}
                requestHeaders={item.requestHeaders}
                requestBody={item.requestBody}
                assertionResults={item.assertionResults}
                scriptLogs={item.scriptLogs}
              />
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}

export function WorkspaceOutputPanel(props: Props) {
  return (
    <div className="ws-output">
      <div className="ws-output-grid">
        <section className="ws-output-card">
          <div className="ws-title">Last HTTP response</div>
          {props.httpSending ? (
            <div className="ws-http-loading">
              <Loader2 size={32} className="ws-http-loading-spinner" aria-hidden />
              <p className="ws-http-loading-title">Waiting for response…</p>
              <p className="ws-empty-state-text">
                Your HTTP request is in progress. This panel will show the response when it arrives.
              </p>
            </div>
          ) : !props.http ? (
            <div className="ws-empty-state">
              <Send size={28} className="ws-empty-state-icon" />
              <p className="ws-empty-state-title">No response yet</p>
              <p className="ws-empty-state-text">
                Hit <strong>Send</strong> on a request, or <strong>▶ Send all</strong> on a collection to capture responses here.
              </p>
            </div>
          ) : props.http.kind === 'single' ? (
            <SingleResponseBlock
              method={props.http.method}
              url={props.http.url}
              at={props.http.at}
              result={props.http.result}
              requestHeaders={props.http.requestHeaders}
              requestBody={props.http.requestBody}
              assertionResults={props.http.assertionResults}
              scriptError={props.http.scriptError}
              scriptLogs={props.http.scriptLogs}
            />
          ) : (
            <BatchResponseBlock at={props.http.at} collectionName={props.http.collectionName} items={props.http.items} />
          )}
        </section>

        <section className="ws-output-card">
          <div className="ws-title">Last k6 run snapshot</div>
          {!props.k6 ? (
            <div className="ws-empty-state">
              <Zap size={28} className="ws-empty-state-icon" />
              <p className="ws-empty-state-title">No load test run yet</p>
              <p className="ws-empty-state-text">
                Press <strong>Run</strong> in the top bar to start a k6 load test. Summary metrics will appear here.
              </p>
            </div>
          ) : (
            <div>
              <div className="ws-output-meta">
                <span className={`ws-run-status-badge ws-run-status--${props.k6.status}`}>
                  {props.k6.status}
                </span>
                <span className="muted tiny">{new Date(props.k6.at).toLocaleString()}</span>
                {props.k6.runId ? (
                  <span className="muted tiny mono" title={`Run ID: ${props.k6.runId}`}>
                    {props.k6.runId}
                  </span>
                ) : null}
              </div>
              {props.k6.hint ? (
                <p className="muted" style={{ margin: '10px 0 0', lineHeight: 1.5 }}>
                  {props.k6.hint}
                </p>
              ) : null}
              <div className="ws-kpi-grid compact">
                <div className="ws-kpi" title="Average response time across all requests in this run">
                  <div className="ws-kpi-label">Avg response</div>
                  <div className="ws-kpi-value">{fmtMs(props.k6.metrics.avgMs)}</div>
                </div>
                <div className="ws-kpi" title="95th percentile response time — 95% of requests completed within this time">
                  <div className="ws-kpi-label">p95 response</div>
                  <div className="ws-kpi-value">{fmtMs(props.k6.metrics.p95Ms)}</div>
                </div>
                <div className="ws-kpi" title="Percentage of requests that returned an error (non-2xx or network failure)">
                  <div className="ws-kpi-label">Error rate</div>
                  <div
                    className="ws-kpi-value"
                    style={{
                      color:
                        props.k6.metrics.errorRate != null && props.k6.metrics.errorRate > 0.01
                          ? 'var(--color-error)'
                          : undefined,
                    }}
                  >
                    {props.k6.metrics.errorRate == null
                      ? '—'
                      : `${(props.k6.metrics.errorRate * 100).toFixed(2)}%`}
                  </div>
                </div>
                <div className="ws-kpi" title="Requests per second — throughput during the steady-state phase">
                  <div className="ws-kpi-label">Throughput</div>
                  <div className="ws-kpi-value">
                    {props.k6.metrics.rps == null ? '—' : `${props.k6.metrics.rps.toFixed(1)} req/s`}
                  </div>
                </div>
                <div className="ws-kpi" title="k6 check() assertions — how many passed vs total evaluated">
                  <div className="ws-kpi-label">Checks</div>
                  <div
                    className="ws-kpi-value"
                    style={{
                      color:
                        (props.k6.metrics.checksFailed ?? 0) > 0 ? 'var(--color-error)' : undefined,
                    }}
                  >
                    {props.k6.metrics.checksTotal
                      ? `${props.k6.metrics.checksPassed ?? 0} / ${props.k6.metrics.checksTotal}`
                      : '—'}
                  </div>
                  {(props.k6.metrics.checksFailed ?? 0) > 0 ? (
                    <div className="ws-kpi-sub error">{props.k6.metrics.checksFailed} failed</div>
                  ) : null}
                </div>
                <div className="ws-kpi" title="Total number of HTTP requests that failed (network errors or non-2xx responses)">
                  <div className="ws-kpi-label">Failed reqs</div>
                  <div
                    className="ws-kpi-value"
                    style={{
                      color:
                        props.k6.metrics.httpReqFailed != null && props.k6.metrics.httpReqFailed > 0
                          ? 'var(--color-error)'
                          : undefined,
                    }}
                  >
                    {props.k6.metrics.httpReqFailed != null
                      ? props.k6.metrics.httpReqFailed.toFixed(0)
                      : '—'}
                  </div>
                </div>
              </div>
              <details className="ws-details" style={{ marginTop: 10 }}>
                <summary>
                  <Terminal size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                  Run in terminal
                </summary>
                <pre className="ws-pre">{`# Export the k6 script from the top bar first, then:
k6 run your_script.k6.js

# With summary export (JSON):
k6 run --summary-export=results.json your_script.k6.js

# With Grafana / InfluxDB output:
k6 run --out influxdb=http://localhost:8086/k6 your_script.k6.js

# With Grafana Cloud k6:
k6 run --out cloud your_script.k6.js`}</pre>
              </details>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
