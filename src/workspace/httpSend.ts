import type { HttpExecuteResponse } from '../models/types'
import { tauriHttpExecute } from '../desktop/tauriBridge'

export async function executeHttpRequest(input: {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}): Promise<HttpExecuteResponse> {
  const t0 = performance.now()
  const tauri = await tauriHttpExecute(input)
  if (tauri) {
    return { ...tauri, durationMs: Math.round(performance.now() - t0) }
  }

  try {
    const hasBody = !['GET', 'HEAD'].includes(input.method.toUpperCase())
    const res = await fetch(input.url, {
      method: input.method,
      headers: input.headers,
      body: hasBody ? (input.body ?? '') : undefined,
    })
    const headersArr: [string, string][] = []
    res.headers.forEach((v, k) => headersArr.push([k, v]))
    const body = await res.text()
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      responseHeaders: headersArr,
      body,
      durationMs: Math.round(performance.now() - t0),
    }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      statusText: '',
      responseHeaders: [],
      body: '',
      error: e instanceof Error ? e.message : 'Request failed (browser mode / CORS). Use the desktop app for full HTTP support.',
      durationMs: Math.round(performance.now() - t0),
    }
  }
}

export function buildUrlWithQuery(baseUrl: string, query: Record<string, string>): string {
  const entries = Object.entries(query).filter(([k]) => k.trim())
  if (!entries.length) return baseUrl
  try {
    const u = new URL(baseUrl)
    for (const [k, v] of entries) {
      u.searchParams.set(k, v)
    }
    return u.toString()
  } catch {
    const qs = new URLSearchParams(Object.fromEntries(entries)).toString()
    if (baseUrl.includes('?')) return `${baseUrl}&${qs}`
    return `${baseUrl}?${qs}`
  }
}
