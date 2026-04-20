/**
 * OpenAPI 2.x (Swagger) + 3.x → PerfMix Collection parser
 *
 * Supports:
 *   - OpenAPI 3.0 / 3.1 (application/json, multipart, form, raw bodies)
 *   - Swagger 2.0 (consumes, in:body, in:formData parameters)
 *   - YAML and JSON input (via js-yaml)
 *   - $ref resolution for inline request body schemas (one level deep)
 *   - Path parameters substituted with {{paramName}} template variables
 *   - Query / header parameters added to the request
 *   - Server base URL extraction (first server entry)
 */

import jsYaml from 'js-yaml'
import type { Collection, RequestDefinition } from '../models/types'

function buildId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

// ── Minimal OpenAPI type stubs ────────────────────────────────────────────────

type OaParameter = {
  name: string
  in: 'query' | 'header' | 'path' | 'cookie' | 'body' | 'formData'
  required?: boolean
  schema?: { type?: string; example?: unknown; default?: unknown }
  example?: unknown
  type?: string // Swagger 2.x
}

type OaMediaObject = {
  schema?: {
    type?: string
    properties?: Record<string, { type?: string; example?: unknown; default?: unknown }>
    example?: unknown
    examples?: unknown
  }
  example?: unknown
}

type OaRequestBody = {
  required?: boolean
  content?: Record<string, OaMediaObject>
}

type OaOperation = {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  parameters?: OaParameter[]
  requestBody?: OaRequestBody | { $ref: string }
  consumes?: string[] // Swagger 2.x
}

type OaPathItem = {
  parameters?: OaParameter[]
  get?: OaOperation
  post?: OaOperation
  put?: OaOperation
  patch?: OaOperation
  delete?: OaOperation
  head?: OaOperation
  options?: OaOperation
}

type OaServer = { url: string; description?: string }

type OaDoc = {
  swagger?: string          // '2.0'
  openapi?: string          // '3.0.x' | '3.1.x'
  info?: { title?: string; version?: string }
  host?: string             // Swagger 2.x
  basePath?: string         // Swagger 2.x
  schemes?: string[]        // Swagger 2.x
  servers?: OaServer[]      // OpenAPI 3.x
  paths?: Record<string, OaPathItem>
  components?: {
    requestBodies?: Record<string, OaRequestBody>
    schemas?: Record<string, unknown>
  }
  definitions?: Record<string, unknown> // Swagger 2.x
}

const SUPPORTED_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const
type HttpMethod = (typeof SUPPORTED_METHODS)[number]

// ── Base URL resolution ───────────────────────────────────────────────────────

function resolveBaseUrl(doc: OaDoc): string {
  // OpenAPI 3.x
  if (doc.servers?.length) {
    const first = doc.servers[0].url
    // Relative server URLs (e.g. '/api/v1') — return as-is; user fills in host
    return first
  }
  // Swagger 2.x
  if (doc.host) {
    const scheme = doc.schemes?.[0] ?? 'https'
    const base = doc.basePath ?? ''
    return `${scheme}://${doc.host}${base}`
  }
  return ''
}

// ── $ref resolution (one level) ───────────────────────────────────────────────

function resolveRef(doc: OaDoc, ref: string): OaRequestBody | null {
  // e.g. '#/components/requestBodies/Pet' or '#/definitions/Pet'
  if (!ref.startsWith('#/')) return null
  const parts = ref.slice(2).split('/')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = doc
  for (const part of parts) {
    if (node == null || typeof node !== 'object') return null
    node = node[part]
  }
  return node as OaRequestBody ?? null
}

// ── Example value → string ────────────────────────────────────────────────────

function exampleToString(val: unknown): string {
  if (val == null) return ''
  if (typeof val === 'string') return val
  return JSON.stringify(val)
}

// ── Build a placeholder body for a given content type ─────────────────────────

