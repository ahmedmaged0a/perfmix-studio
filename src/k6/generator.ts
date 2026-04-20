import type {
  ApiRequestItem,
  CorrelationRule,
  RequestAssertion,
  RequestTestCase,
  ScenarioDefinition,
  ThresholdRow,
} from '../models/types'
import { normalizeOAuthAuthorizationCodeHeaderRegex } from '../workspace/oauthCodeRegex'
import {
  isVariableOwnedByAnotherRequest,
  shouldBlockEuumpAccessMirrorToUpdatedToken,
} from '../workspace/workspaceCorrelationRuntime'
import { criteriaToggleValue, isCriteriaToggleOn, thinkTimeMsForK6 } from '../models/types'
import { parseDurationToSeconds } from '../workspace/durationParse'

function effectiveRampDownDuration(tc: RequestTestCase): string | null {
  if (!tc.rampDownEnabled) return null
  const raw = (tc.rampDown ?? '').trim()
  if (!raw) return null
  return parseDurationToSeconds(raw) > 0 ? raw : null
}

/** JS expression emitted into k6 scripts for steady-state duration override. */
function parallelSteadyDurJs(tcDuration: string): string {
  return `(String(__ENV.PERFMIX_LOAD_DURATION ?? '').trim() || ${JSON.stringify(tcDuration)})`
}

/** JS expression for VU count override in parallel ramping / constant scenarios. */
function parallelVuJs(tcVu: number): string {
  return `Math.max(1, parseInt(String(__ENV.PERFMIX_LOAD_VUS ?? '').trim(), 10) || ${tcVu})`
}

/** Ramp-down stage duration when ramp-down is enabled (parallel). */
function rampDownDurJs(fallbackRd: string): string {
  return `(String(__ENV.PERFMIX_LOAD_RAMP_DOWN ?? '').trim() || ${JSON.stringify(fallbackRd)})`
}

function perfMixCliEnvComment(): string {
  return `/* CLI load overrides (optional — unset uses embedded PerfMix values):
 *   Sequential journey: PERFMIX_COLLECTION_DURATION, PERFMIX_COLLECTION_VUS
 *   Parallel scenarios: PERFMIX_LOAD_DURATION, PERFMIX_LOAD_VUS, PERFMIX_LOAD_RAMP_DOWN (when ramp-down enabled)
 * Example:
 *   k6 run -e PERFMIX_COLLECTION_DURATION=10m -e PERFMIX_COLLECTION_VUS=20 script.js
 */
`
}

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
  /** Whole collection: parallel scenarios (default) vs one sequential journey. */
  collectionExecution?: 'parallel' | 'sequential'
  /** Used when mode is collection + sequential (performance). */
  collectionLoadVus?: number
  collectionLoadDuration?: string
  /** Stored from UI; sequential journey export uses constant-vus (this ramp is not emitted there). */
  collectionLoadRampUp?: string
  /** Project extract rules scoped to the exported requests (sequential journey only). */
  correlationRules?: CorrelationRule[]
  /** When true (e.g. JMX Cookie Manager), sequential k6 uses http.cookieJar(). */
  useCookieJar?: boolean
  /** Emit console.warn when correlation extractors leave RUNTIME vars empty (JMX import option). */
  correlationDebug?: boolean
}

function toScenarioKey(name: string) {
  return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
}

/** Stable slot id for (request, test case) when resolving parallel scenario keys. */
function testCaseSlotKey(req: ApiRequestItem, tc: RequestTestCase) {
  return `${req.id}\0${tc.id}`
}

/**
 * Human-first k6 scenario names (folder / request / TC names + ids), `toScenarioKey`-safe,
 * with numeric suffixes when sanitized bases collide.
 */
function uniqueK6ScenarioKeyFromRaw(baseRaw: string, used: Set<string>): string {
  let key = toScenarioKey(baseRaw)
  if (!key) key = 'scenario'
  let n = 2
  let candidate = key
  while (used.has(candidate)) {
    candidate = `${key}_${n}`
    n += 1
  }
  used.add(candidate)
  return candidate
}

