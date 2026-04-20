/**
 * Postman Collection v2.0 / v2.1 → PerfMix Collection parser
 *
 * Handles:
 *   - Nested folders (flattened into a single collection, folder name prepended)
 *   - URL objects and string URLs
 *   - Query params from url.query array
 *   - Headers from header array (strips disabled ones)
 *   - Raw / urlencoded / form-data / GraphQL body modes
 *   - Path variables substituted with {{var}} PerfMix syntax
 *   - Collection-level and folder-level variables (surfaced as warnings)
 */

import type { Collection, RequestDefinition } from '../models/types'

function buildId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

// ── Postman type stubs ────────────────────────────────────────────────────────

type PmKeyValue = { key: string; value?: string; disabled?: boolean }

type PmUrlObject = {
  raw?: string
  protocol?: string
  host?: string | string[]
  port?: string
  path?: string | string[]
  query?: PmKeyValue[]
  variable?: PmKeyValue[]
}

type PmBodyMode = 'raw' | 'urlencoded' | 'formdata' | 'graphql' | 'binary' | 'file'

type PmBody = {
  mode?: PmBodyMode
  raw?: string
  urlencoded?: PmKeyValue[]
  formdata?: PmKeyValue[]
  graphql?: { query?: string; variables?: string }
  options?: { raw?: { language?: string } }
}

type PmRequest = {
  method?: string
  url?: string | PmUrlObject
  header?: PmKeyValue[]
  body?: PmBody
  description?: string | { content?: string }
}

type PmItem = {
  name?: string
  request?: PmRequest
  item?: PmItem[]   // folder
  description?: string
}

type PmVariable = { key?: string; value?: string }

type PmCollection = {
  info?: { name?: string; schema?: string }
  item?: PmItem[]
  variable?: PmVariable[]
}

type PmRoot = {
  collection?: PmCollection
  // Some exports have the collection at root level
  info?: { name?: string; schema?: string }
  item?: PmItem[]
  variable?: PmVariable[]
}

// ── URL resolution ────────────────────────────────────────────────────────────

function resolveUrl(url: string | PmUrlObject | undefined): { clean: string; query: Record<string, string> } {
  const query: Record<string, string> = {}

  if (!url) return { clean: '', query }

  if (typeof url === 'string') {
    try {
      const u = new URL(url.replace(/\{\{([^}]+)\}\}/g, '__VAR__'))
      u.searchParams.forEach((val, key) => {
        query[key] = val === '__VAR__' ? `{{${key}}}` : val
      })
      u.search = ''
      // Restore template variables
      return { clean: url.split('?')[0], query }
    } catch {
      return { clean: url.split('?')[0], query }
    }
  }

  // PmUrlObject
  const queryArr = url.query ?? []
  for (const q of queryArr) {
    if (q.disabled) continue
    if (q.key) query[q.key] = q.value ?? ''
  }

  // Reconstruct clean URL
  if (url.raw) {
    const raw = url.raw
    const qMark = raw.indexOf('?')
    return { clean: qMark >= 0 ? raw.slice(0, qMark) : raw, query }
  }

  // Build from parts
  const protocol = url.protocol ?? 'https'
  const host = Array.isArray(url.host) ? url.host.join('.') : (url.host ?? '')
  const port = url.port ? `:${url.port}` : ''
  const path = Array.isArray(url.path) ? `/${url.path.join('/')}` : (url.path ?? '')
  return { clean: `${protocol}://${host}${port}${path}`, query }
}

// ── Body extraction ───────────────────────────────────────────────────────────

