import type { Project } from '../../models/types'

type Props = {
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
}

export function WorkspaceTopBar(props: Props) {
  return (
    <header className="ws-topbar">
      <div className="ws-topbar-left">
        <select
          className="ws-select"
          value={props.activeProjectId}
          onChange={(e) => props.onSelectProject(e.target.value)}
        >
          {props.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" className="ws-btn ghost" onClick={props.onCreateProject}>
          + Project
        </button>

        <label className="ws-inline">
          <span className="muted">Environment</span>
          <select
            className="ws-select"
            value={props.environment}
            onChange={(e) => props.onEnvironmentChange(e.target.value)}
          >
            <option value="dev">Dev</option>
            <option value="testing">Testing</option>
            <option value="preprod-v1">Preprod-V1</option>
            <option value="preprod-v2">Preprod-V2</option>
            <option value="production">Production</option>
          </select>
        </label>

        <label className="ws-inline">
          <span className="muted">Run</span>
          <select
            className="ws-select"
            value={props.runPurpose}
            onChange={(e) => props.onRunPurposeChange(e.target.value as 'performance' | 'smoke')}
          >
            <option value="performance">Performance</option>
            <option value="smoke">Smoke</option>
          </select>
        </label>
      </div>

      <div className="ws-topbar-right">
        <span className="muted ws-user">{props.username ?? 'user'}</span>
        <button type="button" className="ws-btn ghost" onClick={props.onLogout}>
          Logout
        </button>
        <button type="button" className="ws-btn primary" onClick={props.onRun}>
          Run
        </button>
        <label className="ws-inline">
          <span className="muted">Export</span>
          <select
            className="ws-select"
            value={props.exportTarget}
            onChange={(e) => props.onExportTargetChange(e.target.value as 'request' | 'collection')}
          >
            <option value="request">Active request</option>
            <option value="collection">Whole collection</option>
          </select>
        </label>
        <button type="button" className="ws-btn" onClick={props.onExport}>
          Download .js
        </button>
        <button type="button" className="ws-btn ghost" onClick={props.onExportCurl}>
          Export cURL
        </button>
      </div>
    </header>
  )
}
