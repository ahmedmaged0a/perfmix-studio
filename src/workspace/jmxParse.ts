/**
 * JMeter JMX → PerfMix Collection parser
 *
 * Handles the most common JMeter patterns:
 *   - HTTPSamplerProxy and legacy HTTPSampler (HTTP Request samplers)
 *   - HeaderManager (attached headers)
 *   - ThreadGroup / GenericSampler containers (for collection name)
 *   - Nested hashTree structures (controllers, loops, ifs)
 *   - Raw body (postBodyRaw=true) and form params / query params
 *   - HTTPS / HTTP detection via protocol property
 *   - Test Plan user-defined variables → collection.variables; `${name}` → `{{name}}`
 *   - Form/query encoding keeps `{{var}}` segments readable for k6 (no `%7B%7B` placeholders).
 *   - JSR223 PostProcessor scripts → stored on the request (`jmeterJsr223PostProcessors`); `props.put` / `vars.put` mirrors → correlation `runtimeMirrorTo`; in-app Send runs a small post-correlation shim.
 *   - Thread Group num_threads / ramp_time / scheduler duration → one RequestTestCase per sampler
 *   - ConstantTimer in the sampler’s following hashTree → `thinkTimeMs` / `thinkTimeEnabled` (no default 150ms; JMeter has no wait without a timer); disabled timers ignored
 *   - Authorization without `Bearer` / `Basic` / `Digest` (e.g. `{{token}}` after `${token}` conversion) → prefixed with `Bearer ` on import
 *   - Controller-scoped RegexExtractor (sibling before HTTP steps in the same hashTree) → one correlation rule per following enabled sampler; sampler-post Regex unchanged
 *   - ResponseAssertion (response body contains / equals) → request `assertions`; JMeter `Asserion.test_strings` typo supported
 *   - CSVDataSet variable names → `collection.variables` (empty placeholders) + path warning
 *   - Disabled HTTP samplers (`enabled="false"`) skipped; common regex typo `(+?)` → `(.+?)` with warning
 *
 * Thread group ownership follows JMeter’s on-disk layout: each node is followed by a sibling
 * {@code <hashTree>} for its children, so {@code ThreadGroup} is usually the *previous sibling*
 * of the {@code hashTree} that contains an {@code HTTPSamplerProxy}, not a DOM parent of the sampler.
 */

import type {
  BodyType,
  Collection,
  CorrelationRule,
  JmeterJsr223PostProcessor,
  JmxImportHints,
  RequestAssertion,
  RequestDefinition,
  RequestTestCase,
} from '../models/types'
import { inferBodyTypeFromHeadersAndText } from './inferRequestBodyType'
import { normalizeOAuthAuthorizationCodeHeaderRegex } from './oauthCodeRegex'

function buildId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

/** Recursively collect all elements matching tag anywhere in subtree */
function allByTag(root: Element, tag: string): Element[] {
  return Array.from(root.querySelectorAll(tag))
}

/** Read a named stringProp / boolProp / intProp / longProp child */
function prop(el: Element, name: string): string | null {
  const found = Array.from(el.children).find(
    (c) =>
      (c.tagName === 'stringProp' ||
        c.tagName === 'boolProp' ||
        c.tagName === 'intProp' ||
        c.tagName === 'longProp') &&
      c.getAttribute('name') === name,
  )
  return found ? (found.textContent ?? '').trim() : null
}

/** Reconstruct full URL from JMX fields */
function buildUrl(
  protocol: string,
  domain: string,
  port: string,
  path: string,
): string {
  const proto = protocol?.trim() || 'https'
  const dom = domain?.trim() || ''
  const rawPath = path?.trim() || '/'
  const portNum = parseInt(port ?? '', 10)
  const defaultPort = proto === 'https' ? 443 : 80
  const portSuffix =
    portNum && !isNaN(portNum) && portNum !== defaultPort ? `:${portNum}` : ''
  if (!dom) return rawPath // relative — just keep path
  const slash = rawPath.startsWith('/') ? '' : '/'
  return `${proto}://${dom}${portSuffix}${slash}${rawPath}`
}

/** Headers from browser recordings that trigger Keycloak/WAF 403 `Invalid CORS request` when replayed. */
const KEYCLOAK_LOGIN_HEADER_SKIP = new Set(
  [
    'origin',
    'referer',
    'sec-fetch-mode',
    'sec-fetch-site',
    'sec-fetch-dest',
    'sec-fetch-user',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
    'priority',
    'postman-token',
  ].map((s) => s.toLowerCase()),
)

/** Skip browser-recording headers on Keycloak authenticate and EUUM token POST (same CORS/WAF issues). */
function skipJmxRecordedBrowserReplayHeader(headerName: string, samplerPath: string): boolean {
  if (!KEYCLOAK_LOGIN_HEADER_SKIP.has(headerName.trim().toLowerCase())) return false
  if (/login-actions\/authenticate/i.test(samplerPath)) return true
  if (/euum/i.test(samplerPath) && /authorize\/v1\/token/i.test(samplerPath)) return true
  return false
}

/** Parse HeaderManager element → headers record */
function parseHeaderManager(hm: Element): Record<string, string> {
  const headers: Record<string, string> = {}
  const headerEls = hm.querySelectorAll('elementProp[elementType="Header"]')
  headerEls.forEach((el) => {
    const name = prop(el, 'Header.name')
    const value = prop(el, 'Header.value')
    if (name) headers[name] = value ?? ''
  })
  return headers
}

/** Single `{{var}}` placeholder — JMeter `${__P(var)}` usually resolves to the full header value (often already `Bearer …`). */
const LONE_PERF_MIX_PLACEHOLDER_AUTHZ = /^\{\{\s*[\w.-]+\s*\}\}\s*$/i

/**
 * JMeter often stores only `${token}` (→ `{{token}}`) in Authorization; most APIs expect `Bearer …`.
 * If the header value is non-empty and does not already use a common auth scheme prefix, prepend `Bearer `.
 *
 * **Exception:** a lone `{{var}}` after `__P` / props import is left unchanged — k6 must not emit
 * `Bearer {{token}}` when the runtime value is already `Bearer eyJ…` (would become `Bearer Bearer …`).
 */
export function normalizeImportedAuthorizationBearer(headers: Record<string, string>): void {
  const authKey = Object.keys(headers).find((k) => k.trim().toLowerCase() === 'authorization')
  if (!authKey) return
  const raw = String(headers[authKey] ?? '').trim()
  if (!raw) return
  if (/^(null|undefined)$/i.test(raw)) {
    delete headers[authKey]
    return
  }
  if (/^Bearer\s+(null|undefined)$/i.test(raw)) {
    delete headers[authKey]
    return
  }
  if (/^(Bearer|Basic|Digest)\s+/i.test(raw)) return
  if (LONE_PERF_MIX_PLACEHOLDER_AUTHZ.test(raw)) return
  headers[authKey] = `Bearer ${raw}`
}

