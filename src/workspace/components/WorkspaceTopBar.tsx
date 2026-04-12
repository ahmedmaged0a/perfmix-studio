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
  collectionExecution: 'parallel' | 'sequential'
  onCollectionExecutionChange: (mode: 'parallel' | 'sequential') => void
  collectionLoadVus: number
  collectionLoadDuration: string
  collectionLoadRampUp: string
  onCollectionLoadChange: (patch: { k6LoadVus?: number; k6LoadDuration?: string; k6LoadRampUp?: string }) => void
}

export function WorkspaceTopBar(props: Props) {
  const showSequentialLoad = props.exportTarget === 'collection' && props.collectionExecution === 'sequential' && props.runPurpose === 'performance'

  return (
    <header className="ws-topbar">
      <div className="ws-topbar-row ws-topbar-row--main">
        <div className="ws-topbar-cluster">
          <span className="ws-topbar-label">Project</span>
          <select
            className="ws-select ws-select--compact"
            value={props.activeProjectId}
            onChange={(e) => props.onSelectProject(e.target.value)}
          >
            {props.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="button" className="ws-btn ws-btn--sm ghost" onClick={props.onCreateProject}>
            + New
          </button>
        </div>

        <span className="ws-topbar-divider" aria-hidden />

        <div className="ws-topbar-cluster">
          <span className="ws-topbar-label">Environment</span>
          <select
            className="ws-select ws-select--compact"
            value={props.environment}
            onChange={(e) => props.onEnvironmentChange(e.target.value)}
          >
            <option value="dev">Dev</option>
            <option value="testing">Testing</option>
            <option value="preprod-v1">Preprod-V1</option>
            <option value="preprod-v2">Preprod-V2</option>
            <option value="production">Production</option>
          </select>
        </div>

        <div className="ws-topbar-cluster">
          <span className="ws-topbar-label">Mode</span>
          <select
            className="ws-select ws-select--compact"
            value={props.runPurpose}
            onChange={(e) => props.onRunPurposeChange(e.target.value as 'performance' | 'smoke')}
          >
            <option value="performance">Performance</option>
            <option value="smoke">Smoke</option>
          </select>
        </div>

        {props.exportTarget === 'collection' ? (
          <>
            <span className="ws-topbar-divider" aria-hidden />
            <div className="ws-topbar-cluster ws-topbar-cluster--grow">
              <span className="ws-topbar-label">Collection k6</span>
              <select
                className="ws-select ws-select--wide"
                value={props.collectionExecution}
                onChange={(e) => props.onCollectionExecutionChange(e.target.value as 'parallel' | 'sequential')}
                title="Parallel: separate scenarios per request/TC. Sequential: list order per iteration (e.g. login → APIs → logout)."
              >
                <option value="parallel">Parallel load</option>
                <option value="sequential">Sequential journey</option>
              </select>
            </div>
          </>
        ) : null}

        {showSequentialLoad ? (
          <div className="ws-topbar-cluster ws-topbar-cluster--load">
            <span className="ws-topbar-label">Load</span>
            <input
              className="ws-input ws-input--narrow"
              type="number"
              min={1}
              title="Virtual users"
              value={props.collectionLoadVus}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                if (Number.isFinite(n) && n >= 1) props.onCollectionLoadChange({ k6LoadVus: n })
              }}
            />
            <input
              className="ws-input ws-input--time"
              value={props.collectionLoadDuration}
              onChange={(e) => props.onCollectionLoadChange({ k6LoadDuration: e.target.value })}
              placeholder="1m"
              title="Steady duration"
            />
            <input
              className="ws-input ws-input--time"
              value={props.collectionLoadRampUp}
              onChange={(e) => props.onCollectionLoadChange({ k6LoadRampUp: e.target.value })}
              title="Ramp-up"
              placeholder="30s"
            />
          </div>
        ) : null}

        <div className="ws-topbar-spacer" />

        <div className="ws-topbar-cluster ws-topbar-cluster--end">
          <span className="ws-topbar-user muted">{props.username ?? 'user'}</span>
          <button type="button" className="ws-btn ws-btn--sm ghost" onClick={props.onLogout}>
            Logout
          </button>
          <button type="button" className="ws-btn ws-btn--sm primary" onClick={props.onRun}>
            Run
          </button>
        </div>
      </div>

      <div className="ws-topbar-row ws-topbar-row--tools">
        <div className="ws-topbar-cluster">
          <span className="ws-topbar-label">Script scope</span>
          <select
            className="ws-select ws-select--compact"
            value={props.exportTarget}
            onChange={(e) => props.onExportTargetChange(e.target.value as 'request' | 'collection')}
          >
            <option value="request">Active request</option>
            <option value="collection">Whole collection</option>
          </select>
        </div>
        <button type="button" className="ws-btn ws-btn--sm" onClick={props.onExport}>
          Download .js
        </button>
        <button type="button" className="ws-btn ws-btn--sm ghost" onClick={props.onExportCurl}>
          Export cURL
        </button>
      </div>
    </header>
  )
}
