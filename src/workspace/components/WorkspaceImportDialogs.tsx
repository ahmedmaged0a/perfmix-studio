import { useEffect, useMemo, useState } from 'react'
import type { Collection, RequestDefinition } from '../../models/types'
import { parseCurlCommand, parsedCurlToRequestDefinition } from '../curlParse'
import { parsePerfMixCollectionImport } from '../collectionIo'

function buildId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

type ImportCurlModalProps = {
  open: boolean
  collections: Collection[]
  defaultCollectionId: string | null
  onClose: () => void
  /** Returns the new request to append to the chosen collection */
  onConfirm: (collectionId: string, request: RequestDefinition) => void
}

export function ImportCurlModal(props: ImportCurlModalProps) {
  const [text, setText] = useState('')
  const [ignoreGeneric, setIgnoreGeneric] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [collectionId, setCollectionId] = useState<string>(props.defaultCollectionId ?? props.collections[0]?.id ?? '')

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
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    const host = (() => {
      try {
        return new URL(parsed.value.url).hostname
      } catch {
        return 'Imported'
      }
    })()
    const req = parsedCurlToRequestDefinition(parsed.value, buildId, host)
    const col = effectiveColId
    if (!col) {
      setError('No collection available.')
      return
    }
    props.onConfirm(col, req)
    setText('')
    props.onClose()
  }

  return (
    <div className="ws-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="ws-modal" role="dialog" aria-labelledby="ws-import-curl-title">
        <div className="ws-modal-head">
          <h2 id="ws-import-curl-title">Import cURL</h2>
          <button type="button" className="ws-btn ghost" aria-label="Close" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <div className="ws-modal-body">
          <label className="ws-field">
            <span className="muted">Target collection</span>
            <select className="ws-select" value={effectiveColId} onChange={(e) => setCollectionId(e.target.value)}>
              {props.collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ws-field">
            <span className="muted">Paste cURL command</span>
            <textarea className="ws-textarea" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="curl --request GET 'https://...'" />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <label className="ws-inline" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={ignoreGeneric} onChange={(e) => setIgnoreGeneric(e.target.checked)} />
            <span>Ignore generic headers</span>
          </label>
        </div>
        <div className="ws-modal-foot">
          <button type="button" className="ws-btn ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" className="ws-btn primary" onClick={submit}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

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
    if (!res.ok) {
      setError(res.error)
      return
    }
    props.onConfirm(res.collection)
    setText('')
    props.onClose()
  }

  return (
    <div className="ws-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="ws-modal" role="dialog" aria-labelledby="ws-import-col-title">
        <div className="ws-modal-head">
          <h2 id="ws-import-col-title">Import collection (JSON)</h2>
          <button type="button" className="ws-btn ghost" aria-label="Close" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <div className="ws-modal-body">
          <p className="muted tiny">Paste a file exported as PerfMix collection JSON (perfMixCollectionExport v1).</p>
          <textarea className="ws-textarea" rows={14} value={text} onChange={(e) => setText(e.target.value)} />
          {error ? <p className="form-error">{error}</p> : null}
        </div>
        <div className="ws-modal-foot">
          <button type="button" className="ws-btn ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" className="ws-btn primary" onClick={submit}>
            Import
          </button>
        </div>
      </div>
    </div>
  )
}
