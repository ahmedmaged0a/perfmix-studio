import { describe, expect, it } from 'vitest'
import { buildE164FromParts, isValidE164, validatePhoneParts } from './phoneValidation'

describe('phoneValidation', () => {
  it('buildE164FromParts combines dial and national digits', () => {
    expect(buildE164FromParts('+1', '2025559876')).toBe('+12025559876')
    expect(buildE164FromParts('+20', '1012345678')).toBe('+201012345678')
  })

  it('buildE164FromParts rejects empty or invalid length', () => {
    expect(buildE164FromParts('+1', '')).toBeNull()
    expect(buildE164FromParts('', '5551234567')).toBeNull()
  })

  it('isValidE164 validates E.164 shape', () => {
    expect(isValidE164('+12025559876')).toBe(true)
    expect(isValidE164('12025559876')).toBe(false)
    expect(isValidE164('+123')).toBe(false)
  })

  it('validatePhoneParts returns message when incomplete', () => {
    const bad = validatePhoneParts('+1', '')
    expect(bad.ok).toBe(false)
    const good = validatePhoneParts('+1', '2025559876')
    expect(good.ok).toBe(true)
    if (good.ok) expect(good.e164).toBe('+12025559876')
  })
})
