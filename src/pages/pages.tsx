import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Card } from '../components/ui/Card'
import { Page } from '../components/ui/Page'
import { SimpleTable } from '../components/ui/SimpleTable'
import { buildK6Script } from '../k6/generator'
import { useAppStore } from '../store/appStore'
import { useToastStore } from '../store/toastStore'
import type { RequestTestCase } from '../models/types'
import { tauriReadRunReportHtml } from '../desktop/tauriBridge'

export function OnboardingPage() {
  const initializeProject = useAppStore((state) => state.initializeProject)
  const projectName = useAppStore((state) => state.data?.projectName ?? '')
  const pushToast = useToastStore((state) => state.pushToast)
  const [name, setName] = useState(projectName)
  const [environment, setEnvironment] = useState('staging')
  const [runner, setRunner] = useState('local-k6')
  const [error, setError] = useState('')

  const handleCreateProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('Project name is required.')
      return
    }
    initializeProject(name, environment, runner)
    pushToast('Project initialized successfully.', 'success')
  }

  return (
    <Page title="Onboarding" subtitle="Start fast with imports and templates">
      <div className="card">
        <h3>Create New Project</h3>
        <form className="form-grid" onSubmit={handleCreateProject}>
          <label>
            Project name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="My Performance Project" />
          </label>
          <label>
            Environment
            <input value={environment} onChange={(event) => setEnvironment(event.target.value)} />
          </label>
          <label>
            Runner
            <input value={runner} onChange={(event) => setRunner(event.target.value)} />
          </label>
          <button type="submit">Create Project</button>
        </form>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
      <div className="grid-3">
        <Card title="New Project" body="Create a native project with collection, environments, and scenarios." />
        <Card title="Import JMX" body="Migrate JMeter plans with mapping and compatibility report." />
        <Card title="Import OpenAPI/Postman" body="Generate collections from existing API contracts." />
      </div>
    </Page>
  )
}

export function DashboardPage() {
  const data = useAppStore((state) => state.data)
  const metrics = data?.metrics ?? []

  return (
    <Page title="Dashboard" subtitle="Track run health and release readiness">
      <div className="grid-4">
        {metrics.map((metric) => (
          <Card key={metric.label} title={metric.label} body={`${metric.value} (${metric.trend})`} />
        ))}
      </div>
      <div className="grid-2">
        <Card title="Recent Runs" body="Checkout-Load: Passed | Cart-Spike: Failed | Orders-Soak: Passed" />
        <Card title="Top Slow APIs" body="POST /orders (p95 1.7s), GET /checkout (p95 1.4s)" />
      </div>
    </Page>
  )
}

