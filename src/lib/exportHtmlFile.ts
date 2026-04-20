import { invoke } from '@tauri-apps/api/core'

function hasTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Strip path segments and unsafe characters; keep a sensible .html default. */
export function sanitizeHtmlDownloadName(name: string): string {
  const base = name
    .trim()
    .replace(/[/\\?*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120)
  if (!base) return 'report.html'
  const lower = base.toLowerCase()
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return base
  return `${base}.html`
}

export type ExportHtmlFileInput = {
  html: string
  defaultFileName: string
}

export type ExportHtmlFileResult =
  | { ok: true; mode: 'native'; path: string; fileName: string }
  | { ok: true; mode: 'browser'; fileName: string }
  | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'error'; message: string }

/**
 * Desktop (Tauri): native save dialog + write file. Browser: trigger download to default folder.
 */
export async function exportHtmlFile(input: ExportHtmlFileInput): Promise<ExportHtmlFileResult> {
  const fileName = sanitizeHtmlDownloadName(input.defaultFileName)
  if (!input.html.trim()) {
    return { ok: false, reason: 'error', message: 'Nothing to export.' }
  }

  if (hasTauriRuntime()) {
    try {
      const path = await invoke<string | null>('export_html_file', {
        defaultFileName: fileName,
        html: input.html,
      })
      if (path == null || path === '') {
        return { ok: false, reason: 'cancelled' }
      }
      const leaf = path.replace(/^.*[/\\]/, '') || fileName
      return { ok: true, mode: 'native', path, fileName: leaf }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return { ok: false, reason: 'error', message }
    }
  }

  try {
    const blob = new Blob([input.html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
    return { ok: true, mode: 'browser', fileName }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: 'error', message }
  }
}

const MAX_TOAST_PATH = 420

/** User-facing success copy for toast (single string; store supports plain text). */
export function formatExportSuccessToast(result: Extract<ExportHtmlFileResult, { ok: true }>): string {
  if (result.mode === 'native') {
    const path =
      result.path.length > MAX_TOAST_PATH ? `${result.path.slice(0, MAX_TOAST_PATH)}…` : result.path
    return `HTML report exported successfully.\n${path}`
  }
  return `HTML report exported successfully. Saved as "${result.fileName}" to your browser's default download folder.`
}