/**
 * Given an HTTPSamplerProxy element, find its sibling hashTree (which follows
 * immediately after in the parent's children) and look for a HeaderManager inside.
 */
function findAttachedHeaderManagers(sampler: Element): Element[] {
  const parent = sampler.parentElement
  if (!parent) return []
  const siblings = Array.from(parent.children)
  const idx = siblings.indexOf(sampler)
  // The hashTree immediately following the sampler holds its children (header mgrs etc.)
  for (let i = idx + 1; i < siblings.length; i++) {
    const sib = siblings[i]
    if (sib.tagName === 'hashTree') {
      return allByTag(sib, 'HeaderManager')
    }
    // Stop if another sampler / controller starts
    if (
      sib.tagName !== 'hashTree' &&
      sib.tagName !== 'ResultCollector' &&
      sib.tagName !== 'ResponseAssertion'
    ) {
      break
    }
  }
  return []
}

/**
 * Sum `ConstantTimer.delay` (ms) from ConstantTimer elements that are **direct children** of the
 * hashTree immediately after the sampler (same scope as attached HeaderManagers).
 */
function findDirectConstantTimersDelayMsTotal(sampler: Element): number | null {
  const parent = sampler.parentElement
  if (!parent) return null
  const siblings = Array.from(parent.children)
  const idx = siblings.indexOf(sampler)
  for (let i = idx + 1; i < siblings.length; i++) {
    const sib = siblings[i]
    if (sib.tagName === 'hashTree') {
      let sum = 0
      let any = false
      for (const ch of Array.from(sib.children)) {
        if (ch.tagName !== 'ConstantTimer') continue
        if (ch.getAttribute('enabled') === 'false') continue
        const raw = prop(ch, 'ConstantTimer.delay')
        if (raw == null) continue
        const m = /^\s*(\d+)\s*$/.exec(String(raw))
        if (!m) continue
        sum += parseInt(m[1], 10)
        any = true
      }
      return any ? sum : null
    }
    if (
      sib.tagName !== 'hashTree' &&
      sib.tagName !== 'ResultCollector' &&
      sib.tagName !== 'ResponseAssertion'
    ) {
      break
    }
  }
  return null
}

/** Decode common XML entities JMeter sometimes leaves in path/body text. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
}

/**
 * Encode a query or x-www-form-urlencoded fragment but leave `{{var}}` literals intact so k6 `tmpl()`
 * can substitute them (JMeter `${var}` → `{{var}}` must not become `%7B%7Bvar%7D%7D`).
 */
export function encodeURIComponentPreservingPerfMixTemplates(s: string): string {
  const parts = String(s).split(/(\{\{[a-zA-Z0-9_\-.]+\}\})/g)
  return parts
    .map((part) => (/^\{\{[a-zA-Z0-9_\-.]+\}\}$/.test(part) ? part : encodeURIComponent(part)))
    .join('')
}

/**
 * JMeter `${__P(name)}` / `${__P(name,default)}` → `{{name}}` and record defaults for collection variables.
 */
function substJmeterPFunctions(s: string, pDefaults: Map<string, string>): string {
  return s.replace(/\$\{__P\s*\(\s*([^,)\s]+)\s*(?:,\s*([^)]*))?\s*\)\s*\}/g, (_, nameRaw: string, defRaw?: string) => {
    const name = String(nameRaw).trim()
    if (!name) return ''
    const def = defRaw != null ? String(defRaw).trim() : ''
    if (!pDefaults.has(name)) pDefaults.set(name, def)
    return `{{${name}}}`
  })
}

function transformJmeterExpressions(s: string, pDefaults: Map<string, string>): string {
  return substJmeterVars(substJmeterPFunctions(s, pDefaults))
}

/** JMeter: "Send parameters with the request" can send individual POST args as query string. */
function httpArgumentUsesQueryString(arg: Element): boolean {
  const v = prop(arg, 'HTTPArgument.use_query_string')
  return v === 'true' || v === '1'
}

/** Extract query params or body from HTTPSamplerProxy arguments */
function parseArguments(
  sampler: Element,
  isRawBody: boolean,
  method: string,
  pDefaults: Map<string, string>,
): { query: Record<string, string>; bodyText: string } {
  const query: Record<string, string> = {}
  let bodyText = ''

  const argsEl = sampler.querySelector('elementProp[name="HTTPsampler.Arguments"]')
  if (!argsEl) return { query, bodyText }

  const argEls = argsEl.querySelectorAll('elementProp[elementType="HTTPArgument"]')

  if (isRawBody) {
    const first = argEls[0]
    if (first) bodyText = transformJmeterExpressions(prop(first, 'Argument.value') ?? '', pDefaults)
  } else if (method === 'GET' || method === 'DELETE' || method === 'HEAD') {
    argEls.forEach((arg) => {
      const name = prop(arg, 'Argument.name')
      const value = prop(arg, 'Argument.value')
      if (name) {
        query[transformJmeterExpressions(name, pDefaults)] = transformJmeterExpressions(value ?? '', pDefaults)
      }
    })
  } else {
    const pairs: string[] = []
    argEls.forEach((arg) => {
      const rawName = prop(arg, 'Argument.name')
      const rawValue = prop(arg, 'Argument.value')
      if (rawName === null || rawName === undefined) return
      const name = transformJmeterExpressions(rawName ?? '', pDefaults)
      const value = transformJmeterExpressions(rawValue ?? '', pDefaults)
      if (httpArgumentUsesQueryString(arg)) {
        if (name) query[name] = value
      } else {
        pairs.push(
          `${encodeURIComponentPreservingPerfMixTemplates(name)}=${encodeURIComponentPreservingPerfMixTemplates(value)}`,
        )
      }
    })
    if (pairs.length > 0) bodyText = pairs.join('&')
  }
  return { query, bodyText }
}

/** JMeter `${var}` → PerfMix `{{var}}` for URLs, headers, and bodies */
function substJmeterVars(s: string): string {
  return s.replace(/\$\{([^}]*)\}/g, (_, inner: string) => {
    const key = inner.trim()
    return key ? `{{${key}}}` : '{{}}'
  })
}

/** Test plan user-defined variables → collection.variables */
function parseUserDefinedVariables(doc: Document): Record<string, string> {
  const out: Record<string, string> = {}
  doc.querySelectorAll('elementProp[name="TestPlan.user_defined_variables"]').forEach((root) => {
    root.querySelectorAll('elementProp[elementType="Argument"]').forEach((el) => {
      const name = prop(el, 'Argument.name')
      const value = prop(el, 'Argument.value')
      if (name) out[name] = value ?? ''
    })
  })
  return out
}

/**
 * Standalone JMeter "Arguments" panels (scheme, username, …) — not HTTPsampler.Arguments inside a sampler.
 */