type ParallelScenarioKeyRegistry = {
  tcKeyBySlot: Map<string, string>
  defaultKeyByReqId: Map<string, string>
  hasAnyCase: boolean
}

function buildParallelScenarioKeyRegistry(requests: ApiRequestItem[]): ParallelScenarioKeyRegistry {
  const used = new Set<string>()
  const tcKeyBySlot = new Map<string, string>()
  let hasAnyCase = false

  for (const req of requests) {
    const cases = req.testCases ?? []
    if (cases.length) hasAnyCase = true
    for (const tc of cases) {
      const baseRaw = `${req.folder}_${req.name}_${tc.name}_${req.id}_${tc.id}`
      tcKeyBySlot.set(testCaseSlotKey(req, tc), uniqueK6ScenarioKeyFromRaw(baseRaw, used))
    }
  }

  const defaultKeyByReqId = new Map<string, string>()
  if (hasAnyCase) {
    for (const req of requests) {
      if (req.testCases?.length) continue
      const baseRaw = `${req.folder}_${req.name}_default_${req.id}`
      defaultKeyByReqId.set(req.id, uniqueK6ScenarioKeyFromRaw(baseRaw, used))
    }
  }

  return { tcKeyBySlot, defaultKeyByReqId, hasAnyCase }
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

function perfTagsLiteral(req: ApiRequestItem): string {
  const report = req.excludeFromAggregateReport ? '0' : '1'
  return JSON.stringify({ perfmix_request_id: req.id, perfmix_report: report })
}

function thinkTimeMsForRequest(req: ApiRequestItem, fallbackMs: number) {
  const tc = req.testCases?.[0]
  if (tc) return thinkTimeMsForK6(tc)
  return fallbackMs
}

function isKeycloakAuthenticatePost(req: ApiRequestItem): boolean {
  const m = req.method.toLowerCase()
  if (m !== 'post' && m !== 'put' && m !== 'patch') return false
  return /login-actions\/authenticate/i.test(req.url)
}

function buildHttpCall(req: ApiRequestItem, index: number, useJar = false, keycloakAuthRuntimeExpr: string | null = null) {
  const method = req.method.toLowerCase()
  const headersExpr = buildHeadersObject(req.headers)
  const checksExpr = buildAssertionChecks(req.assertions, req.name)
  const tagsExpr = perfTagsLiteral(req)
  const jarOpt = useJar ? ', jar' : ''
  /** Match JMeter / Tauri: keep 302 `Location` with OAuth `code` for correlation (`tokenCode`). */
  const redirectOpt = /login-actions\/authenticate/i.test(req.url) ? ', redirects: 0' : ''

  if (method === 'get' || method === 'head') {
    return `  // Step ${index + 1}: ${req.name}
  const url${index} = tmpl(${JSON.stringify(req.url)});
  const res${index} = http.${method}(url${index}, { headers: ${headersExpr}, tags: ${tagsExpr}${jarOpt}${redirectOpt} });
  check(res${index}, ${checksExpr});`
  }

  const bodyRaw = req.body?.trim() ?? ''
  let bodyExpr: string
  if (keycloakAuthRuntimeExpr && isKeycloakAuthenticatePost(req)) {
    const baseTmpl = bodyRaw ? `tmpl(${JSON.stringify(bodyRaw)})` : `''`
    bodyExpr = `perfMixKeycloakAuthPostBody(${baseTmpl}, ${keycloakAuthRuntimeExpr})`
  } else {
    bodyExpr = bodyRaw ? `tmpl(${JSON.stringify(bodyRaw)})` : 'null'
  }
  return `  // Step ${index + 1}: ${req.name}
  const url${index} = tmpl(${JSON.stringify(req.url)});
  const res${index} = http.${method}(url${index}, ${bodyExpr}, { headers: ${headersExpr}, tags: ${tagsExpr}${jarOpt}${redirectOpt} });
  check(res${index}, ${checksExpr});`
}

function buildExtractionSnippet(
  rule: CorrelationRule,
  resIndex: number,
  allRules: CorrelationRule[],
  requestUrl: string,
): string {
  const kind = rule.kind ?? 'jsonpath'
  const grp = Math.max(1, rule.regexGroup ?? 1)
  const mirrorLinesRegex = (rule.runtimeMirrorTo ?? [])
    .filter((a) => a && a !== rule.variableName)
    .filter((a) => !isVariableOwnedByAnotherRequest(allRules, a, rule.fromRequestId))
    .filter((a) => !shouldBlockEuumpAccessMirrorToUpdatedToken(a, rule.variableName, requestUrl))
    .map((alias) => `      setRunVar(${JSON.stringify(alias)}, __cap);`)

  if (kind === 'regex') {
    if (!rule.regexPattern?.trim()) return '  // skip extract: empty regex pattern'
    const pat = JSON.stringify(
      normalizeOAuthAuthorizationCodeHeaderRegex(rule.regexPattern.trim(), rule.regexSource),
    )
    const src = rule.regexSource === 'headers' ? `headerBlob(res${resIndex})` : `res${resIndex}.body`
    const regFlags = rule.regexSource === 'headers' ? `, 'i'` : ''
    if (mirrorLinesRegex.length) {
      return `  try {
    const __src = ${src};
    const __m = new RegExp(${pat}${regFlags}).exec(__src);
    if (__m && __m[${grp}] !== undefined) {
      const __cap = __m[${grp}];
      setRunVar(${JSON.stringify(rule.variableName)}, __cap);
${mirrorLinesRegex.join('\n')}
    }
  } catch (e) {}`
    }
    return `  try {
    const __src = ${src};
    const __m = new RegExp(${pat}${regFlags}).exec(__src);
    if (__m && __m[${grp}] !== undefined) setRunVar(${JSON.stringify(rule.variableName)}, __m[${grp}]);
  } catch (e) {}`
  }

  const jp = JSON.stringify(rule.jsonPath || '$')
  const mirrorLinesJp = (rule.runtimeMirrorTo ?? [])
    .filter((a) => a && a !== rule.variableName)
    .filter((a) => !isVariableOwnedByAnotherRequest(allRules, a, rule.fromRequestId))
    .filter((a) => !shouldBlockEuumpAccessMirrorToUpdatedToken(a, rule.variableName, requestUrl))
    .map((alias) => `      setRunVar(${JSON.stringify(alias)}, String(__v));`)

  if (mirrorLinesJp.length) {
    return `  try {
    const __j = res${resIndex}.body ? JSON.parse(res${resIndex}.body) : null;
    const __v = jsonPathLite(__j, ${jp});
    if (__v != null && __v !== '') {
      setRunVar(${JSON.stringify(rule.variableName)}, __v);
${mirrorLinesJp.join('\n')}
    }
  } catch (e) {}`
  }
  return `  try {
    const __j = res${resIndex}.body ? JSON.parse(res${resIndex}.body) : null;
    const __v = jsonPathLite(__j, ${jp});
    if (__v != null && __v !== '') setRunVar(${JSON.stringify(rule.variableName)}, __v);
  } catch (e) {}`
}

function indentTextBlock(s: string, eachLinePrefix: string): string {
  return s
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : eachLinePrefix + line))
    .join('\n')
}

