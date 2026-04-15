import { useEffect, useRef, useState } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Pencil,
  Play,
  Download,
  Trash2,
  GripVertical,
  Plus,
  Search,
  X,
  FolderOpen,
  FileText,
  Upload,
} from 'lucide-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
  onOpenImportJmx?: () => void
  onOpenImportHar?: () => void
  onOpenImportOpenApi?: () => void
  onOpenImportPostman?: () => void
  onOpenImportUnified?: () => void
  onExportCollectionJson?: (collectionId: string) => void
  onDeleteRequest?: (collectionId: string, requestId: string) => void
  onDeleteCollection?: (collectionId: string) => void
  onDeleteAllCollections?: () => void
  onMoveRequest?: (collectionId: string, requestId: string, direction: 'up' | 'down') => void
  onReorderRequests?: (collectionId: string, newRequestIds: string[]) => void
}

// ── Sortable request row ─────────────────────────────────────────────────────
type SortableRowProps = {
  req: RequestDefinition
  colId: string
  isActive: boolean
  editing: boolean
  requestDraft: string
  onRequestDraftChange: (v: string) => void
  onCommitName: (colId: string, reqId: string) => void
  onCancelEdit: () => void
  onSelect: (id: string) => void
  onStartEdit: (colId: string, req: RequestDefinition, e: React.MouseEvent) => void
  onDelete?: (colId: string, reqId: string) => void
  methodColor: string
}

function SortableRequestRow(props: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.req.id,
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style} className="ws-tree-row ws-tree-request-row">
      {/* Drag handle */}
      <span
        className="ws-drag-handle"
        {...attributes}
        {...listeners}
        title="Drag to reorder"
      >
        <GripVertical size={13} />
      </span>

      {props.editing ? (
        <input
          className="ws-tree-rename"
          value={props.requestDraft}
          onChange={(e) => props.onRequestDraftChange(e.target.value)}
          onBlur={() => props.onCommitName(props.colId, props.req.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') props.onCommitName(props.colId, props.req.id)
            if (e.key === 'Escape') props.onCancelEdit()
          }}
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <button
          type="button"
          className={`ws-tree-item${props.isActive ? ' active' : ''}`}
          style={{ flex: 1 }}
          onClick={() => props.onSelect(props.req.id)}
        >
          <span className="ws-method" style={{ color: props.methodColor }}>
            {props.req.method}
          </span>
          <span className="ws-req-name">{props.req.name}</span>
        </button>
      )}

      <button
        type="button"
        className="ws-icon-btn ws-icon-btn--ghost"
        title="Rename request"
        onClick={(e) => props.onStartEdit(props.colId, props.req, e)}
      >
        <Pencil size={12} />
      </button>
      {props.onDelete ? (
        <button
          type="button"
          className="ws-icon-btn ws-icon-btn--danger"
          title="Remove request"
          onClick={(e) => {
            e.stopPropagation()
            props.onDelete!(props.colId, props.req.id)
          }}
        >
          <Trash2 size={12} />
        </button>
      ) : null}
    </div>
  )
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'var(--method-get)',
  POST: 'var(--method-post)',
  PUT: 'var(--method-put)',
  PATCH: 'var(--method-patch)',
  DELETE: 'var(--method-delete)',
  HEAD: 'var(--method-head)',
  OPTIONS: 'var(--method-options)',
}