function parsePlanLevelStandaloneArguments(doc: Document): Record<string, string> {
  const out: Record<string, string> = {}
  doc.querySelectorAll('Arguments').forEach((el) => {
    if (el.closest('HTTPSamplerProxy')) return
    if (el.getAttribute('testclass') !== 'Arguments') return
    el.querySelectorAll('collectionProp[name="Arguments.arguments"] > elementProp[elementType="Argument"]').forEach(
      (argEl) => {
        const name = prop(argEl, 'Argument.name')
        const value = prop(argEl, 'Argument.value')
        if (name) out[name] = value ?? ''
      },
    )
  })
  return out
}

function mergeVariableMaps(
  base: Record<string, string>,
  overlay: Record<string, string>,
  warnings: string[],
  overlayLabel: string,
): Record<string, string> {
  const out = { ...base }
  for (const [k, v] of Object.entries(overlay)) {
    if (Object.prototype.hasOwnProperty.call(out, k) && out[k] !== v) {
      warnings.push(`User variable "${k}" appears in multiple places; ${overlayLabel} value wins over earlier import.`)
    }
    out[k] = v
  }
  return out
}

function appendQueryToUrl(url: string, query: Record<string, string>): string {
  const entries = Object.entries(query).filter(([k]) => k)
  if (!entries.length) return url
  const qs = entries
    .map(([k, v]) => {
      const ke = encodeURIComponentPreservingPerfMixTemplates(k)
      const ve = encodeURIComponentPreservingPerfMixTemplates(v)
      return `${ke}=${ve}`
    })
    .join('&')
  if (!url.includes('?')) return `${url}?${qs}`
  const joiner = url.endsWith('?') || url.endsWith('&') ? '' : '&'
  return `${url}${joiner}${qs}`
}

/** hashTree immediately following a sampler (HeaderManager, RegexExtractor, … live here). */
function findSamplerPostHashTree(sampler: Element): Element | null {
  const parent = sampler.parentElement
  if (!parent) return null
  const siblings = Array.from(parent.children)
  const idx = siblings.indexOf(sampler)
  for (let i = idx + 1; i < siblings.length; i++) {
    const sib = siblings[i]
    if (sib.tagName === 'hashTree') return sib
    if (
      sib.tagName !== 'hashTree' &&
      sib.tagName !== 'ResultCollector' &&
      sib.tagName !== 'ResponseAssertion'
    ) {
      break
    }
  }
  return null
}

function regexTemplateToGroup(template: string | null): number {
  if (!template) return 1
  const m = String(template).match(/\$(\d+)\$/)
  if (m) return Math.max(1, parseInt(m[1], 10) || 1)
  return 1
}

function isHttpSamplerTag(tag: string): boolean {
  return tag === 'HTTPSamplerProxy' || tag === 'HTTPSampler'
}

/** Build one correlation rule from a JMeter RegexExtractor element (sampler-post or controller-scoped). */
function buildCorrelationRuleFromRegexElement(
  rx: Element,
  fromRequestId: string,
  typoFixCount: { n: number },
  typoCountedElements: Set<Element>,
): CorrelationRule | null {
  const varName = prop(rx, 'RegexExtractor.refname')?.trim()
  const rawPattern = prop(rx, 'RegexExtractor.regex')
  const useHeaders = prop(rx, 'RegexExtractor.useHeaders') === 'true'
  let patternCore = normalizeImportedRegexPattern(rawPattern)
  if (patternCore.includes('(+?)')) {
    patternCore = patternCore.replaceAll('(+?)', '(.+?)')
    if (!typoCountedElements.has(rx)) {
      typoCountedElements.add(rx)
      typoFixCount.n += 1
    }
  }
  const pattern = normalizeOAuthAuthorizationCodeHeaderRegex(
    patternCore,
    useHeaders ? 'headers' : undefined,
  )
  if (!varName || !pattern) return null
  const group = regexTemplateToGroup(prop(rx, 'RegexExtractor.template'))
  return {
    id: buildId('cr'),
    variableName: varName,
    fromRequestId,
    kind: 'regex',
    jsonPath: '',
    regexPattern: pattern,
    regexGroup: group,
    regexSource: useHeaders ? 'headers' : 'body',
  }
}

/** JMeter bitmask: CONTAINS=2, SUBSTRING=1<<4 (16 in 5.6+), EQUALS=8. */
const JM_ASSERT_CONTAINS = 2
const JM_ASSERT_SUBSTRING = 16
const JM_ASSERT_EQUALS = 8

function collectResponseAssertionTestStrings(ra: Element): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const name of ['Asserion.test_strings', 'Assertion.test_strings'] as const) {
    ra.querySelectorAll(`collectionProp[name="${name}"] stringProp`).forEach((sp) => {
      const t = (sp.textContent ?? '').trim()
      if (t && !seen.has(t)) {
        seen.add(t)
        out.push(t)
      }
    })
  }
  return out
}

/** ResponseAssertion elements in the hashTree immediately after the sampler. */
function parseResponseAssertionsForSampler(sampler: Element): RequestAssertion[] {
  const ht = findSamplerPostHashTree(sampler)
  if (!ht) return []
  const out: RequestAssertion[] = []
  for (const child of Array.from(ht.children)) {
    if (child.tagName !== 'ResponseAssertion') continue
    if (child.getAttribute('enabled') === 'false') continue
    const testField = prop(child, 'Assertion.test_field') ?? ''
    const testTypeRaw = prop(child, 'Assertion.test_type')
    const testType = testTypeRaw != null && testTypeRaw !== '' ? parseInt(testTypeRaw, 10) : 0
    if (!Number.isFinite(testType)) continue
    if (!testField.includes('response_data')) continue

    const strings = collectResponseAssertionTestStrings(child)
    if (!strings.length) continue

    const isEquals = (testType & JM_ASSERT_EQUALS) !== 0
    const isContainsLike =
      (testType & JM_ASSERT_CONTAINS) !== 0 || (testType & JM_ASSERT_SUBSTRING) !== 0 || testType === 0

    for (const target of strings) {
      if (isEquals) {
        out.push({
          id: buildId('assert'),
          type: 'body_equals',
          enabled: true,
          target,
        })
      } else if (isContainsLike) {
        out.push({
          id: buildId('assert'),
          type: 'body_contains',
          enabled: true,
          target,
        })
      }
    }
  }
  return out
}

/** CSV Data Set Config → collection variable keys (values empty until user supplies data). */
function parseCsvDataSetVariables(doc: Document, warnings: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  doc.querySelectorAll('CSVDataSet').forEach((el) => {
    if (el.getAttribute('enabled') === 'false') return
    const namesRaw = prop(el, 'variableNames')?.trim() ?? ''
    if (!namesRaw) return
    const delimRaw = prop(el, 'delimiter')?.trim()
    const delim = delimRaw === '\\t' ? '\t' : delimRaw || ','
    const filename = prop(el, 'filename')?.trim() ?? ''
    const names = namesRaw.split(delim).map((s) => s.trim()).filter(Boolean)
    for (const n of names) {
      if (!Object.prototype.hasOwnProperty.call(out, n)) out[n] = ''
    }
    if (filename) {
      warnings.push(
        `CSV Data Set Config references "${filename}" — file is not loaded automatically; set collection variables or supply data for: ${names.join(', ')}.`,
      )
    }
  })
  return out
}

