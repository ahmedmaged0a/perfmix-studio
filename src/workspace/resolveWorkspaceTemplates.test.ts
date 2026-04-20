import { describe, expect, it } from 'vitest'
import { applyTemplate, type TemplateContext } from './resolveWorkspaceTemplates'
import { coerceBearerSchemeForAuthNamedVar } from './workspaceCorrelationRuntime'

function ctx(partial: Partial<TemplateContext>): TemplateContext {
  return {
    activeEnvironment: 'dev',
    envVariables: {},
    sharedVariables: {},
    collectionVariables: {},
    projectVariables: {},
    ...partial,
  }
}

describe('resolveVar / applyTemplate', () => {
  it('resolves {{token}} from collection key Token (case-insensitive)', () => {
    const c = ctx({
      collectionVariables: { Token: 'jwt-from-Token-key' },
    })
    expect(applyTemplate('Bearer {{token}}', c)).toBe('Bearer jwt-from-Token-key')
  })

  it('resolves {{refreshToken}} from shared key RefreshToken', () => {
    const c = ctx({
      sharedVariables: { RefreshToken: 'rt-val' },
    })
    expect(applyTemplate('{{refreshToken}}', c)).toBe('rt-val')
  })

  it('prepends Bearer when RUNTIME token is raw JWT so it wins over collection Bearer (Authorization {{token}})', () => {
    const raw = 'eyJh.eyJi.sig'
    const c = ctx({
      runtimeVarOverrides: { token: raw },
      collectionVariables: { token: `Bearer ${raw}` },
    })
    expect(applyTemplate('{{token}}', c)).toBe(`Bearer ${raw}`)
  })

  it('leaves non-JWT token values unchanged (e.g. literal names)', () => {
    expect(coerceBearerSchemeForAuthNamedVar('token', 'token')).toBe('token')
  })
})
