import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Search,
  Play,
  Plus,
  FileCode,
  Download,
  FolderPlus,
  Zap,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  CornerDownLeft,
} from 'lucide-react'
import type { Project } from '../../models/types'

type ActionItem = {
  id: string
  type: 'action'
  label: string
  description?: string
  icon: React.ReactNode
  keywords?: string
  onExecute: () => void
}

type RequestItem = {
  id: string
  type: 'request'
  label: string
  description: string
  method: string
  collectionName: string
  onExecute: () => void
}

type CollectionItem = {
  id: string
  type: 'collection'
  label: string
  description: string
  count: number
  onExecute: () => void
}

type PaletteItem = ActionItem | RequestItem | CollectionItem

type Props = {
  open: boolean
  onClose: () => void
  project: Project
  onSelectRequest: (collectionId: string, requestId: string) => void
  onSelectCollection: (collectionId: string) => void
  onCreateRequest: () => void
  onCreateCollection: () => void
  onRun: () => void
  onExport: () => void
  onExportCurl: () => void
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

function fuzzyScore(query: string, target: string): number {
  if (!query) return 1
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (t === q) return 100
  if (t.startsWith(q)) return 80
  if (t.includes(q)) return 60
  // character-by-character fuzzy
  let qi = 0
  let score = 0
  let lastMatch = -1
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      score += lastMatch === i - 1 ? 5 : 1 // bonus for consecutive
      lastMatch = i
      qi++
    }
  }
  return qi === q.length ? score : 0
}

function matchItem(query: string, item: PaletteItem): number {
  if (!query.trim()) return 1
  if (item.type === 'request') {
    const scores = [
      fuzzyScore(query, item.label),
      fuzzyScore(query, item.method),
      fuzzyScore(query, item.collectionName),
      fuzzyScore(query, item.description),
    ]
    return Math.max(...scores)
  }
  if (item.type === 'collection') {
    return Math.max(fuzzyScore(query, item.label), fuzzyScore(query, item.description))
  }
  // action
  return Math.max(
    fuzzyScore(query, item.label),
    fuzzyScore(query, item.description ?? ''),
    fuzzyScore(query, (item as ActionItem).keywords ?? ''),
  )
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const idx = t.indexOf(q)
  if (idx >= 0) {
    return (
      <>
        {text.slice(0, idx)}
        <mark className="cp-highlight">{text.slice(idx, idx + q.length)}</mark>
        {text.slice(idx + q.length)}
      </>
    )
  }
  return <>{text}</>
}