/** Per-phase RUNTIME object + setRunVar + headerBlob + jsonPathLite (no resolveVar / Keycloak). */
function buildRuntimeObjectBlock(runtimeVar: string, dbgVal: boolean): string {
  return `const ${runtimeVar} = {};
const __pfDbg_corr = ${JSON.stringify(dbgVal)};
function setRunVar(name, val) { ${runtimeVar}[String(name)] = String(val == null ? '' : val); }
function headerBlob(res) {
  if (!res || !res.headers) return '';
  const h = res.headers;
  return Object.keys(h).sort().map((k) => k + ': ' + String(h[k] ?? '')).join('\\n');
}
function jsonPathLite(root, path) {
  if (path == null || path === '' || path === '$') return root;
  const p = String(path).replace(/^\\$\\./, '');
  try {
    let cur = root;
    for (const part of p.split('.').filter(Boolean)) {
      cur = cur == null ? undefined : cur[part];
    }
    return cur;
  } catch (e) { return undefined; }
}`.trim()
}

/** Emitted once at module scope; callers pass RUNTIME or __perfMixSetupRt. */
function keycloakExecutionHelperDefinition(): string {
  return [
    'function tryPerfMixKeycloakExecution(rt, body) {',
    '  try {',
    "    const b = String(body || '').replace(/&amp;/gi, '&');",
    "    if (!b.includes('execution')) return;",
    "    const cur = (rt.execution || '').trim();",
    "    if (cur && cur !== 'execution' && /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-/.test(cur)) return;",
    '    let m = /[?&]execution=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\\b/i.exec(b);',
    "    if (m && m[1] && m[1] !== 'execution') { rt.execution = String(m[1]); return; }",
    '    const am = /\\baction=(["\'])([^"\']*login-actions\\/authenticate[^"\']*)\\1/i.exec(b);',
    '    if (am && am[2]) {',
    '      m = /[?&]execution=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\\b/i.exec(am[2]);',
    "      if (m && m[1]) { rt.execution = String(m[1]); return; }",
    '    }',
    "    m = /<input[^>]*\\bname=[\"']execution[\"'][^>]*\\bvalue=[\"']([0-9a-fA-F-]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})[\"']/i.exec(b);",
    "    if (m && m[1] && m[1] !== 'execution') { rt.execution = String(m[1]); return; }",
    "    m = /<input[^>]*\\bvalue=[\"']([0-9a-fA-F-]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})[\"'][^>]*\\bname=[\"']execution[\"']/i.exec(b);",
    "    if (m && m[1] && m[1] !== 'execution') rt.execution = String(m[1]);",
    '  } catch (e) {}',
    '}',
  ].join('\n')
}

