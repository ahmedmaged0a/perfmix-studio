/** Parse common k6-style duration strings (e.g. 30s, 1m, 2m30s, plain seconds). */
export function parseDurationToSeconds(d: string): number {
  let s = 0
  const mMatch = d.match(/(\d+)\s*m/)
  const sMatch = d.match(/(\d+)\s*s/)
  if (mMatch) s += parseInt(mMatch[1], 10) * 60
  if (sMatch) s += parseInt(sMatch[1], 10)
  if (s === 0 && /^\d+$/.test(d.trim())) s = parseInt(d.trim(), 10)
  return s
}
