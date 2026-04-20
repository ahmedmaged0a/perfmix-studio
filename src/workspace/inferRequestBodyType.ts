import type { BodyType, RequestDefinition } from '../models/types'

function getContentType(headers: Record<string, string> | undefined): string | null {
  if (!headers) return null
  const pair = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')
  return pair ? pair[1].trim().toLowerCase() : null
}

function mapContentTypeToBodyType(ct: string | null): BodyType | null {
  if (!ct) return null
  if (ct.includes('multipart/form-data')) return 'form-data'
  if (ct.includes('application/x-www-form-urlencoded')) return 'x-www-form-urlencoded'
  if (ct.includes('application/json') || ct.includes('+json')) return 'json'
  if (ct.includes('application/xml') || ct.includes('text/xml')) return 'xml'
  if (ct.includes('text/plain')) return 'text'
  if (ct.includes('application/graphql')) return 'graphql'
  if (ct.includes('application/msgpack') || ct.includes('application/x-msgpack')) return 'msgpack'
  return null
}

function looksLikeJson(s: string): boolean {
  const t = s.trim()
  if (!t || (t[0] !== '{' && t[0] !== '[')) return false
  try {
    JSON.parse(t)
    return true
  } catch {
    return false
  }
}

/**
 * Best guess at which body-type chip "owns" stored payload, for UI hints when `bodyType`
 * is missing, `none`, or the editor would otherwise hide content (e.g. JMX import).
 */
export function inferStoredPayloadBodyType(req: RequestDefinition): BodyType | null {
  const text = (req.bodyText ?? '').trim()
  const form = req.bodyFormData ?? {}
  const formHasValues = Object.values(form).some((v) => String(v ?? '').trim().length > 0)

  if (formHasValues && !text) {
    const ct = getContentType(req.headers)
    if (ct?.includes('multipart/form-data')) return 'form-data'
    if (ct?.includes('application/x-www-form-urlencoded')) return 'x-www-form-urlencoded'
    return 'form-data'
  }

  if (!text) return null

  const ct = getContentType(req.headers)
  const fromCt = mapContentTypeToBodyType(ct)
  if (fromCt) return fromCt

  if (looksLikeJson(text)) return 'json'
  const t = text.trimStart()
  if (t.startsWith('<?xml') || (t.startsWith('<') && !t.startsWith('<!'))) return 'xml'
  if (text.includes('=') && /[^=]=/.test(text) && (text.includes('&') || text.includes('='))) {
    return 'x-www-form-urlencoded'
  }
  return 'text'
}

/** Import helpers: infer `bodyType` from headers + body string without a full request object. */
export function inferBodyTypeFromHeadersAndText(
  headers: Record<string, string>,
  bodyText: string,
): BodyType | undefined {
  const r = inferStoredPayloadBodyType({
    id: '',
    name: '',
    method: 'POST',
    url: '',
    query: {},
    headers,
    bodyText,
    testCases: [],
  })
  return r ?? undefined
}