/** Merge Keycloak hidden form fields from RUNTIME after tmpl() — JMeter often records only username/password. */
function keycloakAuthPostBodyHelperDefinition(): string {
  return [
    'function perfMixKeycloakAuthPostBody(base, rt) {',
    '  try {',
    "    const s0 = String(base == null ? '' : base);",
    "    const parts = [];",
    "    const exec = String(rt && rt.execution != null ? rt.execution : '').trim();",
    '    if (!/(?:^|&)execution=/i.test(s0) && exec && exec !== \'execution\') {',
    "      parts.push('execution=' + encodeURIComponent(exec));",
    '    }',
    "    const sc = String(rt && (rt.session_code != null && rt.session_code !== '') ? rt.session_code : (rt.sessionCode != null ? rt.sessionCode : '')).trim();",
    '    if (!/(?:^|&)session_code=/i.test(s0) && sc) {',
    "      parts.push('session_code=' + encodeURIComponent(sc));",
    '    }',
    "    const tab = String(rt && (rt.tab_id != null && rt.tab_id !== '') ? rt.tab_id : (rt.tab_Id != null ? rt.tab_Id : '')).trim();",
    '    if (!/(?:^|&)tab_id=/i.test(s0) && tab) {',
    "      parts.push('tab_id=' + encodeURIComponent(tab));",
    '    }',
    '    if (!parts.length) return s0;',
    "    const t = s0.trim();",
    "    const sep = t ? '&' : '';",
    "    return t + sep + parts.join('&');",
    "  } catch (e) { return String(base == null ? '' : base); }",
    '}',
  ].join('\n')
}

