/**
 * HAR (HTTP Archive) → PerfMix Collection parser
 *
 * HAR 1.1 / 1.2 spec: https://w3c.github.io/web-performance/specs/HAR/Overview.html
 *
 * Features:
 *   - Reads all entries from log.entries[]
 *   - Converts headers, query strings, POST data
 *   - Optional: filter by domain, filter static assets
 *   - Groups entries into a single collection named after the first unique hostname
 *   - Strips default ignored headers (Sec-*, :authority, :method, :path, etc.)
 */

import type { Collection, RequestDefinition } from '../models/types'

function buildId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

// Headers that are controlled by the HTTP client / browser and should not be
// replayed verbatim in load test scripts.
const SKIP_HEADERS = new Set([
  ':method',
  ':path',
  ':scheme',
  ':authority',
  ':status',
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  'te',
  'trailers',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'sec-fetch-user',
])

// Extensions/MIME types that are static assets and usually not worth load testing
const STATIC_MIME_PREFIXES = [
  'image/',
  'font/',
  'video/',
  'audio/',
  'text/css',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
]

const STATIC_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp', '.tiff',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.css', '.js', '.map',
  '.mp4', '.webm', '.mp3', '.ogg',
  '.pdf', '.zip', '.gz',
]

function isStaticAsset(url: string, mimeType: string): boolean {
  const lower = url.toLowerCase().split('?')[0]
  if (STATIC_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true
  if (STATIC_MIME_PREFIXES.some((m) => mimeType.toLowerCase().startsWith(m))) return true
  return false
}

/** HAR entry types (minimal subset we care about) */
type HarHeader = { name: string; value: string }
type HarQueryParam = { name: string; value: string }
type HarPostData = {
  mimeType?: string
  text?: string
  params?: Array<{ name: string; value?: string }>
}
type HarRequest = {
  method: string
  url: string
  headers?: HarHeader[]
  queryString?: HarQueryParam[]
  postData?: HarPostData
}
type HarEntry = {
  startedDateTime?: string
  request: HarRequest
  response?: { status?: number; content?: { mimeType?: string } }
}
type HarLog = {
  version?: string
  entries?: HarEntry[]
}
type HarRoot = {
  log: HarLog
}

export type HarParseOptions = {
  /** Only include requests whose URL contains this domain string (optional) */
  domainFilter?: string
  /** Skip image/font/CSS/JS static assets */
  skipStaticAssets?: boolean
  /** Remove cookie/auth headers (Authorization, Cookie) */
  stripSensitiveHeaders?: boolean
  /** Deduplicate requests with identical method+url */
  deduplicateExact?: boolean
}

export type HarParseResult =
  | { ok: true; collection: Collection; warnings: string[]; totalEntries: number; includedEntries: number }
  | { ok: false; error: string }

export function parseHar(jsonText: string, opts: HarParseOptions = {}): HarParseResult {
  const warnings: string[] = []

  let har: HarRoot
  try {
    har = JSON.parse(jsonText) as HarRoot
  } catch {
    return { ok: false, error: 'Invalid JSON. Make sure the file is a valid .har file.' }
  }

  if (!har?.log?.entries) {
    return { ok: false, error: 'Not a valid HAR file — missing log.entries array.' }
  }

  const entries = har.log.entries
  const totalEntries = entries.length

  // --- Derive collection name from first URL's hostname ---
  let collectionName = 'Imported from HAR'
  for (const e of entries) {
    try {
      const hostname = new URL(e.request.url).hostname
      if (hostname) { collectionName = hostname; break }
    } catch { /* skip */ }
  }

  // --- Filter entries ---
  const sensitiveHeaders = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token'])

  const seenUrls = new Set<string>()
  const requests: RequestDefinition[] = []

  for (const entry of entries) {
    const req = entry.request
    if (!req?.url || !req?.method) continue

    // Domain filter
    if (opts.domainFilter) {
      try {
        const hostname = new URL(req.url).hostname
        if (!hostname.includes(opts.domainFilter)) continue
      } catch {
        continue
      }
    }

    // Static asset filter
    if (opts.skipStaticAssets !== false) {
      const responseMime = entry.response?.content?.mimeType ?? ''
      if (isStaticAsset(req.url, responseMime)) continue
    }

    // Deduplication
    if (opts.deduplicateExact !== false) {
      const key = `${req.method.toUpperCase()}:${req.url.split('?')[0]}`
      if (seenUrls.has(key)) continue
      seenUrls.add(key)
    }

    // --- Build headers ---
    const headers: Record<string, string> = {}
    for (const h of req.headers ?? []) {
      const lower = h.name.toLowerCase()
      if (SKIP_HEADERS.has(lower)) continue
      if (opts.stripSensitiveHeaders !== false && sensitiveHeaders.has(lower)) continue
      headers[h.name] = h.value
    }

    // --- Build query params ---
    const query: Record<string, string> = {}
    for (const q of req.queryString ?? []) {
      if (q.name) query[q.name] = q.value ?? ''
    }

    // --- Build body ---
    let bodyText = ''
    if (req.postData) {
      if (req.postData.text) {
        bodyText = req.postData.text
      } else if (req.postData.params?.length) {
        // form-encoded params
        const pairs = req.postData.params.map(
          (p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value ?? '')}`,
        )
        bodyText = pairs.join('&')
        // Set Content-Type if not already set
        if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
          headers['Content-Type'] = 'application/x-www-form-urlencoded'
        }
      }
    }

    // --- Derive friendly name ---
    let name = ''
    try {
      const u = new URL(req.url)
      const segments = u.pathname.split('/').filter(Boolean)
      name = segments.length > 0 ? `${req.method} /${segments.slice(-2).join('/')}` : `${req.method} /`
    } catch {
      name = `${req.method} ${req.url.slice(0, 60)}`
    }

    // --- Clean URL: remove query string (already captured in query) ---
    let cleanUrl = req.url
    try {
      const u = new URL(req.url)
      u.search = ''
      cleanUrl = u.toString()
    } catch { /* keep raw */ }

    // Normalize method
    const method = req.method.toUpperCase()
    const safeMethod = (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).includes(method as never)
      ? (method as RequestDefinition['method'])
      : 'GET'

    requests.push({
      id: buildId('req'),
      name,
      method: safeMethod,
      url: cleanUrl,
      query,
      headers,
      bodyText,
      testCases: [],
    })
  }

  const includedEntries = requests.length
  if (includedEntries === 0) {
    warnings.push('No requests matched after filtering. Try relaxing the domain filter or disabling static asset skipping.')
  }

  const collection: Collection = {
    id: buildId('col'),
    name: collectionName,
    requests,
  }

  return { ok: true, collection, warnings, totalEntries, includedEntries }
}
