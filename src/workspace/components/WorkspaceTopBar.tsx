import { useState, useRef, useEffect } from 'react'
import { FileCode, LogOut, Play, Plus, Search, Terminal, Sun, Moon, ChevronDown, Check } from 'lucide-react'
import type { Project } from '../../models/types'

type Props = {
  onOpenCommandPalette?: () => void
  username: string | null
  projects: Project[]
  activeProjectId: string
  environment: string
  onSelectProject: (id: string) => void
  onCreateProject: () => void
  onEnvironmentChange: (env: string) => void
  onRun: () => void
  exportTarget: 'request' | 'collection'
  onExportTargetChange: (target: 'request' | 'collection') => void
  onExport: () => void
  onExportCurl: () => void
  onLogout: () => void
  runPurpose: 'performance' | 'smoke'
  onRunPurposeChange: (mode: 'performance' | 'smoke') => void
  collectionExecution: 'parallel' | 'sequential'
  onCollectionExecutionChange: (mode: 'parallel' | 'sequential') => void
  collectionLoadVus: number
  collectionLoadDuration: string
  collectionLoadRampUp: string
  onCollectionLoadChange: (patch: { k6LoadVus?: number; k6LoadDuration?: string; k6LoadRampUp?: string }) => void
  theme: 'dark' | 'light'
  onThemeToggle: () => void
}

// ── Custom TopBar select ────────────────────────────────────────────────────────
type SelectOption = { value: string; label: string }

