import { describe, expect, it } from 'vitest'
import { applyJsr223ScriptFragmentToRuntime, applyJmeterJsr223PostProcessorShim } from './jmeterJsr223PostShim'

describe('applyJsr223ScriptFragmentToRuntime', () => {
  it('copies vars.get source into props.put target', () => {
    const runtime: Record<string, string> = { accessToken: 'jwt-value' }
    const logs: string[] = []
    applyJsr223ScriptFragmentToRuntime(runtime, logs, 'props.put("token", vars.get("accessToken"))')
    expect(runtime.token).toBe('jwt-value')
    expect(logs.some((l) => l.includes('token'))).toBe(true)
  })

  it('supports vars.put and single-quoted vars.get', () => {
    const runtime: Record<string, string> = { x: 'ok' }
    const logs: string[] = []
    applyJsr223ScriptFragmentToRuntime(runtime, logs, "vars.put('y', vars.get('x'))")
    expect(runtime.y).toBe('ok')
    expect(logs.length).toBeGreaterThan(0)
  })

  it('applies .trim() on vars.get', () => {
    const runtime: Record<string, string> = { accessToken: '  spaced  ' }
    const logs: string[] = []
    applyJsr223ScriptFragmentToRuntime(runtime, logs, 'props.put("token", vars.get("accessToken").trim())')
    expect(runtime.token).toBe('spaced')
    expect(logs.length).toBeGreaterThan(0)
  })

  it('sets string literal with double quotes', () => {
    const runtime: Record<string, string> = {}
    const logs: string[] = []
    applyJsr223ScriptFragmentToRuntime(runtime, logs, 'props.put("a", "hello")')
    expect(runtime.a).toBe('hello')
    expect(logs.length).toBeGreaterThan(0)
  })

  it('skips vars.get when source missing', () => {
    const runtime: Record<string, string> = {}
    const logs: string[] = []
    applyJsr223ScriptFragmentToRuntime(runtime, logs, 'props.put("token", vars.get("missing"))')
    expect(runtime.token).toBeUndefined()
    expect(logs.some((l) => l.includes('skipped'))).toBe(true)
  })

  it('self-ref props.put does not collapse updatedToken onto token when extractor missed (BPA)', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJFVVVNIiwic3ViIjoiMSJ9.sig'
    const runtime: Record<string, string> = { token: jwt }
    const logs: string[] = []
    applyJsr223ScriptFragmentToRuntime(
      runtime,
      logs,
      'props.put("updatedToken", vars.get("updatedToken"))',
    )
    expect(runtime.updatedToken).toBeUndefined()
    expect(logs.some((l) => l.includes('skipped'))).toBe(true)
  })
})

describe('applyJmeterJsr223PostProcessorShim', () => {
  it('runs processors in order', () => {
    const runtime: Record<string, string> = { a: '1' }
    const logs: string[] = []
    applyJmeterJsr223PostProcessorShim(runtime, logs, [
      { id: '1', script: 'vars.put("b", vars.get("a"))' },
      { id: '2', script: 'vars.put("c", vars.get("b"))' },
    ])
    expect(runtime.b).toBe('1')
    expect(runtime.c).toBe('1')
  })
})
