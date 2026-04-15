import { useEffect, useMemo, useRef, useState } from 'react'
import { Upload, FileCode, AlertTriangle, CheckCircle, X } from 'lucide-react'
import type { Collection, RequestDefinition } from '../../models/types'
import { parseCurlCommand, parsedCurlToRequestDefinition } from '../curlParse'
import { parsePerfMixCollectionImport } from '../collectionIo'
import { parseJmx } from '../jmxParse'
import { parseHar } from '../harParse'
import type { HarParseOptions } from '../harParse'
import { parseOpenApi } from '../openApiParse'
import { parsePostmanCollection } from '../postmanParse'

function buildId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

// ── Shared modal chrome ────────────────────────────────────────────────────────

function ModalBackdrop({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="ws-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {children}
    </div>
  )
}

function ModalHead({ title, id, onClose }: { title: string; id: string; onClose: () => void }) {
  return (
    <div className="ws-modal-head">
      <h2 id={id}>{title}</h2>
      <button type="button" className="ws-btn ghost ws-btn--icon" aria-label="Close" onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  )
}

// ── File drop zone ─────────────────────────────────────────────────────────────

function FileDropZone({
  accept,
  label,
  hint,
  onFileText,
}: {
  accept: string
  label: string
  hint: string
  onFileText: (text: string, name: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)

  const readFile = (file: File) => {
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      onFileText(text, file.name)
    }
    reader.readAsText(file, 'utf-8')
  }

  return (
    <div
      className={`ws-drop-zone${dragging ? ' dragging' : ''}${fileName ? ' has-file' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files[0]
        if (file) readFile(file)
      }}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) readFile(file)
          e.target.value = ''
        }}
      />
      {fileName ? (
        <>
          <CheckCircle size={20} className="ws-drop-zone-icon ws-drop-zone-icon--ok" />
          <span className="ws-drop-zone-name">{fileName}</span>
          <span className="muted tiny">Click to replace</span>
        </>
      ) : (
        <>
          <Upload size={20} className="ws-drop-zone-icon" />
          <span className="ws-drop-zone-label">{label}</span>
          <span className="muted tiny">{hint}</span>
        </>
      )}
    </div>
  )
}

// ── Warning list ───────────────────────────────────────────────────────────────

function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null
  return (
    <div className="ws-import-warnings">
      <div className="ws-import-warnings-head">
        <AlertTriangle size={13} />
        {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
      </div>
      <ul className="ws-import-warnings-list">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  )
}

// ── Import preview pill ────────────────────────────────────────────────────────

function ImportPreview({ count, label }: { count: number; label: string }) {
  return (
    <div className="ws-import-preview">
      <FileCode size={14} />
      <strong>{count}</strong> {label}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ImportCurlModal
// ═══════════════════════════════════════════════════════════════════════════════

type ImportCurlModalProps = {
  open: boolean
  collections: Collection[]
  defaultCollectionId: string | null
  onClose: () => void
  onConfirm: (collectionId: string, request: RequestDefinition) => void
}

export function ImportCurlModal(props: ImportCurlModalProps) {
  const [text, setText] = useState('')
  const [ignoreGeneric, setIgnoreGeneric] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [collectionId, setCollectionId] = useState<string>(
    props.defaultCollectionId ?? props.collections[0]?.id ?? '',
  )

  useEffect(() => {
    if (!props.open) return
    const def = props.defaultCollectionId ?? props.collections[0]?.id ?? ''
    if (def) setCollectionId(def)
    setError(null)
  }, [props.open, props.defaultCollectionId, props.collections])

  const effectiveColId = useMemo(() => {
    if (props.collections.some((c) => c.id === collectionId)) return collectionId
    return props.collections[0]?.id ?? ''
  }, [props.collections, collectionId])

  if (!props.open) return null

  const submit = () => {
    setError(null)
    const parsed = parseCurlCommand(text, { ignoreGenericHeaders: ignoreGeneric })
    if (!parsed.ok) { setError(parsed.error); return }
    const host = (() => { try { return new URL(parsed.value.url).hostname } catch { return 'Imported' } })()
    const req = parsedCurlToRequestDefinition(parsed.value, buildId, host)
    if (!effectiveColId) { setError('No collection available.'); return }
    props.onConfirm(effectiveColId, req)
    setText('')
    props.onClose()
  }

  return (
    <ModalBackdrop onClose={props.onClose}>
      <div className="ws-modal" role="dialog" aria-labelledby="ws-import-curl-title">
        <ModalHead title="Import cURL" id="ws-import-curl-title" onClose={props.onClose} />
        <div className="ws-modal-body">
          <label className="ws-field">
            <span className="muted">Target collection</span>
            <select className="ws-select" value={effectiveColId} onChange={(e) => setCollectionId(e.target.value)}>
              {props.collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="ws-field">
            <span className="muted">Paste cURL command</span>
            <textarea
              className="ws-textarea"
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="curl --request GET 'https://...'"
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <label className="ws-inline" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={ignoreGeneric} onChange={(e) => setIgnoreGeneric(e.target.checked)} />
            <span>Ignore generic headers</span>
          </label>
        </div>
        <div className="ws-modal-foot">
          <button type="button" className="ws-btn ghost" onClick={props.onClose}>Cancel</button>
          <button type="button" className="ws-btn primary" onClick={submit}>Import</button>
        </div>
      </div>
    </ModalBackdrop>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ImportCollectionModal (PerfMix JSON)
// ═══════════════════════════════════════════════════════════════════════════════

type ImportCollectionModalProps = {
  open: boolean
  onClose: () => void
  onConfirm: (collection: Collection) => void
}

export function ImportCollectionModal(props: ImportCollectionModalProps) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!props.open) return null

  const submit = () => {
    setError(null)
    const res = parsePerfMixCollectionImport(text)
    if (!res.ok) { setError(res.error); return }
    props.onConfirm(res.collection)
    setText('')
    props.onClose()
  }

  return (
    <ModalBackdrop onClose={props.onClose}>
      <div className="ws-modal" role="dialog" aria-labelledby="ws-import-col-title">
        <ModalHead title="Import collection (JSON)" id="ws-import-col-title" onClose={props.onClose} />
        <div className="ws-modal-body">
          <p className="muted tiny">Paste a PerfMix collection JSON export (perfMixCollectionExport v1).</p>
          <textarea className="ws-textarea" rows={14} value={text} onChange={(e) => setText(e.target.value)} />
          {error ? <p className="form-error">{error}</p> : null}
        </div>
        <div className="ws-modal-foot">
          <button type="button" className="ws-btn ghost" onClick={props.onClose}>Cancel</button>
          <button type="button" className="ws-btn primary" onClick={submit}>Import</button>
        </div>
      </div>
    </ModalBackdrop>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ImportJmxModal — JMeter .jmx → PerfMix Collection
// ═══════════════════════════════════════════════════════════════════════════════

type ImportJmxModalProps = {
  open: boolean
  onClose: () => void
  onConfirm: (collection: Collection) => void
}

type JmxPreview = {
  collectionName: string
  requestCount: number
  warnings: string[]
}

export function ImportJmxModal(props: ImportJmxModalProps) {
  const [xmlText, setXmlText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<JmxPreview | null>(null)

  useEffect(() => {
    if (!props.open) { setXmlText(''); setError(null); setPreview(null) }
  }, [props.open])

  const handleFileText = (text: string) => {
    setXmlText(text)
    setError(null)
    setPreview(null)
    // Live parse for preview
    const res = parseJmx(text)
    if (res.ok) {
      setPreview({
        collectionName: res.collection.name,
        requestCount: res.collection.requests.length,
        warnings: res.warnings,
      })
    } else {
      setError(res.error)
    }
  }

  const submit = () => {
    if (!xmlText.trim()) { setError('No file loaded yet.'); return }
    setError(null)
    const res = parseJmx(xmlText)
    if (!res.ok) { setError(res.error); return }
    props.onConfirm(res.collection)
    props.onClose()
  }

  if (!props.open) return null

  return (
    <ModalBackdrop onClose={props.onClose}>
      <div className="ws-modal ws-modal--lg" role="dialog" aria-labelledby="ws-import-jmx-title">
        <ModalHead title="Import JMeter test plan (.jmx)" id="ws-import-jmx-title" onClose={props.onClose} />
        <div className="ws-modal-body">

          <div className="ws-import-section">
            <p className="ws-import-section-desc muted">
              Select a JMeter <code>.jmx</code> file to convert all HTTP Request samplers into a
              PerfMix collection. Headers, body, query parameters, and protocol are preserved.
            </p>
          </div>

          <FileDropZone
            accept=".jmx,application/xml,text/xml"
            label="Drop .jmx file here, or click to browse"
            hint="JMeter test plan files only"
            onFileText={(text) => handleFileText(text)}
          />

          {error ? <p className="form-error" style={{ marginTop: 10 }}>{error}</p> : null}

          {preview ? (
            <div className="ws-import-result" style={{ marginTop: 12 }}>
              <ImportPreview
                count={preview.requestCount}
                label={`HTTP request${preview.requestCount !== 1 ? 's' : ''} → collection "${preview.collectionName}"`}
              />
              <WarningList warnings={preview.warnings} />
            </div>
          ) : null}

          <details className="ws-import-notes" style={{ marginTop: 12 }}>
            <summary className="muted tiny" style={{ cursor: 'pointer' }}>What gets imported?</summary>
            <ul className="muted tiny ws-import-notes-list">
              <li>All <strong>HTTP Request</strong> samplers across all Thread Groups</li>
              <li>Per-sampler <strong>Header Manager</strong> headers</li>
              <li>Request body (raw or form-encoded) and query parameters</li>
              <li>Collection name from the first Thread Group or Test Plan name</li>
              <li>Controllers (If, Loop, Transaction) are flattened — requests are extracted</li>
              <li>Timers, assertions, response extractors are not imported</li>
            </ul>
          </details>
        </div>
        <div className="ws-modal-foot">
          <button type="button" className="ws-btn ghost" onClick={props.onClose}>Cancel</button>
          <button
            type="button"
            className="ws-btn primary"
            onClick={submit}
            disabled={!xmlText.trim() || !!error}
          >
            Import as collection
          </button>
        </div>
      </div>
    </ModalBackdrop>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ImportHarModal — HAR → PerfMix Collection
// ═══════════════════════════════════════════════════════════════════════════════

type ImportHarModalProps = {
  open: boolean
  onClose: () => void
  onConfirm: (collection: Collection) => void
}

type HarPreview = {
  collectionName: string
  totalEntries: number
  includedEntries: number
  warnings: string[]
}

export function ImportHarModal(props: ImportHarModalProps) {
  const [jsonText, setJsonText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<HarPreview | null>(null)
  const [domainFilter, setDomainFilter] = useState('')
  const [skipStatic, setSkipStatic] = useState(true)
  const [stripSensitive, setStripSensitive] = useState(true)
  const [deduplicateExact, setDeduplicateExact] = useState(true)

  useEffect(() => {
    if (!props.open) { setJsonText(''); setError(null); setPreview(null) }
  }, [props.open])

  const opts: HarParseOptions = {
    domainFilter: domainFilter.trim() || undefined,
    skipStaticAssets: skipStatic,
    stripSensitiveHeaders: stripSensitive,
    deduplicateExact,
  }

  const runPreview = (text: string, o: HarParseOptions) => {
    setError(null)
    setPreview(null)
    const res = parseHar(text, o)
    if (res.ok) {
      setPreview({
        collectionName: res.collection.name,
        totalEntries: res.totalEntries,
        includedEntries: res.includedEntries,
        warnings: res.warnings,
      })
    } else {
      setError(res.error)
    }
  }

  const handleFileText = (text: string) => {
    setJsonText(text)
    runPreview(text, opts)
  }

  // Re-run preview when options change (if we already have a file)
  useEffect(() => {
    if (jsonText) runPreview(jsonText, opts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainFilter, skipStatic, stripSensitive, deduplicateExact])

  const submit = () => {
    if (!jsonText.trim()) { setError('No file loaded yet.'); return }
    setError(null)
    const res = parseHar(jsonText, opts)
    if (!res.ok) { setError(res.error); return }
    props.onConfirm(res.collection)
    props.onClose()
  }

  if (!props.open) return null

  return (
    <ModalBackdrop onClose={props.onClose}>
      <div className="ws-modal ws-modal--lg" role="dialog" aria-labelledby="ws-import-har-title">
        <ModalHead title="Import HAR recording (.har)" id="ws-import-har-title" onClose={props.onClose} />
        <div className="ws-modal-body">

          <p className="ws-import-section-desc muted">
            Import a browser HAR recording as a PerfMix collection. Export a HAR from Chrome DevTools
            (Network tab → right-click → Save all as HAR), Firefox, or any proxy tool.
          </p>

          <FileDropZone
            accept=".har,application/json"
            label="Drop .har file here, or click to browse"
            hint="HTTP Archive files — exported from Chrome, Firefox, or a proxy"
            onFileText={(text) => handleFileText(text)}
          />

          {/* Options */}
          <div className="ws-import-options">
            <div className="ws-import-options-head muted">Filtering options</div>

            <label className="ws-field">
              <span className="muted">Domain filter <span className="tiny">(optional)</span></span>
              <input
                className="ws-input"
                type="text"
                placeholder="e.g. api.example.com"
                value={domainFilter}
                onChange={(e) => setDomainFilter(e.target.value)}
              />
            </label>

            <div className="ws-import-checkboxes">
              <label className="ws-inline">
                <input type="checkbox" checked={skipStatic} onChange={(e) => setSkipStatic(e.target.checked)} />
                <span>Skip static assets <span className="muted tiny">(images, fonts, CSS, JS)</span></span>
              </label>
              <label className="ws-inline">
                <input type="checkbox" checked={stripSensitive} onChange={(e) => setStripSensitive(e.target.checked)} />
                <span>Strip sensitive headers <span className="muted tiny">(Authorization, Cookie)</span></span>
              </label>
              <label className="ws-inline">
                <input type="checkbox" checked={deduplicateExact} onChange={(e) => setDeduplicateExact(e.target.checked)} />
                <span>Deduplicate <span className="muted tiny">(same method + URL path)</span></span>
              </label>
            </div>
          </div>

          {error ? <p className="form-error" style={{ marginTop: 10 }}>{error}</p> : null}

          {preview ? (
            <div className="ws-import-result" style={{ marginTop: 8 }}>
              <ImportPreview
                count={preview.includedEntries}
                label={`of ${preview.totalEntries} entries → collection "${preview.collectionName}"`}
              />
              <WarningList warnings={preview.warnings} />
            </div>
          ) : null}
        </div>

        <div className="ws-modal-foot">
          <button type="button" className="ws-btn ghost" onClick={props.onClose}>Cancel</button>
          <button
            type="button"
            className="ws-btn primary"
            onClick={submit}
            disabled={!jsonText.trim() || !!error || (preview?.includedEntries === 0)}
          >
            Import as collection
          </button>
        </div>
      </div>
    </ModalBackdrop>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ImportOpenApiModal — OpenAPI 3.x / Swagger 2.x → PerfMix Collection
// ═══════════════════════════════════════════════════════════════════════════════

type ImportOpenApiModalProps = {
  open: boolean
  onClose: () => void
  onConfirm: (collection: Collection) => void
}

type OpenApiPreview = {
  collectionName: string
  requestCount: number
  specVersion: string
  warnings: string[]
}

export function ImportOpenApiModal(props: ImportOpenApiModalProps) {
  const [specText, setSpecText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<OpenApiPreview | null>(null)

  useEffect(() => {
    if (!props.open) { setSpecText(''); setError(null); setPreview(null) }
  }, [props.open])

  const handleFileText = (text: string) => {
    setSpecText(text)
    setError(null)
    setPreview(null)
    const res = parseOpenApi(text)
    if (res.ok) {
      setPreview({
        collectionName: res.collection.name,
        requestCount: res.collection.requests.length,
        specVersion: res.specVersion,
        warnings: res.warnings,
      })
    } else {
      setError(res.error)
    }
  }

  const submit = () => {
    if (!specText.trim()) { setError('No file loaded yet.'); return }
    const res = parseOpenApi(specText)
    if (!res.ok) { setError(res.error); return }
    props.onConfirm(res.collection)
    props.onClose()
  }

  if (!props.open) return null

  return (
    <ModalBackdrop onClose={props.onClose}>
      <div className="ws-modal ws-modal--lg" role="dialog" aria-labelledby="ws-import-oa-title">
        <ModalHead title="Import OpenAPI / Swagger spec" id="ws-import-oa-title" onClose={props.onClose} />
        <div className="ws-modal-body">
          <p className="ws-import-section-desc muted">
            Import an OpenAPI 3.x or Swagger 2.x spec (<code>.yaml</code> / <code>.json</code>).
            Each path+method becomes a request with headers, query params, and a placeholder body.
          </p>

          <FileDropZone
            accept=".yaml,.yml,.json,application/json,text/yaml"
            label="Drop .yaml or .json spec here, or click to browse"
            hint="OpenAPI 3.x / Swagger 2.x — YAML or JSON"
            onFileText={(text) => handleFileText(text)}
          />

          {error ? <p className="form-error" style={{ marginTop: 10 }}>{error}</p> : null}

          {preview ? (
            <div className="ws-import-result" style={{ marginTop: 12 }}>
              <ImportPreview
                count={preview.requestCount}
                label={`endpoint${preview.requestCount !== 1 ? 's' : ''} → "${preview.collectionName}" (${preview.specVersion})`}
              />
              <WarningList warnings={preview.warnings} />
            </div>
          ) : null}

          <details className="ws-import-notes" style={{ marginTop: 12 }}>
            <summary className="muted tiny" style={{ cursor: 'pointer' }}>What gets imported?</summary>
            <ul className="muted tiny ws-import-notes-list">
              <li>All path + method combinations as individual requests</li>
              <li>Request body (JSON placeholder built from schema properties)</li>
              <li>Query and header parameters</li>
              <li>Path parameters replaced with <code>{'{{paramName}}'}</code> templates</li>
              <li>Operation summary / description saved as request docs</li>
              <li>Base URL from <code>servers[0]</code> (OA3) or <code>host + basePath</code> (Swagger 2)</li>
            </ul>
          </details>
        </div>
        <div className="ws-modal-foot">
          <button type="button" className="ws-btn ghost" onClick={props.onClose}>Cancel</button>
          <button
            type="button"
            className="ws-btn primary"
            onClick={submit}
            disabled={!specText.trim() || !!error}
          >
            Import as collection
          </button>
        </div>
      </div>
    </ModalBackdrop>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ImportPostmanModal — Postman Collection v2.x → PerfMix Collection
// ═══════════════════════════════════════════════════════════════════════════════

type ImportPostmanModalProps = {
  open: boolean
  onClose: () => void
  onConfirm: (collection: Collection) => void
}

type PostmanPreview = {
  collectionName: string
  requestCount: number
  warnings: string[]
}

export function ImportPostmanModal(props: ImportPostmanModalProps) {
  const [jsonText, setJsonText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PostmanPreview | null>(null)

  useEffect(() => {
    if (!props.open) { setJsonText(''); setError(null); setPreview(null) }
  }, [props.open])

  const handleFileText = (text: string) => {
    setJsonText(text)
    setError(null)
    setPreview(null)
    const res = parsePostmanCollection(text)
    if (res.ok) {
      setPreview({
        collectionName: res.collection.name,
        requestCount: res.collection.requests.length,
        warnings: res.warnings,
      })
    } else {
      setError(res.error)
    }
  }

  const submit = () => {
    if (!jsonText.trim()) { setError('No file loaded yet.'); return }
    const res = parsePostmanCollection(jsonText)
    if (!res.ok) { setError(res.error); return }
    props.onConfirm(res.collection)
    props.onClose()
  }

  if (!props.open) return null

  return (
    <ModalBackdrop onClose={props.onClose}>
      <div className="ws-modal ws-modal--lg" role="dialog" aria-labelledby="ws-import-pm-title">
        <ModalHead title="Import Postman collection" id="ws-import-pm-title" onClose={props.onClose} />
        <div className="ws-modal-body">
          <p className="ws-import-section-desc muted">
            Import a Postman Collection v2.0 / v2.1 export (<code>.json</code>).
            Folders are flattened with their name prepended to each request.
          </p>

          <FileDropZone
            accept=".json,application/json"
            label="Drop Postman collection .json here, or click to browse"
            hint="Postman Collection v2.0 / v2.1 JSON export"
            onFileText={(text) => handleFileText(text)}
          />

          {error ? <p className="form-error" style={{ marginTop: 10 }}>{error}</p> : null}

          {preview ? (
            <div className="ws-import-result" style={{ marginTop: 12 }}>
              <ImportPreview
                count={preview.requestCount}
                label={`request${preview.requestCount !== 1 ? 's' : ''} → "${preview.collectionName}"`}
              />
              <WarningList warnings={preview.warnings} />
            </div>
          ) : null}

          <details className="ws-import-notes" style={{ marginTop: 12 }}>
            <summary className="muted tiny" style={{ cursor: 'pointer' }}>What gets imported?</summary>
            <ul className="muted tiny ws-import-notes-list">
              <li>All requests across all folders (nested folders are flattened)</li>
              <li>Headers, query parameters, and request body (raw, form, urlencoded, GraphQL)</li>
              <li>Request description saved as docs</li>
              <li>Folder hierarchy preserved in request names (e.g. "Auth / Login")</li>
              <li>Collection variables are listed as warnings — add them manually</li>
              <li>Pre/post-request scripts, tests, and environments are not imported</li>
            </ul>
          </details>
        </div>
        <div className="ws-modal-foot">
          <button type="button" className="ws-btn ghost" onClick={props.onClose}>Cancel</button>
          <button
            type="button"
            className="ws-btn primary"
            onClick={submit}
            disabled={!jsonText.trim() || !!error}
          >
            Import as collection
          </button>
        </div>
      </div>
    </ModalBackdrop>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ImportUnifiedModal — single modal with tabs for all import sources
// ═══════════════════════════════════════════════════════════════════════════════

type UnifiedImportTab = 'curl' | 'json' | 'jmx' | 'har' | 'oas' | 'postman'

const TAB_LABELS: Record<UnifiedImportTab, string> = {
  curl: 'cURL',
  json: 'JSON',
  jmx: 'JMX',
  har: 'HAR',
  oas: 'OpenAPI',
  postman: 'Postman',
}

type ImportUnifiedModalProps = {
  open: boolean
  collections: Collection[]
  defaultCollectionId: string | null
  onClose: () => void
  onConfirmCurl: (collectionId: string, request: RequestDefinition) => void
  onConfirmCollection: (collection: Collection) => void
  onConfirmJmx: (collection: Collection) => void
  onConfirmHar: (collection: Collection) => void
  onConfirmOpenApi: (collection: Collection) => void
  onConfirmPostman: (collection: Collection) => void
}

export function ImportUnifiedModal(props: ImportUnifiedModalProps) {
  const [activeTab, setActiveTab] = useState<UnifiedImportTab>('curl')

  if (!props.open) return null

  return (
    <ModalBackdrop onClose={props.onClose}>
      <div
        className="ws-modal ws-modal--lg"
        role="dialog"
        aria-modal
        aria-labelledby="import-unified-title"
        style={{ maxHeight: 'min(88vh, 760px)' }}
      >
        <ModalHead title="Import" id="import-unified-title" onClose={props.onClose} />

        <div className="ws-modal-body" style={{ paddingTop: 14 }}>
          {/* Tab strip */}
          <div className="ws-import-modal-tabs">
            {(Object.keys(TAB_LABELS) as UnifiedImportTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`ws-import-modal-tab${activeTab === tab ? ' active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>

          {activeTab === 'curl' && (
            <ImportCurlBody
              collections={props.collections}
              defaultCollectionId={props.defaultCollectionId}
              onClose={props.onClose}
              onConfirm={props.onConfirmCurl}
            />
          )}
          {activeTab === 'json' && (
            <ImportCollectionBody onClose={props.onClose} onConfirm={props.onConfirmCollection} />
          )}
          {activeTab === 'jmx' && (
            <ImportJmxBody onClose={props.onClose} onConfirm={props.onConfirmJmx} />
          )}
          {activeTab === 'har' && (
            <ImportHarBody onClose={props.onClose} onConfirm={props.onConfirmHar} />
          )}
          {activeTab === 'oas' && (
            <ImportOpenApiBody onClose={props.onClose} onConfirm={props.onConfirmOpenApi} />
          )}
          {activeTab === 'postman' && (
            <ImportPostmanBody onClose={props.onClose} onConfirm={props.onConfirmPostman} />
          )}
        </div>
      </div>
    </ModalBackdrop>
  )
}

// ── Inlined body components (body + foot only, no outer modal shell) ──────────

function ImportCurlBody(props: {
  collections: Collection[]
  defaultCollectionId: string | null
  onClose: () => void
  onConfirm: (collectionId: string, request: RequestDefinition) => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [collectionId, setCollectionId] = useState<string>(
    props.defaultCollectionId ?? props.collections[0]?.id ?? '',
  )

  const parsed = useMemo(() => {
    const t = text.trim()
    if (!t) return null
    try {
      const result = parseCurlCommand(t, { ignoreGenericHeaders: true })
      return result.ok ? result.value : null
    } catch { return null }
  }, [text])

  const submit = () => {
    if (!parsed) { setError('Could not parse the cURL command.'); return }
    const req = parsedCurlToRequestDefinition(parsed, buildId)
    props.onConfirm(collectionId, req)
    props.onClose()
  }

  return (
    <>
      <div className="ws-field">
        <label className="ws-topbar-label">Paste cURL command</label>
        <textarea
          className="ws-textarea"
          rows={6}
          spellCheck={false}
          placeholder={'curl -X POST https://api.example.com/v1/items \\\n  -H "Content-Type: application/json" \\\n  -d \'{"name":"test"}\''}
          value={text}
          onChange={(e) => { setText(e.target.value); setError(null) }}
        />
        {error && <p className="form-error">{error}</p>}
      </div>
      {props.collections.length > 1 && (
        <div className="ws-field">
          <label className="ws-topbar-label">Add to collection</label>
          <select className="ws-select" value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
            {props.collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      <div className="ws-modal-foot">
        <button type="button" className="ws-btn ghost" onClick={props.onClose}>Cancel</button>
        <button type="button" className="ws-btn primary" onClick={submit} disabled={!parsed}>Import request</button>
      </div>
    </>
  )
}

function ImportCollectionBody(props: {
  onClose: () => void
  onConfirm: (collection: Collection) => void
}) {
  const [jsonText, setJsonText] = useState('')

  const result = useMemo(() => {
    const t = jsonText.trim()
    if (!t) return null
    try { return parsePerfMixCollectionImport(t) }
    catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) } }
  }, [jsonText])

  const submit = () => {
    if (!result?.ok) return
    props.onConfirm(result.collection)
    props.onClose()
  }

  return (
    <>
      <div className="ws-field">
        <label className="ws-topbar-label">Paste PerfMix JSON export</label>
        <textarea
          className="ws-textarea"
          rows={8}
          spellCheck={false}
          placeholder='{"id":"col-...","name":"My collection","requests":[...]}'
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
        />
        {result && !result.ok && <p className="form-error">{result.error}</p>}
        {result?.ok && <ImportPreview count={result.collection.requests.length} label="requests found" />}
      </div>
      <div className="ws-modal-foot">
        <button type="button" className="ws-btn ghost" onClick={props.onClose}>Cancel</button>
        <button type="button" className="ws-btn primary" onClick={submit} disabled={!result?.ok}>Import collection</button>
      </div>
    </>
  )
}

function ImportJmxBody(props: { onClose: () => void; onConfirm: (collection: Collection) => void }) {
  const [result, setResult] = useState<ReturnType<typeof parseJmx> | null>(null)
  const submit = () => { if (!result?.ok) return; props.onConfirm(result.collection); props.onClose() }
  return (
    <>
      <FileDropZone accept=".jmx" label="Drop a JMeter .jmx file here" hint=".jmx — or click to browse" onFileText={(text) => setResult(parseJmx(text))} />
      {result && !result.ok && <p className="form-error" style={{ marginTop: 8 }}>{result.error}</p>}
      {result?.ok && <div className="ws-import-result" style={{ marginTop: 10 }}><ImportPreview count={result.collection.requests.length} label="requests found" /><WarningList warnings={result.warnings} /></div>}
      <div className="ws-modal-foot">
        <button type="button" className="ws-btn ghost" onClick={props.onClose}>Cancel</button>
        <button type="button" className="ws-btn primary" onClick={submit} disabled={!result?.ok}>Import as collection</button>
      </div>
    </>
  )
}

function ImportHarBody(props: { onClose: () => void; onConfirm: (collection: Collection) => void }) {
  const [rawText, setRawText] = useState<string | null>(null)
  const [domainFilter, setDomainFilter] = useState('')
  const [skipStatic, setSkipStatic] = useState(true)
  const [stripSensitive, setStripSensitive] = useState(true)
  const [deduplicate, setDeduplicate] = useState(false)

  const opts: HarParseOptions = useMemo(() => ({
    domainFilter: domainFilter.trim() || undefined,
    skipStaticAssets: skipStatic,
    stripSensitiveHeaders: stripSensitive,
    deduplicateExact: deduplicate,
  }), [domainFilter, skipStatic, stripSensitive, deduplicate])

  const result = useMemo(() => rawText != null ? parseHar(rawText, opts) : null, [rawText, opts])

  const submit = () => { if (!result?.ok) return; props.onConfirm(result.collection); props.onClose() }

  return (
    <>
      <FileDropZone accept=".har,.json" label="Drop a HAR file here" hint=".har or .json — or click to browse" onFileText={(text) => setRawText(text)} />
      <div className="ws-import-options" style={{ marginTop: 10 }}>
        <div className="ws-import-options-head muted">Filter options</div>
        <div className="ws-field" style={{ margin: 0 }}>
          <label className="ws-topbar-label">Domain filter (optional)</label>
          <input className="ws-input" placeholder="e.g. api.example.com" value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)} />
        </div>
        <div className="ws-import-checkboxes">
          {([
            [skipStatic, setSkipStatic, 'Skip static assets (JS, CSS, images)'],
            [stripSensitive, setStripSensitive, 'Strip sensitive headers (Authorization, Cookies)'],
            [deduplicate, setDeduplicate, 'Deduplicate identical requests'],
          ] as [boolean, (v: boolean) => void, string][]).map(([val, setter, label]) => (
            <label key={label} className="ws-inline">
              <input type="checkbox" checked={val} onChange={(e) => setter(e.target.checked)} />
              <span className="tiny">{label}</span>
            </label>
          ))}
        </div>
      </div>
      {result && !result.ok && <p className="form-error" style={{ marginTop: 8 }}>{result.error}</p>}
      {result?.ok && <div className="ws-import-result" style={{ marginTop: 10 }}><ImportPreview count={result.includedEntries} label={`of ${result.totalEntries} requests included`} /><WarningList warnings={result.warnings} /></div>}
      <div className="ws-modal-foot">
        <button type="button" className="ws-btn ghost" onClick={props.onClose}>Cancel</button>
        <button type="button" className="ws-btn primary" onClick={submit} disabled={!result?.ok || result.collection.requests.length === 0}>Import as collection</button>
      </div>
    </>
  )
}

function ImportOpenApiBody(props: { onClose: () => void; onConfirm: (collection: Collection) => void }) {
  const [result, setResult] = useState<ReturnType<typeof parseOpenApi> | null>(null)
  const submit = () => { if (!result?.ok) return; props.onConfirm(result.collection); props.onClose() }
  return (
    <>
      <FileDropZone accept=".yaml,.yml,.json" label="Drop an OpenAPI / Swagger file" hint=".yaml, .yml, or .json — or click to browse" onFileText={(text) => setResult(parseOpenApi(text))} />
      {result && !result.ok && <p className="form-error" style={{ marginTop: 8 }}>{result.error}</p>}
      {result?.ok && <div className="ws-import-result" style={{ marginTop: 10 }}><ImportPreview count={result.collection.requests.length} label={`endpoints (spec ${result.specVersion})`} /><WarningList warnings={result.warnings} /></div>}
      <div className="ws-modal-foot">
        <button type="button" className="ws-btn ghost" onClick={props.onClose}>Cancel</button>
        <button type="button" className="ws-btn primary" onClick={submit} disabled={!result?.ok}>Import as collection</button>
      </div>
    </>
  )
}

function ImportPostmanBody(props: { onClose: () => void; onConfirm: (collection: Collection) => void }) {
  const [result, setResult] = useState<ReturnType<typeof parsePostmanCollection> | null>(null)
  const submit = () => { if (!result?.ok) return; props.onConfirm(result.collection); props.onClose() }
  return (
    <>
      <FileDropZone accept=".json" label="Drop a Postman Collection JSON" hint="Collection v2.0 / v2.1 export — or click to browse" onFileText={(text) => setResult(parsePostmanCollection(text))} />
      {result && !result.ok && <p className="form-error" style={{ marginTop: 8 }}>{result.error}</p>}
      {result?.ok && <div className="ws-import-result" style={{ marginTop: 10 }}><ImportPreview count={result.collection.requests.length} label="requests found" /><WarningList warnings={result.warnings} /></div>}
      <div className="ws-modal-foot">
        <button type="button" className="ws-btn ghost" onClick={props.onClose}>Cancel</button>
        <button type="button" className="ws-btn primary" onClick={submit} disabled={!result?.ok}>Import as collection</button>
      </div>
    </>
  )
}