function TopBarSelect({
  prefix,
  value,
  onChange,
  options,
}: {
  prefix: string
  value: string
  onChange: (v: string) => void
  options: SelectOption[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = options.find((o) => o.value === value)?.label ?? value

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  return (
    <div ref={ref} className="ws-topbar-select">
      <button
        type="button"
        className={`ws-topbar-select-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="ws-topbar-select-prefix">{prefix}</span>
        <span className="ws-topbar-select-sep" aria-hidden>·</span>
        <span className="ws-topbar-select-value">{selected}</span>
        <ChevronDown
          size={10}
          className={`ws-topbar-select-chevron${open ? ' rotated' : ''}`}
        />
      </button>

      {open && (
        <div className="ws-topbar-select-menu" role="listbox">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={`ws-topbar-select-option${o.value === value ? ' active' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false) }}
            >
              <span className="ws-topbar-select-option-check">
                {o.value === value ? <Check size={11} strokeWidth={2.5} /> : null}
              </span>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Export dropdown ─────────────────────────────────────────────────────────────
function ExportDropdown(props: {
  exportTarget: 'request' | 'collection'
  onExportTargetChange: (t: 'request' | 'collection') => void
  onExport: () => void
  onExportCurl: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="ws-btn ws-btn--sm ghost"
        title="Export options"
        onClick={() => setOpen((v) => !v)}
      >
        <FileCode size={13} style={{ marginRight: 4 }} />
        Export
        <ChevronDown size={11} style={{ marginLeft: 3 }} />
      </button>

      {open && (
        <div className="ws-export-dropdown">
          <div className="ws-export-dropdown-section">
            <span className="ws-export-dropdown-label">Scope</span>
            <div className="ws-export-dropdown-options">
              {(['request', 'collection'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`ws-export-option${props.exportTarget === t ? ' active' : ''}`}
                  onClick={() => props.onExportTargetChange(t)}
                >
                  {t === 'request' ? 'Active request' : 'Whole collection'}
                </button>
              ))}
            </div>
          </div>

          <div className="ws-export-dropdown-divider" />

          <button
            type="button"
            className="ws-export-dropdown-action"
            onClick={() => { props.onExport(); setOpen(false) }}
          >
            <FileCode size={13} style={{ marginRight: 6 }} />
            Download .js script
          </button>
          <button
            type="button"
            className="ws-export-dropdown-action"
            onClick={() => { props.onExportCurl(); setOpen(false) }}
          >
            <Terminal size={13} style={{ marginRight: 6 }} />
            Export as cURL
          </button>
        </div>
      )}
    </div>
  )
}

// ── Static option lists ─────────────────────────────────────────────────────────
const ENV_OPTIONS: SelectOption[] = [
  { value: 'dev', label: 'Dev' },
  { value: 'testing', label: 'Testing' },
  { value: 'preprod-v1', label: 'Preprod-V1' },
  { value: 'preprod-v2', label: 'Preprod-V2' },
  { value: 'production', label: 'Production' },
]

const MODE_OPTIONS: SelectOption[] = [
  { value: 'performance', label: 'Performance' },
  { value: 'smoke', label: 'Smoke' },
]

const EXEC_OPTIONS: SelectOption[] = [
  { value: 'parallel', label: 'Parallel' },
  { value: 'sequential', label: 'Sequential' },
]

// ── Main TopBar ─────────────────────────────────────────────────────────────────
export function WorkspaceTopBar(props: Props) {
  const showSequentialLoad =
    props.exportTarget === 'collection' &&
    props.collectionExecution === 'sequential' &&
    props.runPurpose === 'performance'

  const projectOptions: SelectOption[] = props.projects.map((p) => ({
    value: p.id,
    label: p.name,
  }))

  return (
    <header className="ws-topbar">
      <div className="ws-topbar-row ws-topbar-row--main">

        {/* Project */}
        <TopBarSelect
          prefix="Project"
          value={props.activeProjectId}
          onChange={props.onSelectProject}
          options={projectOptions}
        />
        <button
          type="button"
          className="ws-btn ws-btn--sm ws-btn--add-collection"
          title="Create a new project"
          onClick={props.onCreateProject}
        >
          <Plus size={12} strokeWidth={2.5} style={{ marginRight: 3 }} />
          New
        </button>

        <span className="ws-topbar-divider" aria-hidden />

        {/* Environment */}
        <TopBarSelect
          prefix="Env"
          value={props.environment}
          onChange={props.onEnvironmentChange}
          options={ENV_OPTIONS}
        />

        <span className="ws-topbar-divider" aria-hidden />

        {/* Mode */}
        <TopBarSelect
          prefix="Mode"
          value={props.runPurpose}
          onChange={(v) => props.onRunPurposeChange(v as 'performance' | 'smoke')}
          options={MODE_OPTIONS}
        />

        {/* Collection execution */}
        {props.exportTarget === 'collection' ? (
          <>
            <span className="ws-topbar-divider" aria-hidden />
            <TopBarSelect
              prefix="Exec"
              value={props.collectionExecution}
              onChange={(v) => props.onCollectionExecutionChange(v as 'parallel' | 'sequential')}
              options={EXEC_OPTIONS}
            />
          </>
        ) : null}

        {/* Load config when sequential */}
        {showSequentialLoad ? (
          <>
            <span className="ws-topbar-divider" aria-hidden />
            <div className="ws-topbar-cluster ws-topbar-cluster--load">
              <span className="ws-topbar-label">Load</span>
              <div className="ws-topbar-load-field" title="Virtual users">
                <span className="ws-topbar-load-hint">VUs</span>
                <input
                  className="ws-input ws-input--narrow"
                  type="number"
                  min={1}
                  value={props.collectionLoadVus}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10)
                    if (Number.isFinite(n) && n >= 1) props.onCollectionLoadChange({ k6LoadVus: n })
                  }}
                />
              </div>
              <div className="ws-topbar-load-field" title="Steady-state duration (e.g. 1m, 30s)">
                <span className="ws-topbar-load-hint">Duration</span>
                <input
                  className="ws-input ws-input--time"
                  value={props.collectionLoadDuration}
                  onChange={(e) => props.onCollectionLoadChange({ k6LoadDuration: e.target.value })}
                  placeholder="1m"
                />
              </div>
              <div className="ws-topbar-load-field" title="Ramp-up time (e.g. 30s, 1m)">
                <span className="ws-topbar-load-hint">Ramp</span>
                <input
                  className="ws-input ws-input--time"
                  value={props.collectionLoadRampUp}
                  onChange={(e) => props.onCollectionLoadChange({ k6LoadRampUp: e.target.value })}
                  placeholder="30s"
                />
              </div>
            </div>
          </>
        ) : null}

        <div className="ws-topbar-spacer" />

        {/* Right cluster */}
        <div className="ws-topbar-cluster ws-topbar-cluster--end">
          <ExportDropdown
            exportTarget={props.exportTarget}
            onExportTargetChange={props.onExportTargetChange}
            onExport={props.onExport}
            onExportCurl={props.onExportCurl}
          />

          {props.onOpenCommandPalette ? (
            <button
              type="button"
              className="ws-topbar-kb-hint"
              title="Open command palette (Ctrl+K)"
              onClick={props.onOpenCommandPalette}
            >
              <Search size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              Ctrl+K
            </button>
          ) : null}

          <button
            type="button"
            className="ws-btn ws-btn--sm ws-btn--icon ghost"
            title={props.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={props.onThemeToggle}
          >
            {props.theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          <span className="ws-topbar-user muted" title={`Signed in as ${props.username ?? 'user'}`}>
            {props.username ?? 'user'}
          </span>

          <button
            type="button"
            className="ws-btn ws-btn--sm ghost"
            title="Sign out"
            onClick={props.onLogout}
          >
            <LogOut size={13} style={{ marginRight: 3 }} />
            Logout
          </button>

          <button
            type="button"
            className="ws-btn ws-btn--sm primary"
            title="Generate k6 script and run the load test"
            onClick={props.onRun}
          >
            <Play size={13} fill="currentColor" style={{ marginRight: 4 }} />
            Run
          </button>
        </div>
      </div>
    </header>
  )
}
