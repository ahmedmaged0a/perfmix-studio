import { invoke } from '@tauri-apps/api/core'
import type { HttpExecuteResponse, K6RunResult, RuntimeDiagnostics } from '../models/types'

type BootstrapPayload = {
  k6_path: string
}

type TauriRunStatusPayload = {
  run_id: string
  status: K6RunResult['status']
  logs: string[]
  summary_path?: string
  report_html_path?: string
  summary_json?: string | null
}

type TauriDiagnosticsPayload = {
  tauri_available: boolean
  k6_path: string
  mode: 'bundled' | 'path' | 'unavailable'
  can_execute: boolean
  runs_dir_writable: boolean
  k6_version: string
  issues: string[]
}

function hasTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

type AuthLoginResult = {
  ok: boolean
  username: string
}

/** @deprecated Legacy SQLite login; the app uses Supabase Auth from the SPA. Kept only for backward compatibility / experiments. */
export async function tauriAuthLogin(username: string, password: string): Promise<AuthLoginResult | null> {
  if (!hasTauriRuntime()) return null
  return invoke<AuthLoginResult>('auth_login', { input: { username, password } })
}

export async function tauriAppDataGet(username: string): Promise<string | null | undefined> {
  if (!hasTauriRuntime()) return undefined
  return invoke<string | null>('app_data_get', { username })
}

export async function tauriAppDataSave(username: string, payloadJson: string): Promise<boolean> {
  if (!hasTauriRuntime()) return false
  await invoke<void>('app_data_save', { username, payloadJson })
  return true
}

export type HttpExecuteInput = {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
  /** Per Send-batch cookie jar (Keycloak replay); Tauri only. */
  cookieSessionId?: string
}

export async function tauriHttpExecute(input: HttpExecuteInput): Promise<HttpExecuteResponse | null> {
  if (!hasTauriRuntime()) return null
  return invoke<HttpExecuteResponse>('http_execute', { input })
}

/** Drop an in-app HTTP cookie session after Send / Send all (frees memory; next run is fresh). */
export async function tauriHttpCookieSessionDrop(sessionId: string): Promise<void> {
  if (!hasTauriRuntime()) return
  const s = sessionId.trim()
  if (!s) return
  await invoke<void>('http_cookie_session_drop', { session_id: s })
}

export async function tauriBootstrapRuntime(): Promise<BootstrapPayload | null> {
  if (!hasTauriRuntime()) return null
  return invoke<BootstrapPayload>('bootstrap_runtime')
}

export async function tauriRunK6(
  script: string,
  username: string,
  quiet: boolean,
  runLabel?: string | null,
): Promise<{ runId: string } | null> {
  if (!hasTauriRuntime()) return null
  const runId = await invoke<string>('run_k6', {
    script,
    username,
    quiet,
    runLabel: runLabel && runLabel.trim() ? runLabel.trim() : null,
  })
  return { runId }
}

export async function tauriStopK6(runId: string): Promise<boolean> {
  if (!hasTauriRuntime()) return false
  await invoke<void>('stop_k6', { runId })
  return true
}

export async function tauriGetK6Status(runId: string): Promise<K6RunResult | null> {
  if (!hasTauriRuntime()) return null
  const payload = await invoke<TauriRunStatusPayload>('get_k6_status', { runId })
  return {
    runId: payload.run_id,
    status: payload.status,
    logs: payload.logs,
    summaryPath: payload.summary_path,
    reportHtmlPath: payload.report_html_path,
    summaryJson: payload.summary_json,
  }
}

export async function tauriReadRunReportHtml(runId: string): Promise<string | null> {
  if (!hasTauriRuntime()) return null
  return invoke<string>('read_run_report_html', { runId })
}

export async function tauriGetRuntimeDiagnostics(): Promise<RuntimeDiagnostics | null> {
  if (!hasTauriRuntime()) return null
  const payload = await invoke<TauriDiagnosticsPayload>('runtime_diagnostics')
  return {
    tauriAvailable: payload.tauri_available,
    k6Path: payload.k6_path,
    mode: payload.mode,
    canExecute: payload.can_execute,
    runsDirWritable: payload.runs_dir_writable,
    k6Version: payload.k6_version,
    issues: payload.issues,
  }
}
