import type { HttpExecuteResponse, RequestAssertion, RequestDefinition } from '../models/types'
import { evaluateAssertions } from './assertionRunner'
import { executeHttpRequest } from './httpSend'
import type { TemplateContext } from './resolveWorkspaceTemplates'
import { applyTemplate, getActiveEnvVariables, resolveRequestForHttp } from './resolveWorkspaceTemplates'

export type HttpPipelineOptions = {
  request: RequestDefinition
  templateCtx: TemplateContext
}

export type HttpPipelineResult = {
  method: string
  resolvedUrl: string
  result: HttpExecuteResponse
  assertionResults: { assertion: RequestAssertion; pass: boolean; detail: string }[]
  scriptLogs: string[]
  scriptError?: string
}

function makeScriptConsole(logs: string[]) {
  const push = (level: string, args: unknown[]) => {
    const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
    logs.push(level ? `[${level}] ${line}` : line)
  }
  return {
    log: (...args: unknown[]) => push('', args),
    warn: (...args: unknown[]) => push('warn', args),
    error: (...args: unknown[]) => push('error', args),
  }
}

function wrapPmResponse(res: HttpExecuteResponse) {
  const headerMap = new Map(res.responseHeaders.map(([k, v]) => [k.toLowerCase(), v]))
  return {
    code: res.status,
    status: res.status,
    reason: res.statusText,
    headers: {
      get(name: string) {
        return headerMap.get(name.toLowerCase()) ?? null
      },
    },
    text() {
      return res.body ?? ''
    },
    json() {
      const t = res.body ?? ''
      if (!t.trim()) return null
      return JSON.parse(t) as unknown
    },
  }
}

