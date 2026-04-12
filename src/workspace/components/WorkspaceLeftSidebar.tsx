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
  onDeleteRequest?: (collectionId: string, requestId: string) => void
  onDeleteAllCollections?: () => void
  onMoveRequest?: (collectionId: string, requestId: string, direction: 'up' | 'down') => void
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
        <div className="ws-left-head-text">
          <div className="ws-title">Collections</div>
          <div className="muted ws-left-sub">Project: {props.project.name}</div>
        </div>
        <div className="ws-left-head-actions">
          <button type="button" className="ws-btn ws-btn--sm ghost" onClick={props.onCreateCollection}>
            + Collection
          </button>
          {props.onDeleteAllCollections ? (
            <button type="button" className="ws-link-danger" title="Remove all collections and start with one empty Default" onClick={props.onDeleteAllCollections}>
              Reset all…
            </button>
          ) : null}
        </div>
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
              <button type="button" className="ws-icon-btn ws-icon-btn--ghost" title="Rename collection" onClick={(e) => startEditCollection(col, e)}>
                ✎
              </button>
              <button
                type="button"
                className="ws-icon-btn ws-icon-btn--accent"
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
                  className="ws-icon-btn ws-icon-btn--ghost"
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
                <p className="ws-tree-order-hint muted">Order: &quot;Send all&quot; and sequential k6 follow this list. Arrows move rows.</p>
                {col.requests.map((req: RequestDefinition, reqIndex: number) => {
                  const rk = `${col.id}:${req.id}`
                  const editing = editingRequestKey === rk
                  const canUp = reqIndex > 0
                  const canDown = reqIndex < col.requests.length - 1
                  return (
                    <div key={req.id} className="ws-tree-row ws-tree-request-row">
                      {props.onMoveRequest && !editing ? (
                        <span className="ws-tree-reorder" aria-label="Reorder request">
                          <button
                            type="button"
                            className="ws-icon-btn"
                            disabled={!canUp}
                            title="Move up"
                            onClick={(e) => {
                              e.stopPropagation()
                              props.onMoveRequest!(col.id, req.id, 'up')
                            }}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="ws-icon-btn"
                            disabled={!canDown}
                            title="Move down"
                            onClick={(e) => {
                              e.stopPropagation()
                              props.onMoveRequest!(col.id, req.id, 'down')
                            }}
                          >
                            ↓
                          </button>
                        </span>
                      ) : null}
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
                      <button type="button" className="ws-icon-btn ws-icon-btn--ghost" title="Rename request" onClick={(e) => startEditRequest(col.id, req, e)}>
                        ✎
                      </button>
                      {props.onDeleteRequest ? (
                        <button
                          type="button"
                          className="ws-icon-btn ws-icon-btn--danger"
                          title="Remove request"
                          onClick={(e) => {
                            e.stopPropagation()
                            props.onDeleteRequest!(col.id, req.id)
                          }}
                        >
                          ✕
                        </button>
                      ) : null}
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
