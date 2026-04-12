import type { Collection, RequestDefinition, RequestTestCase } from '../models/types'

export const PERF_MIX_COLLECTION_EXPORT_VERSION = 1 as const

export type PerfMixCollectionExport = {
  perfMixCollectionExport: typeof PERF_MIX_COLLECTION_EXPORT_VERSION
  collection: Collection
}

function buildId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

export function buildPerfMixCollectionExportJson(collection: Collection): string {
  const payload: PerfMixCollectionExport = {
    perfMixCollectionExport: PERF_MIX_COLLECTION_EXPORT_VERSION,
    collection: structuredClone(collection),
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

export function parsePerfMixCollectionImport(
  jsonText: string,
): { ok: true; collection: Collection } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText) as unknown
  } catch {
    return { ok: false, error: 'Invalid JSON.' }
  }
  if (!isRecord(parsed)) return { ok: false, error: 'Root must be an object.' }
  const ver = parsed.perfMixCollectionExport
  if (ver !== PERF_MIX_COLLECTION_EXPORT_VERSION) {
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

  const exec = col.k6CollectionExecution
  const collection: Collection = {
    id: buildId('col'),
    name: String(col.name).trim(),
    variables: isRecord(col.variables) ? (col.variables as Record<string, string>) : {},
    docs: typeof col.docs === 'string' ? col.docs : undefined,
    k6CollectionExecution: exec === 'parallel' || exec === 'sequential' ? exec : undefined,
    k6LoadVus: typeof col.k6LoadVus === 'number' && Number.isFinite(col.k6LoadVus) ? col.k6LoadVus : undefined,
    k6LoadDuration: typeof col.k6LoadDuration === 'string' ? col.k6LoadDuration : undefined,
    k6LoadRampUp: typeof col.k6LoadRampUp === 'string' ? col.k6LoadRampUp : undefined,
    requests: requests.map((r) => remapRequest({ ...r, query: r.query ?? {}, headers: r.headers ?? {}, bodyText: r.bodyText ?? '', testCases: r.testCases ?? [] })),
  }

  return { ok: true, collection }
}