export function CommandPalette(props: Props) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Build the full item list
  const allItems = useCallback((): PaletteItem[] => {
    const actions: ActionItem[] = [
      {
        id: 'action:run',
        type: 'action',
        label: 'Run k6 load test',
        description: 'Generate script and start the test',
        icon: <Play size={14} fill="currentColor" />,
        keywords: 'execute start performance smoke',
        onExecute: () => { props.onRun(); props.onClose() },
      },
      {
        id: 'action:new-request',
        type: 'action',
        label: 'New request',
        description: 'Add a request to the active collection',
        icon: <Plus size={14} />,
        keywords: 'create add http get post put delete',
        onExecute: () => { props.onCreateRequest(); props.onClose() },
      },
      {
        id: 'action:new-collection',
        type: 'action',
        label: 'New collection',
        description: 'Create a new request collection',
        icon: <FolderPlus size={14} />,
        keywords: 'create folder group',
        onExecute: () => { props.onCreateCollection(); props.onClose() },
      },
      {
        id: 'action:export-js',
        type: 'action',
        label: 'Download k6 script (.js)',
        description: 'Export generated k6 JavaScript file',
        icon: <FileCode size={14} />,
        keywords: 'download export javascript script',
        onExecute: () => { props.onExport(); props.onClose() },
      },
      {
        id: 'action:export-curl',
        type: 'action',
        label: 'Export cURL commands',
        description: 'Export requests as shell cURL commands',
        icon: <Download size={14} />,
        keywords: 'curl shell terminal bash copy',
        onExecute: () => { props.onExportCurl(); props.onClose() },
      },
    ]

    const collections: CollectionItem[] = props.project.collections.map((col) => ({
      id: `collection:${col.id}`,
      type: 'collection',
      label: col.name,
      description: `${col.requests.length} request${col.requests.length !== 1 ? 's' : ''}`,
      count: col.requests.length,
      onExecute: () => { props.onSelectCollection(col.id); props.onClose() },
    }))

    const requests: RequestItem[] = props.project.collections.flatMap((col) =>
      col.requests.map((req) => ({
        id: `request:${col.id}:${req.id}`,
        type: 'request',
        label: req.name,
        description: req.url,
        method: req.method,
        collectionName: col.name,
        onExecute: () => { props.onSelectRequest(col.id, req.id); props.onClose() },
      }))
    )

    return [...actions, ...collections, ...requests]
  }, [props])

  const filteredItems = useCallback(() => {
    const items = allItems()
    if (!query.trim()) return items
    return items
      .map((item) => ({ item, score: matchItem(query, item) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item)
  }, [query, allItems])

  const items = filteredItems()

  // Reset active when query changes
  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // Focus input on open
  useEffect(() => {
    if (props.open) {
      setQuery('')
      setActiveIndex(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [props.open])

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const active = list.querySelector<HTMLButtonElement>('[data-active="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { props.onClose(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      items[activeIndex]?.onExecute()
    }
  }

  if (!props.open) return null

  // Group items by type for display
  const actionItems = items.filter((i) => i.type === 'action')
  const collectionItems = items.filter((i) => i.type === 'collection')
  const requestItems = items.filter((i) => i.type === 'request')

  let globalIdx = 0
  function renderGroup(groupItems: PaletteItem[], groupLabel: string) {
    if (groupItems.length === 0) return null
    return (
      <div className="cp-group" key={groupLabel}>
        <div className="cp-group-label">{groupLabel}</div>
        {groupItems.map((item) => {
          const idx = globalIdx++
          const isActive = idx === activeIndex
          return (
            <button
              key={item.id}
              type="button"
              className={`cp-item${isActive ? ' active' : ''}`}
              data-active={isActive}
              onMouseEnter={() => setActiveIndex(idx)}
              onClick={() => item.onExecute()}
            >
              {item.type === 'action' ? (
                <>
                  <span className="cp-item-icon cp-item-icon--action">{(item as ActionItem).icon}</span>
                  <span className="cp-item-text">
                    <span className="cp-item-label">
                      <HighlightMatch text={item.label} query={query} />
                    </span>
                    {(item as ActionItem).description ? (
                      <span className="cp-item-desc">{(item as ActionItem).description}</span>
                    ) : null}
                  </span>
                  {isActive ? <ChevronRight size={13} className="cp-item-arrow" /> : null}
                </>
              ) : item.type === 'collection' ? (
                <>
                  <span className="cp-item-icon cp-item-icon--collection">
                    <Zap size={13} />
                  </span>
                  <span className="cp-item-text">
                    <span className="cp-item-label">
                      <HighlightMatch text={item.label} query={query} />
                    </span>
                    <span className="cp-item-desc">{(item as CollectionItem).description}</span>
                  </span>
                  {isActive ? <ChevronRight size={13} className="cp-item-arrow" /> : null}
                </>
              ) : (
                <>
                  <span
                    className="cp-item-method"
                    style={{ color: METHOD_COLORS[(item as RequestItem).method] ?? 'var(--color-accent)' }}
                  >
                    {(item as RequestItem).method}
                  </span>
                  <span className="cp-item-text">
                    <span className="cp-item-label">
                      <HighlightMatch text={item.label} query={query} />
                    </span>
                    <span className="cp-item-desc cp-item-desc--url">
                      <HighlightMatch text={(item as RequestItem).description} query={query} />
                    </span>
                  </span>
                  <span className="cp-item-col muted">{(item as RequestItem).collectionName}</span>
                  {isActive ? <ChevronRight size={13} className="cp-item-arrow" /> : null}
                </>
              )}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="cp-backdrop" onClick={props.onClose} onKeyDown={undefined}>
      <div
        className="cp-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="cp-search-wrap">
          <Search size={15} className="cp-search-icon" />
          <input
            ref={inputRef}
            className="cp-search-input"
            placeholder="Search requests, collections, actions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="cp-esc-hint">Esc</kbd>
        </div>

        {/* Results */}
        <div className="cp-results" ref={listRef}>
          {items.length === 0 ? (
            <div className="cp-empty">
              <Search size={22} className="cp-empty-icon" />
              <span>No results for &ldquo;{query}&rdquo;</span>
            </div>
          ) : (
            <>
              {renderGroup(actionItems, 'Actions')}
              {renderGroup(collectionItems, 'Collections')}
              {renderGroup(requestItems, 'Requests')}
            </>
          )}
        </div>

        {/* Footer hints */}
        <div className="cp-footer">
          <span className="cp-hint"><ArrowUp size={11} /><ArrowDown size={11} /> navigate</span>
          <span className="cp-hint"><CornerDownLeft size={11} /> select</span>
          <span className="cp-hint"><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
