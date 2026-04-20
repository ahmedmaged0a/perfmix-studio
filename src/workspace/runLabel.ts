/** Slug segment for k6 run_id stem (Rust sanitizes again for filesystem safety). */

export function slugifyPart(s: string): string {
  return s
    .trim()
    .replace(/[^\w\s-]+/g, '')
    .replace(/[\s/\\:]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

function stamp(): { date: string; time: string } {
  const d = new Date()
  return {
    date: d.toISOString().slice(0, 10),
    time: d.toTimeString().slice(0, 8).replace(/:/g, ''),
  }
}

export function buildWorkspaceRunLabelStem(input: {
  exportTarget: 'collection' | 'request'
  collectionName: string
  requestName?: string
}): string {
  const { date, time } = stamp()
  const col = slugifyPart(input.collectionName) || 'collection'
  if (input.exportTarget === 'collection') {
    return `${col}_all_${date}_${time}`.slice(0, 80)
  }
  const req = slugifyPart(input.requestName ?? 'request') || 'request'
  return `${col}_${req}_${date}_${time}`.slice(0, 80)
}

export function buildCodegenRunLabelStem(input: {
  mode: 'collection' | 'single'
  scenarioName: string
  requestDisplayName?: string
}): string {
  const { date, time } = stamp()
  const scen = slugifyPart(input.scenarioName) || 'scenario'
  if (input.mode === 'single' && input.requestDisplayName) {
    const req = slugifyPart(input.requestDisplayName) || 'request'
    return `${scen}_${req}_${date}_${time}`.slice(0, 80)
  }
  return `${scen}_collection_${date}_${time}`.slice(0, 80)
}