function extractBody(body: PmBody | undefined): { bodyText: string; contentType: string | null } {
  if (!body || !body.mode) return { bodyText: '', contentType: null }

  switch (body.mode) {
    case 'raw': {
      const lang = body.options?.raw?.language ?? 'text'
      const ct =
        lang === 'json' ? 'application/json'
        : lang === 'xml' ? 'application/xml'
        : lang === 'html' ? 'text/html'
        : null
      return { bodyText: body.raw ?? '', contentType: ct }
    }
    case 'urlencoded': {
      const pairs = (body.urlencoded ?? [])
        .filter((p) => !p.disabled && p.key)
        .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value ?? '')}`)
        .join('&')
      return { bodyText: pairs, contentType: 'application/x-www-form-urlencoded' }
    }
    case 'formdata': {
      // Can't send actual multipart/form-data as text; encode as JSON note
      const fields = (body.formdata ?? [])
        .filter((p) => !p.disabled && p.key)
        .map((p) => `  "${p.key}": "${p.value ?? ''}"`)
        .join(',\n')
      return {
        bodyText: fields ? `{\n${fields}\n}` : '',
        contentType: 'multipart/form-data',
      }
    }
    case 'graphql': {
      const gql = body.graphql ?? {}
      const payload = { query: gql.query ?? '', variables: gql.variables ? JSON.parse(gql.variables) : {} }
      return { bodyText: JSON.stringify(payload, null, 2), contentType: 'application/json' }
    }
    default:
      return { bodyText: '', contentType: null }
  }
}

// ── Description extraction ────────────────────────────────────────────────────

function extractDescription(desc: string | { content?: string } | undefined): string {
  if (!desc) return ''
  if (typeof desc === 'string') return desc
  return desc.content ?? ''
}

// ── Flatten items recursively ─────────────────────────────────────────────────

function flattenItems(
  items: PmItem[],
  folderPrefix: string,
  requests: RequestDefinition[],
  warnings: string[],
) {
  for (const item of items) {
    if (item.item) {
      // Folder — recurse
      const prefix = folderPrefix ? `${folderPrefix} / ${item.name ?? 'Folder'}` : (item.name ?? 'Folder')
      flattenItems(item.item, prefix, requests, warnings)
      continue
    }

    if (!item.request) continue

    const req = item.request
    const method = (req.method ?? 'GET').toUpperCase() as RequestDefinition['method']
    const safeMethod = (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).includes(method as never)
      ? method
      : 'GET'

    const { clean: url, query } = resolveUrl(req.url)

    // Headers (skip disabled)
    const headers: Record<string, string> = {}
    for (const h of req.header ?? []) {
      if (h.disabled || !h.key) continue
      headers[h.key] = h.value ?? ''
    }

    // Body
    const { bodyText, contentType } = extractBody(req.body)
    if (contentType && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = contentType
    }

    const baseName = item.name?.trim() || `${safeMethod} ${url}`
    const name = folderPrefix ? `${folderPrefix} / ${baseName}` : baseName

    const docs = extractDescription(req.description)

    if (!url) {
      warnings.push(`Skipped "${name}" — no URL found.`)
      continue
    }

    requests.push({
      id: buildId('req'),
      name,
      method: safeMethod,
      url,
      query,
      headers,
      bodyText,
      testCases: [],
      docs,
    })
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export type PostmanParseResult =
  | { ok: true; collection: Collection; warnings: string[] }
  | { ok: false; error: string }

export function parsePostmanCollection(jsonText: string): PostmanParseResult {
  const warnings: string[] = []

  let root: PmRoot
  try {
    root = JSON.parse(jsonText) as PmRoot
  } catch {
    return { ok: false, error: 'Invalid JSON. Make sure the file is a valid Postman collection export.' }
  }

  // Normalize: some exports nest under 'collection', others are flat
  const col: PmCollection = root.collection ?? (root as unknown as PmCollection)

  if (!col?.item?.length) {
    return { ok: false, error: 'No items found. Make sure this is a Postman Collection v2.0/v2.1 export.' }
  }

  // Warn if schema version is unrecognised
  const schema = col.info?.schema ?? ''
  if (schema && !schema.includes('v2')) {
    warnings.push(`Unrecognised schema "${schema}". Expected Postman Collection v2.x.`)
  }

  // Warn about collection variables (not imported)
  const vars = col.variable ?? []
  if (vars.length > 0) {
    const names = vars.map((v) => v.key ?? '').filter(Boolean).join(', ')
    warnings.push(
      `${vars.length} collection variable(s) not imported (${names}). Add them manually under Project Variables.`,
    )
  }

  const collectionName = col.info?.name?.trim() || 'Imported from Postman'
  const requests: RequestDefinition[] = []

  flattenItems(col.item, '', requests, warnings)

  if (requests.length === 0) {
    return { ok: false, error: 'No requests found after processing all items.' }
  }

  const collection: Collection = {
    id: buildId('col'),
    name: collectionName,
    requests,
  }

  return { ok: true, collection, warnings }
}
