import type { Collection, CorrelationRule, RequestDefinition, RequestTestCase } from '../models/types'
import { ensureCollectionK6LoadFields } from './k6LoadDefaults'

/** Legacy: collection only. */
export const PERF_MIX_COLLECTION_EXPORT_V1 = 1 as const
/** Adds optional `correlationRules` (scoped to collection requests). */
export const PERF_MIX_COLLECTION_EXPORT_V2 = 2 as const

export type PerfMixCollectionExport = {
  perfMixCollectionExport: typeof PERF_MIX_COLLECTION_EXPORT_V1 | typeof PERF_MIX_COLLECTION_EXPORT_V2
  collection: Collection
  correlationRules?: CorrelationRule[]
}

function buildId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

export function buildPerfMixCollectionExportJson(
  collection: Collection,
  correlationRules?: CorrelationRule[],
): string {
  const hasRules = correlationRules != null && correlationRules.length > 0
  const payload: PerfMixCollectionExport = {
    perfMixCollectionExport: hasRules ? PERF_MIX_COLLECTION_EXPORT_V2 : PERF_MIX_COLLECTION_EXPORT_V1,
    collection: structuredClone(collection),
    ...(hasRules ? { correlationRules: structuredClone(correlationRules) } : {}),
  }
  return JSON.stringify(payload, null, 2)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function remapRequest(r: RequestDefinition): RequestDefinition {
  const m = String(r.method).toUpperCase()
  const method = (m === 'GET' || m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE' ? m : 'GET') as RequestDefinition['method']
  return {
    ...r,
    method,
    id: buildId('req'),
    testCases: (r.testCases ?? []).map(
      (tc): RequestTestCase => ({
        ...tc,
        id: buildId('tc'),
      }),
    ),
    assertions: (r.assertions ?? []).map((a) => ({ ...a, id: buildId('assert') })),
  }
}

function normalizeImportedCorrelationRules(
  raw: unknown[],
  requestIdMap: Map<string, string>,
  validRequestIds: Set<string>,
): CorrelationRule[] {
  const out: CorrelationRule[] = []
  for (const row of raw) {
    if (!isRecord(row)) continue
    if (typeof row.variableName !== 'string' || !row.variableName.trim()) continue
    if (typeof row.fromRequestId !== 'string' || !row.fromRequestId.trim()) continue
    const mappedFrom = requestIdMap.get(row.fromRequestId.trim())
    if (!mappedFrom || !validRequestIds.has(mappedFrom)) continue
    const kind = row.kind
    const kindOk = kind === 'regex' || kind === 'jsonpath' ? kind : undefined
    const regexSource = row.regexSource
    const srcOk = regexSource === 'headers' || regexSource === 'body' ? regexSource : undefined
    const mirrors = Array.isArray(row.runtimeMirrorTo)
      ? row.runtimeMirrorTo.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      : undefined
    out.push({
      id: buildId('corr'),
      variableName: row.variableName.trim(),
      fromRequestId: mappedFrom,
      ...(kindOk ? { kind: kindOk } : {}),
      jsonPath: typeof row.jsonPath === 'string' ? row.jsonPath : '',
      ...(typeof row.regexPattern === 'string' ? { regexPattern: row.regexPattern } : {}),
      ...(typeof row.regexGroup === 'number' && Number.isFinite(row.regexGroup) ? { regexGroup: row.regexGroup } : {}),
      ...(srcOk ? { regexSource: srcOk } : {}),
      ...(mirrors?.length ? { runtimeMirrorTo: mirrors } : {}),
    })
  }
  return out
}

export function parsePerfMixCollectionImport(
  jsonText: string,
):
  | { ok: true; collection: Collection; correlationRules?: CorrelationRule[] }
  | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText) as unknown
  } catch {
    return { ok: false, error: 'Invalid JSON.' }
  }
  if (!isRecord(parsed)) return { ok: false, error: 'Root must be an object.' }
  const ver = parsed.perfMixCollectionExport
  if (ver !== PERF_MIX_COLLECTION_EXPORT_V1 && ver !== PERF_MIX_COLLECTION_EXPORT_V2) {
    return { ok: false, error: `Unsupported perfMixCollectionExport version: ${String(ver)}` }
  }
  const col = parsed.collection
  if (!isRecord(col)) return { ok: false, error: 'Missing collection object.' }
  if (typeof col.name !== 'string' || !col.name.trim()) return { ok: false, error: 'Collection must have a name.' }
  if (!Array.isArray(col.requests)) return { ok: false, error: 'Collection.requests must be an array.' }

  const requests = col.requests as RequestDefinition[]
  const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
  for (const r of requests) {
    if (!r || typeof r !== 'object') return { ok: false, error: 'Invalid request entry.' }
    if (typeof r.name !== 'string' || !r.method || !r.url) return { ok: false, error: 'Each request needs name, method, url.' }
    if (!methods.has(String(r.method).toUpperCase())) return { ok: false, error: `Invalid method on request "${r.name}".` }
  }

  const requestIdMap = new Map<string, string>()
  const remappedRequests = requests.map((r) => {
    const oldId = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : ''
    const nr = remapRequest({
      ...r,
      query: r.query ?? {},
      headers: r.headers ?? {},
      bodyText: r.bodyText ?? '',
      testCases: r.testCases ?? [],
    })
    if (oldId) requestIdMap.set(oldId, nr.id)
    return nr
  })
  const validRequestIds = new Set(remappedRequests.map((r) => r.id))

  const importedCorrelationRules =
    Array.isArray(parsed.correlationRules) && parsed.correlationRules.length
      ? normalizeImportedCorrelationRules(parsed.correlationRules as unknown[], requestIdMap, validRequestIds)
      : []

  const exec = col.k6CollectionExecution
  const hintsRaw = col.jmxImportHints
  const hints =
    hintsRaw && typeof hintsRaw === 'object' && hintsRaw !== null
      ? (hintsRaw as { useCookieJar?: boolean; correlationDebug?: boolean })
      : null
  const jmxHints =
    hints && (hints.useCookieJar || hints.correlationDebug)
      ? {
          ...(hints.useCookieJar ? { useCookieJar: true as const } : {}),
          ...(hints.correlationDebug ? { correlationDebug: true as const } : {}),
        }
      : null
  const collection: Collection = {
    id: buildId('col'),
    name: String(col.name).trim(),
    variables: isRecord(col.variables) ? (col.variables as Record<string, string>) : {},
    docs: typeof col.docs === 'string' ? col.docs : undefined,
    k6CollectionExecution: exec === 'parallel' || exec === 'sequential' ? exec : undefined,
    k6LoadVus: typeof col.k6LoadVus === 'number' && Number.isFinite(col.k6LoadVus) ? col.k6LoadVus : undefined,
    k6LoadDuration: typeof col.k6LoadDuration === 'string' ? col.k6LoadDuration : undefined,
    k6LoadRampUp: typeof col.k6LoadRampUp === 'string' ? col.k6LoadRampUp : undefined,
    ...(jmxHints ? { jmxImportHints: jmxHints } : {}),
    requests: remappedRequests,
  }

  const ensured = { ...collection, ...ensureCollectionK6LoadFields(collection) }
  if (importedCorrelationRules.length) {
    return { ok: true, collection: ensured, correlationRules: importedCorrelationRules }
  }
  return { ok: true, collection: ensured }
}
