import type { CorrelationRule, HttpExecuteResponse } from '../models/types'
import { normalizeOAuthAuthorizationCodeHeaderRegex } from './oauthCodeRegex'

/**
 * JMeter JSR223 `props.put("updatedToken", vars.get("accessToken"))` is merged as `runtimeMirrorTo`
 * on the Token sampler's extractor. That must not overwrite variables another sampler's extractor
 * owns (e.g. `updatedToken` from the "default" API response).
 */
export function isVariableOwnedByAnotherRequest(
  rules: CorrelationRule[],
  variableName: string,
  fromRequestId: string,
): boolean {
  const want = variableName.trim().toLowerCase()
  if (!want) return false
  for (const r of rules) {
    if ((r.variableName ?? '').trim().toLowerCase() !== want) continue
    if (r.fromRequestId === fromRequestId) continue
    return true
  }
  return false
}

/** Same shape as k6 headerBlob: sorted header lines for regex extractors. */
function headerBlobFromPairs(headers: [string, string][]): string {
  const h: Record<string, string> = {}
  for (const [k, v] of headers) {
    h[k] = v
  }
  return Object.keys(h)
    .sort()
    .map((k) => `${k}: ${String(h[k] ?? '')}`)
    .join('\n')
}

function jsonPathLite(root: unknown, path: string): unknown {
  if (path == null || path === '' || path === '$') return root
  const p = String(path).replace(/^\$\./, '')
  try {
    let cur: unknown = root
    for (const part of p.split('.').filter(Boolean)) {
      cur = cur == null ? undefined : (cur as Record<string, unknown>)[part]
    }
    return cur
  } catch {
    return undefined
  }
}

/**
 * Apply correlation rules for one completed request into `runtime` (e.g. `templateCtx.runtimeVarOverrides`),
 * mirroring sequential k6 extractors so in-app Send can resolve {{sessionCode}}, etc.
 */
export function applyCorrelationRulesToRuntime(
  runtime: Record<string, string>,
  rules: CorrelationRule[],
  fromRequestId: string,
  result: HttpExecuteResponse,
  sourceRequestUrl?: string,
): void {
  for (const rule of rules) {
    if (rule.fromRequestId !== fromRequestId) continue

    if (rule.regexPattern?.trim()) {
      const grp = Math.max(1, rule.regexGroup ?? 1)
      const src =
        rule.regexSource === 'headers'
          ? headerBlobFromPairs(result.responseHeaders ?? [])
          : (result.body ?? '')
      const pat = normalizeOAuthAuthorizationCodeHeaderRegex(rule.regexPattern.trim(), rule.regexSource)
      try {
        // Header lines use gateway/client casing (often all-lowercase); JMeter patterns vary in case.
        const re =
          rule.regexSource === 'headers' ? new RegExp(pat, 'i') : new RegExp(pat)
        const m = re.exec(src)
        if (m && m[grp] !== undefined) {
          const val = String(m[grp])
          runtime[rule.variableName] = val
          for (const alias of rule.runtimeMirrorTo ?? []) {
            if (!alias || alias === rule.variableName) continue
            if (isVariableOwnedByAnotherRequest(rules, alias, rule.fromRequestId)) continue
            if (shouldBlockEuumpAccessMirrorToUpdatedToken(alias, rule.variableName, sourceRequestUrl))
              continue
            runtime[alias] = val
          }
        }
      } catch {
        // ignore invalid regex
      }
      continue
    }

    const jp = rule.jsonPath?.trim()
    if (jp) {
      try {
        const raw = result.body ?? ''
        const root = raw.trim() ? (JSON.parse(raw) as unknown) : null
        const v = jsonPathLite(root, jp)
        if (v != null && v !== '') {
          const val = typeof v === 'string' ? v : String(v)
          runtime[rule.variableName] = val
          for (const alias of rule.runtimeMirrorTo ?? []) {
            if (!alias || alias === rule.variableName) continue
            if (isVariableOwnedByAnotherRequest(rules, alias, rule.fromRequestId)) continue
            if (shouldBlockEuumpAccessMirrorToUpdatedToken(alias, rule.variableName, sourceRequestUrl))
              continue
            runtime[alias] = val
          }
        }
      } catch {
        // ignore JSON / path errors
      }
    }
  }
}

