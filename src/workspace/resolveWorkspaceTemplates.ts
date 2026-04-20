import type { RequestDefinition } from '../models/types'
import { buildUrlWithQuery } from './httpSend'
import { inferStoredPayloadBodyType } from './inferRequestBodyType'
import { coerceBearerSchemeForAuthNamedVar } from './workspaceCorrelationRuntime'

/** Same resolution order as k6 generator: environment → collection → project → shared */
export type TemplateContext = {
  activeEnvironment: string
  envVariables: Record<string, Record<string, string>>
  sharedVariables: Record<string, string>
  collectionVariables: Record<string, string>
  projectVariables: Record<string, string>
  /** pm.environment.set — applies before active env map for this Send */
  runtimeVarOverrides?: Record<string, string>
  /** pm.variables — request-scoped; highest priority */
  variableOverrides?: Record<string, string>
  /** Tauri: isolate Set-Cookie per Send batch (Keycloak replay). Omitted in browser / ad-hoc calls. */
  httpCookieSessionId?: string
}

function normalizeEnvKey(raw: string): string {
  return String(raw ?? '').trim().toLowerCase()
}

export function getActiveEnvVariables(ctx: TemplateContext): Record<string, string> {
  const envNormalized: Record<string, Record<string, string>> = {}
  for (const [envName, vars] of Object.entries(ctx.envVariables ?? {})) {
    envNormalized[normalizeEnvKey(envName)] = vars
  }
  const activeRaw = String(ctx.activeEnvironment || 'staging').trim()
  const activeKey = normalizeEnvKey(activeRaw)
  if (envNormalized[activeKey]) return envNormalized[activeKey]
  return envNormalized.staging || envNormalized.dev || envNormalized.prod || envNormalized.production || {}
}

function nonEmptyVarFromMap(map: Record<string, string> | undefined, name: string): string | undefined {
  if (!map || !Object.prototype.hasOwnProperty.call(map, name)) return undefined
  const v = String(map[name])
  return v.trim() === '' ? undefined : v
}

/** Collection / project / shared maps: match `{{token}}` to stored key `Token` (JMeter imports). */
function nonEmptyVarFromMapCaseInsensitive(
  map: Record<string, string> | undefined,
  name: string,
): string | undefined {
  const exact = nonEmptyVarFromMap(map, name)
  if (exact !== undefined) return exact
  if (!map) return undefined
  const want = name.trim().toLowerCase()
  for (const [k, v] of Object.entries(map)) {
    if (k.trim().toLowerCase() !== want) continue
    const s = String(v).trim()
    if (s !== '') return s
  }
  return undefined
}

/** RUNTIME: match `{{Token}}` to `token`, `{{euum.token}}` to keys set by EUUM token mirroring. */
function nonEmptyVarFromRuntimeMap(
  map: Record<string, string> | undefined,
  name: string,
): string | undefined {
  const exact = nonEmptyVarFromMap(map, name)
  if (exact !== undefined) return exact
  if (!map) return undefined
  const want = name.trim().toLowerCase()
  for (const [k, v] of Object.entries(map)) {
    if (k.trim().toLowerCase() !== want) continue
    const s = String(v).trim()
    if (s !== '') return s
  }
  return undefined
}

/**
 * Variable resolution for Send: treat **whitespace-only** stored values as unset so runtime/correlation
 * can supply tokens after an empty collection placeholder (common in JMeter imports).
 */
export function resolveVar(name: string, ctx: TemplateContext): string {
  const fromVo = nonEmptyVarFromMapCaseInsensitive(ctx.variableOverrides, name)
  if (fromVo !== undefined) return coerceBearerSchemeForAuthNamedVar(name, fromVo)
  const fromRo = nonEmptyVarFromRuntimeMap(ctx.runtimeVarOverrides, name)
  if (fromRo !== undefined) return coerceBearerSchemeForAuthNamedVar(name, fromRo)
  const envMap = getActiveEnvVariables(ctx)
  const fromEnv = nonEmptyVarFromMap(envMap, name)
  if (fromEnv !== undefined) return coerceBearerSchemeForAuthNamedVar(name, fromEnv)
  const fromCol = nonEmptyVarFromMapCaseInsensitive(ctx.collectionVariables, name)
  if (fromCol !== undefined) return coerceBearerSchemeForAuthNamedVar(name, fromCol)
  const fromProj = nonEmptyVarFromMapCaseInsensitive(ctx.projectVariables, name)
  if (fromProj !== undefined) return coerceBearerSchemeForAuthNamedVar(name, fromProj)
  const fromShared = nonEmptyVarFromMapCaseInsensitive(ctx.sharedVariables, name)
  if (fromShared !== undefined) return coerceBearerSchemeForAuthNamedVar(name, fromShared)
  return name
}

export function applyTemplate(input: string | undefined | null, ctx: TemplateContext): string {
  if (input == null) return ''
  let s = String(input)
  // Match k6 generator: legacy JMX stored `{{var}}` URL-encoded in query/body fragments.
  s = s.replace(/%7B%7B([a-zA-Z0-9_.-]+)%7D%7D/gi, '{{$1}}')
  // Nested placeholders (e.g. collection `token` = `{{access_token}}` filled from runtime after token API).
  const maxPasses = 12
  for (let i = 0; i < maxPasses; i++) {
    const next = s.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) => String(resolveVar(key, ctx)))
    if (next === s) break
    s = next
  }
  return s
}

