import { useState, useMemo } from 'react'
import type { Collection, Project, RequestDefinition } from '../../models/types'

type DocScope = 'project' | 'collection' | 'request'

type Props = {
  project: Project
  collection: Collection | null
  request: RequestDefinition | null
  onChangeProjectDocs: (docs: string) => void
  onChangeCollectionDocs: (docs: string) => void
  onChangeRequestDocs: (docs: string) => void
}

export function WorkspaceDocsPanel(props: Props) {
  const [scope, setScope] = useState<DocScope>('request')
  const [editing, setEditing] = useState(false)

  const currentDocs = useMemo(() => {
    if (scope === 'project') return props.project.docs ?? ''
    if (scope === 'collection') return props.collection?.docs ?? ''
    return props.request?.docs ?? ''
  }, [scope, props.project.docs, props.collection?.docs, props.request?.docs])

  const scopeLabel =
    scope === 'project'
      ? props.project.name
      : scope === 'collection'
        ? props.collection?.name ?? '—'
        : props.request?.name ?? '—'

  const handleChange = (value: string) => {
    if (scope === 'project') props.onChangeProjectDocs(value)
    else if (scope === 'collection') props.onChangeCollectionDocs(value)
    else props.onChangeRequestDocs(value)
  }

  return (
    <div className="ws-docs">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div className="ws-title">Documentation</div>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Scope: <span className="mono">{scopeLabel}</span>
          </p>
        </div>
        <button type="button" className="ws-btn ghost" onClick={() => setEditing((p) => !p)}>
          {editing ? 'Preview' : 'Edit'}
        </button>
      </div>

      <div className="ws-docs-tabs">
        <button type="button" className={`ws-subtab${scope === 'project' ? ' active' : ''}`} onClick={() => setScope('project')}>
          Project
        </button>
        <button type="button" className={`ws-subtab${scope === 'collection' ? ' active' : ''}`} onClick={() => setScope('collection')} disabled={!props.collection}>
          Collection
        </button>
        <button type="button" className={`ws-subtab${scope === 'request' ? ' active' : ''}`} onClick={() => setScope('request')} disabled={!props.request}>
          Request
        </button>
      </div>

      {editing ? (
        <div className="ws-docs-editor">
          <textarea
            className="ws-textarea"
            value={currentDocs}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={`Write documentation for this ${scope}…\n\nSupports plain text. Describe the purpose, usage notes, expected behavior, etc.`}
          />
        </div>
      ) : (
        <div className="ws-docs-preview">
          {currentDocs ? (
            currentDocs.split('\n').map((line, i) => (
              <p key={i} style={{ margin: '0 0 6px' }}>
                {line || '\u00A0'}
              </p>
            ))
          ) : (
            <p className="muted">No documentation yet. Click Edit to start writing.</p>
          )}
        </div>
      )}
    </div>
  )
}
