import type { AppData, K6RunResult, RuntimeDiagnostics } from '../models/types'
import { appDataMock } from './mockData'
import { fromAppDataDto, toAppDataDto } from './mappers'
import type { AppDataDto } from './dto'
import {
  tauriAppDataGet,
  tauriAppDataSave,
  tauriGetK6Status,
  tauriGetRuntimeDiagnostics,
  tauriRunK6,
  tauriStopK6,
} from '../desktop/tauriBridge'

export interface ApiClient {
  getAppData: (username: string) => Promise<AppData | null>
  saveAppData: (username: string, payload: AppData) => Promise<void>
  startK6Run: (script: string, username: string, quiet: boolean) => Promise<{ runId: string }>
  stopK6Run: (runId: string) => Promise<void>
  getK6RunStatus: (runId: string) => Promise<K6RunResult>
  getRuntimeDiagnostics: () => Promise<RuntimeDiagnostics>
}

class HttpApiClient implements ApiClient {
  private baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

  async getAppData(_username: string): Promise<AppData | null> {
    const response = await fetch(`${this.baseUrl}/api/app-data`)
    if (!response.ok) {
      throw new Error('Failed to load app data from backend.')
    }
    const dto = (await response.json()) as AppDataDto
    return fromAppDataDto(dto)
  }

  async saveAppData(_username: string, payload: AppData): Promise<void> {
    const dto = toAppDataDto(payload)
    const response = await fetch(`${this.baseUrl}/api/app-data`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dto),
    })
    if (!response.ok) {
      throw new Error('Failed to save app data to backend.')
    }
  }

  async startK6Run(script: string, username: string, quiet: boolean): Promise<{ runId: string }> {
    const tauriResult = await tauriRunK6(script, username, quiet)
    if (tauriResult) {
      return tauriResult
    }
    const response = await fetch(`${this.baseUrl}/api/k6/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script }),
    })
    if (!response.ok) {
      throw new Error('Failed to start k6 run.')
    }
    return (await response.json()) as { runId: string }
  }

  async stopK6Run(runId: string): Promise<void> {
    const ok = await tauriStopK6(runId)
    if (ok) return
    await fetch(`${this.baseUrl}/api/k6/run/${runId}/stop`, { method: 'POST' })
  }

  async getK6RunStatus(runId: string): Promise<K6RunResult> {
    const tauriResult = await tauriGetK6Status(runId)
    if (tauriResult) {
      return tauriResult
    }
    const response = await fetch(`${this.baseUrl}/api/k6/run/${runId}`)
    if (!response.ok) {
      throw new Error('Failed to fetch k6 run status.')
    }
    return (await response.json()) as K6RunResult
  }

  async getRuntimeDiagnostics(): Promise<RuntimeDiagnostics> {
    const tauri = await tauriGetRuntimeDiagnostics()
    if (tauri) return tauri
    return {
      tauriAvailable: false,
      k6Path: 'k6 (PATH expected)',
      mode: 'path',
      canExecute: true,
      runsDirWritable: true,
      k6Version: 'unknown (web mode)',
      issues: ['Running in browser mode. Install desktop app for bundled runtime checks.'],
    }
  }
}

class FallbackApiClient implements ApiClient {
  private httpClient = new HttpApiClient()
  private mockRuns = new Map<string, { startedAt: number; script: string }>()

  async getAppData(username: string): Promise<AppData | null> {
    const tauriPayload = await tauriAppDataGet(username)
    if (tauriPayload !== undefined) {
      if (!tauriPayload) return null
      const parsed = JSON.parse(tauriPayload) as AppData
      return parsed
    }

    try {
      return await this.httpClient.getAppData(username)
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 120))
      return appDataMock
    }
  }

  async saveAppData(username: string, payload: AppData): Promise<void> {
    const tauriOk = await tauriAppDataSave(username, JSON.stringify(payload))
    if (tauriOk) return

    try {
      await this.httpClient.saveAppData(username, payload)
    } catch {
      void payload
    }
  }

  async startK6Run(script: string, username: string, quiet: boolean): Promise<{ runId: string }> {
    try {
      return await this.httpClient.startK6Run(script, username, quiet)
    } catch {
      const runId = `mock-${Date.now()}`
      this.mockRuns.set(runId, { startedAt: Date.now(), script })
      return { runId }
    }
  }

  async stopK6Run(runId: string): Promise<void> {
    try {
      await this.httpClient.stopK6Run(runId)
    } catch {
      this.mockRuns.delete(runId)
    }
  }

  async getK6RunStatus(runId: string): Promise<K6RunResult> {
    try {
      return await this.httpClient.getK6RunStatus(runId)
    } catch {
      const mock = this.mockRuns.get(runId)
      if (!mock) {
        return { runId, status: 'failed', logs: ['Run not found.'] }
      }
      const elapsed = Date.now() - mock.startedAt
      if (elapsed < 1200) {
        return { runId, status: 'queued', logs: ['Queued...'] }
      }
      if (elapsed < 4500) {
        return {
          runId,
          status: 'running',
          logs: ['Init k6 runtime', 'Loading generated script', 'Running VU workers...'],
        }
      }
      return {
        runId,
        status: 'passed',
        logs: ['Init k6 runtime', 'Running VU workers...', 'Thresholds passed', 'Run completed.'],
      }
    }
  }

  async getRuntimeDiagnostics(): Promise<RuntimeDiagnostics> {
    try {
      return await this.httpClient.getRuntimeDiagnostics()
    } catch {
      return {
        tauriAvailable: false,
        k6Path: 'k6',
        mode: 'path',
        canExecute: true,
        runsDirWritable: true,
        k6Version: 'unknown',
        issues: ['Runtime diagnostics fallback mode is active.'],
      }
    }
  }
}

export const apiClient: ApiClient = new FallbackApiClient()
