import type { JmeterJsr223PostProcessor } from '../models/types'

/**
 * Best-effort interpretation of common JMeter JSR223 PostProcessor lines after correlation extractors.
 * Does not execute Groovy/Java — only maps known `props.put` / `vars.put` patterns into RUNTIME.
 */
export function applyJmeterJsr223PostProcessorShim(
  runtime: Record<string, string>,
  scriptLogs: string[],
  processors: JmeterJsr223PostProcessor[] | undefined,
): void {
  if (!processors?.length) return
  for (const p of processors) {
    applyJsr223ScriptFragmentToRuntime(runtime, scriptLogs, p.script ?? '', p.label)
  }
}

/** Exposed for unit tests: apply one concatenated script body. */
export function applyJsr223ScriptFragmentToRuntime(
  runtime: Record<string, string>,
  scriptLogs: string[],
  script: string,
  processorLabel?: string,
): void {
  const src = String(script ?? '')
  if (!src.trim()) return
  const prefix = processorLabel ? `[jsr223] "${processorLabel}"` : '[jsr223]'

  // props.put("A", vars.get("B")) or vars.put('A', vars.get('B').trim())
  const rePutGet =
    /(?:props|vars)\.put\s*\(\s*(["'])([\w.$-]+)\1\s*,\s*vars\.get\s*\(\s*(["'])([\w.$-]+)\3\s*\)(?:\s*\.\s*trim\s*\(\s*\))?\s*\)/g
  for (const m of src.matchAll(rePutGet)) {
    const target = m[2]
    const source = m[4]
    let val = (runtime[source] ?? '').trim()
    // JMeter sometimes copies e.g. `token` from `accessToken` after extractors we do not import.
    // Do **not** substitute `token`/`accessToken` for `updatedToken*` self-ref — BPA binds `updatedToken`
    // to the "default" API remapped header; falling back to `token` collapses distinct JWTs.
    const isUpdatedTokenKey = (name: string) => {
      const t = name.trim()
      if (t === 'UPDATED_TOKEN') return true
      const n = t.toLowerCase().replace(/-/g, '_')
      return n === 'updatedtoken' || n === 'updated_token'
    }
    let usedSelfRefFallback = false
    if (!val && target === source) {
      if (!isUpdatedTokenKey(target)) {
        val =
          (runtime.token ?? '').trim() ||
          (runtime.accessToken ?? '').trim() ||
          (runtime.access_token ?? '').trim()
        if (val) usedSelfRefFallback = true
      }
    }
    if (!val) {
      scriptLogs.push(`${prefix} skipped props/vars.put("${target}", vars.get("${source}")) — source empty`)
      continue
    }
    runtime[target] = val
    if (usedSelfRefFallback) {
      scriptLogs.push(`${prefix} ${target} ← token/accessToken (self-ref vars.get("${source}") was empty)`)
    } else {
      scriptLogs.push(`${prefix} ${target} ← vars.get("${source}")`)
    }
  }

  // props.put("A", "literal")
  const rePutStrDq = /(?:props|vars)\.put\s*\(\s*"([^"]+)"\s*,\s*"([^"]*)"\s*\)/g
  for (const m of src.matchAll(rePutStrDq)) {
    const target = m[1]
    const val = m[2]
    runtime[target] = val
    scriptLogs.push(`${prefix} ${target} ← "${val.length > 48 ? `${val.slice(0, 48)}…` : val}"`)
  }

  // vars.put('A', 'literal')
  const rePutStrSq = /(?:props|vars)\.put\s*\(\s*'([^']+)'\s*,\s*'([^']*)'\s*\)/g
  for (const m of src.matchAll(rePutStrSq)) {
    const target = m[1]
    const val = m[2]
    runtime[target] = val
    scriptLogs.push(`${prefix} ${target} ← '${val.length > 48 ? `${val.slice(0, 48)}…` : val}'`)
  }
}
