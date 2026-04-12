import type { Collection, RequestDefinition } from '../models/types'
import { buildUrlWithQuery } from './httpSend'

function shSingleQuoted(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

/** Build a curl command for one request (bash-friendly single-quoted args). */
export function requestToCurl(req: RequestDefinition): string {
  const url = buildUrlWithQuery(req.url, req.query)
  const parts: string[] = ['curl']
  parts.push('--request', shSingleQuoted(req.method))
  parts.push('--url', shSingleQuoted(url))
  const headerEntries = Object.entries(req.headers ?? {}).filter(([k]) => k.trim())
  for (const [k, v] of headerEntries) {
    parts.push('--header', shSingleQuoted(`${k}: ${v}`))
  }
  const hasBody = !['GET', 'HEAD'].includes(req.method.toUpperCase()) && (req.bodyText ?? '').length > 0
  if (hasBody) {
    parts.push('--data-binary', shSingleQuoted(req.bodyText ?? ''))
  }
  return parts.join(' ')
}

export function collectionToCurlSh(collection: Collection): string {
  const chunks: string[] = [`# Collection: ${collection.name}`, '']
  for (const req of collection.requests) {
    chunks.push(`# --- ${req.name} ---`)
    chunks.push(requestToCurl(req))
    chunks.push('')
  }
  return chunks.join('\n').trimEnd() + '\n'
}