function buildCorrelationDebugAfterExtracts(
  extracts: CorrelationRule[],
  stepLabel: string,
  runtimeVar = 'RUNTIME',
): string {
  if (!extracts.length) return ''
  const names = new Set<string>()
  for (const e of extracts) {
    names.add(e.variableName)
    for (const m of e.runtimeMirrorTo ?? []) {
      if (m) names.add(m)
    }
  }
  const lines: string[] = []
  for (const n of names) {
    lines.push(
      `  if (__pfDbg_corr && (!Object.prototype.hasOwnProperty.call(${runtimeVar}, ${JSON.stringify(n)}) || ${runtimeVar}[${JSON.stringify(n)}] === '')) console.warn(${JSON.stringify(`[PerfMix] RUNTIME "${n}" is empty after "${stepLabel}" — check correlation regex / Keycloak HTML.`)});`,
    )
  }
  return lines.join('\n')
}

function buildSequentialDefaultBody(
  requests: ApiRequestItem[],
  fallbackThinkMs: number,
  rulesForThisSegment: CorrelationRule[],
  allRulesForSnippetOwnership: CorrelationRule[],
  useCookieJar: boolean,
  correlationDebug: boolean,
  includeKeycloakExecutionFallback: boolean,
  introComment: string,
  debugRuntimeVar = 'RUNTIME',
  keycloakRuntimeExpr: string | null = 'RUNTIME',
) {
  const rulesByRequest = new Map<string, CorrelationRule[]>()
  for (const r of rulesForThisSegment) {
    const list = rulesByRequest.get(r.fromRequestId) ?? []
    list.push(r)
    rulesByRequest.set(r.fromRequestId, list)
  }

  const parts: string[] = [`  // ${introComment}`]
  if (useCookieJar) {
    parts.push('  const jar = http.cookieJar();')
  }
  requests.forEach((req, i) => {
    const idx = i + 1
    const stepChunks: string[] = []
    stepChunks.push(
      buildHttpCall(req, idx, useCookieJar, includeKeycloakExecutionFallback ? keycloakRuntimeExpr : null),
    )
    const extracts = rulesByRequest.get(req.id) ?? []
    for (const rule of extracts) {
      stepChunks.push(buildExtractionSnippet(rule, idx, allRulesForSnippetOwnership, req.url))
    }
    if (correlationDebug) {
      const dbg = buildCorrelationDebugAfterExtracts(extracts, req.name, debugRuntimeVar)
      if (dbg) stepChunks.push(dbg)
    }
    if (includeKeycloakExecutionFallback && keycloakRuntimeExpr) {
      stepChunks.push(`  tryPerfMixKeycloakExecution(${keycloakRuntimeExpr}, res${idx}.body);`)
    }
    const sleepMs = thinkTimeMsForRequest(req, fallbackThinkMs)
    if (sleepMs > 0) {
      stepChunks.push(`  sleep(${sleepMs / 1000});`)
    }
    const stepBlock = stepChunks.join('\n')
    parts.push(stepBlock)
  })
  return parts.join('\n')
}

