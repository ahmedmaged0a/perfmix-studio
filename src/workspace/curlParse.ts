import type { RequestDefinition } from '../models/types'

const GENERIC_HEADERS = new Set(
  [
    'user-agent',
    'accept-encoding',
    'connection',
    'host',
    'content-length',
    'sec-fetch-mode',
    'sec-fetch-site',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
    'pragma',
    'cache-control',
  ].map((s) => s.toLowerCase()),
)

export type ParsedCurl = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  headers: Record<string, string>
  body: string
}

export type ParseCurlResult = { ok: true; value: ParsedCurl } | { ok: false; error: string }

/** Shell-like argv tokenization (supports `'` `"` and `\`). */
export function tokenizeCurlLine(input: string): string[] {
  const s = input.trim().replace(/^curl\s+/i, '')
  const out: string[] = []
  let i = 0
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i += 1
    if (i >= s.length) break
    if (s[i] === "'") {
      i += 1
      let chunk = ''
      while (i < s.length && s[i] !== "'") {
        if (s[i] === '\\' && i + 1 < s.length) {
          chunk += s[i + 1]
          i += 2
        } else {
          chunk += s[i]
          i += 1
        }
      }
      if (s[i] !== "'") return out.length ? out : []
      i += 1
      out.push(chunk)
      continue
    }
    if (s[i] === '"') {
      i += 1
      let chunk = ''
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length) {
          chunk += s[i + 1]
          i += 2
        } else {
          chunk += s[i]
          i += 1
        }
      }
      if (s[i] !== '"') return out
      i += 1
      out.push(chunk)
      continue
    }
    let start = i
    while (i < s.length && !/\s/.test(s[i])) i += 1
    out.push(s.slice(start, i))
  }
  return out
}

function nextValue(argv: string[], idx: number): { val: string; next: number } | null {
  if (idx >= argv.length) return null
  return { val: argv[idx], next: idx + 1 }
}

export function parseCurlCommand(raw: string, options: { ignoreGenericHeaders: boolean }): ParseCurlResult {
  const text = raw
    .replace(/\r\n/g, '\n')
    .replace(/\\\n/g, ' ')
    .replace(/\n+/g, ' ')
    .trim()
  if (!text) return { ok: false, error: 'Paste a cURL command.' }
  if (!/^curl\b/i.test(text)) return { ok: false, error: 'Command must start with curl.' }

  const argv = tokenizeCurlLine(text)
  if (!argv.length) return { ok: false, error: 'Could not parse cURL arguments.' }

  let method: ParsedCurl['method'] = 'GET'
  let url = ''
  const headers: Record<string, string> = {}
  const dataPieces: string[] = []

  let i = 0
  while (i < argv.length) {
    const a = argv[i]
    const al = a.toLowerCase()
    if (al === '-x' || al === '--request') {
      const nv = nextValue(argv, i + 1)
      if (!nv) return { ok: false, error: 'Missing value for -X / --request.' }
      const m = nv.val.toUpperCase()
      if (m === 'GET' || m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') method = m as ParsedCurl['method']
      else return { ok: false, error: `Unsupported method: ${nv.val}` }
      i = nv.next
      continue
    }
    if (al === '--url') {
      const nv = nextValue(argv, i + 1)
      if (!nv) return { ok: false, error: 'Missing value for --url.' }
      url = nv.val
      i = nv.next
      continue
    }
    if (al === '-h' || al === '--header') {
      const nv = nextValue(argv, i + 1)
      if (!nv) return { ok: false, error: 'Missing value for -H / --header.' }
      const line = nv.val
      const colon = line.indexOf(':')
      if (colon === -1) return { ok: false, error: `Bad header (expected Name: value): ${line}` }
      const hk = line.slice(0, colon).trim()
      const hv = line.slice(colon + 1).trim()
      if (hk) headers[hk] = hv
      i = nv.next
      continue
    }
    if (
      al === '-d' ||
      al === '--data' ||
      al === '--data-binary' ||
      al === '--data-raw' ||
      al === '--data-urlencode'
    ) {
      const nv = nextValue(argv, i + 1)
      if (!nv) return { ok: false, error: `Missing value for ${a}.` }
      if (nv.val.startsWith('@')) {
        return { ok: false, error: 'Body from file (@path) is not supported yet. Paste raw body instead.' }
      }
      dataPieces.push(nv.val)
      i = nv.next
      continue
    }
    if (al === '-b' || al === '--cookie') {
      const nv = nextValue(argv, i + 1)
      if (!nv) return { ok: false, error: 'Missing value for --cookie.' }
      headers.Cookie = nv.val
      i = nv.next
      continue
    }
    if (al === '-u' || al === '--user') {
      const nv = nextValue(argv, i + 1)
      if (!nv) return { ok: false, error: 'Missing value for --user.' }
      if (typeof btoa === 'function') {
        headers.Authorization = `Basic ${btoa(nv.val)}`
      }
      i = nv.next
      continue
    }
    if (al === '-g' || al === '--globoff') {
      i += 1
      continue
    }
    if (al.startsWith('-')) {
      return { ok: false, error: `Unsupported flag: ${a}` }
    }
    if (!url) {
      url = a
      i += 1
      continue
    }
    return { ok: false, error: `Unexpected token: ${a}` }
  }

  if (!url) return { ok: false, error: 'No URL found (add --url or a bare URL).' }

  let finalHeaders = { ...headers }
  if (options.ignoreGenericHeaders) {
    const next: Record<string, string> = {}
    for (const [k, v] of Object.entries(finalHeaders)) {
      if (GENERIC_HEADERS.has(k.toLowerCase())) continue
      next[k] = v
    }
    finalHeaders = next
  }

  const body = dataPieces.join('&')
  if (body && method === 'GET') {
    // curl often uses GET with -d meaning POST in some versions; if body present, default POST
    method = 'POST'
  }
  if (body && !Object.keys(finalHeaders).some((k) => k.toLowerCase() === 'content-type')) {
    finalHeaders['Content-Type'] = 'application/x-www-form-urlencoded'
  }

  return {
    ok: true,
    value: {
      method,
      url,
      headers: finalHeaders,
      body,
    },
  }
}

export function parsedCurlToRequestDefinition(
  parsed: ParsedCurl,
  buildId: (prefix: string) => string,
  nameHint?: string,
): RequestDefinition {
  let pathUrl = parsed.url
  let query: Record<string, string> = {}
  try {
    const u = new URL(parsed.url)
    pathUrl = `${u.origin}${u.pathname}`
    query = {}
    u.searchParams.forEach((v, k) => {
      query[k] = v
    })
  } catch {
    /* keep full string as url */
  }

  const req: RequestDefinition = {
    id: buildId('req'),
    name: nameHint?.trim() || 'Imported cURL',
    method: parsed.method,
    url: pathUrl,
    query,
    headers: parsed.headers,
    bodyText: parsed.body,
    testCases: [],
    assertions: [],
  }
  return req
}
