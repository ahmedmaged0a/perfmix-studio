import { describe, expect, it } from 'vitest'
import { normalizeImportedAuthorizationBearer } from './jmxParse'

describe('normalizeImportedAuthorizationBearer', () => {
  it('does not prefix lone {{token}} (__P / props usually carry full Bearer value at runtime)', () => {
    const h: Record<string, string> = { Authorization: '{{token}}' }
    normalizeImportedAuthorizationBearer(h)
    expect(h.Authorization).toBe('{{token}}')
  })

  it('does not prefix lone {{ updatedToken }} with spacing', () => {
    const h: Record<string, string> = { Authorization: '{{  updatedToken  }}' }
    normalizeImportedAuthorizationBearer(h)
    expect(h.Authorization).toBe('{{  updatedToken  }}')
  })

  it('prefixes lowercase authorization key', () => {
    const h: Record<string, string> = { authorization: '${accessToken}' }
    normalizeImportedAuthorizationBearer(h)
    expect(h.authorization).toBe('Bearer ${accessToken}')
  })

  it('does not double-prefix Bearer', () => {
    const h: Record<string, string> = { Authorization: 'Bearer {{token}}' }
    normalizeImportedAuthorizationBearer(h)
    expect(h.Authorization).toBe('Bearer {{token}}')
  })

  it('leaves Basic unchanged', () => {
    const h: Record<string, string> = { Authorization: 'Basic abc' }
    normalizeImportedAuthorizationBearer(h)
    expect(h.Authorization).toBe('Basic abc')
  })

  it('no-op when Authorization missing', () => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    normalizeImportedAuthorizationBearer(h)
    expect(h).toEqual({ 'Content-Type': 'application/json' })
  })

  it('removes literal null Authorization (would otherwise become Bearer null)', () => {
    const h: Record<string, string> = { authorization: 'null' }
    normalizeImportedAuthorizationBearer(h)
    expect(h).toEqual({})
  })

  it('removes Bearer null', () => {
    const h: Record<string, string> = { Authorization: 'Bearer null' }
    normalizeImportedAuthorizationBearer(h)
    expect(h).toEqual({})
  })
})
