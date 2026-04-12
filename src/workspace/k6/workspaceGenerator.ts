import type { Collection, Project, RequestDefinition } from '../../models/types'
import { buildK6Script } from '../../k6/generator'

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
    body: request.bodyText,
    testCases: request.testCases,
    assertions: request.assertions,
  }
}

export function buildWorkspaceK6Script(params: Params) {
  // MVP: generate from the active request only, but keep collection context in comments.
  const legacyRequest = mapRequestToLegacy(params.collection.name, params.request)

  return buildK6Script({
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
  })
}

export function buildWorkspaceCollectionK6Script(params: CollectionParams) {
  const legacyRequests = params.collection.requests.map((r) => mapRequestToLegacy(params.collection.name, r))
  const firstId = legacyRequests[0]?.id ?? 'req'

  return buildK6Script({
    mode: 'collection',
    selectedRequestId: firstId,
    requests: legacyRequests,
    scenarioName: `${params.project.name} / ${params.collection.name}`,
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
  })
}
