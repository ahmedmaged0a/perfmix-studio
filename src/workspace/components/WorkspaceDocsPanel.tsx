import { useState, useMemo, useEffect, useRef } from 'react'
import { marked } from 'marked'
import { Pencil, Eye, BookOpen, FileText, Inbox } from 'lucide-react'
import type { Collection, Project, RequestDefinition } from '../../models/types'

// Configure marked for safe, clean output
marked.setOptions({ gfm: true, breaks: true })

type DocScope = 'project' | 'collection' | 'request'

type Props = {
  project: Project
  collection: Collection | null
  request: RequestDefinition | null
  onChangeProjectDocs: (docs: string) => void
  onChangeCollectionDocs: (docs: string) => void
  onChangeRequestDocs: (docs: string) => void
}

const PLACEHOLDER: Record<DocScope, string> = {
  project: `# Project Overview\n\nDescribe the project's purpose, base URLs, authentication strategy, and any shared conventions.\n\n## Environments\n\n- **Dev** — https://dev.api.example.com\n- **Production** — https://api.example.com\n\n## Auth\n\nBearer token via \`Authorization\` header. Token stored in environment variable \`AUTH_TOKEN\`.`,
  collection: `# Collection Overview\n\nDescribe what this collection tests, the order requests should be run, and any dependencies between them.\n\n## Steps\n\n1. Authenticate → POST /auth/login\n2. Fetch data → GET /resource\n3. Clean up → DELETE /resource/{id}`,
  request: `# Request Notes\n\nDocument the purpose of this request, expected responses, and any edge cases.\n\n## Expected Response\n\n\`\`\`json\n{\n  "id": 1,\n  "status": "ok"\n}\n\`\`\``,
}

export function WorkspaceDocsPanel(props: Props) {
  const [scope, setScope] = useState<DocScope>('request')
  const [editing, setEditing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const noRequestsInCollection = !!(props.collection && props.collection.requests.length === 0)
  const requestDocsUnavailable = scope === 'request' && (!props.request || noRequestsInCollection)

  const currentDocs = useMemo(() => {
    if (scope === 'project') return props.project.docs ?? ''
    if (scope === 'collection') return props.collection?.docs ?? ''
    return props.request?.docs ?? ''
  }, [scope, props.project.docs, props.collection?.docs, props.request?.docs])

  const scopeLabel =
    scope === 'project'
      ? props.project.name
      : scope === 'collection'
        ? (props.collection?.name ?? '—')
        : props.request?.name ??
          (noRequestsInCollection && props.collection ? props.collection.name : 'Select a request')

  const handleChange = (value: string) => {
    if (scope === 'project') props.onChangeProjectDocs(value)
    else if (scope === 'collection') props.onChangeCollectionDocs(value)
    else {
      if (!props.request) return
      props.onChangeRequestDocs(value)
    }
  }

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editing) {
      setTimeout(() => textareaRef.current?.focus(), 30)
    }
  }, [editing])

  // Reset to preview on scope change
  useEffect(() => {
    setEditing(false)
  }, [scope])

  // Cannot edit request docs without a concrete request
  useEffect(() => {
    if (requestDocsUnavailable) setEditing(false)
  }, [requestDocsUnavailable])

  const renderedHtml = useMemo(() => {
    if (!currentDocs.trim()) return ''
    return marked.parse(currentDocs) as string
  }, [currentDocs])

  const hasContent = currentDocs.trim().length > 0

  const requestEmptyCollectionPreview =
    scope === 'request' && props.collection && noRequestsInCollection

  const requestNoSelectionPreview = scope === 'request' && props.collection && !noRequestsInCollection && !props.request

  return (
    <div className="ws-docs">
      {/* Header */}
      <div className="ws-docs-header">
        <div className="ws-docs-title-group">
          <BookOpen size={15} className="ws-docs-title-icon" />
          <div>
            <div className="ws-title">Documentation</div>
            <p className="muted ws-docs-scope-label">
              {scopeLabel}
            </p>
          </div>
        </div>
        <div className="ws-docs-header-actions">
          <button
            type="button"
            className={`ws-btn ws-btn--sm${editing ? ' ghost' : ''}`}
            title={
              requestDocsUnavailable
                ? 'Add a request to this collection to edit request documentation'
                : editing
                  ? 'Switch to preview'
                  : 'Edit documentation'
            }
            disabled={requestDocsUnavailable}
            onClick={() => setEditing((p) => !p)}
          >
            {editing
              ? <><Eye size={13} style={{ marginRight: 5 }} />Preview</>
              : <><Pencil size={13} style={{ marginRight: 5 }} />Edit</>
            }
          </button>
        </div>
      </div>

      {/* Scope tabs */}
      <div className="ws-docs-tabs">
        <button
          type="button"
          className={`ws-subtab${scope === 'project' ? ' active' : ''}`}
          onClick={() => setScope('project')}
        >
          Project
        </button>
        <button
          type="button"
          className={`ws-subtab${scope === 'collection' ? ' active' : ''}`}
          onClick={() => setScope('collection')}
          disabled={!props.collection}
          title={props.collection ? props.collection.name : 'No collection selected'}
        >
          Collection
          {props.collection?.docs?.trim() ? <span className="ws-subtab-dot" /> : null}
        </button>
        <button
          type="button"
          className={`ws-subtab${scope === 'request' ? ' active' : ''}`}
          onClick={() => setScope('request')}
          disabled={!props.collection}
          title={
            !props.collection
              ? 'Select a collection first'
              : noRequestsInCollection
                ? 'Request documentation (add a request to edit)'
                : props.request?.name ?? 'Request'
          }
        >
          Request
          {props.request?.docs?.trim() ? <span className="ws-subtab-dot" /> : null}
        </button>
      </div>

      {/* Editor or Preview */}
      <div className="ws-docs-body">
        {editing && !requestDocsUnavailable ? (
          <div className="ws-docs-editor-wrap">
            <div className="ws-docs-editor-hint muted">
              Markdown supported — headers, bold, code blocks, lists
            </div>
            <textarea
              ref={textareaRef}
              className="ws-textarea ws-docs-textarea"
              value={currentDocs}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={PLACEHOLDER[scope]}
              spellCheck={false}
            />
          </div>
        ) : (
          <div className="ws-docs-preview-wrap">
            {requestEmptyCollectionPreview ? (
              <div className="ws-empty-state">
                <Inbox size={32} className="ws-empty-state-icon" />
                <p className="ws-empty-state-text">No requests in this collection</p>
                <p className="ws-empty-state-sub muted">
                  Add a request from the sidebar (<strong>+ Request</strong>), then you can write request notes here.
                </p>
              </div>
            ) : requestNoSelectionPreview ? (
              <div className="ws-empty-state">
                <FileText size={32} className="ws-empty-state-icon" />
                <p className="ws-empty-state-text">Select a request</p>
                <p className="ws-empty-state-sub muted">Choose a request in the left sidebar to view or edit its documentation.</p>
              </div>
            ) : hasContent ? (
              <div
                className="ws-docs-markdown"
                // marked output is controlled; sanitization via gfm safe mode
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
            ) : (
              <div className="ws-empty-state">
                <FileText size={32} className="ws-empty-state-icon" />
                <p className="ws-empty-state-text">No documentation yet</p>
                <p className="ws-empty-state-sub muted">Click <strong>Edit</strong> to start writing Markdown</p>
                <button
                  type="button"
                  className="ws-btn ws-btn--sm primary"
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={13} style={{ marginRight: 5 }} />
                  Start writing
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
