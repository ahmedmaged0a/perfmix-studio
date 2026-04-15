import { useState, useRef, useEffect } from 'react'
import { FileCode, LogOut, Play, Plus, Search, Terminal, Sun, Moon, ChevronDown } from 'lucide-react'
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

/** Floating export dropdown */
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
          {/* Scope */}
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

          {/* Actions */}
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

export function WorkspaceTopBar(props: Props) {
  const showSequentialLoad =
    props.exportTarget === 'collection' &&
    props.collectionExecution === 'sequential' &&
    props.runPurpose === 'performance'

  return (
    <header className="ws-topbar">
      {/* ── Main row ─────────────────────────────────────────────────── */}
      <div className="ws-topbar-row ws-topbar-row--main">

        {/* Project */}
        <div className="ws-topbar-cluster">
          <span className="ws-topbar-label" title="Active project">Project</span>
          <select
            className="ws-select ws-select--compact"
            value={props.activeProjectId}
            onChange={(e) => props.onSelectProject(e.target.value)}
            title="Switch active project"
          >
            {props.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            type="button"
            className="ws-btn ws-btn--sm ghost"
            title="Create a new project"
            onClick={props.onCreateProject}
          >
            <Plus size={12} strokeWidth={2.5} style={{ marginRight: 2 }} />
            New
          </button>
        </div>

        <span className="ws-topbar-divider" aria-hidden />

        {/* Environment */}
        <div className="ws-topbar-cluster">
          <span className="ws-topbar-label" title="Active environment — variables defined here take priority">
            Env
          </span>
          <select
            className="ws-select ws-select--compact"
            value={props.environment}
            onChange={(e) => props.onEnvironmentChange(e.target.value)}
            title="Switch environment"
          >
            <option value="dev">Dev</option>
            <option value="testing">Testing</option>
            <option value="preprod-v1">Preprod-V1</option>
            <option value="preprod-v2">Preprod-V2</option>
            <option value="production">Production</option>
          </select>
        </div>

        <span className="ws-topbar-divider" aria-hidden />

        {/* Mode */}
        <div className="ws-topbar-cluster">
          <span className="ws-topbar-label" title="Performance: full load test. Smoke: 1 VU quick check.">
            Mode
          </span>
          <select
            className="ws-select ws-select--compact"
            value={props.runPurpose}
            onChange={(e) => props.onRunPurposeChange(e.target.value as 'performance' | 'smoke')}
            title="Performance = full load test. Smoke = quick 1 VU sanity check."
          >
            <option value="performance">Performance</option>
            <option value="smoke">Smoke</option>
          </select>
        </div>

        {/* Collection execution (only when targeting collection) */}
        {props.exportTarget === 'collection' ? (
          <>
            <span className="ws-topbar-divider" aria-hidden />
            <div className="ws-topbar-cluster">
              <span className="ws-topbar-label" title="How k6 executes the collection">
                Exec
              </span>
              <select
                className="ws-select ws-select--compact"
                value={props.collectionExecution}
                onChange={(e) => props.onCollectionExecutionChange(e.target.value as 'parallel' | 'sequential')}
                title="Parallel: each request runs as a concurrent scenario. Sequential: requests run in order per VU."
              >
                <option value="parallel">Parallel</option>
                <option value="sequential">Sequential</option>
              </select>
            </div>
          </>
        ) : null}

        {/* Load config when sequential */}
        {showSequentialLoad ? (
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
        ) : null}

        <div className="ws-topbar-spacer" />

        {/* Right cluster — utils + run */}
        <div className="ws-topbar-cluster ws-topbar-cluster--end">
          {/* Export dropdown */}
          <ExportDropdown
            exportTarget={props.exportTarget}
            onExportTargetChange={props.onExportTargetChange}
            onExport={props.onExport}
            onExportCurl={props.onExportCurl}
          />

          {/* Command palette hint */}
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

          {/* Theme toggle */}
          <button
            type="button"
            className="ws-btn ws-btn--sm ws-btn--icon ghost"
            title={props.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={props.onThemeToggle}
          >
            {props.theme === 'dark'
              ? <Sun size={14} />
              : <Moon size={14} />}
          </button>

          {/* User */}
          <span className="ws-topbar-user muted" title={`Signed in as ${props.username ?? 'user'}`}>
            {props.username ?? 'user'}
          </span>

          {/* Logout */}
          <button
            type="button"
            className="ws-btn ws-btn--sm ghost"
            title="Sign out"
            onClick={props.onLogout}
          >
            <LogOut size={13} style={{ marginRight: 3 }} />
            Logout
          </button>

          {/* Run */}
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