/**
 * RegexExtractor siblings in a controller `hashTree` (before HTTP samplers) — JMeter runs them after
 * each following sampler in scope. Emit one rule per following enabled sampler so k6 can re-extract
 * like JMeter (last successful match wins).
 */
function collectScopedRegexCorrelationRules(
  doc: Document,
  postRegexSeen: Set<Element>,
  samplerToRequestId: Map<Element, string>,
  warnings: string[],
  typoFixCount: { n: number },
  typoCountedElements: Set<Element>,
): CorrelationRule[] {
  const out: CorrelationRule[] = []
  let manyTargetsWarned = false

  doc.querySelectorAll('RegexExtractor').forEach((rx) => {
    if (rx.getAttribute('enabled') === 'false') return
    if (postRegexSeen.has(rx)) return

    const parent = rx.parentElement
    if (!parent || parent.tagName !== 'hashTree') return

    const siblings = Array.from(parent.children)
    const idx = siblings.indexOf(rx)
    if (idx < 0) return

    const followingSamplers: Element[] = []
    for (let i = idx + 1; i < siblings.length; i++) {
      const sib = siblings[i]
      if (sib.tagName === 'RegexExtractor') break
      if (sib.tagName === 'hashTree') continue
      if (isHttpSamplerTag(sib.tagName)) {
        if (sib.getAttribute('enabled') !== 'false') followingSamplers.push(sib)
      }
    }

    const label = rx.getAttribute('testname')?.trim() || rx.getAttribute('name')?.trim() || 'RegexExtractor'
    if (followingSamplers.length === 0) {
      warnings.push(
        `RegexExtractor "${label}" has no following enabled HTTP samplers in the same hashTree — not imported as scoped correlation.`,
      )
      return
    }
    if (followingSamplers.length > 10 && !manyTargetsWarned) {
      warnings.push(
        'One or more controller-scoped RegexExtractor elements apply to many HTTP samplers — verify correlation targets.',
      )
      manyTargetsWarned = true
    }

    for (const samp of followingSamplers) {
      const rid = samplerToRequestId.get(samp)
      if (!rid) {
        warnings.push(`Scoped RegexExtractor "${label}": a following sampler was not imported — skipped one rule.`)
        continue
      }
      const rule = buildCorrelationRuleFromRegexElement(rx, rid, typoFixCount, typoCountedElements)
      if (rule) out.push(rule)
    }
  })

  return out
}

/** Decode XML entities in JMeter regex text until stable, then relax common Keycloak HTML boundaries. */
function normalizeImportedRegexPattern(raw: string | null | undefined): string {
  if (raw == null || !String(raw).trim()) return ''
  let s = String(raw)
  for (let i = 0; i < 6; i++) {
    const next = decodeHtmlEntities(s)
    if (next === s) break
    s = next
  }
  return relaxKeycloakCorrelationPattern(s)
}

/** Allow `&` or `&amp;` (and double-encoded) after session_code capture — live HTML varies. */
function relaxKeycloakCorrelationPattern(pattern: string): string {
  let out = pattern
  if (/session_code=/i.test(out)) {
    out = out.replace(/&amp;amp/gi, '(?:&|&amp;|&amp;amp)')
    out = out.replace(/([^\\])&amp(?!;)/gi, '$1(?:&|&amp;)')
  }
  return out
}

const KEYCLOAK_EXECUTION_UUID =
  /execution=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/

function findPriorOpenIdAuthRequestIndex(requests: RequestDefinition[], beforeIdx: number): number {
  for (let j = beforeIdx - 1; j >= 0; j--) {
    if (/openid-connect\/auth/i.test(requests[j].url)) return j
  }
  return -1
}

function ensureDualKeycloakExecutionExtractRules(correlationRules: CorrelationRule[], authRequestId: string) {
  const patterns = [
    '(?:[?&]|&amp;)execution=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\\b',
    '<input[^>]*\\bname=["\']execution["\'][^>]*\\bvalue=["\']([0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12})["\']',
    '<input[^>]*\\bvalue=["\']([0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12})["\'][^>]*\\bname=["\']execution["\']',
  ]
  for (const regexPattern of patterns) {
    const exists = correlationRules.some(
      (r) =>
        r.fromRequestId === authRequestId &&
        r.variableName === 'execution' &&
        r.regexPattern?.replace(/\s/g, '') === regexPattern.replace(/\s/g, ''),
    )
    if (exists) continue
    correlationRules.push({
      id: buildId('cr'),
      variableName: 'execution',
      fromRequestId: authRequestId,
      kind: 'regex',
      jsonPath: '',
      regexPattern,
      regexGroup: 1,
      regexSource: 'body',
    })
  }
}

/**
 * Replace static Keycloak `execution` UUID (or placeholder) in authenticate URLs with {{execution}}
 * and add body extractors on the nearest prior openid-connect/auth request.
 */
function applyKeycloakExecutionRewrite(
  requests: RequestDefinition[],
  correlationRules: CorrelationRule[],
  warnings: string[],
) {
  for (let i = 0; i < requests.length; i++) {
    const req = requests[i]
    if (!/login-actions\/authenticate/i.test(req.url)) continue

    const authIdx = findPriorOpenIdAuthRequestIndex(requests, i)
    if (authIdx === -1) {
      if (
        KEYCLOAK_EXECUTION_UUID.test(req.url) ||
        /[?&]execution=execution(?:&|$)/i.test(req.url) ||
        /\{\{\s*execution\s*\}\}/i.test(req.url)
      ) {
        warnings.push(
          `Request "${req.name}": Keycloak authenticate URL references execution — no prior openid-connect/auth request found to attach extractors.`,
        )
      }
      continue
    }
    const authReq = requests[authIdx]

    if (/\{\{\s*execution\s*\}\}/i.test(req.url)) {
      ensureDualKeycloakExecutionExtractRules(correlationRules, authReq.id)
      continue
    }

    if (/[?&]execution=execution(?:&|$)/i.test(req.url)) {
      req.url = req.url.replace(/([?&])execution=execution(?=&|$)/gi, '$1execution={{execution}}')
      ensureDualKeycloakExecutionExtractRules(correlationRules, authReq.id)
      warnings.push(
        `Keycloak: fixed literal execution=execution in "${req.name}" to use {{execution}} and added extract rules on "${authReq.name}".`,
      )
      continue
    }

    if (!KEYCLOAK_EXECUTION_UUID.test(req.url)) continue

    const m = req.url.match(KEYCLOAK_EXECUTION_UUID)
    if (!m?.[1]) continue
    const uuid = m[1]

    ensureDualKeycloakExecutionExtractRules(correlationRules, authReq.id)
    req.url = req.url.split(`execution=${uuid}`).join('execution={{execution}}')
    warnings.push(
      `Keycloak: replaced static execution id in "${req.name}" with {{execution}} and ensured extract rules on "${authReq.name}".`,
    )
  }
}

