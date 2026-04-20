import { describe, expect, it } from 'vitest'
import type { Collection, CorrelationRule } from '../models/types'
import {
  PERF_MIX_COLLECTION_EXPORT_V1,
  PERF_MIX_COLLECTION_EXPORT_V2,
  buildPerfMixCollectionExportJson,
  parsePerfMixCollectionImport,
} from './collectionIo'

const minimalRequest = (id: string) => ({
  id,
  name: 'R',
  method: 'GET' as const,
  url: 'https://example.com',
  query: {},
  headers: {},
  bodyText: '',
  testCases: [],
})

describe('collectionIo', () => {
  it('exports v1 when no correlation rules passed', () => {
    const col: Collection = {
      id: 'col-old',
      name: 'MyCol',
      requests: [minimalRequest('req-old')],
      variables: { a: '1' },
    }
    const json = buildPerfMixCollectionExportJson(col)
    const root = JSON.parse(json) as { perfMixCollectionExport: number; correlationRules?: unknown }
    expect(root.perfMixCollectionExport).toBe(PERF_MIX_COLLECTION_EXPORT_V1)
    expect(root.correlationRules).toBeUndefined()
  })

  it('exports v2 and round-trips correlation rules with remapped request ids', () => {
    const col: Collection = {
      id: 'col-old',
      name: 'MyCol',
      requests: [minimalRequest('req-token')],
    }
    const rules: CorrelationRule[] = [
      {
        id: 'cr-old',
        variableName: 'accessToken',
        fromRequestId: 'req-token',
        kind: 'regex',
        jsonPath: '',
        regexPattern: '"(access_token)"\\s*:\\s*"([^"]+)"',
        regexGroup: 2,
        regexSource: 'body',
        runtimeMirrorTo: ['token'],
      },
    ]
    const json = buildPerfMixCollectionExportJson(col, rules)
    const root = JSON.parse(json) as { perfMixCollectionExport: number; correlationRules: CorrelationRule[] }
    expect(root.perfMixCollectionExport).toBe(PERF_MIX_COLLECTION_EXPORT_V2)
    expect(root.correlationRules).toHaveLength(1)
    expect(root.correlationRules[0].fromRequestId).toBe('req-token')

    const parsed = parsePerfMixCollectionImport(json)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.collection.name).toBe('MyCol')
    expect(parsed.collection.requests).toHaveLength(1)
    expect(parsed.collection.requests[0].id).not.toBe('req-token')
    expect(parsed.correlationRules).toHaveLength(1)
    expect(parsed.correlationRules![0].fromRequestId).toBe(parsed.collection.requests[0].id)
    expect(parsed.correlationRules![0].id).not.toBe('cr-old')
  })

  it('imports v1 files', () => {
    const col: Collection = { id: 'x', name: 'N', requests: [minimalRequest('r1')] }
    const json = JSON.stringify({ perfMixCollectionExport: PERF_MIX_COLLECTION_EXPORT_V1, collection: col })
    const parsed = parsePerfMixCollectionImport(json)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.correlationRules).toBeUndefined()
  })
})
