import type { RequestDefinition } from '../models/types'
import { buildUrlWithQuery } from './httpSend'

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

export function resolveVar(name: string, ctx: TemplateContext): string {
  const vo = ctx.variableOverrides
  if (vo && Object.prototype.hasOwnProperty.call(vo, name)) return String(vo[name])
  const ro = ctx.runtimeVarOverrides
  if (ro && Object.prototype.hasOwnProperty.call(ro, name)) return String(ro[name])
  const envMap = getActiveEnvVariables(ctx)
  if (Object.prototype.hasOwnProperty.call(envMap, name)) return String(envMap[name])
  if (Object.prototype.hasOwnProperty.call(ctx.collectionVariables ?? {}, name))
    return String((ctx.collectionVariables ?? {})[name])
  if (Object.prototype.hasOwnProperty.call(ctx.projectVariables ?? {}, name))
    return String((ctx.projectVariables ?? {})[name])
  if (Object.prototype.hasOwnProperty.call(ctx.sharedVariables ?? {}, name))
    return String((ctx.sharedVariables ?? {})[name])
  return name
}

export function applyTemplate(input: string | null | undefined, ctx: TemplateContext): string {
  if (input == null) return ''
  return String(input).replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) => String(resolveVar(key, ctx)))
}

export function resolveRequestForHttp(
  req: RequestDefinition,
  ctx: TemplateContext,
): { method: string; url: string; headers: Record<string, string>; body: string } {
  const baseUrl = applyTemplate(req.url, ctx)
  const query: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.query ?? {})) {
    if (!k.trim()) continue
    query[k] = applyTemplate(v, ctx)
  }
  const url = buildUrlWithQuery(baseUrl, query)
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    const rk = applyTemplate(k, ctx)
    headers[rk] = applyTemplate(v, ctx)
  }
  const body = applyTemplate(req.bodyText ?? '', ctx)
  return { method: req.method, url, headers, body }
}