function basePm(
  ctx: TemplateContext,
  draft: { method: string; url: string; headers: Record<string, string>; body: string },
  scriptLogs: string[],
) {
  const console = makeScriptConsole(scriptLogs)
  const pm = {
    request: {
      get url() {
        return draft.url
      },
      set url(v: string) {
        draft.url = applyTemplate(String(v), ctx)
      },
      get method() {
        return draft.method
      },
      set method(v: string) {
        const u = String(v).toUpperCase()
        if (u === 'GET' || u === 'POST' || u === 'PUT' || u === 'PATCH' || u === 'DELETE') draft.method = u as RequestDefinition['method']
      },
      headers: {
        upsert(key: string, value: string) {
          draft.headers[key] = applyTemplate(value, ctx)
        },
        add(obj: { key: string; value: string }) {
          draft.headers[obj.key] = applyTemplate(obj.value, ctx)
        },
        remove(key: string) {
          delete draft.headers[key]
        },
      },
      get body() {
        return draft.body
      },
      set body(v: string) {
        draft.body = applyTemplate(String(v), ctx)
      },
    },
    collectionVariables: {
      get: (k: string) => ctx.collectionVariables[k],
      set: (k: string, v: string) => {
        ctx.collectionVariables[k] = applyTemplate(String(v), ctx)
      },
    },
    environment: {
      get: (k: string) => {
        if (ctx.runtimeVarOverrides && Object.prototype.hasOwnProperty.call(ctx.runtimeVarOverrides, k)) {
          return ctx.runtimeVarOverrides[k]
        }
        const envMap = getActiveEnvVariables(ctx)
        return envMap[k]
      },
      set: (k: string, v: string) => {
        if (!ctx.runtimeVarOverrides) ctx.runtimeVarOverrides = {}
        ctx.runtimeVarOverrides[k] = String(v)
      },
    },
    variables: {
      get: (k: string) => ctx.variableOverrides?.[k],
      set: (k: string, v: string) => {
        if (!ctx.variableOverrides) ctx.variableOverrides = {}
        ctx.variableOverrides[k] = String(v)
      },
    },
    sendRequest(
      urlOrOpts: string | { url: string; method?: string; headers?: Record<string, string>; body?: string | null },
      callback?: (err: Error | null, res: ReturnType<typeof wrapPmResponse> | null) => void,
    ) {
      const opts =
        typeof urlOrOpts === 'string'
          ? { url: urlOrOpts, method: 'GET', headers: {} as Record<string, string>, body: undefined as string | undefined }
          : {
              url: urlOrOpts.url,
              method: urlOrOpts.method ?? 'GET',
              headers: urlOrOpts.headers ?? {},
              body: urlOrOpts.body ?? undefined,
            }
      void (async () => {
        try {
          const inner = await executeHttpRequest({
            method: opts.method,
            url: applyTemplate(opts.url, ctx),
            headers: Object.fromEntries(
              Object.entries(opts.headers).map(([k, v]) => [k, applyTemplate(v, ctx)]),
            ),
            body: opts.body != null ? applyTemplate(String(opts.body), ctx) : undefined,
          })
          const wrapped = wrapPmResponse(inner)
          callback?.(null, wrapped)
        } catch (e) {
          callback?.(e instanceof Error ? e : new Error(String(e)), null)
        }
      })()
    },
    test(name: string, fn: () => void) {
      const label = String(name)
      try {
        fn()
        scriptLogs.push(`[test] ✓ ${label}`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        scriptLogs.push(`[test] ✗ ${label}: ${msg}`)
      }
    },
  }
  return { pm, console }
}

function createPrePm(
  ctx: TemplateContext,
  draft: { method: string; url: string; headers: Record<string, string>; body: string },
  scriptLogs: string[],
) {
  return basePm(ctx, draft, scriptLogs)
}

function createPostPm(
  ctx: TemplateContext,
  draft: { method: string; url: string; headers: Record<string, string>; body: string },
  response: HttpExecuteResponse,
  scriptLogs: string[],
) {
  const { pm, console } = basePm(ctx, draft, scriptLogs)
  Object.defineProperty(pm, 'response', {
    enumerable: true,
    configurable: true,
    get() {
      return wrapPmResponse(response)
    },
  })
  return { pm, console }
}

async function runScript(
  code: string | undefined,
  pm: object,
  console: ReturnType<typeof makeScriptConsole>,
): Promise<void> {
  const trimmed = code?.trim()
  if (!trimmed) return
  const fn = new Function('pm', 'console', `return (async () => {\n${trimmed}\n})();`)
  const out = fn(pm, console) as unknown
  if (out != null && typeof (out as Promise<unknown>).then === 'function') {
    await (out as Promise<unknown>)
  }
}

export async function runSingleRequestHttpPipeline(opts: HttpPipelineOptions): Promise<HttpPipelineResult> {
  const scriptLogs: string[] = []
  const templateCtx: TemplateContext = {
    ...opts.templateCtx,
    collectionVariables: opts.templateCtx.collectionVariables,
    runtimeVarOverrides:
      opts.templateCtx.runtimeVarOverrides !== undefined && opts.templateCtx.runtimeVarOverrides !== null
        ? opts.templateCtx.runtimeVarOverrides
        : {},
    variableOverrides:
      opts.templateCtx.variableOverrides !== undefined && opts.templateCtx.variableOverrides !== null
        ? opts.templateCtx.variableOverrides
        : {},
  }

  let resolved = resolveRequestForHttp(opts.request, templateCtx)
  const draft = { method: resolved.method, url: resolved.url, headers: { ...resolved.headers }, body: resolved.body }

  const pre = opts.request.preRequestScript
  if (pre?.trim()) {
    try {
      const { pm, console } = createPrePm(templateCtx, draft, scriptLogs)
      await runScript(pre, pm, console)
      resolved = { method: draft.method as RequestDefinition['method'], url: draft.url, headers: { ...draft.headers }, body: draft.body }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        method: draft.method,
        resolvedUrl: draft.url,
        result: {
          ok: false,
          status: 0,
          statusText: '',
          responseHeaders: [],
          body: '',
          error: `Pre-request script failed: ${msg}`,
          durationMs: 0,
        },
        assertionResults: [],
        scriptLogs,
        scriptError: `Pre-request script: ${msg}`,
      }
    }
  }

  const t0 = performance.now()
  let result: HttpExecuteResponse
  try {
    result = await executeHttpRequest({
      method: resolved.method,
      url: resolved.url,
      headers: resolved.headers,
      body: ['GET', 'HEAD'].includes(resolved.method.toUpperCase()) ? undefined : resolved.body,
    })
  } catch (e) {
    result = {
      ok: false,
      status: 0,
      statusText: '',
      responseHeaders: [],
      body: '',
      error: e instanceof Error ? e.message : String(e),
      durationMs: Math.round(performance.now() - t0),
    }
  }

  const post = opts.request.postRequestScript
  if (post?.trim()) {
    try {
      const { pm, console } = createPostPm(templateCtx, draft, result, scriptLogs)
      await runScript(post, pm, console)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      scriptLogs.push(`[error] Post-request script: ${msg}`)
      return {
        method: resolved.method,
        resolvedUrl: resolved.url,
        result,
        assertionResults: evaluateAssertions(opts.request.assertions ?? [], result),
        scriptLogs,
        scriptError: `Post-request script: ${msg}`,
      }
    }
  }

  return {
    method: resolved.method,
    resolvedUrl: resolved.url,
    result,
    assertionResults: evaluateAssertions(opts.request.assertions ?? [], result),
    scriptLogs,
  }
}

export function buildTemplateContextFromAppState(input: {
  activeEnvironment: string
  envVariables: Record<string, Record<string, string>>
  sharedVariables: Record<string, string>
  collectionVariables: Record<string, string>
  projectVariables: Record<string, string>
}): TemplateContext {
  return {
    activeEnvironment: input.activeEnvironment,
    envVariables: input.envVariables ?? {},
    sharedVariables: input.sharedVariables ?? {},
    collectionVariables: input.collectionVariables ?? {},
    projectVariables: input.projectVariables ?? {},
  }
}
