import type { ApiRequestItem, RequestAssertion, ScenarioDefinition, ThresholdRow } from '../models/types'
import { criteriaToggleValue, isCriteriaToggleOn, thinkTimeMsForK6 } from '../models/types'

type BuildK6Params = {
  mode: 'collection' | 'single'
  selectedRequestId: string
  requests: ApiRequestItem[]
  scenarioName: string
  vus: number
  duration: string
  thresholds: ThresholdRow[]
  scenarios: ScenarioDefinition[]
  activeEnvironment: string
  envVariables: Record<string, Record<string, string>>
  sharedVariables: Record<string, string>
  /** Active collection {{var}}; overridden by environment */
  collectionVariables?: Record<string, string>
  /** Active project {{var}}; overridden by collection then environment */
  projectVariables?: Record<string, string>
  dataCsv: string
  runPurpose: 'performance' | 'smoke'
}

function toScenarioKey(name: string) {
  return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
}

function renderThresholds(rows: ThresholdRow[]) {
  if (!rows.length) {
    return "http_req_duration: ['p(95)<2000'],\n    http_req_failed: ['rate<0.01'],"
  }
  return rows
    .map((row) => {
      if (row.metric === 'error_rate') return `http_req_failed: ['${row.rule.replace(/\s/g, '')}']`
      if (row.metric === 'avg' || row.metric === 'p95' || row.metric === 'p99') {
        return `http_req_duration: ['${row.rule.replace(/\s/g, '')}']`
      }
      return `http_reqs: ['${row.rule.replace(/\s/g, '')}']`
    })
    .join(',\n    ')
}

function buildHeadersObject(headersRaw: string) {
  const lines = headersRaw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) {
    return `{ 'Content-Type': 'application/json' }`
  }

  const pairs = lines.map((line) => {
    const idx = line.indexOf(':')
    if (idx === -1) {
      return null
    }
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (!key) return null
    return { key, value }
  }).filter(Boolean) as { key: string; value: string }[]

  if (!pairs.length) {
    return `{ 'Content-Type': 'application/json' }`
  }

  const rendered = pairs
    .map((p) => `${JSON.stringify(p.key)}: tmpl(${JSON.stringify(p.value)})`)
    .join(', ')

  return `{ ${rendered} }`
}

function buildAssertionChecks(assertions: RequestAssertion[] | undefined, reqName: string): string {
  const enabled = (assertions ?? []).filter((a) => a.enabled)
  if (!enabled.length) {
    return `{ ${JSON.stringify(`${reqName} status is < 400`)}: (r) => r.status < 400 }`
  }

  const checks: string[] = []
  for (const a of enabled) {
    const label = `${reqName}: ${a.type.replace(/_/g, ' ')}`
    switch (a.type) {
      case 'status_code':
        checks.push(`${JSON.stringify(label)}: (r) => r.status === ${parseInt(a.target, 10) || 200}`)
        break
      case 'body_equals':
        checks.push(`${JSON.stringify(label)}: (r) => r.body === ${JSON.stringify(a.target)}`)
        break
      case 'body_contains':
        checks.push(`${JSON.stringify(label)}: (r) => r.body && r.body.includes(${JSON.stringify(a.target)})`)
        break
      case 'header_visible':
        checks.push(`${JSON.stringify(label)}: (r) => r.headers[${JSON.stringify(a.target.toLowerCase())}] !== undefined`)
        break
      case 'header_contains':
        checks.push(`${JSON.stringify(label)}: (r) => (r.headers[${JSON.stringify(a.target.toLowerCase())}] || '').includes(${JSON.stringify(a.expected ?? '')})`)
        break
      case 'header_value_equals':
        checks.push(`${JSON.stringify(label)}: (r) => r.headers[${JSON.stringify(a.target.toLowerCase())}] === ${JSON.stringify(a.expected ?? '')}`)
        break
    }
  }
  return `{\n      ${checks.join(',\n      ')},\n    }`
}

