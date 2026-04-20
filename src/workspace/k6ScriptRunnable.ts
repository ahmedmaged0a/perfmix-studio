/** Workspace placeholder when there are no requests to export. */
export const EMPTY_K6_PLACEHOLDER = '// No requests in this collection. Add a request to generate k6.\n'

/**
 * True if the buffer looks like a k6 script PerfMix can run (has an `export default` entrypoint).
 * Empty, whitespace-only, comment-only, and the workspace placeholder are not runnable.
 */
export function isRunnableK6Script(script: string): boolean {
  const t = script.trim()
  if (!t) return false
  const oneLine = t.replace(/\r\n/g, '\n').replace(/\n+$/, '').trim()
  const placeholderLine = EMPTY_K6_PLACEHOLDER.replace(/\r\n/g, '\n').replace(/\n+$/, '').trim()
  if (oneLine === placeholderLine) return false
  if (!/\bexport\s+default\b/.test(t)) return false
  return true
}