export function WorkspaceLeftSidebar(props: Props) {
  const activeCollection =
    props.project.collections.find((c) => c.id === props.activeCollectionId) ?? props.project.collections[0]

  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null)
  const [collectionDraft, setCollectionDraft] = useState('')
  const [editingRequestKey, setEditingRequestKey] = useState<string | null>(null)
  const [requestDraft, setRequestDraft] = useState('')
  const [collapsedCollections, setCollapsedCollections] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const handleDragEnd = (colId: string, requests: RequestDefinition[], event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIds = requests.map((r) => r.id)
    const oldIndex = oldIds.indexOf(active.id as string)
    const newIndex = oldIds.indexOf(over.id as string)
    const newIds = arrayMove(oldIds, oldIndex, newIndex)
    props.onReorderRequests?.(colId, newIds)
  }

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

  const toggleCollapse = (colId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setCollapsedCollections((prev) => {
      const next = new Set(prev)
      if (next.has(colId)) next.delete(colId)
      else next.add(colId)
      return next
    })
  }

  const canDeleteCollection = props.project.collections.length > 1 && !!props.onDeleteCollection

  const query = searchQuery.trim().toLowerCase()
  const filteredCollections = props.project.collections.map((col) => ({
    ...col,
    requests: query
      ? col.requests.filter(
          (r) =>
            r.name.toLowerCase().includes(query) ||
            r.method.toLowerCase().includes(query) ||
            r.url.toLowerCase().includes(query),
        )
      : col.requests,
  })).filter((col) => !query || col.requests.length > 0)

  return (
    <aside className="ws-left">
      {/* Header */}
      <div className="ws-left-head">
        <div className="ws-left-head-text">
          <div className="ws-title">Collections</div>
          <div className="muted ws-left-sub">Project: {props.project.name}</div>
        </div>
        <div className="ws-left-head-actions">
          <button
            type="button"
            className="ws-btn ws-btn--sm ws-btn--add-collection"
            title="Create a new collection"
            onClick={props.onCreateCollection}
          >
            <Plus size={13} strokeWidth={2.5} style={{ marginRight: 3 }} />
            Collection
          </button>
          {props.onDeleteAllCollections ? (
            <button
              type="button"
              className="ws-btn ws-btn--sm ws-btn--reset-danger"
              title="Remove all collections and start with one empty Default"
              onClick={props.onDeleteAllCollections}
            >
              Reset All
            </button>
          ) : null}
        </div>
      </div>

      {/* Search */}
      <div className="ws-left-search">
        <Search size={13} className="ws-left-search-icon" />
        <input
          ref={searchRef}
          className="ws-left-search-input"
          placeholder="Search requests…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery ? (
          <button
            type="button"
            className="ws-left-search-clear"
            onClick={() => { setSearchQuery(''); searchRef.current?.focus() }}
            title="Clear search"
          >
            <X size={12} />
          </button>
        ) : null}
      </div>

      {/* Unified import button */}
      {props.onOpenImportUnified ? (
        <div style={{ padding: '0 10px 10px' }}>
          <button
            type="button"
            className="ws-left-import-btn"
            title="Import from cURL, JSON, JMX, HAR, OpenAPI, or Postman"
            onClick={props.onOpenImportUnified}
          >
            <Upload size={13} />
            Import collection…
          </button>
        </div>
      ) : null}

      {/* Tree */}
      <div className="ws-tree">
        {filteredCollections.length === 0 && query ? (
          <div className="ws-empty-state ws-empty-state--sm">
            <Search size={22} className="ws-empty-state-icon" />
            <p className="ws-empty-state-text">No requests match "{searchQuery}"</p>
          </div>
        ) : filteredCollections.length === 0 ? (
          <div className="ws-empty-state ws-empty-state--sm">
            <FolderOpen size={28} className="ws-empty-state-icon" />
            <p className="ws-empty-state-text">No collections yet</p>
            <button type="button" className="ws-btn ws-btn--sm primary" onClick={props.onCreateCollection}>
              <Plus size={13} style={{ marginRight: 4 }} />
              New collection
            </button>
          </div>
        ) : (
          filteredCollections.map((col: Collection) => {
            const isActive = col.id === activeCollection?.id
            const isCollapsed = collapsedCollections.has(col.id) && !query
            return (
              <div key={col.id} className={`ws-tree-node${isActive ? ' active' : ''}`}>
                {/* Collection row */}
                <div className="ws-tree-row">
                  <button
                    type="button"
                    className="ws-tree-collapse-btn"
                    title={isCollapsed ? 'Expand collection' : 'Collapse collection'}
                    onClick={(e) => toggleCollapse(col.id, e)}
                  >
                    {isCollapsed
                      ? <ChevronRight size={13} strokeWidth={2} />
                      : <ChevronDown size={13} strokeWidth={2} />
                    }
                  </button>

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
                    <button
                      type="button"
                      className="ws-tree-folder"
                      style={{ flex: 1, textAlign: 'left' }}
                      onClick={() => props.onSelectCollection(col.id)}
                    >
                      {col.name}
                      <span className="ws-tree-count muted">{col.requests.length}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    className="ws-icon-btn ws-icon-btn--ghost"
                    title="Rename collection"
                    onClick={(e) => startEditCollection(col, e)}
                  >
                    <Pencil size={13} />
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
                    <Play size={13} fill="currentColor" />
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
                      <Download size={13} />
                    </button>
                  ) : null}
                  {canDeleteCollection ? (
                    <button
                      type="button"
                      className="ws-icon-btn ws-icon-btn--danger"
                      title="Delete collection"
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onDeleteCollection!(col.id)
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  ) : null}
                </div>

                {/* Requests */}
                {!isCollapsed ? (
                  <div className="ws-tree-children">
                    {col.requests.length === 0 ? (
                      <div className="ws-empty-state ws-empty-state--xs">
                        <FileText size={18} className="ws-empty-state-icon" />
                        <p className="ws-empty-state-text">No requests in this collection</p>
                      </div>
                    ) : (
                      <>
                        <p className="ws-tree-order-hint muted">
                          Drag <GripVertical size={11} style={{ verticalAlign: 'middle' }} /> to reorder. Order affects &quot;Send all&quot; and sequential k6.
                        </p>
                        <DndContext
                          sensors={sensors}
                          collisionDetection={closestCenter}
                          onDragEnd={(event) => handleDragEnd(col.id, col.requests, event)}
                        >
                          <SortableContext
                            items={col.requests.map((r) => r.id)}
                            strategy={verticalListSortingStrategy}
                          >
                            {col.requests.map((req: RequestDefinition) => {
                              const rk = `${col.id}:${req.id}`
                              const editing = editingRequestKey === rk
                              const methodColor = METHOD_COLORS[req.method] ?? 'var(--color-accent)'
                              return (
                                <SortableRequestRow
                                  key={req.id}
                                  req={req}
                                  colId={col.id}
                                  isActive={req.id === props.activeRequestId}
                                  editing={editing}
                                  requestDraft={requestDraft}
                                  onRequestDraftChange={setRequestDraft}
                                  onCommitName={commitRequestName}
                                  onCancelEdit={() => setEditingRequestKey(null)}
                                  onSelect={props.onSelectRequest}
                                  onStartEdit={startEditRequest}
                                  onDelete={props.onDeleteRequest}
                                  methodColor={methodColor}
                                />
                              )
                            })}
                          </SortableContext>
                        </DndContext>
                      </>
                    )}
                    <button type="button" className="ws-tree-add" onClick={props.onCreateRequest}>
                      <Plus size={13} strokeWidth={2.5} style={{ marginRight: 4 }} />
                      Request
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
