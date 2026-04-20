import type { Collection, Project, RequestDefinition } from '../../models/types'
import { buildK6Script } from '../../k6/generator'
import { ensureCollectionK6LoadFields } from '../k6LoadDefaults'
import { serializeUrlEncodedFormForExport } from '../resolveWorkspaceTemplates'

type CollectionParams = {
  project: Project
  collection: Collection
  activeEnvironment: string
  envVariables: Record<string, Record<string, string>>
  sharedVariables: Record<string, string>
  csvRows: string[]
  runPurpose: 'performance' | 'smoke'
}

type Params = {
  project: Project
  collection: Collection
  request: RequestDefinition
  activeEnvironment: string
  envVariables: Record<string, Record<string, string>>
  sharedVariables: Record<string, string>
  csvRows: string[]
  runPurpose: 'performance' | 'smoke'
}

function headersToText(headers: Record<string, string>) {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

function mapRequestToLegacy(collectionName: string, request: RequestDefinition) {
  return {
    id: request.id,
    folder: collectionName,
    name: request.name,
    method: request.method,
    url: request.url,
    headers: headersToText(request.headers),
    body: serializeUrlEncodedFormForExport(request) ?? request.bodyText ?? '',
    testCases: request.testCases,
    assertions: request.assertions,
    excludeFromAggregateReport: request.excludeFromAggregateReport,
    jmeterThreadGroupKind: request.jmeterThreadGroupKind,
  }
}

function correlationRulesForCollection(project: Project, collection: Collection) {
  const ids = new Set(collection.requests.map((r) => r.id))
  return (project.correlationRules ?? []).filter((r) => ids.has(r.fromRequestId))
}

function prependJsr223TodoHeader(requests: RequestDefinition[], out: string): string {
  const lines = requests
    .filter((r) => (r.jmeterJsr223PostProcessors?.length ?? 0) > 0)
    .map(
      (r) =>
        `// JMX JSR223 PostProcessor on "${r.name.replace(/\*\//g, '')}" — not translated to k6; mirror with extractors + RUNTIME or post-response logic.`,
    )
  if (!lines.length) return out
  return `${lines.join('\n')}\n\n${out}`
}

export function buildWorkspaceK6Script(params: Params) {
  // MVP: generate from the active request only, but keep collection context in comments.
  const legacyRequest = mapRequestToLegacy(params.collection.name, params.request)

  const correlationRules = (params.project.correlationRules ?? []).filter(
    (r) => r.fromRequestId === params.request.id,
  )

  const body = buildK6Script({
    mode: 'single',
    selectedRequestId: params.request.id,
    requests: [legacyRequest],
    scenarioName: `${params.project.name} / ${params.collection.name} / ${params.request.name}`,
    vus: 1,
    duration: '1m',
    thresholds: [],
    scenarios: [],
    activeEnvironment: params.activeEnvironment,
    envVariables: params.envVariables,
    sharedVariables: params.sharedVariables,
    collectionVariables: params.collection.variables ?? {},
    projectVariables: params.project.variables ?? {},
    dataCsv: params.csvRows.join('\n'),
    runPurpose: params.runPurpose,
    correlationRules,
    useCookieJar: params.collection.jmxImportHints?.useCookieJar,
  })
  return prependJsr223TodoHeader([params.request], body)
}

export function buildWorkspaceCollectionK6Script(params: CollectionParams) {
  const legacyRequests = params.collection.requests.map((r) => mapRequestToLegacy(params.collection.name, r))
  const firstId = legacyRequests[0]?.id ?? 'req'
  const correlationRules = correlationRulesForCollection(params.project, params.collection)
  const load = ensureCollectionK6LoadFields(params.collection)

  const body = buildK6Script({
    mode: 'collection',
    selectedRequestId: firstId,
    requests: legacyRequests,
    scenarioName: `${params.project.name} / ${params.collection.name}`,
    vus: load.k6LoadVus,
    duration: load.k6LoadDuration,
    thresholds: [],
    scenarios: [],
    activeEnvironment: params.activeEnvironment,
    envVariables: params.envVariables,
    sharedVariables: params.sharedVariables,
    collectionVariables: params.collection.variables ?? {},
    projectVariables: params.project.variables ?? {},
    dataCsv: params.csvRows.join('\n'),
    runPurpose: params.runPurpose,
    collectionExecution: params.collection.k6CollectionExecution ?? 'parallel',
    collectionLoadVus: load.k6LoadVus,
    collectionLoadDuration: load.k6LoadDuration,
    collectionLoadRampUp: load.k6LoadRampUp,
    correlationRules,
    useCookieJar: params.collection.jmxImportHints?.useCookieJar,
    correlationDebug: params.collection.jmxImportHints?.correlationDebug,
  })
  return prependJsr223TodoHeader(params.collection.requests, body)
}
