import { useMemo, useState } from 'react'
import { KeyValueTable } from '../../components/ui/KeyValueTable'
import type { CorrelationRule, RequestDefinition } from '../../models/types'

type Props = {
  activeEnvironment: string
  collectionName: string | null
  envVariables: Record<string, Record<string, string>>
  collectionVariables: Record<string, string>
  projectVariables: Record<string, string>
  sharedVariables: Record<string, string>
  correlationRules: CorrelationRule[]
  requests: RequestDefinition[]
  onChangeActiveEnvVars: (next: Record<string, string>) => void
  onChangeCollectionVars: (next: Record<string, string>) => void
  onChangeProjectVars: (next: Record<string, string>) => void
  onChangeSharedVars: (next: Record<string, string>) => void
  onChangeEnvJson: (json: string) => void
  onChangeSharedJson: (json: string) => void
  onAddCorrelation: () => void
  onChangeCorrelation: (id: string, patch: Partial<CorrelationRule>) => void
  onRemoveCorrelation: (id: string) => void
  onUploadCsv: (text: string) => void
}

type VarTab = 'env' | 'collection' | 'project' | 'global' | 'corr' | 'csv'

export function WorkspaceRightPanel(props: Props) {
  const [tab, setTab] = useState<VarTab>('env')

  const envJson = useMemo(() => JSON.stringify(props.envVariables ?? {}, null, 2), [props.envVariables])
  const sharedJson = useMemo(() => JSON.stringify(props.sharedVariables ?? {}, null, 2), [props.sharedVariables])

  const activeEnvVars = props.envVariables?.[props.activeEnvironment] ?? {}

  return (
    <aside className="ws-right">
      <div className="ws-right-head">
        <div className="ws-title">Variables</div>
        <div className="muted">
          Active env: <span className="mono">{props.activeEnvironment}</span>
        </div>
      </div>

      <div className="ws-right-tabs" style={{ flexWrap: 'wrap' }}>
        <button type="button" className={tab === 'env' ? 'ws-mini-tab active' : 'ws-mini-tab'} onClick={() => setTab('env')}>
          Environment
        </button>
        <button type="button" className={tab === 'collection' ? 'ws-mini-tab active' : 'ws-mini-tab'} onClick={() => setTab('collection')} disabled={!props.collectionName}>
          Collection
        </button>
        <button type="button" className={tab === 'project' ? 'ws-mini-tab active' : 'ws-mini-tab'} onClick={() => setTab('project')}>
          Project
        </button>
        <button type="button" className={tab === 'global' ? 'ws-mini-tab active' : 'ws-mini-tab'} onClick={() => setTab('global')}>
          Global
        </button>
        <button type="button" className={tab === 'corr' ? 'ws-mini-tab active' : 'ws-mini-tab'} onClick={() => setTab('corr')}>
          Extract
        </button>
        <button type="button" className={tab === 'csv' ? 'ws-mini-tab active' : 'ws-mini-tab'} onClick={() => setTab('csv')}>
          CSV
        </button>
      </div>

      {tab === 'env' ? (
        <div className="ws-right-body">
          <div className="muted">
            Highest priority in generated k6: same key overrides collection, project, and global maps.
          </div>
          <div className="ws-field">
            <KeyValueTable value={activeEnvVars} onChange={props.onChangeActiveEnvVars} />
          </div>
          <details className="ws-details">
            <summary>Advanced: edit full environments JSON</summary>
            <textarea className="ws-textarea" rows={12} value={envJson} onChange={(e) => props.onChangeEnvJson(e.target.value)} spellCheck={false} />
          </details>
        </div>
      ) : null}

      {tab === 'collection' ? (
        <div className="ws-right-body">
          <div className="muted">
            Collection <span className="mono">{props.collectionName ?? '—'}</span>: applies to requests in this folder; overridden by environment keys.
          </div>
          <div className="ws-field">
            <KeyValueTable value={props.collectionVariables} onChange={props.onChangeCollectionVars} />
          </div>
        </div>
      ) : null}

      {tab === 'project' ? (
        <div className="ws-right-body">
          <div className="muted">Project-wide defaults; overridden by collection, then environment.</div>
          <div className="ws-field">
            <KeyValueTable value={props.projectVariables} onChange={props.onChangeProjectVars} />
          </div>
        </div>
      ) : null}

      {tab === 'global' ? (
        <div className="ws-right-body">
          <div className="muted">Global (app-wide) fallback; lowest priority after environment, collection, and project.</div>
          <div className="ws-field">
            <KeyValueTable value={props.sharedVariables} onChange={props.onChangeSharedVars} />
          </div>
          <details className="ws-details">
            <summary>Advanced: edit global JSON</summary>
            <textarea className="ws-textarea" rows={12} value={sharedJson} onChange={(e) => props.onChangeSharedJson(e.target.value)} spellCheck={false} />
          </details>
        </div>
      ) : null}

      {tab === 'corr' ? (
        <div className="ws-right-body">
          <div className="ws-section-head">
            <div className="muted">Save response fields into variables (MVP: authoring + codegen roadmap).</div>
            <button type="button" className="ws-btn ghost" onClick={props.onAddCorrelation}>
              + Rule
            </button>
          </div>

          <div className="ws-table-wrap">
            <table className="ws-table tight">
              <thead>
                <tr>
                  <th>Var</th>
                  <th>From request</th>
                  <th>JSONPath</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {props.correlationRules.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <input className="ws-input table" value={r.variableName} onChange={(e) => props.onChangeCorrelation(r.id, { variableName: e.target.value })} />
                    </td>
                    <td>
                      <select className="ws-select table" value={r.fromRequestId} onChange={(e) => props.onChangeCorrelation(r.id, { fromRequestId: e.target.value })}>
                        {props.requests.map((req) => (
                          <option key={req.id} value={req.id}>
                            {req.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input className="ws-input table" value={r.jsonPath} onChange={(e) => props.onChangeCorrelation(r.id, { jsonPath: e.target.value })} />
                    </td>
                    <td>
                      <button type="button" className="ws-btn danger" onClick={() => props.onRemoveCorrelation(r.id)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'csv' ? (
        <div className="ws-right-body">
          <div className="muted">
            Upload a CSV. For MVP, values are exposed as <span className="mono">{`{{data}}`}</span> per line (legacy generator).
          </div>
          <label className="ws-field">
            <span className="muted">CSV file</span>
            <input
              className="ws-input"
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const text = await file.text()
                props.onUploadCsv(text)
              }}
            />
          </label>
        </div>
      ) : null}
    </aside>
  )
}