export function correlationRulesForCollectionRequests(
  rules: CorrelationRule[] | undefined,
  requestIds: Set<string>,
): CorrelationRule[] {
  return (rules ?? []).filter((r) => requestIds.has(r.fromRequestId))
}

const KEYCLOAK_EXECUTION_PARAM =
  /[?&]execution=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\b/i

/** Decode entities so `action="...&amp;execution=..."` matches like a real query string. */
function keycloakHtmlForExecutionScan(body: string): string {
  return body.replace(/&amp;/gi, '&')
}

/**
 * Pull Keycloak browser-flow `execution` from login HTML. Prefer query string (often in form
 * `action` URL), then hidden inputs (attribute order varies in XHTML).
 */
export function extractKeycloakExecutionFromLoginHtml(body: string): string | null {
  const raw = body ?? ''
  if (!raw.toLowerCase().includes('execution')) return null

  const b = keycloakHtmlForExecutionScan(raw)

  const fromQuery = KEYCLOAK_EXECUTION_PARAM.exec(b)
  if (fromQuery?.[1] && fromQuery[1] !== 'execution') return fromQuery[1]

  const actionM = /\baction=["']([^"']*login-actions\/authenticate[^"']*)["']/i.exec(b)
  if (actionM?.[1]) {
    const inner = keycloakHtmlForExecutionScan(actionM[1])
    const q = KEYCLOAK_EXECUTION_PARAM.exec(inner)
    if (q?.[1] && q[1] !== 'execution') return q[1]
  }

  const inputPatterns = [
    /<input[^>]*\bname=["']execution["'][^>]*\bvalue=["']([0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12})["']/i,
    /<input[^>]*\bvalue=["']([0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12})["'][^>]*\bname=["']execution["']/i,
    /name=["']execution["']\s+value=["']([0-9a-fA-F-]{36})["']/i,
    /value=["']([0-9a-fA-F-]{36})["']\s+name=["']execution["']/i,
  ]
  for (const re of inputPatterns) {
    const m = re.exec(b)
    if (m?.[1] && m[1] !== 'execution') return m[1]
  }
  return null
}

/**
 * If `runtime.execution` is missing, wrong, or literally "execution", try resilient Keycloak HTML
 * patterns after correlation rules (form action URL, `&amp;execution=`, hidden inputs).
 */
export function maybeFillKeycloakExecutionFromAuthHtml(
  runtime: Record<string, string>,
  result: HttpExecuteResponse,
): void {
  const cur = (runtime.execution ?? '').trim()
  if (cur && cur !== 'execution' && /[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-/.test(cur)) return

  const found = extractKeycloakExecutionFromLoginHtml(result.body ?? '')
  if (found) runtime.execution = found
}

/**
 * OAuth authorize callbacks put `code` in the `Location` URL. JMeter header regex extractors can miss
 * (encoding, `?code=` vs `&code=`, greedy groups). When unresolved, `{{tokenCode}}` becomes the literal
 * `tokenCode` and EUUM returns `euum.authorization.code.invalid`.
 *
 * - On 3xx responses, prefer `code=` from `Location` (authoritative for this hop).
 * - Otherwise fill only when `tokenCode` is empty or still the placeholder name.
 */
export function maybeFillOAuthAuthorizationCodeFromLocationHeader(
  runtime: Record<string, string>,
  result: HttpExecuteResponse,
): void {
  const loc = (result.responseHeaders ?? [])
    .find(([k]) => k.toLowerCase() === 'location')?.[1]
    ?.trim()
  if (!loc) return

  const m = /[?&]code=([^&\s#]+)/i.exec(loc)
  if (!m?.[1]) return

  let v = m[1]
  try {
    v = decodeURIComponent(v)
  } catch {
    // keep raw token if decode fails
  }
  if (!v || v === 'tokenCode') return

  const st = result.status
  const redirectResponse = st >= 300 && st < 400
  const cur = (runtime.tokenCode ?? '').trim()

  if (redirectResponse) {
    runtime.tokenCode = v
    return
  }
  if (!cur || cur === 'tokenCode') {
    runtime.tokenCode = v
  }
}

function responseHeaderValueCaseInsensitive(
  headers: [string, string][] | undefined,
  name: string,
): string | null {
  const want = name.toLowerCase()
  for (const [k, v] of headers ?? []) {
    if (k.toLowerCase() === want) return v
  }
  return null
}

/** API Gateway often exposes the authoritative bearer in remapped headers; may differ from JSON body. */
function tryEuumpJwtFromRemappedResponseHeaders(headers: [string, string][] | undefined): string | null {
  const raw =
    responseHeaderValueCaseInsensitive(headers, 'x-amzn-remapped-authorization') ??
    responseHeaderValueCaseInsensitive(headers, 'access-token') ??
    null
  if (!raw?.trim()) return null
  const cand = stripBearerPrefix(raw)
  if (!cand || !looksLikeJwt(cand)) return null
  return cand
}

function tryEuumpJwtFromAuthorizeTokenJsonBody(body: string): string | null {
  const trimmed = (body ?? '').trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const j = JSON.parse(trimmed) as Record<string, unknown>
    const at = j.access_token ?? j.accessToken
    if (typeof at !== 'string' || !at.trim()) return null
    const cand = stripBearerPrefix(at)
    if (!cand || !looksLikeJwt(cand)) return null
    return cand
  } catch {
    return null
  }
}

function stripBearerPrefix(raw: string): string {
  const t = String(raw ?? '').trim()
  if (/^bearer\s+/i.test(t)) return t.replace(/^bearer\s+/i, '').trim()
  return t
}

/** `Authorization: {{token}}` / `{{updatedToken}}` — store scheme + credential; keep `access_token` raw for JSON bodies. */
function ensureBearerSchemeForAuthHeaderVar(jwtCore: string): string {
  const core = String(jwtCore ?? '').trim()
  if (!core) return ''
  if (/^(Bearer|Basic|Digest)\s+/i.test(core)) return core
  return `Bearer ${core}`
}

/** Rough check: EUUM JWTs are three dot-separated base64url segments. */
function looksLikeJwt(value: string): boolean {
  const p = value.split('.')
  return p.length >= 3 && p.every((s) => s.length > 0)
}

/**
 * Template resolution prefers RUNTIME over collection. Correlation often stores a **raw** JWT in
 * `token` while the collection variable is `Bearer …`; without this, `Authorization: {{token}}`
 * sends only the JWT. Normalize auth-alias names when the value is JWT-shaped and missing a scheme.
 */
export function coerceBearerSchemeForAuthNamedVar(name: string, value: string): string {
  const n = name.trim().toLowerCase().replace(/-/g, '_')
  if (n !== 'token' && n !== 'updatedtoken' && n !== 'updated_token') return String(value ?? '')
  const t = String(value ?? '').trim()
  if (!t) return t
  if (/^(Bearer|Basic|Digest)\s+/i.test(t)) return t
  const core = stripBearerPrefix(t)
  if (core && looksLikeJwt(core)) return `Bearer ${core}`
  return t
}

/** Same pattern as collection `unsetValue` — when true, EUUM token fill may set `token` / `Token` / `TOKEN`. */
const EUUMP_COLLECTION_STYLE_TEMPLATE_REF =
  /^\{\{\s*(token|access_token|accessToken|updatedToken|updated_token)\s*\}\}$/i

function genericRuntimeTokenUnsetForEuumpFill(raw: string): boolean {
  const t = String(raw ?? '').trim()
  if (t === '') return true
  if (t === 'token' || t === 'access_token' || t === 'accessToken') return true
  if (t === 'updatedToken' || t === 'updated_token') return true
  if (/^Bearer\s*$/i.test(t)) return true
  if (EUUMP_COLLECTION_STYLE_TEMPLATE_REF.test(t)) return true
  if (!looksLikeJwt(t)) return true
  return false
}

/** Same gate as EUUM authorize token fill — used to avoid writing `updatedToken` on that response. */
export function isEuumpAuthorizeV1TokenUrl(url: string): boolean {
  const u = String(url ?? '')
  if (!/\/authorize\/v1\/token\b/i.test(u)) return false
  if (!/euum/i.test(u)) return false
  return true
}

/**
 * JMeter sometimes mirrors `accessToken` → `updatedToken` on the EUUM token sampler; that must not
 * run in-app or in k6 — `updatedToken` belongs to another response (e.g. “default” remapped header).
 */
export function shouldBlockEuumpAccessMirrorToUpdatedToken(
  mirrorAlias: string,
  extractedVariableName: string,
  sourceRequestUrl?: string,
): boolean {
  if (!sourceRequestUrl || !isEuumpAuthorizeV1TokenUrl(sourceRequestUrl)) return false
  const src = (extractedVariableName ?? '').trim().toLowerCase().replace(/-/g, '_')
  if (src !== 'accesstoken' && src !== 'access_token') return false
  const raw = (mirrorAlias ?? '').trim()
  if (raw === 'UPDATED_TOKEN') return true
  const want = raw.toLowerCase().replace(/-/g, '_')
  return want === 'updatedtoken' || want === 'updated_token'
}

/**
 * Access / bearer aliases for EUUM JWT (not generic `token` / `Token` / `TOKEN`, not `updatedToken`).
 * `updatedToken` is often bound to another request via extract rules (e.g. “default” API).
 */
function seedEuumpAccessJwtAliases(runtime: Record<string, string>, jwt: string): void {
  const keys = [
    'access_token',
    'accessToken',
    'AccessToken',
    'ACCESS_TOKEN',
    'auth_token',
    'Auth_Token',
    'AUTH_TOKEN',
    'authToken',
    'bearer_token',
    'Bearer_Token',
    'eu_token',
    'EU_TOKEN',
    'euum_token',
    'EUUM_TOKEN',
    'euumToken',
    'euum.token',
    'internal_token',
    'internalToken',
    'jwt',
    'JWT',
  ]
  for (const k of keys) {
    runtime[k] = jwt
  }
}

function seedEuumpUpdatedTokenRuntimeAliases(runtime: Record<string, string>, jwt: string): void {
  const v = ensureBearerSchemeForAuthHeaderVar(jwt)
  runtime.updatedToken = v
  runtime.UPDATED_TOKEN = v
  runtime.updated_token = v
}

/** Access + `updatedToken` aliases (non–token-URL remapped header path). */
function seedEuumpAccessAndUpdatedRuntimeAliases(runtime: Record<string, string>, jwt: string): void {
  seedEuumpAccessJwtAliases(runtime, jwt)
  seedEuumpUpdatedTokenRuntimeAliases(runtime, jwt)
}

/**
 * EUUM token exchange often returns **204** with an empty body; the access token is only in
 * `x-amzn-remapped-authorization: Bearer …` (API Gateway). JMeter JSON PostProcessors are not imported,
 * so `{{access_token}}` / `{{accessToken}}` stay empty and later `Authorization` headers fail.
 *
 * When both JSON and remapped headers carry JWTs, prefer the remapped header — it can be the
 * API Gateway–authoritative bearer while the body still carries an older or alternate token.
 */
export function maybeFillEuumpAccessTokenFromAuthorizeTokenResponse(
  runtime: Record<string, string>,
  result: HttpExecuteResponse,
  resolvedUrl: string,
): void {
  if (!isEuumpAuthorizeV1TokenUrl(resolvedUrl)) return
  if (result.status < 200 || result.status >= 300) return

  const hdrs = result.responseHeaders ?? []
  const jwtFromHeader = tryEuumpJwtFromRemappedResponseHeaders(hdrs)
  const jwtFromJson = tryEuumpJwtFromAuthorizeTokenJsonBody(result.body ?? '')
  const jwt = jwtFromHeader ?? jwtFromJson
  if (!jwt) return

  runtime.access_token = jwt
  runtime.accessToken = jwt
  seedEuumpAccessJwtAliases(runtime, jwt)
  if (genericRuntimeTokenUnsetForEuumpFill(runtime.token ?? '')) {
    const tv = ensureBearerSchemeForAuthHeaderVar(jwt)
    runtime.token = tv
    runtime.Token = tv
    runtime.TOKEN = tv
  }
}

/**
 * API Gateway often returns the active bearer in `x-amzn-remapped-authorization` on **ordinary**
 * API calls (the “default” service), not only on EUUM `.../authorize/v1/token`. Correlation or the
 * token step may leave `updatedToken` / `access_token` matching an older `token`; this refreshes
 * access-token aliases and `updatedToken` from the remapped header whenever it is present on a 2xx
 * response, without changing generic `token` / `Token` / `TOKEN`.
 *
 * On the EUUM `/authorize/v1/token` URL, only access aliases are updated — not `updatedToken`, which
 * is typically extracted from another request (e.g. “default” API).
 */
export function maybeFillAccessTokensFromRemappedAuthorizationHeader(
  runtime: Record<string, string>,
  result: HttpExecuteResponse,
  resolvedUrl: string,
): void {
  if (result.status < 200 || result.status >= 300) return
  const jwt = tryEuumpJwtFromRemappedResponseHeaders(result.responseHeaders ?? [])
  if (!jwt) return
  runtime.access_token = jwt
  runtime.accessToken = jwt
  if (isEuumpAuthorizeV1TokenUrl(resolvedUrl)) {
    seedEuumpAccessJwtAliases(runtime, jwt)
  } else {
    seedEuumpAccessAndUpdatedRuntimeAliases(runtime, jwt)
  }
}

function jwtLikeFromRuntimeValue(raw: string | undefined): string {
  const t = String(raw ?? '').trim()
  if (!t) return ''
  const core = stripBearerPrefix(t)
  if (!core || !looksLikeJwt(core)) return ''
  return core
}

/** Access / generic `token` lineage — never `updatedToken` (BPA keeps those separate). */
function jwtForAccessLineage(runtime: Record<string, string>): string {
  return (
    jwtLikeFromRuntimeValue(runtime.access_token) ||
    jwtLikeFromRuntimeValue(runtime.accessToken) ||
    jwtLikeFromRuntimeValue(runtime.token) ||
    jwtLikeFromRuntimeValue(runtime.Token) ||
    jwtLikeFromRuntimeValue(runtime.TOKEN) ||
    ''
  )
}

function jwtForUpdatedLineage(runtime: Record<string, string>): string {
  return (
    jwtLikeFromRuntimeValue(runtime.updatedToken) ||
    jwtLikeFromRuntimeValue(runtime.updated_token) ||
    jwtLikeFromRuntimeValue(runtime.UPDATED_TOKEN) ||
    ''
  )
}

function templatePlaceholderInnerName(raw: string): string | null {
  const m = EUUMP_COLLECTION_STYLE_TEMPLATE_REF.exec(String(raw ?? '').trim())
  return m?.[1] ? m[1].trim() : null
}

/** `{{token}}` / `{{updatedToken}}` and same-named collection keys get `Bearer …`; `access_token` stays raw. */
function wantsBearerSchemeForCollectionOrTemplateName(name: string): boolean {
  const n = name.trim().toLowerCase().replace(/-/g, '_')
  return n === 'token' || n === 'updatedtoken' || n === 'updated_token'
}

function isUpdatedTemplateOrKeyName(innerOrKey: string): boolean {
  const t = innerOrKey.trim()
  if (t === 'UPDATED_TOKEN') return true
  const n = t.toLowerCase().replace(/-/g, '_')
  return n === 'updatedtoken' || n === 'updated_token'
}

/**
 * Collection variables often hold empty / `{{access_token}}` placeholders (“value from token API”).
 * Copy JWTs from RUNTIME into those keys so `pm.collectionVariables` and headers resolve consistently
 * across sequential sends (same object as `templateCtx.collectionVariables`).
 *
 * `{{updatedToken}}` / updated-shaped keys use **only** the updated lineage; access placeholders never
 * steal `updatedToken` and vice versa (avoids collapsing both to the EUUM access JWT).
 */
export function syncEuumpJwtFromRuntimeIntoCollectionVars(
  runtime: Record<string, string>,
  collectionVars: Record<string, string>,
): void {
  const accessJwt = jwtForAccessLineage(runtime)
  const updatedJwt = jwtForUpdatedLineage(runtime)

  // Do not inject new collection keys — runtime already has JWT via maybeFill (access) / remapped or extractors.
  // Only refresh existing imported placeholders / token-shaped keys so the same map object used for templates updates.

  const unsetValue = (raw: string) => {
    const t = String(raw ?? '').trim()
    if (t === '') return true
    if (t === 'token' || t === 'access_token' || t === 'accessToken') return true
    if (t === 'updatedToken' || t === 'updated_token') return true
    if (/^Bearer\s*$/i.test(t)) return true
    if (EUUMP_COLLECTION_STYLE_TEMPLATE_REF.test(t)) return true
    return false
  }

  const tokenishKey = (key: string) => {
    const k = key.trim().toLowerCase().replace(/-/g, '_')
    if (k === 'token' || k === 'access_token' || k === 'accesstoken') return true
    if (k === 'updatedtoken' || k === 'updated_token') return true
    if (k === 'auth_token' || k === 'eu_token' || k === 'euum_token' || k === 'bearer_token') return true
    if (k.includes('access_token')) return true
    if (k.endsWith('_token') && !/(csrf|xsrf|oauth|request|session|verify)/i.test(k)) return true
    return false
  }

  for (const key of Object.keys(collectionVars)) {
    const raw = String(collectionVars[key] ?? '')
    if (!unsetValue(raw)) continue

    const inner = templatePlaceholderInnerName(raw)
    let next = ''
    if (inner) {
      const core = isUpdatedTemplateOrKeyName(inner) ? updatedJwt : accessJwt
      if (!core) continue
      next = wantsBearerSchemeForCollectionOrTemplateName(inner)
        ? ensureBearerSchemeForAuthHeaderVar(core)
        : core
    } else if (tokenishKey(key)) {
      const core = isUpdatedTemplateOrKeyName(key) ? updatedJwt : accessJwt
      if (!core) continue
      next = wantsBearerSchemeForCollectionOrTemplateName(key)
        ? ensureBearerSchemeForAuthHeaderVar(core)
        : core
    } else {
      continue
    }

    if (!next) continue
    collectionVars[key] = next
  }
}

/** RUNTIME key: raw percent-encoded `redirect_uri` query fragment from Keycloak /auth (use in Token body as-is). */
export const OAUTH_REDIRECT_URI_RUNTIME_KEY = 'oauth_redirect_uri'

/** Raw percent-encoded `redirect_uri` query value from a Keycloak authorization URL. */
export function extractRedirectUriRawFromOpenIdAuthUrl(url: string): string | null {
  if (!/openid-connect\/auth/i.test(String(url ?? ''))) return null
  const m = /[?&]redirect_uri=([^&]+)/i.exec(String(url))
  return m?.[1] ? m[1] : null
}

/**
 * After a successful resolve of an openid-connect/auth URL, copy `redirect_uri` into RUNTIME so EUUM token
 * exchange can use `redirect_uri={{oauth_redirect_uri}}` and match the authorization request exactly.
 */
export function maybeFillOAuthRedirectUriFromAuthUrl(
  runtime: Record<string, string>,
  resolvedAuthUrl: string,
): void {
  const raw = extractRedirectUriRawFromOpenIdAuthUrl(resolvedAuthUrl)
  if (raw != null && raw !== '') runtime[OAUTH_REDIRECT_URI_RUNTIME_KEY] = raw
}