/**
 * Keycloak login POST must include hidden `execution` (from prior /auth HTML). JMeter recordings often
 * keep only username/password in the sampler body — add a template placeholder so Send + k6 resolve it.
 */
function applyKeycloakAuthenticateBodyExecutionPlaceholder(requests: RequestDefinition[], warnings: string[]) {
  for (const req of requests) {
    if (!/login-actions\/authenticate/i.test(req.url)) continue
    if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') continue
    const b = (req.bodyText ?? '').trim()
    if (!b) continue
    if (/(?:^|&)execution=/i.test(b)) continue
    if (!/(?:^|&)username=/i.test(b) && !/(?:^|&)password=/i.test(b)) continue
    req.bodyText = b.endsWith('&') ? `${b}execution={{execution}}` : `${b}&execution={{execution}}`
    warnings.push(
      `Keycloak: appended execution={{execution}} to the form body of "${req.name}" so browser login replay matches Keycloak.`,
    )
  }
}

/** Raw `redirect_uri` query substring from an openid-connect/auth URL (percent-encoded as in the sampler). */
function extractRedirectUriRawFromUrl(url: string): string | null {
  const m = /[?&]redirect_uri=([^&]+)/i.exec(url)
  return m?.[1] ? m[1] : null
}

/** Raw `redirect_uri` form value from x-www-form-urlencoded body, or null if the parameter is absent. */
function extractRedirectUriRawFromFormBody(body: string): string | null {
  if (!/(?:^|&)redirect_uri=/i.test(body)) return null
  const m = /(?:^|&)redirect_uri=([^&]*)/i.exec(body)
  return m ? (m[1] ?? '') : null
}

function replaceRedirectUriInFormBody(body: string, newValueRaw: string): string {
  if (/(?:^|&)redirect_uri=/i.test(body)) {
    return body.replace(/(^|&)redirect_uri=[^&]*/i, (_, p1: string) => `${p1}redirect_uri=${newValueRaw}`)
  }
  if (!body) return `redirect_uri=${newValueRaw}`
  return body.endsWith('&') ? `${body}redirect_uri=${newValueRaw}` : `${body}&redirect_uri=${newValueRaw}`
}

function stableDecodeForRedirectCompare(s: string): string {
  try {
    let cur = s
    for (let i = 0; i < 4; i++) {
      const next = decodeURIComponent(cur.replace(/\+/g, ' '))
      if (next === cur) break
      cur = next
    }
    return cur
  } catch {
    return s
  }
}

function isLikelyAuthorizationCodeTokenRequest(req: RequestDefinition): boolean {
  if (req.method !== 'POST') return false
  const b = req.bodyText ?? ''
  if (!/(?:^|&)code=/i.test(b)) return false
  if (!/\bgrant_type\s*=\s*(authorization_code|authorization%5Fcode)\b/i.test(b)) return false
  const u = req.url.toLowerCase()
  return u.includes('/token') || u.includes('euum') || u.includes('oauth') || u.includes('openid-connect')
}

/**
 * RFC 6749: token `redirect_uri` must match the authorization request. Some EUUM/BPA flows intentionally
 * use a **different** callback on the Token sampler than on Keycloak `/auth` (internal portal vs
 * api-gateway) — do **not** overwrite a distinct Token `redirect_uri` (see LatestBPA-API2.jmx).
 */
function applyKeycloakRedirectUriAlignment(requests: RequestDefinition[], warnings: string[]) {
  for (let i = 0; i < requests.length; i++) {
    const req = requests[i]
    if (!isLikelyAuthorizationCodeTokenRequest(req)) continue

    const authIdx = findPriorOpenIdAuthRequestIndex(requests, i)
    if (authIdx < 0) continue

    const authReq = requests[authIdx]
    const authRu = extractRedirectUriRawFromUrl(authReq.url)
    if (authRu == null || authRu === '') continue

    const body = req.bodyText ?? ''
    const curRu = extractRedirectUriRawFromFormBody(body)
    if (curRu === null) {
      req.bodyText = replaceRedirectUriInFormBody(body, authRu)
      warnings.push(
        `Keycloak: added redirect_uri to "${req.name}" from prior "${authReq.name}" (openid-connect/auth).`,
      )
      continue
    }

    if (curRu === authRu) continue

    if (stableDecodeForRedirectCompare(curRu) === stableDecodeForRedirectCompare(authRu)) {
      req.bodyText = replaceRedirectUriInFormBody(body, authRu)
      warnings.push(
        `Keycloak: normalized redirect_uri encoding in "${req.name}" to match "${authReq.name}" authorization request.`,
      )
      continue
    }

    // Token redirect_uri differs from /auth on purpose (common for EUUM); never replace.
  }
}

function parseRegexExtractorsForSampler(
  sampler: Element,
  fromRequestId: string,
  typoFixCount: { n: number },
  typoCountedElements: Set<Element>,
): CorrelationRule[] {
  const ht = findSamplerPostHashTree(sampler)
  if (!ht) return []
  const rules: CorrelationRule[] = []
  ht.querySelectorAll('RegexExtractor').forEach((rx) => {
    if (rx.getAttribute('enabled') === 'false') return
    const rule = buildCorrelationRuleFromRegexElement(rx, fromRequestId, typoFixCount, typoCountedElements)
    if (rule) rules.push(rule)
  })
  return rules
}

/** Enabled JSR223 PostProcessors under the sampler’s post hashTree, in DOM order (JMeter execution order). */
function parseJsr223PostProcessorsForSampler(sampler: Element): JmeterJsr223PostProcessor[] {
  const ht = findSamplerPostHashTree(sampler)
  if (!ht) return []
  const out: JmeterJsr223PostProcessor[] = []
  for (const child of Array.from(ht.children)) {
    if (child.tagName !== 'JSR223PostProcessor') continue
    if (child.getAttribute('enabled') === 'false') continue
    const script = decodeHtmlEntities(prop(child, 'script') ?? '')
    const label =
      child.getAttribute('testname')?.trim() || child.getAttribute('name')?.trim() || undefined
    const language =
      prop(child, 'JSR223PostProcessor.scriptLanguage')?.trim() ||
      prop(child, 'scriptLanguage')?.trim() ||
      undefined
    out.push({
      id: buildId('jsr'),
      ...(label ? { label } : {}),
      ...(language ? { language } : {}),
      script,
    })
  }
  return out
}

/** JMeter props.put("token", vars.get("accessToken")) / vars.put — map target property → source JMeter var. */
function parseJsr223RuntimeMirrorsFromScript(script: string): { toProp: string; fromVar: string }[] {
  const out: { toProp: string; fromVar: string }[] = []
  const s = String(script ?? '')
  const re =
    /(?:props|vars)\.put\s*\(\s*["']([^"']+)["']\s*,\s*vars\.get\s*\(\s*["']([^"']+)["']\s*\)\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    const toProp = m[1]?.trim()
    const fromVar = m[2]?.trim()
    if (toProp && fromVar && toProp !== fromVar) out.push({ toProp, fromVar })
  }
  return out
}