function buildHttpCall(req: ApiRequestItem, index: number) {
  const method = req.method.toLowerCase()
  const headersExpr = buildHeadersObject(req.headers)
  const checksExpr = buildAssertionChecks(req.assertions, req.name)

  if (method === 'get' || method === 'head') {
    return `  // Step ${index + 1}: ${req.name}
  const url${index} = tmpl(${JSON.stringify(req.url)});
  const res${index} = http.${method}(url${index}, { headers: ${headersExpr} });
  check(res${index}, ${checksExpr});`
  }

  const bodyRaw = req.body?.trim() ?? ''
  const bodyExpr = bodyRaw ? `tmpl(${JSON.stringify(bodyRaw)})` : 'null'
  return `  // Step ${index + 1}: ${req.name}
  const url${index} = tmpl(${JSON.stringify(req.url)});
  const res${index} = http.${method}(url${index}, ${bodyExpr}, { headers: ${headersExpr} });
  check(res${index}, ${checksExpr});`
}

function buildScenarioEntries(
  requests: ApiRequestItem[],
  fallbackScenarioKey: string,
  fallbackVus: number,
  fallbackDuration: string,
  runPurpose: BuildK6Params['runPurpose'],
) {
  const entries: string[] = []
  let hasCase = false

  for (const req of requests) {
    const cases = req.testCases?.length ? req.testCases : []
    for (const tc of cases) {
      hasCase = true
      const scenarioKey = toScenarioKey(`${req.id}_${tc.id}_${tc.name}`)
      if (runPurpose === 'smoke') {
        entries.push(`    ${scenarioKey}: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '2m',
    },`)
      } else {
        entries.push(`    ${scenarioKey}: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: ${JSON.stringify(tc.rampUp)}, target: ${tc.vus} },
        { duration: ${JSON.stringify(tc.duration)}, target: ${tc.vus} },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },`)
      }
    }
  }

  // Requests with no test cases still need a scenario when other requests define TCs (collection mixed mode).
  if (hasCase) {
    for (const req of requests) {
      if (req.testCases?.length) continue
      const defaultKey = toScenarioKey(`${req.id}_default`)
      if (runPurpose === 'smoke') {
        entries.push(`    ${defaultKey}: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '2m',
    },`)
      } else {
        entries.push(`    ${defaultKey}: {
      executor: 'constant-vus',
      vus: ${fallbackVus},
      duration: ${JSON.stringify(fallbackDuration)},
    },`)
      }
    }
  }

  if (!hasCase) {
    if (runPurpose === 'smoke') {
      entries.push(`    ${fallbackScenarioKey}: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '2m',
    },`)
    } else {
      entries.push(`    ${fallbackScenarioKey}: {
      executor: 'constant-vus',
      vus: ${fallbackVus},
      duration: ${JSON.stringify(fallbackDuration)},
    },`)
    }
  }

  return entries.join('\n')
}