export function CollectionsPage() {
  const apiRequests = useAppStore((state) => state.data?.apiRequests ?? [])
  const addApiRequest = useAppStore((state) => state.addApiRequest)
  const updateApiRequest = useAppStore((state) => state.updateApiRequest)
  const removeApiRequest = useAppStore((state) => state.removeApiRequest)
  const pushToast = useToastStore((state) => state.pushToast)

  const buildLocalId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

  const [folder, setFolder] = useState('Checkout')
  const [name, setName] = useState('')
  const [method, setMethod] = useState<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>('POST')
  const [url, setUrl] = useState('{{baseUrl}}/orders')
  const [headers, setHeaders] = useState('Authorization: Bearer {{token}}')
  const [body, setBody] = useState('{"sample":"value"}')
  const [testCases, setTestCases] = useState<RequestTestCase[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const clearForm = () => {
    setFolder('Checkout')
    setName('')
    setMethod('POST')
    setUrl('{{baseUrl}}/orders')
    setHeaders('Authorization: Bearer {{token}}')
    setBody('{"sample":"value"}')
    setTestCases([])
  }

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    if (!name.trim() || !url.trim() || !folder.trim()) {
      setError('Folder, name, and URL are required.')
      return
    }
    const payload = {
      folder: folder.trim(),
      name: name.trim(),
      method,
      url: url.trim(),
      headers: headers.trim(),
      body: body.trim(),
      testCases,
    }

    if (editingId) {
      updateApiRequest(editingId, payload)
      pushToast('API request updated.', 'success')
      setEditingId(null)
    } else {
      addApiRequest(payload)
      pushToast('API request created.', 'success')
    }
    clearForm()
  }

  const startEdit = (id: string) => {
    const target = apiRequests.find((item) => item.id === id)
    if (!target) return
    setEditingId(id)
    setFolder(target.folder)
    setName(target.name)
    setMethod(target.method)
    setUrl(target.url)
    setHeaders(target.headers)
    setBody(target.body)
    setTestCases(target.testCases ?? [])
  }

  const folders = Array.from(new Set(apiRequests.map((item) => item.folder)))

  return (
    <Page title="API Collections" subtitle="Design and organize request definitions">
      <div className="grid-2">
        <div className="card">
          <h3>Collection Tree</h3>
          {folders.length === 0 ? <p className="muted">No folders yet.</p> : null}
          {folders.map((folderName) => (
            <div key={folderName} className="folder-block">
              <strong>{folderName}</strong>
              {apiRequests
                .filter((item) => item.folder === folderName)
                .map((item) => (
                  <div key={item.id} className="list-row">
                    <span>{item.method}</span>
                    <span>{item.name}</span>
                    <div className="action-row">
                      <button type="button" onClick={() => startEdit(item.id)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          removeApiRequest(item.id)
                          pushToast('API request deleted.', 'info')
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          ))}
        </div>
        <div className="card">
          <h3>{editingId ? 'Edit Request' : 'Create Request'}</h3>
          <form className="form-grid" onSubmit={handleSave}>
            <label>
              Folder
              <input value={folder} onChange={(event) => setFolder(event.target.value)} />
            </label>
            <label>
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              Method
              <select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </select>
            </label>
            <label>
              URL
              <input value={url} onChange={(event) => setUrl(event.target.value)} />
            </label>
            <label>
              Headers
              <input value={headers} onChange={(event) => setHeaders(event.target.value)} />
            </label>
            <label>
              Body
              <input value={body} onChange={(event) => setBody(event.target.value)} />
            </label>
            <button type="submit">{editingId ? 'Update' : 'Save'}</button>
            {editingId ? (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null)
                  clearForm()
                }}
              >
                Cancel
              </button>
            ) : null}
          </form>
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      </div>
      <div className="card">
        <h3>Performance test cases (optional)</h3>
        <p className="muted">
          Each test case becomes its own k6 scenario with ramp-up, steady load, and optional thresholds (avg / p95 / error rate).
          Leave empty to only generate a default scenario from the Generated Code page.
        </p>

        <div className="action-row">
          <button
            type="button"
            onClick={() =>
              setTestCases((prev) => [
                ...prev,
                {
                  id: buildLocalId('tc'),
                  name: `TC ${prev.length + 1}`,
                  vus: 5,
                  duration: '10m',
                  rampUp: '30s',
                  thinkTimeMs: 150,
                  maxAvgMs: 800,
                },
              ])
            }
          >
            Add test case
          </button>
        </div>

        {testCases.length ? (
          <div className="grid-2" style={{ marginTop: 12 }}>
            {testCases.map((tc, index) => (
              <div key={tc.id} className="card" style={{ padding: 12 }}>
                <div className="action-row" style={{ justifyContent: 'space-between' }}>
                  <strong>
                    {index + 1}. {tc.name}
                  </strong>
                  <button
                    type="button"
                    onClick={() => setTestCases((prev) => prev.filter((item) => item.id !== tc.id))}
                  >
                    Remove
                  </button>
                </div>
                <div className="form-grid" style={{ marginTop: 10 }}>
                  <label>
                    Name
                    <input
                      value={tc.name}
                      onChange={(event) =>
                        setTestCases((prev) =>
                          prev.map((item) => (item.id === tc.id ? { ...item, name: event.target.value } : item)),
                        )
                      }
                    />
                  </label>
                  <label>
                    VUs (threads)
                    <input
                      type="number"
                      value={String(tc.vus)}
                      onChange={(event) =>
                        setTestCases((prev) =>
                          prev.map((item) =>
                            item.id === tc.id ? { ...item, vus: Number(event.target.value) || 1 } : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Duration
                    <input
                      value={tc.duration}
                      onChange={(event) =>
                        setTestCases((prev) =>
                          prev.map((item) => (item.id === tc.id ? { ...item, duration: event.target.value } : item)),
                        )
                      }
                    />
                  </label>
                  <label>
                    Ramp-up
                    <input
                      value={tc.rampUp}
                      onChange={(event) =>
                        setTestCases((prev) =>
                          prev.map((item) => (item.id === tc.id ? { ...item, rampUp: event.target.value } : item)),
                        )
                      }
                    />
                  </label>
                  <label>
                    Think time (ms)
                    <input
                      type="number"
                      value={String(tc.thinkTimeMs)}
                      onChange={(event) =>
                        setTestCases((prev) =>
                          prev.map((item) =>
                            item.id === tc.id ? { ...item, thinkTimeMs: Number(event.target.value) || 0 } : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Max avg (ms) (optional)
                    <input
                      type="number"
                      value={tc.maxAvgMs === undefined ? '' : String(tc.maxAvgMs)}
                      onChange={(event) =>
                        setTestCases((prev) =>
                          prev.map((item) => {
                            if (item.id !== tc.id) return item
                            const raw = event.target.value.trim()
                            return { ...item, maxAvgMs: raw ? Number(raw) : undefined }
                          }),
                        )
                      }
                    />
                  </label>
                  <label>
                    Max p95 (ms) (optional)
                    <input
                      type="number"
                      value={tc.maxP95Ms === undefined ? '' : String(tc.maxP95Ms)}
                      onChange={(event) =>
                        setTestCases((prev) =>
                          prev.map((item) => {
                            if (item.id !== tc.id) return item
                            const raw = event.target.value.trim()
                            return { ...item, maxP95Ms: raw ? Number(raw) : undefined }
                          }),
                        )
                      }
                    />
                  </label>
                  <label>
                    Max error rate (0-1) (optional)
                    <input
                      type="number"
                      step="0.001"
                      value={tc.maxErrorRate === undefined ? '' : String(tc.maxErrorRate)}
                      onChange={(event) =>
                        setTestCases((prev) =>
                          prev.map((item) => {
                            if (item.id !== tc.id) return item
                            const raw = event.target.value.trim()
                            return { ...item, maxErrorRate: raw ? Number(raw) : undefined }
                          }),
                        )
                      }
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 10 }}>
            No test cases yet.
          </p>
        )}
      </div>
      <Card
        title="Preview"
        body={`${method} ${url} | headers: ${headers || '-'} | body: ${body || '-'} | variable placeholders supported.`}
      />
    </Page>
  )
}

export function ScenariosPage() {
  const scenarios = useAppStore((state) => state.data?.scenarios ?? [])
  const apiRequests = useAppStore((state) => state.data?.apiRequests ?? [])
  const createScenario = useAppStore((state) => state.createScenario)
  const updateScenario = useAppStore((state) => state.updateScenario)
  const pushToast = useToastStore((state) => state.pushToast)

  const [name, setName] = useState('')
  const [flow, setFlow] = useState('')
  const [vus, setVus] = useState('5')
  const [duration, setDuration] = useState('10m')
  const [rampUp, setRampUp] = useState('30s')
  const [thinkTimeMs, setThinkTimeMs] = useState('150')
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedSteps, setSelectedSteps] = useState<string[]>([])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')

    if (!name.trim() || !flow.trim()) {
      setError('Scenario name and flow are required.')
      return
    }

    const parsedVus = Number(vus)
    const parsedThinkTime = Number(thinkTimeMs)
    if (!Number.isInteger(parsedVus) || parsedVus <= 0) {
      setError('VUs must be a positive integer.')
      return
    }
    if (!Number.isInteger(parsedThinkTime) || parsedThinkTime < 0) {
      setError('Think time must be a non-negative integer.')
      return
    }

    createScenario({
      name: name.trim(),
      flow: selectedSteps.length ? selectedSteps.join(' -> ') : flow.trim(),
      vus: parsedVus,
      duration: duration.trim(),
      rampUp: rampUp.trim(),
      thinkTimeMs: parsedThinkTime,
    })

    setName('')
    setFlow('')
    setVus('5')
    setDuration('10m')
    setRampUp('30s')
    setThinkTimeMs('150')
    pushToast('Scenario created.', 'success')
  }

  const startEditScenario = (id: string) => {
    const target = scenarios.find((item) => item.id === id)
    if (!target) return
    setEditingId(id)
    setName(target.name)
    setFlow(target.flow)
    setVus(String(target.vus))
    setDuration(target.duration)
    setRampUp(target.rampUp)
    setThinkTimeMs(String(target.thinkTimeMs))
    setSelectedSteps(target.flow.split(' -> ').map((item) => item.trim()))
  }

  const handleUpdateScenario = () => {
    if (!editingId) return
    setError('')
    const parsedVus = Number(vus)
    const parsedThinkTime = Number(thinkTimeMs)
    if (!name.trim() || !flow.trim()) {
      setError('Scenario name and flow are required.')
      return
    }
    if (!Number.isInteger(parsedVus) || parsedVus <= 0 || !Number.isInteger(parsedThinkTime) || parsedThinkTime < 0) {
      setError('VUs must be positive and think time must be non-negative.')
      return
    }
    updateScenario(editingId, {
      name: name.trim(),
      flow: selectedSteps.length ? selectedSteps.join(' -> ') : flow.trim(),
      vus: parsedVus,
      duration: duration.trim(),
      rampUp: rampUp.trim(),
      thinkTimeMs: parsedThinkTime,
    })
    setEditingId(null)
    setSelectedSteps([])
    pushToast('Scenario updated.', 'success')
  }

  return (
    <Page title="Scenario Builder" subtitle="Compose request flows and load profiles">
      <div className="card">
        <h3>{editingId ? 'Edit Scenario' : 'Create Scenario'}</h3>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Checkout Baseline" />
          </label>
          <label>
            Flow
            <input
              value={flow}
              onChange={(event) => setFlow(event.target.value)}
              placeholder="Login -> Add to cart -> Checkout"
            />
          </label>
          <label>
            VUs
            <input value={vus} onChange={(event) => setVus(event.target.value)} />
          </label>
          <label>
            Duration
            <input value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="10m" />
          </label>
          <label>
            Ramp-up
            <input value={rampUp} onChange={(event) => setRampUp(event.target.value)} placeholder="45s" />
          </label>
          <label>
            Think time (ms)
            <input value={thinkTimeMs} onChange={(event) => setThinkTimeMs(event.target.value)} />
          </label>
          {editingId ? (
            <>
              <button type="button" onClick={handleUpdateScenario}>
                Update Scenario
              </button>
              <button type="button" onClick={() => setEditingId(null)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="submit">Save Scenario</button>
          )}
        </form>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="composer-box">
          <strong>Flow Composer</strong>
          <div className="chip-row">
            {apiRequests.map((req) => (
              <button
                key={req.id}
                type="button"
                onClick={() => setSelectedSteps((prev) => [...prev, req.name])}
                className="chip-button"
              >
                + {req.name}
              </button>
            ))}
          </div>
          <div className="chip-row">
            {selectedSteps.map((step, index) => (
              <span key={`${step}-${index}`} className="chip">
                {index + 1}. {step}
              </span>
            ))}
          </div>
          <div className="action-row">
            <button type="button" onClick={() => setSelectedSteps((prev) => prev.slice(0, -1))}>
              Remove Last
            </button>
            <button type="button" onClick={() => setSelectedSteps([])}>
              Clear
            </button>
          </div>
        </div>
      </div>
      <div className="grid-2">
        {scenarios.map((scenario) => (
          <div key={scenario.id} className="card">
            <h3>{scenario.name}</h3>
            <p>{`Flow: ${scenario.flow} | VUs: ${scenario.vus}, Duration: ${scenario.duration}, Ramp-up: ${scenario.rampUp}, Think: ${scenario.thinkTimeMs}ms`}</p>
            <div className="action-row">
              <button type="button" onClick={() => startEditScenario(scenario.id)}>
                Edit
              </button>
            </div>
          </div>
        ))}
      </div>
      <Card title="Custom Hooks" body="Pre-step and post-step script blocks for advanced behavior." />
    </Page>
  )
}

export function MatrixPage() {
  const matrixRows = useAppStore((state) => state.data?.matrixRows ?? [])
  const addMatrixRow = useAppStore((state) => state.addMatrixRow)
  const updateMatrixRow = useAppStore((state) => state.updateMatrixRow)
  const removeMatrixRow = useAppStore((state) => state.removeMatrixRow)
  const pushToast = useToastStore((state) => state.pushToast)

  const [name, setName] = useState('')
  const [vus, setVus] = useState('5')
  const [duration, setDuration] = useState('10m')
  const [expectedAvg, setExpectedAvg] = useState('< 1s')
  const [expectedError, setExpectedError] = useState('< 1%')
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    const parsedVus = Number(vus)
    if (!name.trim()) {
      setError('Scenario name is required.')
      return
    }
    if (!Number.isInteger(parsedVus) || parsedVus <= 0) {
      setError('VUs must be a positive integer.')
      return
    }
    addMatrixRow({
      name: name.trim(),
      vus: parsedVus,
      duration: duration.trim(),
      expectedAvg: expectedAvg.trim(),
      expectedError: expectedError.trim(),
    })
    setName('')
    pushToast('Matrix row added.', 'success')
  }

  const startEdit = (id: string) => {
    const target = matrixRows.find((item) => item.id === id)
    if (!target) return
    setEditingId(id)
    setName(target.name)
    setVus(String(target.vus))
    setDuration(target.duration)
    setExpectedAvg(target.expectedAvg)
    setExpectedError(target.expectedError)
  }

  const handleUpdate = () => {
    if (!editingId) return
    const parsedVus = Number(vus)
    if (!name.trim() || !Number.isInteger(parsedVus) || parsedVus <= 0) {
      setError('Scenario name and valid VUs are required.')
      return
    }
    updateMatrixRow(editingId, {
      name: name.trim(),
      vus: parsedVus,
      duration: duration.trim(),
      expectedAvg: expectedAvg.trim(),
      expectedError: expectedError.trim(),
    })
    setEditingId(null)
    pushToast('Matrix row updated.', 'success')
  }

  return (
    <Page title="Test Matrix" subtitle="Run many scenarios against same API set">
      <div className="card">
        <h3>{editingId ? 'Edit Matrix Case' : 'Add Matrix Case'}</h3>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Scenario
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            VUs
            <input value={vus} onChange={(event) => setVus(event.target.value)} />
          </label>
          <label>
            Duration
            <input value={duration} onChange={(event) => setDuration(event.target.value)} />
          </label>
          <label>
            Expected Avg
            <input value={expectedAvg} onChange={(event) => setExpectedAvg(event.target.value)} />
          </label>
          <label>
            Expected Error
            <input value={expectedError} onChange={(event) => setExpectedError(event.target.value)} />
          </label>
          {editingId ? (
            <>
              <button type="button" onClick={handleUpdate}>
                Update Case
              </button>
              <button type="button" onClick={() => setEditingId(null)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="submit">Add Case</button>
          )}
        </form>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Scenario</th>
              <th>VUs</th>
              <th>Duration</th>
              <th>Expected Avg</th>
              <th>Expected Error</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {matrixRows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.vus}</td>
                <td>{row.duration}</td>
                <td>{row.expectedAvg}</td>
                <td>{row.expectedError}</td>
                <td>
                  <button type="button" onClick={() => startEdit(row.id)}>
                    Edit
                  </button>
                  <button type="button" onClick={() => removeMatrixRow(row.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  )
}

export function ThresholdsPage() {
  const thresholdRows = useAppStore((state) => state.data?.thresholdRows ?? [])
  const addThreshold = useAppStore((state) => state.addThreshold)
  const updateThreshold = useAppStore((state) => state.updateThreshold)
  const removeThreshold = useAppStore((state) => state.removeThreshold)
  const toggleThreshold = useAppStore((state) => state.toggleThreshold)
  const pushToast = useToastStore((state) => state.pushToast)

  const [scope, setScope] = useState('')
  const [metric, setMetric] = useState('avg')
  const [operator, setOperator] = useState('<')
  const [targetValue, setTargetValue] = useState('1000')
  const [unit, setUnit] = useState('ms')
  const [rule, setRule] = useState('< 1000ms')
  const [severity, setSeverity] = useState<'warn' | 'fail'>('fail')
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    const composedRule = `${operator} ${targetValue}${unit}`
    if (!scope.trim() || !metric.trim() || !targetValue.trim()) {
      setError('Scope, metric, and target are required.')
      return
    }
    addThreshold({
      scope: scope.trim(),
      metric: metric.trim(),
      rule: composedRule.trim(),
      severity,
      enabled: true,
    })
    setScope('')
    pushToast('Threshold added.', 'success')
  }

  const startEdit = (id: string) => {
    const target = thresholdRows.find((item) => item.id === id)
    if (!target) return
    setEditingId(id)
    setScope(target.scope)
    setMetric(target.metric)
    setRule(target.rule)
    setSeverity(target.severity)
  }

  const handleUpdate = () => {
    if (!editingId) return
    const composedRule = `${operator} ${targetValue}${unit}`
    if (!scope.trim() || !metric.trim() || !targetValue.trim()) {
      setError('Scope, metric, and target are required.')
      return
    }
    const current = thresholdRows.find((item) => item.id === editingId)
    updateThreshold(editingId, {
      scope: scope.trim(),
      metric: metric.trim(),
      rule: composedRule.trim(),
      severity,
      enabled: current?.enabled ?? true,
    })
    setEditingId(null)
    pushToast('Threshold updated.', 'success')
  }

  return (
    <Page title="Thresholds & Criteria" subtitle="Set release guardrails by scenario">
      <div className="card">
        <h3>{editingId ? 'Edit Threshold' : 'Create Threshold'}</h3>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Scope
            <input value={scope} onChange={(event) => setScope(event.target.value)} placeholder="Scenario: Checkout" />
          </label>
          <label>
            Metric
            <select value={metric} onChange={(event) => setMetric(event.target.value)}>
              <option value="avg">avg</option>
              <option value="p95">p95</option>
              <option value="p99">p99</option>
              <option value="error_rate">error_rate</option>
              <option value="rps">rps</option>
            </select>
          </label>
          <label>
            Operator
            <select value={operator} onChange={(event) => setOperator(event.target.value)}>
              <option value="<">{'<'}</option>
              <option value="<=">{'<='}</option>
              <option value=">">{'>'}</option>
              <option value=">=">{'>='}</option>
            </select>
          </label>
          <label>
            Target
            <input value={targetValue} onChange={(event) => setTargetValue(event.target.value)} />
          </label>
          <label>
            Unit
            <select value={unit} onChange={(event) => setUnit(event.target.value)}>
              <option value="ms">ms</option>
              <option value="s">s</option>
              <option value="%">%</option>
              <option value="">none</option>
            </select>
          </label>
          <label>
            Rule
            <input value={rule} onChange={(event) => setRule(event.target.value)} placeholder="< 1000ms" />
          </label>
          <label>
            Severity
            <select value={severity} onChange={(event) => setSeverity(event.target.value as 'warn' | 'fail')}>
              <option value="fail">fail</option>
              <option value="warn">warn</option>
            </select>
          </label>
          {editingId ? (
            <>
              <button type="button" onClick={handleUpdate}>
                Update Threshold
              </button>
              <button type="button" onClick={() => setEditingId(null)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="submit">Add Threshold</button>
          )}
        </form>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Scope</th>
              <th>Metric</th>
              <th>Rule</th>
              <th>Severity</th>
              <th>Enabled</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {thresholdRows.map((row) => (
              <tr key={row.id}>
                <td>{row.scope}</td>
                <td>{row.metric}</td>
                <td>{row.rule}</td>
                <td>{row.severity}</td>
                <td>{row.enabled ? 'yes' : 'no'}</td>
                <td>
                  <button type="button" onClick={() => toggleThreshold(row.id)}>
                    {row.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button type="button" onClick={() => startEdit(row.id)}>
                    Edit
                  </button>
                  <button type="button" onClick={() => removeThreshold(row.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  )
}

export function CodegenPage() {
  const requests = useAppStore((state) => state.data?.apiRequests ?? [])
  const thresholds = useAppStore((state) => state.data?.thresholdRows ?? [])
  const scenarios = useAppStore((state) => state.data?.scenarios ?? [])
  const environment = useAppStore((state) => state.data?.environment ?? 'staging')
  const envVariables = useAppStore((state) => state.data?.envVariables ?? {})
  const sharedVariables = useAppStore((state) => state.data?.sharedVariables ?? {})
  const dataCsv = useAppStore((state) => state.data?.dataCsv ?? '')
  const pushToast = useToastStore((state) => state.pushToast)
  const setGeneratedScript = useAppStore((state) => state.setGeneratedScript)
  const executeK6Run = useAppStore((state) => state.executeK6Run)
  const loadDiagnostics = useAppStore((state) => state.loadDiagnostics)
  const k6VerboseLogs = useAppStore((state) => state.k6VerboseLogs)
  const setK6VerboseLogs = useAppStore((state) => state.setK6VerboseLogs)

  const [mode, setMode] = useState<'collection' | 'single'>('collection')
  const [scenarioName, setScenarioName] = useState('generated scenario')
  const [selectedRequestId, setSelectedRequestId] = useState('')
  const [vus, setVus] = useState('5')
  const [duration, setDuration] = useState('10m')
  const [runPurpose, setRunPurpose] = useState<'performance' | 'smoke'>('performance')
  const [generated, setGenerated] = useState('')

  const generate = () => {
    const code = buildK6Script({
      mode,
      selectedRequestId,
      requests,
      scenarioName,
      vus: Number(vus) || 1,
      duration,
      thresholds,
      scenarios,
      activeEnvironment: environment,
      envVariables,
      sharedVariables,
      dataCsv,
      runPurpose,
    })
    setGenerated(code)
    setGeneratedScript(code)
    pushToast('K6 script generated.', 'success')
  }

  const copyCode = async () => {
    if (!generated) return
    await navigator.clipboard.writeText(generated)
    pushToast('K6 script copied.', 'info')
  }

  const downloadCode = () => {
    if (!generated) return
    const blob = new Blob([generated], { type: 'text/javascript;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'performance-test.k6.js'
    a.click()
    URL.revokeObjectURL(url)
    pushToast('K6 script downloaded.', 'success')
  }

  const runNow = async () => {
    if (!generated) {
      pushToast('Generate script first.', 'error')
      return
    }
    await loadDiagnostics()
    setGeneratedScript(generated)
    await executeK6Run()
    pushToast('K6 run finished. Review Run Center for results.', 'success')
  }

  return (
    <Page title="Generated k6 Code" subtitle="Create E2E performance scripts from collection or single request">
      <div className="card">
        <h3>E2E Script Builder</h3>
        <form className="form-grid" onSubmit={(event) => event.preventDefault()}>
          <label>
            Source Mode
            <select value={mode} onChange={(event) => setMode(event.target.value as 'collection' | 'single')}>
              <option value="collection">Collection (all requests)</option>
              <option value="single">Single request</option>
            </select>
          </label>
          <label>
            Scenario Name
            <input value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} />
          </label>
          <label>
            VUs
            <input value={vus} onChange={(event) => setVus(event.target.value)} />
          </label>
          <label>
            Duration
            <input value={duration} onChange={(event) => setDuration(event.target.value)} />
          </label>
          <label>
            Run purpose
            <select value={runPurpose} onChange={(event) => setRunPurpose(event.target.value as 'performance' | 'smoke')}>
              <option value="performance">Performance (load + thresholds)</option>
              <option value="smoke">Smoke (1 iteration, no thresholds)</option>
            </select>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={k6VerboseLogs} onChange={(event) => setK6VerboseLogs(event.target.checked)} />
            Show live k6 console output (noisy)
          </label>
          <label>
            Single Request
            <select value={selectedRequestId} onChange={(event) => setSelectedRequestId(event.target.value)} disabled={mode !== 'single'}>
              <option value="">Select request</option>
              {requests.map((request) => (
                <option key={request.id} value={request.id}>
                  {request.method} - {request.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={generate}>
            Generate K6
          </button>
        </form>
      </div>
      <div className="action-row">
        <button type="button" onClick={copyCode} disabled={!generated}>
          Copy Code
        </button>
        <button type="button" onClick={downloadCode} disabled={!generated}>
          Download .js
        </button>
        <button type="button" onClick={() => void runNow()} disabled={!generated}>
          Run K6
        </button>
      </div>
      <pre className="code-block">{generated || '// Generate a K6 script to preview it here.'}</pre>
      <div className="card">
        <h3>Run with k6</h3>
        <p className="muted">After downloading, run: k6 run performance-test.k6.js</p>
      </div>
    </Page>
  )
}

function metricNumber(summary: unknown, metric: string, field: string): number | null {
  if (!summary || typeof summary !== 'object') return null
  const root = summary as Record<string, unknown>
  const metrics = root.metrics
  if (!metrics || typeof metrics !== 'object') return null
  const m = (metrics as Record<string, unknown>)[metric]
  if (!m || typeof m !== 'object') return null
  const values = (m as Record<string, unknown>).values
  if (!values || typeof values !== 'object') return null
  const v = (values as Record<string, unknown>)[field]
  return typeof v === 'number' ? v : null
}

export function RunsPage() {
  const samples = useAppStore((state) => state.data?.runSamples ?? [])
  const lastRunStatus = useAppStore((state) => state.lastRunStatus)
  const runLogs = useAppStore((state) => state.runLogs)
  const lastRunId = useAppStore((state) => state.lastRunId)
  const lastSummaryPath = useAppStore((state) => state.lastSummaryPath)
  const lastReportHtmlPath = useAppStore((state) => state.lastReportHtmlPath)
  const lastSummaryJson = useAppStore((state) => state.lastSummaryJson)
  const k6VerboseLogs = useAppStore((state) => state.k6VerboseLogs)
  const maxRps = samples.reduce((max, item) => Math.max(max, item.rps), 1)
  const maxP95 = samples.reduce((max, item) => Math.max(max, item.p95), 1)

  const summaryLines = useMemo(() => {
    if (!lastSummaryJson) return []
    try {
      const parsed = JSON.parse(lastSummaryJson) as unknown
      const avg = metricNumber(parsed, 'http_req_duration', 'avg')
      const p95 = metricNumber(parsed, 'http_req_duration', 'p(95)')
      const err = metricNumber(parsed, 'http_req_failed', 'rate')
      const reqs = metricNumber(parsed, 'http_reqs', 'count')
      const rps = metricNumber(parsed, 'http_reqs', 'rate')
      const lines: string[] = []
      if (avg !== null) lines.push(`http_req_duration.avg: ${avg.toFixed(2)} ms`)
      if (p95 !== null) lines.push(`http_req_duration.p(95): ${p95.toFixed(2)} ms`)
      if (err !== null) lines.push(`http_req_failed.rate: ${(err * 100).toFixed(3)}%`)
      if (reqs !== null) lines.push(`http_reqs: ${reqs.toFixed(0)}`)
      if (rps !== null) lines.push(`http_reqs.rate: ${rps.toFixed(3)} req/s`)
      return lines
    } catch {
      return ['Summary JSON could not be parsed.']
    }
  }, [lastSummaryJson])

  return (
    <Page title="Run Center" subtitle="Execute and monitor tests in real time">
      <div className="grid-3">
        <Card title="Status" body={`Run status: ${lastRunStatus}`} />
        <Card title="Run ID" body={lastRunId ?? 'n/a'} />
        <Card title="Artifacts" body={`Summary: ${lastSummaryPath ?? 'n/a'} | HTML: ${lastReportHtmlPath ?? 'n/a'}`} />
      </div>
      <div className="card">
        <h3>Results (quick read)</h3>
        {!lastSummaryJson ? (
          <p className="muted">No summary yet. Run a test and wait until it finishes (quiet mode hides live k6 spam).</p>
        ) : (
          <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
            {summaryLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <p className="muted" style={{ marginTop: 10 }}>
          Live console output is <strong>{k6VerboseLogs ? 'ON' : 'OFF'}</strong> (toggle on Generated Code page).
        </p>
      </div>
      <div className="card">
        <h3>{k6VerboseLogs ? 'Live Logs' : 'Run notes'}</h3>
        {runLogs.length ? (
          runLogs.map((log, index) => (
            <p key={`${log}-${index}`}>{log}</p>
          ))
        ) : (
          <p className="muted">No run logs yet. Trigger a run from Generated k6 Code page.</p>
        )}
      </div>
      <div className="card">
        <h3>Live RPS</h3>
        <div className="chart-bars">
          {samples.map((item) => (
            <div key={`rps-${item.minute}`} className="bar-col">
              <div className="bar rps" style={{ height: `${(item.rps / maxRps) * 140}px` }} />
              <small>{item.minute}</small>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <h3>Live p95</h3>
        <div className="chart-bars">
          {samples.map((item) => (
            <div key={`p95-${item.minute}`} className="bar-col">
              <div className="bar p95" style={{ height: `${(item.p95 / maxP95) * 140}px` }} />
              <small>{item.minute}</small>
            </div>
          ))}
        </div>
      </div>
    </Page>
  )
}

export function ReportsPage() {
  const samples = useAppStore((state) => state.data?.runSamples ?? [])
  const lastRunId = useAppStore((state) => state.lastRunId)
  const lastSummaryPath = useAppStore((state) => state.lastSummaryPath)
  const lastReportHtmlPath = useAppStore((state) => state.lastReportHtmlPath)
  const pushToast = useToastStore((state) => state.pushToast)

  const downloadHtml = async () => {
    if (!lastRunId) {
      pushToast('No run available yet. Run a test from Generated k6 Code.', 'error')
      return
    }
    const html = await tauriReadRunReportHtml(lastRunId)
    if (!html) {
      pushToast('HTML report is not available in web mode yet.', 'info')
      return
    }
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${lastRunId}.report.html`
    a.click()
    URL.revokeObjectURL(url)
    pushToast('Downloaded HTML report.', 'success')
  }

  return (
    <Page title="Reports" subtitle="Analyze trends and compare runs">
      <div className="card">
        <h3>Latest run</h3>
        <p className="muted">
          Run ID: <strong>{lastRunId ?? 'n/a'}</strong>
        </p>
        <p className="muted">Summary JSON: {lastSummaryPath ?? 'n/a'}</p>
        <p className="muted">HTML report: {lastReportHtmlPath ?? 'n/a'}</p>
        <div className="action-row">
          <button type="button" onClick={() => void downloadHtml()}>
            Download HTML report
          </button>
        </div>
      </div>
      <div className="grid-2">
        <Card title="Run #1024" body="Passed. Avg 812ms, p95 1320ms, error 0.6%, throughput 9.8k" />
        <Card title="Run #1025" body="Failed. Avg 1.2s, p95 1.9s, error 1.4%, throughput 10.3k" />
      </div>
      <Card title="Regression Insight" body="p95 +44% from previous baseline. Likely checkout/order bottleneck." />
      <div className="card">
        <h3>Error Rate Trend</h3>
        {samples.map((item) => (
          <div key={`err-${item.minute}`} className="list-row">
            <span>Minute {item.minute}</span>
            <span>{item.errorRate}%</span>
          </div>
        ))}
      </div>
    </Page>
  )
}

export function IntegrationsPage() {
  const [step, setStep] = useState(1)
  const [repo, setRepo] = useState('org/perf-tests')
  const [workflowName, setWorkflowName] = useState('k6-performance.yml')
  const [secretName, setSecretName] = useState('PERFMIX_API_KEY')

  return (
    <Page title="Integrations" subtitle="Connect CI/CD and source control">
      <div className="grid-2">
        <Card title="GitHub Actions" body="Generate workflow and map secrets for pipeline execution." />
        <Card title="EC2 Runner" body="Prepare remote runner package with k6 script and config bundle." />
      </div>
      <Card title="CLI Package" body="Download k6 script + environment file + run command cheatsheet." />
      <div className="card">
        <h3>GitHub Setup Wizard</h3>
        <p className="muted">Step {step} / 3</p>
        {step === 1 ? (
          <label>
            Repository
            <input value={repo} onChange={(event) => setRepo(event.target.value)} />
          </label>
        ) : null}
        {step === 2 ? (
          <label>
            Workflow file
            <input value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} />
          </label>
        ) : null}
        {step === 3 ? (
          <label>
            Secret variable
            <input value={secretName} onChange={(event) => setSecretName(event.target.value)} />
          </label>
        ) : null}
        <div className="action-row">
          <button type="button" onClick={() => setStep((s) => Math.max(1, s - 1))}>
            Back
          </button>
          <button type="button" onClick={() => setStep((s) => Math.min(3, s + 1))}>
            Next
          </button>
        </div>
        <p className="muted">
          Summary: {repo} / {workflowName} / {secretName}
        </p>
      </div>
    </Page>
  )
}

export function AssistantPage() {
  const [messages, setMessages] = useState<string[]>([
    'Why did Checkout Light fail?',
    'Error rate exceeded 1.0% due to timeout spikes on POST /orders between minute 3-5.',
  ])
  const [prompt, setPrompt] = useState('')

  const send = () => {
    if (!prompt.trim()) return
    setMessages((prev) => [...prev, prompt.trim(), `Suggestion: Add ramp-up and review DB write latency for "${prompt.trim()}".`])
    setPrompt('')
  }

  return (
    <Page title="AI Assistant" subtitle="Get contextual help for scenarios and failures">
      <div className="chat-box">
        {messages.map((msg, index) => (
          <p key={`${msg}-${index}`}>
            <strong>{index % 2 === 0 ? 'You' : 'Assistant'}:</strong> {msg}
          </p>
        ))}
        <div className="form-inline">
          <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask about failures or thresholds..." />
          <button type="button" onClick={send}>
            Send
          </button>
        </div>
      </div>
    </Page>
  )
}

export function SettingsPage() {
  const data = useAppStore((state) => state.data)
  const diagnostics = useAppStore((state) => state.diagnostics)
  const loadDiagnostics = useAppStore((state) => state.loadDiagnostics)
  const setEnvVariables = useAppStore((state) => state.setEnvVariables)
  const setSharedVariables = useAppStore((state) => state.setSharedVariables)
  const setDataCsv = useAppStore((state) => state.setDataCsv)
  const updateWorkspaceMeta = useAppStore((state) => state.updateWorkspaceMeta)
  const pushToast = useToastStore((state) => state.pushToast)
  const [environment, setEnvironment] = useState(data?.environment ?? 'staging')
  const [runner, setRunner] = useState(data?.runner ?? 'local-k6')
  const [envJson, setEnvJson] = useState('')
  const [sharedJson, setSharedJson] = useState('')
  const [dataCsvLocal, setDataCsvLocal] = useState('')

  useEffect(() => {
    if (!data) return
    setEnvironment(data.environment)
    setRunner(data.runner)
    setEnvJson(JSON.stringify(data.envVariables ?? {}, null, 2))
    setSharedJson(JSON.stringify(data.sharedVariables ?? {}, null, 2))
    setDataCsvLocal(data.dataCsv ?? '')
  }, [data])

  return (
    <Page title="Settings" subtitle="Manage environments, secrets, and runners">
      <div className="card">
        <h3>Environment & Runner</h3>
        <form className="form-grid">
          <label>
            Environment
            <input value={environment} onChange={(event) => setEnvironment(event.target.value)} />
          </label>
          <label>
            Runner
            <input value={runner} onChange={(event) => setRunner(event.target.value)} />
          </label>
          <label>
            Environment variables (JSON map: env -&gt; vars)
            <textarea
              rows={10}
              value={envJson}
              onChange={(event) => setEnvJson(event.target.value)}
              placeholder={`{\n  "dev": { "baseUrl": "https://dev.api" },\n  "staging": { "baseUrl": "https://stage.api" }\n}`}
            />
          </label>
          <label>
            Shared variables (JSON)
            <textarea
              rows={8}
              value={sharedJson}
              onChange={(event) => setSharedJson(event.target.value)}
              placeholder={`{\n  "token": "YOUR_TOKEN"\n}`}
            />
          </label>
          <label>
            Data-driven values (one per line, referenced as {'{{data}}'})
            <textarea rows={6} value={dataCsvLocal} onChange={(event) => setDataCsvLocal(event.target.value)} />
          </label>
          <button
            type="button"
            onClick={() => {
              if (!data) return
              try {
                const parsedEnv = JSON.parse(envJson) as Record<string, Record<string, string>>
                const parsedShared = JSON.parse(sharedJson) as Record<string, string>
                setEnvVariables(parsedEnv)
                setSharedVariables(parsedShared)
                setDataCsv(dataCsvLocal)
                updateWorkspaceMeta(environment, runner)
                pushToast('Workspace settings saved.', 'success')
              } catch {
                pushToast('Invalid JSON in environment/shared fields.', 'error')
              }
            }}
          >
            Save workspace settings
          </button>
        </form>
      </div>
      <SimpleTable
        headers={['Setting', 'Current Value', 'Status']}
        rows={[
          ['Default Environment', environment, 'active'],
          [
            'Active variable map',
            `${Object.keys((() => {
              try {
                return JSON.parse(sharedJson || '{}') as Record<string, unknown>
              } catch {
                return {}
              }
            })()).length} shared keys`,
            'info',
          ],
          ['k6 Runtime Path', runner, 'active'],
        ]}
      />
      <div className="card">
        <h3>Runtime Diagnostics</h3>
        <div className="action-row">
          <button type="button" onClick={() => void loadDiagnostics()}>
            Refresh Checks
          </button>
        </div>
        {diagnostics ? (
          <SimpleTable
            headers={['Check', 'Value', 'Status']}
            rows={[
              ['Tauri Availability', diagnostics.tauriAvailable ? 'available' : 'not available', diagnostics.tauriAvailable ? 'ok' : 'warn'],
              ['k6 Detected Path', diagnostics.k6Path, diagnostics.k6Path ? 'ok' : 'warn'],
              ['Runtime Mode', diagnostics.mode, diagnostics.mode !== 'unavailable' ? 'ok' : 'warn'],
              ['Can Execute', diagnostics.canExecute ? 'yes' : 'no', diagnostics.canExecute ? 'ok' : 'fail'],
              ['Runs Dir Writable', diagnostics.runsDirWritable ? 'yes' : 'no', diagnostics.runsDirWritable ? 'ok' : 'fail'],
              ['k6 Version', diagnostics.k6Version || 'unknown', diagnostics.k6Version ? 'ok' : 'warn'],
            ]}
          />
        ) : (
          <p className="muted">No diagnostics yet. Click Refresh Checks.</p>
        )}
        {diagnostics?.issues.length ? (
          <div className="form-error">
            {diagnostics.issues.map((issue, index) => (
              <p key={`${issue}-${index}`}>{issue}</p>
            ))}
          </div>
        ) : null}
      </div>
    </Page>
  )
}