function parseJsr223RuntimeMirrorsForSampler(sampler: Element): { toProp: string; fromVar: string }[] {
  const ht = findSamplerPostHashTree(sampler)
  if (!ht) return []
  const merged: { toProp: string; fromVar: string }[] = []
  ht.querySelectorAll('JSR223PostProcessor').forEach((el) => {
    if (el.getAttribute('enabled') === 'false') return
    const script = decodeHtmlEntities(prop(el, 'script') ?? '')
    merged.push(...parseJsr223RuntimeMirrorsFromScript(script))
  })
  return merged
}

function mergeJsr223MirrorsIntoCorrelationRules(
  rules: CorrelationRule[],
  mirrors: { toProp: string; fromVar: string }[],
  fromRequestId: string,
  warnings: string[],
  samplerLabel: string,
) {
  for (const { toProp, fromVar } of mirrors) {
    let hit = false
    for (const rule of rules) {
      if (rule.fromRequestId !== fromRequestId) continue
      if (rule.variableName !== fromVar) continue
      const next = [...(rule.runtimeMirrorTo ?? [])]
      if (!next.includes(toProp)) next.push(toProp)
      rule.runtimeMirrorTo = next
      hit = true
    }
    if (!hit) {
      warnings.push(
        `JSR223 mirror ${fromVar} → ${toProp} under "${samplerLabel}" has no matching Regex/JSON extractor for "${fromVar}" on that sampler — skipped.`,
      )
    }
  }
}

function scanJmxUnsupportedElements(doc: Document, warnings: string[]) {
  const nonHttp = doc.querySelectorAll(
    [
      'JDBCSampler',
      'TCPSampler',
      'JavaSampler',
      'JMSPublisher',
      'JMSSubscriber',
      'MailReaderSampler',
      'LDAPSampler',
      'AccessLogSampler',
      'TestAction',
      'DebugSampler',
      'BoltSampler',
      'FTPTestSampler',
      'SmtpSampler',
    ].join(', '),
  ).length
  if (nonHttp > 0) {
    warnings.push(
      `${nonHttp} non-HTTP sampler element(s) found — PerfMix only imports HTTP Request samplers (HTTPSamplerProxy and legacy HTTPSampler). Other sampler types are skipped.`,
    )
  }
  if (doc.querySelector('CookieManager')) {
    warnings.push(
      'HTTP Cookie Manager detected — sequential k6 export will use a per-VU cookie jar for this collection.',
    )
  }
  const jsr = doc.querySelectorAll('JSR223PostProcessor, JSR223PreProcessor, JSR223Sampler').length
  if (jsr) {
    warnings.push(
      `${jsr} JSR223 element(s): PostProcessor scripts are saved on each request (JSR223 tab). In-app Send runs a limited shim after extractors (props.put/vars.put with vars.get or string literals). PreProcessors, Samplers, and arbitrary Groovy/Java are not executed.`,
    )
  }
  const beans = doc.querySelectorAll('BeanShellPostProcessor, BeanShellPreProcessor, BeanShellSampler').length
  if (beans) {
    warnings.push(
      `${beans} BeanShell element(s) found — not imported (logic not executed in PerfMix). Add k6 checks or manual steps if you relied on that script.`,
    )
  }
  const jsonPost = doc.querySelectorAll('JSONPostProcessor').length
  if (jsonPost) warnings.push(`${jsonPost} JSON PostProcessor(s) found — not imported yet (use Regex extractors or add correlation rules manually).`)
}

/** HTTP Request samplers: modern `HTTPSamplerProxy` and legacy `HTTPSampler` (same stringProp layout). */
function collectJmxHttpSamplerElements(doc: Document, warnings: string[]): Element[] {
  const seen = new Set<Element>()
  const out: Element[] = []
  let disabled = 0
  for (const sel of ['HTTPSamplerProxy', 'HTTPSampler'] as const) {
    doc.querySelectorAll(sel).forEach((el) => {
      if (seen.has(el)) return
      seen.add(el)
      if (el.getAttribute('enabled') === 'false') {
        disabled += 1
        return
      }
      out.push(el)
    })
  }
  if (disabled > 0) {
    warnings.push(`Skipped ${disabled} disabled HTTP Request sampler(s) (enabled="false").`)
  }
  return out
}

function isThreadGroupTagName(tag: string): boolean {
  return tag === 'ThreadGroup' || tag === 'SetupThreadGroup' || tag === 'PostThreadGroup'
}

/**
 * Locate the ThreadGroup that owns this sampler.
 * JMeter stores: `<ThreadGroup/>` then `<hashTree>` … samplers … so walk up through `hashTree`
 * nodes and use `previousElementSibling` when it is a thread group; also accept a direct
 * parent-chain `ThreadGroup` for non-standard exports.
 */
