import { describe, expect, it } from 'vitest'
import type { CorrelationRule, HttpExecuteResponse } from '../models/types'
import { applyCorrelationRulesToRuntime } from './workspaceCorrelationRuntime'

function makeHttpResult(partial: Partial<HttpExecuteResponse>): HttpExecuteResponse {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    responseHeaders: [],
    body: '',
    durationMs: 0,
    ...partial,
  }
}

describe('applyCorrelationRulesToRuntime', () => {
  it('matches header regex case-insensitively (JMeter x-amzn-Remapped-Authorization vs lowercase header)', () => {
    const rules: CorrelationRule[] = [
      {
        id: 'cr1',
        variableName: 'updatedToken',
        fromRequestId: 'req-default',
        kind: 'regex',
        jsonPath: '',
        regexPattern: 'x-amzn-Remapped-Authorization:\\s+(.+)',
        regexGroup: 1,
        regexSource: 'headers',
      },
    ]
    const runtime: Record<string, string> = {}
    applyCorrelationRulesToRuntime(
      runtime,
      rules,
      'req-default',
      makeHttpResult({
        responseHeaders: [['x-amzn-remapped-authorization', 'Bearer eyJ.h.e']],
      }),
    )
    expect(runtime.updatedToken).toBe('Bearer eyJ.h.e')
  })

  it('does not JSR223-mirror into updatedToken when another request owns that variable', () => {
    const rules: CorrelationRule[] = [
      {
        id: 'cr-token-at',
        variableName: 'accessToken',
        fromRequestId: 'req-token',
        kind: 'regex',
        jsonPath: '',
        regexPattern: '"access_token"\\s*:\\s*"([^"]+)"',
        regexGroup: 1,
        regexSource: 'body',
        runtimeMirrorTo: ['updatedToken'],
      },
      {
        id: 'cr-default-ut',
        variableName: 'updatedToken',
        fromRequestId: 'req-default',
        kind: 'regex',
        jsonPath: '',
        regexPattern: 'x-amzn-Remapped-Authorization:\\s+(.+)',
        regexGroup: 1,
        regexSource: 'headers',
      },
    ]
    const runtime: Record<string, string> = {}
    applyCorrelationRulesToRuntime(
      runtime,
      rules,
      'req-token',
      makeHttpResult({ body: JSON.stringify({ access_token: 'tok.tok.tok' }) }),
    )
    expect(runtime.accessToken).toBe('tok.tok.tok')
    expect(runtime.updatedToken).toBeUndefined()

    applyCorrelationRulesToRuntime(
      runtime,
      rules,
      'req-default',
      makeHttpResult({
        responseHeaders: [['x-amzn-remapped-authorization', 'Bearer upd.upd.upd']],
      }),
    )
    expect(runtime.updatedToken).toBe('Bearer upd.upd.upd')
  })

  it('blocks accessToken→updatedToken mirror on EUUM /authorize/v1/token URL', () => {
    const rules: CorrelationRule[] = [
      {
        id: 'cr-token-at',
        variableName: 'accessToken',
        fromRequestId: 'req-token',
        kind: 'regex',
        jsonPath: '',
        regexPattern: 'x-amzn-Remapped-Authorization:\\s+(.+)',
        regexGroup: 1,
        regexSource: 'headers',
        runtimeMirrorTo: ['updatedToken', 'UPDATED_TOKEN'],
      },
    ]
    const runtime: Record<string, string> = {}
    const euumUrl = 'https://euum.example.com/authorize/v1/token'
    applyCorrelationRulesToRuntime(
      runtime,
      rules,
      'req-token',
      makeHttpResult({
        responseHeaders: [['x-amzn-remapped-authorization', 'Bearer tok.tok.tok']],
      }),
      euumUrl,
    )
    expect(runtime.accessToken).toBe('Bearer tok.tok.tok')
    expect(runtime.updatedToken).toBeUndefined()
    expect(runtime.UPDATED_TOKEN).toBeUndefined()
  })

  it('allows accessToken→updatedToken mirror when response is not EUUM token URL', () => {
    const rules: CorrelationRule[] = [
      {
        id: 'cr-at',
        variableName: 'accessToken',
        fromRequestId: 'r1',
        kind: 'regex',
        jsonPath: '',
        regexPattern: 'x-amzn-Remapped-Authorization:\\s+(.+)',
        regexGroup: 1,
        regexSource: 'headers',
        runtimeMirrorTo: ['updatedToken'],
      },
    ]
    const runtime: Record<string, string> = {}
    applyCorrelationRulesToRuntime(
      runtime,
      rules,
      'r1',
      makeHttpResult({
        responseHeaders: [['x-amzn-remapped-authorization', 'Bearer same']],
      }),
      'https://api.example.com/oauth/token',
    )
    expect(runtime.accessToken).toBe('Bearer same')
    expect(runtime.updatedToken).toBe('Bearer same')
  })

  it('body regex remains case-sensitive by default', () => {
    const rules: CorrelationRule[] = [
      {
        id: 'cr2',
        variableName: 'x',
        fromRequestId: 'r1',
        kind: 'regex',
        jsonPath: '',
        regexPattern: 'Token',
        regexGroup: 0,
        regexSource: 'body',
      },
    ]
    const runtime: Record<string, string> = {}
    applyCorrelationRulesToRuntime(
      runtime,
      rules,
      'r1',
      makeHttpResult({ body: 'token' }),
    )
    expect(runtime.x).toBeUndefined()
  })
})