function buildScenarioEntries(
  requests: ApiRequestItem[],
  keyRegistry: ParallelScenarioKeyRegistry,
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
      const scenarioKey = keyRegistry.tcKeyBySlot.get(testCaseSlotKey(req, tc)) ?? 'scenario'
      if (runPurpose === 'smoke') {
        entries.push(`    ${scenarioKey}: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '2m',
    },`)
      } else {
        const vuJ = parallelVuJs(tc.vus)
        const steadyJ = parallelSteadyDurJs(tc.duration)
        const rd = effectiveRampDownDuration(tc)
        if (rd) {
          const rdJ = rampDownDurJs(rd)
          entries.push(`    ${scenarioKey}: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: ${JSON.stringify(tc.rampUp)}, target: ${vuJ} },
        { duration: ${steadyJ}, target: ${vuJ} },
        { duration: ${rdJ}, target: 0 },
      ],
      gracefulRampDown: ${rdJ},
    },`)
        } else {
          entries.push(`    ${scenarioKey}: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: ${JSON.stringify(tc.rampUp)}, target: ${vuJ} },
        { duration: ${steadyJ}, target: ${vuJ} },
      ],
      gracefulRampDown: '0s',
    },`)
        }
      }
    }
  }

  // Requests with no test cases still need a scenario when other requests define TCs (collection mixed mode).
  if (hasCase) {
    for (const req of requests) {
      if (req.testCases?.length) continue
      const defaultKey = keyRegistry.defaultKeyByReqId.get(req.id) ?? toScenarioKey(`${req.folder}_${req.name}_default_${req.id}`)
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
      vus: ${parallelVuJs(fallbackVus)},
      duration: ${parallelSteadyDurJs(fallbackDuration)},
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
      vus: ${parallelVuJs(fallbackVus)},
      duration: ${parallelSteadyDurJs(fallbackDuration)},
    },`)
    }
  }

  return entries.join('\n')
}

function buildThresholdBlockForTestCases(
  requests: ApiRequestItem[],
  keyRegistry: ParallelScenarioKeyRegistry,
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
      const scenarioKey =
        keyRegistry.tcKeyBySlot.get(testCaseSlotKey(req, tc)) ?? toScenarioKey(`${req.folder}_${req.name}_${tc.name}_${req.id}_${tc.id}`)

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

/** Sequential collection load: constant VUs for JMeter-style “N threads for duration” parity (vs ramping). */
function buildSequentialJourneyScenarioBlock(
  journeyKey: string,
  vu: number,
  duration: string,
  runPurpose: BuildK6Params['runPurpose'],
) {
  if (runPurpose === 'smoke') {
    return `    ${journeyKey}: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '5m',
    },`
  }
  return `    ${journeyKey}: {
      executor: 'constant-vus',
      vus: Math.max(1, parseInt(String(__ENV.PERFMIX_COLLECTION_VUS ?? '').trim(), 10) || ${vu}),
      duration: String(__ENV.PERFMIX_COLLECTION_DURATION ?? '').trim() || ${JSON.stringify(duration)},
    },`
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

  const isCollectionSequential =
    params.mode === 'collection' && (params.collectionExecution ?? 'parallel') === 'sequential'

  const journeyKey = toScenarioKey('collection_journey')
  const loadVu = Math.max(1, Math.floor(params.collectionLoadVus ?? vus ?? 5))
  const loadDuration = params.collectionLoadDuration ?? duration ?? '1m'

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

  const parallelScenarioKeys = buildParallelScenarioKeyRegistry(requests)

  const scenarioBlock = isCollectionSequential
    ? buildSequentialJourneyScenarioBlock(journeyKey, loadVu, loadDuration, params.runPurpose)
    : buildScenarioEntries(requests, parallelScenarioKeys, scenarioKey, vus, duration, params.runPurpose)

  const thresholdsBlock = isCollectionSequential
    ? params.runPurpose === 'smoke'
      ? ''
      : params.thresholds.length > 0
        ? renderThresholds(params.thresholds)
        : ''
    : buildThresholdBlockForTestCases(requests, parallelScenarioKeys, params.thresholds, params.runPurpose)
  const thresholdsInner = thresholdsBlock.trim()

  const reqIdSet = new Set(requests.map((r) => r.id))
  const scopedCorrelationRules = (params.correlationRules ?? []).filter((r) => reqIdSet.has(r.fromRequestId))
  const useJarSeq = Boolean(params.useCookieJar) && isCollectionSequential
  const collectionUsesKeycloakLoginFlow = requests.some((r) =>
    /openid-connect\/auth|login-actions\/authenticate/i.test(r.url),
  )
  const needsRuntimeBlock =
    isCollectionSequential &&
    (scopedCorrelationRules.length > 0 || collectionUsesKeycloakLoginFlow)
  const correlationDebugOn = Boolean(
    params.correlationDebug && isCollectionSequential && scopedCorrelationRules.length > 0,
  )

  const resolveVarEnvTail = `  const envMap = ENVIRONMENTS[ACTIVE_ENV] || {};
  if (Object.prototype.hasOwnProperty.call(envMap, name)) return envMap[name];
  if (Object.prototype.hasOwnProperty.call(COLLECTION_VARS, name)) return COLLECTION_VARS[name];
  if (Object.prototype.hasOwnProperty.call(PROJECT_VARS, name)) return PROJECT_VARS[name];
  if (Object.prototype.hasOwnProperty.call(SHARED, name)) return SHARED[name];
  return \`\${name}\`;`

  const setupRequests = requests.filter((r) => r.jmeterThreadGroupKind === 'setup')
  /** PostThreadGroup is not mirrored yet (MVP); exclude from the per-iteration VU loop. */
  const mainRequests = requests.filter(
    (r) => r.jmeterThreadGroupKind !== 'setup' && r.jmeterThreadGroupKind !== 'teardown',
  )
  const usesK6SetupPhase =
    isCollectionSequential && setupRequests.length > 0 && mainRequests.length > 0

  /** Emit module-level RUNTIME when extractors/Keycloak exist, or whenever setup() merges into default. */
  const needsModuleRuntime = needsRuntimeBlock || usesK6SetupPhase

  const setupRequestIdSet = new Set(setupRequests.map((r) => r.id))
  const correlationRulesSetup = scopedCorrelationRules.filter((r) => setupRequestIdSet.has(r.fromRequestId))
  const correlationRulesMain = scopedCorrelationRules.filter((r) => !setupRequestIdSet.has(r.fromRequestId))

  const keycloakPrelude = isCollectionSequential && collectionUsesKeycloakLoginFlow ? keycloakExecutionHelperDefinition() : ''

  const runtimePrelude = needsModuleRuntime
    ? `${buildRuntimeObjectBlock('RUNTIME', correlationDebugOn)}${
        needsRuntimeBlock ? `\n\n${keycloakAuthPostBodyHelperDefinition()}` : ''
      }`
    : ''

  const resolveVarBody = needsModuleRuntime
    ? `  if (Object.prototype.hasOwnProperty.call(RUNTIME, name)) return RUNTIME[name];
${resolveVarEnvTail}`
    : `  const envMap = ENVIRONMENTS[ACTIVE_ENV] || {};
  if (Object.prototype.hasOwnProperty.call(envMap, name)) return envMap[name];
  if (Object.prototype.hasOwnProperty.call(COLLECTION_VARS, name)) return COLLECTION_VARS[name];
  if (Object.prototype.hasOwnProperty.call(PROJECT_VARS, name)) return PROJECT_VARS[name];
  if (Object.prototype.hasOwnProperty.call(SHARED, name)) return SHARED[name];
  return \`\${name}\`;`

  const setupJourney = usesK6SetupPhase
    ? buildSequentialDefaultBody(
        setupRequests,
        scenario?.thinkTimeMs ?? 0,
        correlationRulesSetup,
        scopedCorrelationRules,
        useJarSeq,
        correlationDebugOn,
        needsRuntimeBlock,
        'JMeter SetupThreadGroup (once per test; opaque cookies are not handed off — see comment above setup())',
        '__perfMixSetupRt',
        '__perfMixSetupRt',
      )
    : ''

  const mainJourney = usesK6SetupPhase
    ? buildSequentialDefaultBody(
        mainRequests,
        scenario?.thinkTimeMs ?? 0,
        correlationRulesMain,
        scopedCorrelationRules,
        useJarSeq,
        correlationDebugOn,
        needsRuntimeBlock,
        'Sequential main requests (JMeter ThreadGroup; per iteration)',
        'RUNTIME',
        'RUNTIME',
      )
    : ''

  const setupExportBlock = usesK6SetupPhase
    ? `// Requests marked setup (JMX SetupThreadGroup or UI) run once in k6 setup(). setup() cannot pass a live http.cookieJar() to VUs — merge setupRuntime into RUNTIME for bearer/header flows; opaque cookies may still differ from JMeter.
export function setup() {
${indentTextBlock(buildRuntimeObjectBlock('__perfMixSetupRt', correlationDebugOn), '  ')}

  function resolveVar(name) {
    if (Object.prototype.hasOwnProperty.call(__perfMixSetupRt, name)) return __perfMixSetupRt[name];
${resolveVarEnvTail}
  }
  function applyTemplate(input) {
    if (!input) return input;
    let s = String(input);
    s = s.replace(/%7B%7B([a-zA-Z0-9_\\-.]+)%7D%7D/gi, '{{$1}}');
    return s.replace(/{{\\s*([a-zA-Z0-9_\\-.]+)\\s*}}/g, (_, key) => String(resolveVar(key)));
  }
  const tmpl = (s) => applyTemplate(s);
${setupJourney}

  return { setupRuntime: __perfMixSetupRt };
}

`
    : ''

  const defaultFunctionBody = isCollectionSequential
    ? usesK6SetupPhase
      ? mainJourney
      : buildSequentialDefaultBody(
          requests,
          scenario?.thinkTimeMs ?? 0,
          scopedCorrelationRules,
          scopedCorrelationRules,
          useJarSeq,
          correlationDebugOn,
          needsRuntimeBlock,
          'Sequential journey',
          'RUNTIME',
          'RUNTIME',
        )
    : (() => {
        const lines: string[] = []
        lines.push('  // Dispatch by scenario (request test cases) or run all requests (default).')
        const caseBranches: string[] = []
        for (const req of requests) {
          const cases = req.testCases?.length ? req.testCases : []
          for (const tc of cases) {
            const scenarioKeyBranch =
              parallelScenarioKeys.tcKeyBySlot.get(testCaseSlotKey(req, tc)) ??
              toScenarioKey(`${req.folder}_${req.name}_${tc.name}_${req.id}_${tc.id}`)
            const call = buildHttpCall(req, 1).replaceAll('\n', '\n  ')
            caseBranches.push(
              `  if (scenarioName === ${JSON.stringify(scenarioKeyBranch)}) {\n  ${call}\n    sleep(${thinkTimeMsForK6(tc)} / 1000);\n    return;\n  }`,
            )
          }
          if (!cases.length) {
            const defaultKey =
              parallelScenarioKeys.defaultKeyByReqId.get(req.id) ??
              toScenarioKey(`${req.folder}_${req.name}_default_${req.id}`)
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
      })()

  const setupPhaseParallelWarn =
    !isCollectionSequential &&
    params.mode === 'collection' &&
    requests.some((r) => r.jmeterThreadGroupKind === 'setup')
      ? '// NOTE: This collection has setup-phase requests but export mode is parallel — k6 setup() is not emitted; setup requests are included like other parallel scenarios.\n\n'
      : ''

  return `${setupPhaseParallelWarn}/*
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
${perfMixCliEnvComment()}${keycloakPrelude ? `${keycloakPrelude}\n\n` : ''}${setupExportBlock ? `${setupExportBlock}\n` : ''}${runtimePrelude ? `${runtimePrelude}\n\n` : ''}// Resolution order: runtime (extracted) → environment → collection → project → global shared
function resolveVar(name) {
${resolveVarBody}
}

function applyTemplate(input) {
  if (!input) return input;
  let s = String(input);
  // Legacy imports: {{var}} was URL-encoded as %7B%7Bvar%7D%7D before substitution.
  s = s.replace(/%7B%7B([a-zA-Z0-9_\\-.]+)%7D%7D/gi, '{{$1}}');
  return s.replace(/{{\\s*([a-zA-Z0-9_\\-.]+)\\s*}}/g, (_, key) => String(resolveVar(key)));
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

export default function ${usesK6SetupPhase ? '(data)' : '()'} {
${usesK6SetupPhase ? '  Object.assign(RUNTIME, (data && data.setupRuntime) || {});\n' : ''}  // Lightweight variable + data-driven substitution (MVP).
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
${defaultFunctionBody}
}
`
}