function encodeUrlPartPreservingTemplates(s: string, ctx: TemplateContext): string {
  const applied = applyTemplate(s, ctx)
  const parts = String(applied).split(/(\{\{[a-zA-Z0-9_.-]+\}\})/g)
  return parts
    .map((part) => (/^\{\{[a-zA-Z0-9_.-]+\}\}$/.test(part) ? part : encodeURIComponent(part)))
    .join('')
}

/** Serialize form table for k6 / curl export (templates not resolved here; `tmpl()` applies at run time). */
export function serializeUrlEncodedFormForExport(req: RequestDefinition): string | null {
  const form = req.bodyFormData ?? {}
  const keys = Object.keys(form).filter((k) => k.trim())
  if (!keys.length) return null
  const inferred = req.bodyType ?? inferStoredPayloadBodyType(req)
  if (inferred !== 'x-www-form-urlencoded') return null
  const enc = (raw: string) => {
    const parts = String(raw).split(/(\{\{[a-zA-Z0-9_.-]+\}\})/g)
    return parts
      .map((part) => (/^\{\{[a-zA-Z0-9_.-]+\}\}$/.test(part) ? part : encodeURIComponent(part)))
      .join('')
  }
  return keys.map((k) => `${enc(k)}=${enc(String(form[k] ?? ''))}`).join('&')
}

/** When the Body tab uses the x-www-form-urlencoded key/value table, payload lives in `bodyFormData`. */
function bodyFromUrlEncodedForm(req: RequestDefinition, ctx: TemplateContext): string | null {
  const form = req.bodyFormData ?? {}
  const keys = Object.keys(form).filter((k) => k.trim())
  if (!keys.length) return null
  const inferred = req.bodyType ?? inferStoredPayloadBodyType(req)
  if (inferred !== 'x-www-form-urlencoded') return null
  return keys.map((k) => `${encodeUrlPartPreservingTemplates(k, ctx)}=${encodeUrlPartPreservingTemplates(String(form[k] ?? ''), ctx)}`).join('&')
}

/** EUUM token API accepts RFC-style `authorization_code`; recordings sometimes use `AUTHORIZATION_CODE`. */
function normalizeEuumTokenGrantTypeBody(url: string, body: string): string {
  const u = url.toLowerCase()
  if (!u.includes('/euum/') || !u.includes('/authorize/v1/token')) return body
  return body
    .replace(/\bgrant_type\s*=\s*AUTHORIZATION_CODE\b/gi, 'grant_type=authorization_code')
    .replace(/\bgrant_type\s*=\s*AUTHORIZATION%5FCODE\b/gi, 'grant_type=authorization_code')
}

const EUUM_TOKEN_OAUTH_QUERY_KEYS = new Set([
  'code',
  'grant_type',
  'redirect_uri',
  'client_id',
  'client_secret',
  'scope',
  'code_verifier',
])

function isEuumAuthorizeTokenPath(baseUrl: string): boolean {
  const u = baseUrl.toLowerCase()
  return u.includes('/euum/') && u.includes('/authorize/v1/token')
}

function headersLookMultipart(headers: Record<string, string>): boolean {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'content-type' && String(v).toLowerCase().includes('multipart/')) return true
  }
  return false
}

/**
 * JMeter "Parameters" on POST are sometimes imported or edited as URL query keys; EUUM expects
 * `application/x-www-form-urlencoded` body fields instead.
 */
function coerceEuumTokenOAuthQueryParamsToBody(
  method: string,
  baseUrl: string,
  query: Record<string, string>,
  existingBody: string,
  ctx: TemplateContext,
): { query: Record<string, string>; body: string } {
  const m = method.toUpperCase()
  if (m !== 'POST' && m !== 'PUT' && m !== 'PATCH') return { query, body: existingBody }
  if (!isEuumAuthorizeTokenPath(baseUrl)) return { query, body: existingBody }
  const moveKeys = Object.keys(query).filter((k) => EUUM_TOKEN_OAUTH_QUERY_KEYS.has(k.trim().toLowerCase()))
  if (!moveKeys.length) return { query, body: existingBody }

  const remaining: Record<string, string> = { ...query }
  const parts: string[] = []
  for (const k of moveKeys) {
    parts.push(
      `${encodeUrlPartPreservingTemplates(k, ctx)}=${encodeUrlPartPreservingTemplates(String(remaining[k] ?? ''), ctx)}`,
    )
    delete remaining[k]
  }
  const add = parts.join('&')
  const merged = [existingBody.trim(), add].filter(Boolean).join('&')
  return { query: remaining, body: merged }
}

export function resolveRequestForHttp(
  req: RequestDefinition,
  ctx: TemplateContext,
): { method: string; url: string; headers: Record<string, string>; body: string } {
  const baseUrl = applyTemplate(req.url, ctx)
  let query: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.query ?? {})) {
    if (!k.trim()) continue
    query[k] = applyTemplate(v, ctx)
  }

  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    const rk = applyTemplate(k, ctx)
    headers[rk] = applyTemplate(v, ctx)
  }

  let body = bodyFromUrlEncodedForm(req, ctx) ?? applyTemplate(req.bodyText ?? '', ctx)

  if (!headersLookMultipart(headers)) {
    const coerced = coerceEuumTokenOAuthQueryParamsToBody(req.method, baseUrl, query, body, ctx)
    query = coerced.query
    body = coerced.body
  }

  const url = buildUrlWithQuery(baseUrl, query)
  body = normalizeEuumTokenGrantTypeBody(url, body)

  if (body.trim() && isEuumAuthorizeTokenPath(baseUrl) && !headersLookMultipart(headers)) {
    const hasCt = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')
    if (!hasCt) headers['Content-Type'] = 'application/x-www-form-urlencoded'
  }

  return { method: req.method, url, headers, body }
}