function buildBodyFromMedia(
  contentType: string,
  media: OaMediaObject,
  _doc: OaDoc,
): string {
  const ct = contentType.toLowerCase()

  // If there's a top-level example use that
  if (media.example != null) return exampleToString(media.example)

  const schema = media.schema
  if (!schema) return ''

  if (schema.example != null) return exampleToString(schema.example)

  if (ct.includes('application/json') || ct.includes('text/json')) {
    // Build a minimal JSON object from properties
    if (schema.type === 'object' && schema.properties) {
      const obj: Record<string, unknown> = {}
      for (const [key, prop] of Object.entries(schema.properties)) {
        obj[key] = prop.example ?? prop.default ?? placeholderForType(prop.type)
      }
      return JSON.stringify(obj, null, 2)
    }
    return ''
  }

  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    if (schema.type === 'object' && schema.properties) {
      return Object.entries(schema.properties)
        .map(([k, p]) => `${encodeURIComponent(k)}=${encodeURIComponent(exampleToString(p.example ?? p.default ?? ''))}`)
        .join('&')
    }
    return ''
  }

  return ''
}

function placeholderForType(type?: string): unknown {
  switch (type) {
    case 'integer':
    case 'number': return 0
    case 'boolean': return false
    case 'array': return []
    default: return ''
  }
}

// ── Swagger 2.x body from parameters ─────────────────────────────────────────

function buildSwagger2Body(params: OaParameter[], consumes: string[]): { body: string; contentType: string } {
  const bodyParam = params.find((p) => p.in === 'body')
  const formParams = params.filter((p) => p.in === 'formData')
  const ct = consumes[0] ?? 'application/json'

  if (bodyParam) {
    // Use example from schema if available
    const ex = bodyParam.schema?.example
    return { body: ex != null ? exampleToString(ex) : '', contentType: ct }
  }

  if (formParams.length > 0) {
    const body = formParams
      .map((p) => `${encodeURIComponent(p.name)}=`)
      .join('&')
    return { body, contentType: 'application/x-www-form-urlencoded' }
  }

  return { body: '', contentType: ct }
}

// ── Derive a request name ─────────────────────────────────────────────────────

function deriveName(method: string, path: string, op: OaOperation): string {
  if (op.summary?.trim()) return op.summary.trim()
  if (op.operationId?.trim()) {
    // camelCase → words
    return op.operationId.trim().replace(/([a-z])([A-Z])/g, '$1 $2')
  }
  // Fallback: METHOD /path/segments
  return `${method.toUpperCase()} ${path}`
}

// ── Convert one operation to a RequestDefinition ──────────────────────────────

