import { useEffect, useState } from 'react'
import type { Collection, Project, RequestDefinition } from '../../models/types'

type Props = {
  project: Project
  activeCollectionId: string | null
  activeRequestId: string | null
  onSelectCollection: (id: string) => void
  onSelectRequest: (id: string) => void
  onCreateCollection: () => void
  onCreateRequest: () => void
  onRenameCollection: (collectionId: string, name: string) => void
  onRenameRequest: (collectionId: string, requestId: string, name: string) => void
  onSendCollectionRequests: (collectionId: string) => void
  onOpenImportCurl?: () => void
  onOpenImportCollection?: () => void
  onExportCollectionJson?: (collectionId: string) => void
}

export function WorkspaceLeftSidebar(props: Props) {
  const activeCollection =
    props.project.collections.find((c) => c.id === props.activeCollectionId) ?? props.project.collections[0]

  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null)
  const [collectionDraft, setCollectionDraft] = useState('')
  const [editingRequestKey, setEditingRequestKey] = useState<string | null>(null)
  const [requestDraft, setRequestDraft] = useState('')

  useEffect(() => {
    if (editingCollectionId && editingCollectionId !== activeCollection?.id) {
      setEditingCollectionId(null)
    }
  }, [editingCollectionId, activeCollection?.id])

  const startEditCollection = (col: Collection, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingCollectionId(col.id)
    setCollectionDraft(col.name)
  }

  const commitCollectionName = (colId: string) => {
    const name = collectionDraft.trim()
    if (name) props.onRenameCollection(colId, name)
    setEditingCollectionId(null)
  }

  const startEditRequest = (colId: string, req: RequestDefinition, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingRequestKey(`${colId}:${req.id}`)
    setRequestDraft(req.name)
  }

  const commitRequestName = (colId: string, reqId: string) => {
    const name = requestDraft.trim()
    if (name) props.onRenameRequest(colId, reqId, name)
    setEditingRequestKey(null)
  }

  return (
    <aside className="ws-left">
      <div className="ws-left-head">
        <div>
          <div className="ws-title">Collections</div>
          <div className="muted">Project: {props.project.name}</div>
        </div>
        <button type="button" className="ws-btn ghost" onClick={props.onCreateCollection}>
          + Collection
        </button>
      </div>
      <div className="ws-left-tools">
        {props.onOpenImportCurl ? (
          <button type="button" className="ws-btn ghost ws-left-tool-btn" onClick={props.onOpenImportCurl}>
            Import cURL
          </button>
        ) : null}
        {props.onOpenImportCollection ? (
          <button type="button" className="ws-btn ghost ws-left-tool-btn" onClick={props.onOpenImportCollection}>
            Import JSON
          </button>
        ) : null}
      </div>

      <div className="ws-tree">
        {props.project.collections.map((col: Collection) => (
          <div key={col.id} className={`ws-tree-node${col.id === activeCollection?.id ? ' active' : ''}`}>
            <div className="ws-tree-row">
              {editingCollectionId === col.id ? (
                <input
                  className="ws-tree-rename"
                  value={collectionDraft}
                  onChange={(e) => setCollectionDraft(e.target.value)}
                  onBlur={() => commitCollectionName(col.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitCollectionName(col.id)
                    if (e.key === 'Escape') setEditingCollectionId(null)
                  }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <button type="button" className="ws-tree-folder" style={{ flex: 1, textAlign: 'left' }} onClick={() => props.onSelectCollection(col.id)}>
                  {col.name}
                </button>
              )}
              <button
                type="button"
                className="ws-btn ghost ws-tree-send"
                title="Rename collection"
                onClick={(e) => startEditCollection(col, e)}
              >
                ✎
              </button>
              <button
                type="button"
                className="ws-btn ghost ws-tree-send"
                title="Send all requests in this collection (HTTP)"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onSendCollectionRequests(col.id)
                }}
              >
                ▶
              </button>
              {props.onExportCollectionJson ? (
                <button
                  type="button"
                  className="ws-btn ghost ws-tree-send"
                  title="Export collection as PerfMix JSON"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onExportCollectionJson!(col.id)
                  }}
                >
                  ⭳
                </button>
              ) : null}
            </div>
            {col.id === activeCollection?.id ? (
              <div className="ws-tree-children">
                {col.requests.map((req: RequestDefinition) => {
                  const rk = `${col.id}:${req.id}`
                  const editing = editingRequestKey === rk
                  return (
                    <div key={req.id} className="ws-tree-row" style={{ marginLeft: 4 }}>
                      {editing ? (
                        <input
                          className="ws-tree-rename"
                          value={requestDraft}
                          onChange={(e) => setRequestDraft(e.target.value)}
                          onBlur={() => commitRequestName(col.id, req.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRequestName(col.id, req.id)
                            if (e.key === 'Escape') setEditingRequestKey(null)
                          }}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <button
                          type="button"
                          className={`ws-tree-item${req.id === props.activeRequestId ? ' active' : ''}`}
                          style={{ flex: 1 }}
                          onClick={() => props.onSelectRequest(req.id)}
                        >
                          <span className="ws-method">{req.method}</span>
                          <span className="ws-req-name">{req.name}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="ws-btn ghost ws-tree-send"
                        title="Rename request"
                        onClick={(e) => startEditRequest(col.id, req, e)}
                      >
                        ✎
                      </button>
                    </div>
                  )
                })}
                <button type="button" className="ws-tree-add" onClick={props.onCreateRequest}>
                  + Request
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </aside>
  )
}