function buildThresholdBlockForTestCases(
  requests: ApiRequestItem[],
  fallbackThresholds: ThresholdRow[],
  runPurpose: BuildK6Params['runPurpose'],
) {
  if (runPurpose === 'smoke') {
    // Smoke runs should not fail the whole process on performance thresholds.
    return ''
  }

  const grouped = new Map<string, string[]>()

  const pushRule = (key: string, rule: string) => {
    const list = grouped.get(key) ?? []
    list.push(rule)
    grouped.set(key, list)
  }

  for (const req of requests) {
    for (const tc of req.testCases ?? []) {
      const scenarioName = `${req.id}_${tc.id}_${tc.name}`
      const scenarioKey = toScenarioKey(scenarioName)

      if (isCriteriaToggleOn(tc, 'maxAvgMs')) {
        const maxAvgMs = criteriaToggleValue(tc, 'maxAvgMs')
        if (typeof maxAvgMs === 'number' && Number.isFinite(maxAvgMs)) {
          pushRule(`http_req_duration{scenario:${scenarioKey}}`, `avg<${maxAvgMs}`)
        }
      }
      if (isCriteriaToggleOn(tc, 'maxP95Ms')) {
        const maxP95Ms = criteriaToggleValue(tc, 'maxP95Ms')
        if (typeof maxP95Ms === 'number' && Number.isFinite(maxP95Ms)) {
          pushRule(`http_req_duration{scenario:${scenarioKey}}`, `p(95)<${maxP95Ms}`)
        }
      }
      if (isCriteriaToggleOn(tc, 'maxP99Ms')) {
        const maxP99Ms = criteriaToggleValue(tc, 'maxP99Ms')
        if (typeof maxP99Ms === 'number' && Number.isFinite(maxP99Ms)) {
          pushRule(`http_req_duration{scenario:${scenarioKey}}`, `p(99)<${maxP99Ms}`)
        }
      }
      if (isCriteriaToggleOn(tc, 'maxErrorRate')) {
        const maxErrorRate = criteriaToggleValue(tc, 'maxErrorRate')
        if (typeof maxErrorRate === 'number' && Number.isFinite(maxErrorRate)) {
          pushRule(`http_req_failed{scenario:${scenarioKey}}`, `rate<${maxErrorRate}`)
        }
      }
      if (isCriteriaToggleOn(tc, 'minThroughputRps')) {
        const minThroughputRps = criteriaToggleValue(tc, 'minThroughputRps')
        if (typeof minThroughputRps === 'number' && Number.isFinite(minThroughputRps)) {
          pushRule(`http_reqs{scenario:${scenarioKey}}`, `rate>${minThroughputRps}`)
        }
      }
    }
  }

  if (!grouped.size) {
    if (fallbackThresholds.length > 0) {
      return renderThresholds(fallbackThresholds)
    }
    return ''
  }

  return Array.from(grouped.entries())
    .map(([metricKey, rules]) => {
      const renderedRules = rules.map((r) => `'${r}'`).join(', ')
      return `'${metricKey}': [${renderedRules}]`
    })
    .join(',\n    ')
}

