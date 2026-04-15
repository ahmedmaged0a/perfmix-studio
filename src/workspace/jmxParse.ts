/**
 * JMeter JMX → PerfMix Collection parser
 *
 * Handles the most common JMeter patterns:
 *   - HTTPSamplerProxy (HTTP Request samplers)
 *   - HeaderManager (attached headers)
 *   - ThreadGroup / GenericSampler containers (for collection name)
 *   - Nested hashTree structures (controllers, loops, ifs)
 *   - Raw body (postBodyRaw=true) and form params / query params
 *   - HTTPS / HTTP detection via protocol property
 */

import type { Collection, RequestDefinition } from '../models/types'

function buildId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

/** Recursively collect all elements matching tag anywhere in subtree */
function allByTag(root: Element, tag: string): Element[] {
  return Array.from(root.querySelectorAll(tag))
}

/** Read a named stringProp / boolProp / intProp child */
function prop(el: Element, name: string): string | null {
  const found = Array.from(el.children).find(
    (c) =>
      (c.tagName === 'stringProp' || c.tagName === 'boolProp' || c.tagName === 'intProp') &&
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

/** Extract query params or body from HTTPSamplerProxy arguments */
function parseArguments(
  sampler: Element,
  isRawBody: boolean,
  method: string,
): { query: Record<string, string>; bodyText: string } {
  const query: Record<string, string> = {}
  let bodyText = ''

  const argsEl = sampler.querySelector('elementProp[name="HTTPsampler.Arguments"]')
  if (!argsEl) return { query, bodyText }

  const argEls = argsEl.querySelectorAll('elementProp[elementType="HTTPArgument"]')

  if (isRawBody) {
    // Raw body — first argument's value is the entire body
    const first = argEls[0]
    if (first) bodyText = prop(first, 'Argument.value') ?? ''
  } else if (method === 'GET' || method === 'DELETE' || method === 'HEAD') {
    // Query parameters
    argEls.forEach((arg) => {
      const name = prop(arg, 'Argument.name')
      const value = prop(arg, 'Argument.value')
      if (name) query[name] = value ?? ''
    })
  } else {
    // Form-encoded body (POST/PUT/PATCH with non-raw args)
    const pairs: string[] = []
    argEls.forEach((arg) => {
      const name = prop(arg, 'Argument.name')
      const value = prop(arg, 'Argument.value')
      if (name !== null) {
        pairs.push(`${encodeURIComponent(name ?? '')}=${encodeURIComponent(value ?? '')}`)
      }
    })
    if (pairs.length > 0) bodyText = pairs.join('&')
  }
  return { query, bodyText }
}

/** Convert one HTTPSamplerProxy element to a RequestDefinition */
function samplerToRequest(sampler: Element): RequestDefinition {
  const testName =
    sampler.getAttribute('testname') ?? sampler.getAttribute('name') ?? 'Unnamed request'
  const method = (prop(sampler, 'HTTPSampler.method') ?? 'GET').toUpperCase() as RequestDefinition['method']
  const protocol = prop(sampler, 'HTTPSampler.protocol') ?? 'https'
  const domain = prop(sampler, 'HTTPSampler.domain') ?? ''
  const port = prop(sampler, 'HTTPSampler.port') ?? ''
  const path = prop(sampler, 'HTTPSampler.path') ?? '/'
  const isRawBody = prop(sampler, 'HTTPSampler.postBodyRaw') === 'true'

  const url = buildUrl(protocol, domain, port, path)
  const { query, bodyText } = parseArguments(sampler, isRawBody, method)

  // Collect headers from attached HeaderManagers
  const headers: Record<string, string> = {}
  const headerManagers = findAttachedHeaderManagers(sampler)
  headerManagers.forEach((hm) => {
    Object.assign(headers, parseHeaderManager(hm))
  })

  return {
    id: buildId('req'),
    name: testName,
    method: (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).includes(method as never)
      ? (method as RequestDefinition['method'])
      : 'GET',
    url,
    query,
    headers,
    bodyText,
    testCases: [],
  }
}

export type JmxParseResult =
  | { ok: true; collection: Collection; warnings: string[] }
  | { ok: false; error: string }

/**
 * Parse a JMeter JMX XML string and convert it to a PerfMix Collection.
 *
 * Groups all HTTP samplers from the same ThreadGroup into the returned collection.
 * If there are multiple ThreadGroups, all requests are merged into one collection
 * and the collection name comes from the first ThreadGroup or TestPlan name.
 */
export function parseJmx(xmlText: string): JmxParseResult {
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

  // Find all HTTP samplers
  const samplers = Array.from(doc.querySelectorAll('HTTPSamplerProxy'))

  if (samplers.length === 0) {
    warnings.push('No HTTP Request samplers found in the JMX file.')
  }

  const requests: RequestDefinition[] = []
  const seenNames = new Map<string, number>()

  for (const sampler of samplers) {
    const req = samplerToRequest(sampler)

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

  const collection: Collection = {
    id: buildId('col'),
    name: collectionName,
    requests,
  }

  return { ok: true, collection, warnings }
}