function operationToRequest(
  method: string,
  path: string,
  op: OaOperation,
  pathItem: OaPathItem,
  baseUrl: string,
  doc: OaDoc,
  isSwagger2: boolean,
): RequestDefinition {
  const name = deriveName(method, path, op)

  // Merge path-level + operation-level parameters (operation takes precedence)
  const pathParams = pathItem.parameters ?? []
  const opParams = op.parameters ?? []
  const paramMap = new Map<string, OaParameter>()
  for (const p of [...pathParams, ...opParams]) paramMap.set(`${p.in}:${p.name}`, p)
  const allParams = Array.from(paramMap.values())

  // Substitute path params with {{var}} templates
  let resolvedPath = path
  for (const p of allParams.filter((p) => p.in === 'path')) {
    resolvedPath = resolvedPath.replace(`{${p.name}}`, `{{${p.name}}}`)
  }

  const url = baseUrl ? `${baseUrl.replace(/\/$/, '')}${resolvedPath}` : resolvedPath

  // Query params
  const query: Record<string, string> = {}
  for (const p of allParams.filter((p) => p.in === 'query')) {
    const val = p.example ?? p.schema?.example ?? p.schema?.default ?? ''
    query[p.name] = exampleToString(val)
  }

  // Headers
  const headers: Record<string, string> = {}
  for (const p of allParams.filter((p) => p.in === 'header')) {
    headers[p.name] = exampleToString(p.example ?? p.schema?.example ?? '')
  }

  // Body
  let bodyText = ''

  if (isSwagger2) {
    const consumes = op.consumes ?? (doc as OaDoc & { consumes?: string[] }).consumes ?? []
    if (['post', 'put', 'patch'].includes(method)) {
      const { body, contentType } = buildSwagger2Body(allParams, consumes)
      bodyText = body
      if (contentType && !headers['Content-Type']) headers['Content-Type'] = contentType
    }
  } else {
    // OpenAPI 3.x
    let reqBody: OaRequestBody | null = null
    if (op.requestBody) {
      if ('$ref' in op.requestBody) {
        reqBody = resolveRef(doc, (op.requestBody as { $ref: string }).$ref)
      } else {
        reqBody = op.requestBody as OaRequestBody
      }
    }

    if (reqBody?.content) {
      // Prefer JSON, then form, then first available
      const preferredOrder = [
        'application/json',
        'application/x-www-form-urlencoded',
        'multipart/form-data',
        'text/plain',
      ]
      let chosenCt: string | null = null
      for (const ct of preferredOrder) {
        if (reqBody.content[ct]) { chosenCt = ct; break }
      }
      if (!chosenCt) chosenCt = Object.keys(reqBody.content)[0] ?? null

      if (chosenCt && reqBody.content[chosenCt]) {
        bodyText = buildBodyFromMedia(chosenCt, reqBody.content[chosenCt], doc)
        if (!headers['Content-Type']) headers['Content-Type'] = chosenCt
      }
    }
  }

  const safeMethod = method.toUpperCase() as RequestDefinition['method']

  return {
    id: buildId('req'),
    name,
    method: (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).includes(safeMethod as never)
      ? safeMethod
      : 'GET',
    url,
    query,
    headers,
    bodyText,
    testCases: [],
    docs: op.description?.trim() || op.summary?.trim() || '',
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export type OpenApiParseResult =
  | { ok: true; collection: Collection; warnings: string[]; specVersion: string }
  | { ok: false; error: string }

export function parseOpenApi(input: string): OpenApiParseResult {
  const warnings: string[] = []

  // Parse YAML or JSON
  let doc: OaDoc
  try {
    // Try JSON first (faster); fall back to YAML
    if (input.trimStart().startsWith('{') || input.trimStart().startsWith('[')) {
      doc = JSON.parse(input) as OaDoc
    } else {
      doc = jsYaml.load(input) as OaDoc
    }
  } catch (err) {
    return { ok: false, error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}` }
  }

  if (!doc || typeof doc !== 'object') {
    return { ok: false, error: 'Input did not produce a valid object. Check the file format.' }
  }

  // Detect version
  const isSwagger2 = typeof doc.swagger === 'string' && doc.swagger.startsWith('2')
  const isOa3 = typeof doc.openapi === 'string' && (doc.openapi.startsWith('3.0') || doc.openapi.startsWith('3.1'))
  const specVersion = doc.openapi ?? doc.swagger ?? 'unknown'

  if (!isSwagger2 && !isOa3) {
    warnings.push(`Unrecognized spec version "${specVersion}". Attempting parse anyway.`)
  }

  if (!doc.paths || Object.keys(doc.paths).length === 0) {
    return { ok: false, error: 'No paths found in the spec. Make sure this is an OpenAPI/Swagger file.' }
  }

  const baseUrl = resolveBaseUrl(doc)
  if (!baseUrl) {
    warnings.push('No server/host found — URLs will be relative paths. Set base URL in environment variables.')
  }

  const collectionName = doc.info?.title?.trim() || 'Imported from OpenAPI'
  const requests: RequestDefinition[] = []

  for (const [path, pathItem] of Object.entries(doc.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue

    for (const method of SUPPORTED_METHODS) {
      const op = pathItem[method as HttpMethod] as OaOperation | undefined
      if (!op) continue

      try {
        const req = operationToRequest(method, path, op, pathItem, baseUrl, doc, isSwagger2)
        requests.push(req)
      } catch (err) {
        warnings.push(`Skipped ${method.toUpperCase()} ${path}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  if (requests.length === 0) {
    return { ok: false, error: 'No HTTP operations found in the spec paths.' }
  }

  const collection: Collection = {
    id: buildId('col'),
    name: collectionName,
    requests,
  }

  return { ok: true, collection, warnings, specVersion }
}