function findAncestorThreadGroup(sampler: Element): Element | null {
  let cur: Element | null = sampler.parentElement
  while (cur) {
    const t = cur.tagName
    if (isThreadGroupTagName(t)) return cur
    if (t === 'hashTree') {
      const prev = cur.previousElementSibling
      if (prev && isThreadGroupTagName(prev.tagName)) return prev
    }
    cur = cur.parentElement
  }
  return null
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (value == null || value === '') return fallback
  const n = parseInt(value, 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function parseThreadGroupLoad(tg: Element, warnings: string[]): { vus: number; rampUp: string; duration: string } {
  const label = tg.getAttribute('testname')?.trim() || tg.getAttribute('name')?.trim() || 'Thread group'
  const vus = Math.max(1, parsePositiveInt(prop(tg, 'ThreadGroup.num_threads'), 1))
  const rampSec = parsePositiveInt(prop(tg, 'ThreadGroup.ramp_time'), 0)
  const rampUp = `${rampSec}s`

  const scheduler = prop(tg, 'ThreadGroup.scheduler') === 'true'
  let duration = '1m'

  if (scheduler) {
    const durSec = parsePositiveInt(prop(tg, 'ThreadGroup.duration'), 0)
    if (durSec > 0) {
      duration = `${durSec}s`
    } else {
      warnings.push(`Thread group "${label}": scheduler enabled but no duration — using 1m for the imported test case.`)
    }
  } else {
    const main = tg.querySelector('elementProp[name="ThreadGroup.main_controller"]')
    const loopsStr = main ? prop(main, 'LoopController.loops') : null
    const forever = main ? prop(main, 'LoopController.continue_forever') === 'true' : false
    if (forever || loopsStr === '-1') {
      warnings.push(
        `Thread group "${label}": infinite loop — k6 uses duration 1m in the imported test case (adjust as needed).`,
      )
    } else if (loopsStr && /^\d+$/.test(loopsStr) && parseInt(loopsStr, 10) > 0) {
      warnings.push(
        `Thread group "${label}": fixed loop count (${loopsStr}) is not mapped to k6; duration set to 1m — adjust if needed.`,
      )
    }
  }

  return { vus, rampUp, duration }
}

function buildImportedTestCase(
  threadGroupLabel: string | null,
  vus: number,
  duration: string,
  rampUp: string,
  constantTimerDelayMsTotal: number | null,
): RequestTestCase {
  const safeLabel = threadGroupLabel?.trim()
  const useThink =
    constantTimerDelayMsTotal != null &&
    Number.isFinite(constantTimerDelayMsTotal) &&
    constantTimerDelayMsTotal > 0
  return {
    id: buildId('tc'),
    name: safeLabel ? `Load (${safeLabel})` : 'Default load',
    vus,
    duration,
    rampUp,
    thinkTimeMs: useThink ? Math.round(constantTimerDelayMsTotal) : 0,
    thinkTimeEnabled: useThink,
    criteria: {
      maxAvgMs: 800,
      maxP95Ms: 1200,
      maxErrorRate: 0.01,
      minThroughputRps: 1,
    },
    criteriaToggles: {
      maxAvgMs: true,
      maxP95Ms: true,
      maxP99Ms: false,
      maxErrorRate: true,
      minThroughputRps: true,
    },
  }
}

/** Convert one HTTPSamplerProxy element to a RequestDefinition */
function samplerToRequest(sampler: Element, pDefaults: Map<string, string>): RequestDefinition {
  const testName =
    sampler.getAttribute('testname') ?? sampler.getAttribute('name') ?? 'Unnamed request'
  const methodRaw = (prop(sampler, 'HTTPSampler.method') ?? 'GET').toUpperCase()
  const protocol = transformJmeterExpressions(prop(sampler, 'HTTPSampler.protocol') ?? 'https', pDefaults)
  const domain = transformJmeterExpressions(prop(sampler, 'HTTPSampler.domain') ?? '', pDefaults)
  const port = transformJmeterExpressions(prop(sampler, 'HTTPSampler.port') ?? '', pDefaults)
  const pathRaw = prop(sampler, 'HTTPSampler.path') ?? '/'
  const path = transformJmeterExpressions(decodeHtmlEntities(pathRaw), pDefaults)
  const isRawBody = prop(sampler, 'HTTPSampler.postBodyRaw') === 'true'

  let url = buildUrl(protocol, domain, port, path)
  const parsedArgs = parseArguments(sampler, isRawBody, methodRaw, pDefaults)
  const query: Record<string, string> = { ...parsedArgs.query }
  let bodyText = parsedArgs.bodyText

  if (methodRaw === 'GET' || methodRaw === 'DELETE' || methodRaw === 'HEAD') {
    if (Object.keys(query).length > 0) {
      url = appendQueryToUrl(url, query)
    }
  }

  // Collect headers from attached HeaderManagers
  const headers: Record<string, string> = {}
  const headerManagers = findAttachedHeaderManagers(sampler)
  headerManagers.forEach((hm) => {
    const raw = parseHeaderManager(hm)
    for (const [k, v] of Object.entries(raw)) {
      if (skipJmxRecordedBrowserReplayHeader(k, path)) continue
      headers[transformJmeterExpressions(k, pDefaults)] = transformJmeterExpressions(v, pDefaults)
    }
  })
  normalizeImportedAuthorizationBearer(headers)

  let bodyType: BodyType | undefined
  if (bodyText.trim()) {
    if (!isRawBody) {
      bodyType = 'x-www-form-urlencoded'
    } else {
      bodyType = inferBodyTypeFromHeadersAndText(headers, bodyText) ?? 'text'
    }
  }

  const methodNorm =
    methodRaw === 'HEAD' ? 'GET' : (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(methodRaw) ? methodRaw : 'GET')

  const req: RequestDefinition = {
    id: buildId('req'),
    name: testName,
    method: methodNorm as RequestDefinition['method'],
    url,
    query: methodRaw === 'GET' || methodRaw === 'DELETE' || methodRaw === 'HEAD' ? {} : query,
    headers,
    bodyText,
    ...(bodyType ? { bodyType } : {}),
    testCases: [],
  }
  coerceImportedEuumTokenOAuthQueryIntoBody(req)
  return req
}

/** OAuth token fields must be in POST body for EUUM; JMeter sometimes stores them as URL query "Parameters". */
const EUUM_TOKEN_OAUTH_QUERY_KEYS = new Set([
  'code',
  'grant_type',
  'redirect_uri',
  'client_id',
  'client_secret',
  'scope',
  'code_verifier',
])

function coerceImportedEuumTokenOAuthQueryIntoBody(req: RequestDefinition): void {
  const m = req.method
  if (m !== 'POST' && m !== 'PUT' && m !== 'PATCH') return
  const u = req.url.toLowerCase()
  if (!u.includes('/euum/') || !u.includes('/authorize/v1/token')) return
  const q = req.query ?? {}
  const keys = Object.keys(q).filter((k) => k.trim())
  if (!keys.length) return
  const move = keys.filter((k) => EUUM_TOKEN_OAUTH_QUERY_KEYS.has(k.trim().toLowerCase()))
  if (!move.length) return

  const nextQuery: Record<string, string> = { ...q }
  const parts: string[] = []
  for (const k of move) {
    parts.push(
      `${encodeURIComponentPreservingPerfMixTemplates(k)}=${encodeURIComponentPreservingPerfMixTemplates(String(nextQuery[k] ?? ''))}`,
    )
    delete nextQuery[k]
  }
  req.query = nextQuery
  const prefix = (req.bodyText ?? '').trim()
  req.bodyText = prefix ? `${prefix}&${parts.join('&')}` : parts.join('&')
  if (!req.bodyType) req.bodyType = 'x-www-form-urlencoded'
  const h = req.headers ?? {}
  if (!Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) {
    req.headers = { ...h, 'Content-Type': 'application/x-www-form-urlencoded' }
  }
}

export type JmxParseResult =
  | { ok: true; collection: Collection; warnings: string[]; correlationRules: CorrelationRule[] }
  | { ok: false; error: string }

export type JmxParseOptions = {
  /** When true, collection stores jmxImportHints.correlationDebug for k6 export diagnostics. */
  correlationDebug?: boolean
}

/**
 * Parse a JMeter JMX XML string and convert it to a PerfMix Collection.
 *
 * Groups all HTTP samplers from the same ThreadGroup into the returned collection.
 * If there are multiple ThreadGroups, all requests are merged into one collection
 * and the collection name comes from the first ThreadGroup or TestPlan name.
 */
export function parseJmx(xmlText: string, options?: JmxParseOptions): JmxParseResult {
  const warnings: string[] = []

  let doc: Document
  try {
    const parser = new DOMParser()
    doc = parser.parseFromString(xmlText, 'application/xml')
    const parseError = doc.querySelector('parsererror')
    if (parseError) {
      return { ok: false, error: `XML parse error: ${parseError.textContent?.slice(0, 200) ?? 'Unknown error'}` }
    }
  } catch {
    return { ok: false, error: 'Failed to parse XML. Make sure the file is a valid JMeter .jmx file.' }
  }

  const root = doc.documentElement
  if (!root || root.tagName.toLowerCase() !== 'jmetertestplan') {
    // Try to be lenient — maybe the root is wrapped
    const testPlanEls = doc.querySelectorAll('jmeterTestPlan')
    if (testPlanEls.length === 0) {
      return { ok: false, error: 'Not a JMeter test plan. Expected <jmeterTestPlan> root element.' }
    }
  }

  // Determine collection name from TestPlan or first ThreadGroup
  const testPlanEl = doc.querySelector('TestPlan')
  const firstThreadGroup =
    doc.querySelector('ThreadGroup') ??
    doc.querySelector('SetupThreadGroup') ??
    doc.querySelector('PostThreadGroup')
  const collectionName =
    firstThreadGroup?.getAttribute('testname') ??
    testPlanEl?.getAttribute('testname') ??
    'Imported from JMX'

  const samplers = collectJmxHttpSamplerElements(doc, warnings)

  if (samplers.length === 0) {
    warnings.push('No HTTP Request samplers found (looked for HTTPSamplerProxy and legacy HTTPSampler).')
  }

  scanJmxUnsupportedElements(doc, warnings)

  const pDefaults = new Map<string, string>()
  const testPlanVars = parseUserDefinedVariables(doc)
  const planArgs = parsePlanLevelStandaloneArguments(doc)
  let variables = mergeVariableMaps(testPlanVars, planArgs, warnings, 'plan-level Arguments panel')
  const csvVars = parseCsvDataSetVariables(doc, warnings)
  variables = mergeVariableMaps(variables, csvVars, warnings, 'CSV Data Set Config')
  for (const [k, v] of Object.entries(variables)) {
    variables[k] = transformJmeterExpressions(v, pDefaults)
  }

  const useCookieJar = Boolean(doc.querySelector('CookieManager'))

  const requests: RequestDefinition[] = []
  const seenNames = new Map<string, number>()
  const correlationRules: CorrelationRule[] = []
  const samplerToRequestId = new Map<Element, string>()
  const postRegexSeen = new Set<Element>()
  const typoFixCount = { n: 0 }
  const regexTypoElements = new Set<Element>()

  for (const sampler of samplers) {
    const htMark = findSamplerPostHashTree(sampler)
    htMark?.querySelectorAll('RegexExtractor').forEach((rx) => postRegexSeen.add(rx))

    const req = samplerToRequest(sampler, pDefaults)
    const tg = findAncestorThreadGroup(sampler)
    if (tg) {
      if (tg.tagName === 'SetupThreadGroup') req.jmeterThreadGroupKind = 'setup'
      else if (tg.tagName === 'PostThreadGroup') req.jmeterThreadGroupKind = 'teardown'
      else if (tg.tagName === 'ThreadGroup') req.jmeterThreadGroupKind = 'main'
    }
    const jsrProcessors = parseJsr223PostProcessorsForSampler(sampler)
    if (jsrProcessors.length) {
      req.jmeterJsr223PostProcessors = jsrProcessors
    }
    const rxRules = parseRegexExtractorsForSampler(sampler, req.id, typoFixCount, regexTypoElements)
    const mirrors = parseJsr223RuntimeMirrorsForSampler(sampler)
    if (mirrors.length) {
      mergeJsr223MirrorsIntoCorrelationRules(rxRules, mirrors, req.id, warnings, req.name)
    }
    correlationRules.push(...rxRules)

    const importedAssertions = parseResponseAssertionsForSampler(sampler)
    if (importedAssertions.length) {
      req.assertions = importedAssertions
    }

    samplerToRequestId.set(sampler, req.id)

    let load: { vus: number; rampUp: string; duration: string } = { vus: 5, rampUp: '30s', duration: '1m' }
    let tgLabel: string | null = null
    if (tg) {
      tgLabel = tg.getAttribute('testname') ?? tg.getAttribute('name')
      load = parseThreadGroupLoad(tg, warnings)
    } else {
      warnings.push(
        `Request "${req.name}" has no Thread Group ancestor — using default load (5 VUs, 30s ramp, 1m) in the test case.`,
      )
    }
    const jmxThinkMs = findDirectConstantTimersDelayMsTotal(sampler)
    req.testCases = [buildImportedTestCase(tgLabel, load.vus, load.duration, load.rampUp, jmxThinkMs)]

    // Deduplicate names
    const base = req.name
    const count = seenNames.get(base) ?? 0
    seenNames.set(base, count + 1)
    if (count > 0) req.name = `${base} (${count + 1})`

    // Warn about empty URLs
    if (!req.url || req.url === '/') {
      warnings.push(`Request "${req.name}" has an empty or relative URL — set domain manually.`)
    }

    requests.push(req)
  }

  correlationRules.push(
    ...collectScopedRegexCorrelationRules(
      doc,
      postRegexSeen,
      samplerToRequestId,
      warnings,
      typoFixCount,
      regexTypoElements,
    ),
  )

  if (typoFixCount.n > 0) {
    warnings.push(
      `Corrected common JMeter regex typo "(+?)" to "(.+?)" in ${typoFixCount.n} RegexExtractor pattern(s).`,
    )
  }

  applyKeycloakExecutionRewrite(requests, correlationRules, warnings)
  applyKeycloakAuthenticateBodyExecutionPlaceholder(requests, warnings)
  applyKeycloakRedirectUriAlignment(requests, warnings)

  for (const [k, v] of pDefaults.entries()) {
    if (!Object.prototype.hasOwnProperty.call(variables, k) || variables[k] === '') {
      variables[k] = v
    }
  }

  for (const [k, v] of Object.entries(variables)) {
    if (v === `{{${k}}}` && pDefaults.has(k)) {
      variables[k] = pDefaults.get(k) ?? ''
    }
  }

  const suggestSequential = useCookieJar || correlationRules.length > 0

  if (requests.some((r) => /keycloak|openid-connect|login-actions\/authenticate/i.test(r.url))) {
    warnings.push(
      'OAuth/Keycloak URLs detected: session_code, tab_id, and execution values are session-specific. If Authenticate fails after import, enable “Emit correlation debug in k6” and re-import to log empty RUNTIME variables during k6 runs.',
    )
  }

  const jmxImportHints: JmxImportHints = {}
  if (useCookieJar) jmxImportHints.useCookieJar = true
  if (options?.correlationDebug) jmxImportHints.correlationDebug = true

  const collection: Collection = {
    id: buildId('col'),
    name: collectionName,
    requests,
    ...(Object.keys(variables).length ? { variables } : {}),
    ...(Object.keys(jmxImportHints).length ? { jmxImportHints } : {}),
    ...(suggestSequential ? { k6CollectionExecution: 'sequential' as const } : {}),
  }

  if (suggestSequential) {
    warnings.push(
      'Collection run mode set to sequential journey so cookie jar and/or response extractors apply in k6 export order.',
    )
  }

  return { ok: true, collection, warnings, correlationRules }
}