export function buildK6Script(params: BuildK6Params): string {
  const scenario = params.scenarios.find((item) => item.name === params.scenarioName)
  const scenarioKey = toScenarioKey(params.scenarioName || 'generated_scenario')
  const requests =
    params.mode === 'collection'
      ? params.requests
      : params.requests.filter((item) => item.id === params.selectedRequestId)

  const requestLines = requests.map((req, index) => buildHttpCall(req, index + 1)).join('\n\n')

  const vus = scenario?.vus ?? params.vus
  const duration = scenario?.duration ?? params.duration

  const envNormalized: Record<string, Record<string, string>> = {}
  for (const [envName, vars] of Object.entries(params.envVariables ?? {})) {
    envNormalized[String(envName).trim().toLowerCase()] = vars
  }

  const activeRaw = String(params.activeEnvironment || 'staging').trim()
  const activeKey = activeRaw.toLowerCase()
  if (!envNormalized[activeKey]) {
    // Make unknown environments usable instead of silently breaking {{baseUrl}} resolution.
    envNormalized[activeKey] =
      envNormalized.staging || envNormalized.dev || envNormalized.prod || envNormalized.production || {}
  }

  const envJson = JSON.stringify(envNormalized)
  const sharedJson = JSON.stringify(params.sharedVariables ?? {})
  const collectionVarsJson = JSON.stringify(params.collectionVariables ?? {})
  const projectVarsJson = JSON.stringify(params.projectVariables ?? {})
  const activeEnv = activeKey
  const dataLines = (params.dataCsv ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const dataJson = JSON.stringify(dataLines)

  const scenarioBlock = buildScenarioEntries(requests, scenarioKey, vus, duration, params.runPurpose)
  const thresholdsBlock = buildThresholdBlockForTestCases(requests, params.thresholds, params.runPurpose)
  const thresholdsInner = thresholdsBlock.trim()

  return `/*
 * Generated by PerfMix Studio
 *
 * HOW TO RUN FROM TERMINAL:
 *   k6 run this_script.js
 *
 * WITH JSON SUMMARY EXPORT:
 *   k6 run --summary-export=results.json this_script.js
 *
 * WITH GRAFANA / INFLUXDB (real-time dashboard):
 *   k6 run --out influxdb=http://localhost:8086/k6 this_script.js
 *   Then import the k6 dashboard in Grafana:
 *     https://grafana.com/grafana/dashboards/2587-k6-load-testing-results/
 *
 * WITH GRAFANA CLOUD K6:
 *   k6 run --out cloud this_script.js
 *
 * WITH PROMETHEUS REMOTE WRITE:
 *   K6_PROMETHEUS_RW_SERVER_URL=http://localhost:9090/api/v1/write \\
 *   k6 run --out experimental-prometheus-rw this_script.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

const ENVIRONMENTS = ${envJson};
const COLLECTION_VARS = ${collectionVarsJson};
const PROJECT_VARS = ${projectVarsJson};
const SHARED = ${sharedJson};
const ACTIVE_ENV = ${JSON.stringify(activeEnv)};
const DATA = ${dataJson};

// Resolution order: environment → collection → project → global shared (AppData)
function resolveVar(name) {
  const envMap = ENVIRONMENTS[ACTIVE_ENV] || {};
  if (Object.prototype.hasOwnProperty.call(envMap, name)) return envMap[name];
  if (Object.prototype.hasOwnProperty.call(COLLECTION_VARS, name)) return COLLECTION_VARS[name];
  if (Object.prototype.hasOwnProperty.call(PROJECT_VARS, name)) return PROJECT_VARS[name];
  if (Object.prototype.hasOwnProperty.call(SHARED, name)) return SHARED[name];
  return \`\${name}\`;
}

function applyTemplate(input) {
  if (!input) return input;
  return String(input).replace(/{{\\s*([a-zA-Z0-9_\\-.]+)\\s*}}/g, (_, key) => String(resolveVar(key)));
}

function dataValue() {
  if (!DATA.length) return '';
  const idx = exec.scenario.iterationInTest % DATA.length;
  return DATA[idx];
}

export const options = {
  scenarios: {
${scenarioBlock}
  },
  thresholds: {
    ${thresholdsInner}
  },
};

export default function () {
  // Lightweight variable + data-driven substitution (MVP).
  globalThis.__vars = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === 'data') return dataValue();
        return resolveVar(String(prop));
      },
    },
  );

  const tmpl = (s) => applyTemplate(s);

  const scenarioName = exec.scenario.name;
${(() => {
    const lines: string[] = []
    lines.push('  // Dispatch by scenario (request test cases) or run all requests (default).')
    const caseBranches: string[] = []
    for (const req of requests) {
      const cases = req.testCases?.length ? req.testCases : []
      for (const tc of cases) {
        const scenarioNameLiteral = `${req.id}_${tc.id}_${tc.name}`
        const scenarioKey = toScenarioKey(scenarioNameLiteral)
        const call = buildHttpCall(req, 1).replaceAll('\n', '\n  ')
        caseBranches.push(
          `  if (scenarioName === ${JSON.stringify(scenarioKey)}) {\n  ${call}\n    sleep(${thinkTimeMsForK6(tc)} / 1000);\n    return;\n  }`,
        )
      }
      if (!cases.length) {
        const defaultKey = toScenarioKey(`${req.id}_default`)
        const call = buildHttpCall(req, 1).replaceAll('\n', '\n  ')
        caseBranches.push(
          `  if (scenarioName === ${JSON.stringify(defaultKey)}) {\n  ${call}\n    sleep(${scenario?.thinkTimeMs ?? 150} / 1000);\n    return;\n  }`,
        )
      }
    }

    lines.push(...caseBranches)

    if (caseBranches.length) {
      lines.push(`  // No matching scenario branch (unexpected).`)
      lines.push(`  sleep(0.2);`)
      return lines.join('\n')
    }

    lines.push(`${requestLines || '  sleep(1);'}`)
    lines.push(`  sleep(${scenario?.thinkTimeMs ?? 150} / 1000);`)
    return lines.join('\n')
  })()}
}
`
}
