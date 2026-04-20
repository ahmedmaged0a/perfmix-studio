import { describe, expect, it } from 'vitest'
import {
  evaluatePasswordStrength,
  isPasswordStrong,
  normalizeUsername,
  USERNAME_PATTERN,
  validateUsernameFormat,
} from './authValidation'

describe('authValidation', () => {
  it('USERNAME_PATTERN accepts 3–32 alnum + underscore', () => {
    expect(USERNAME_PATTERN.test('ab')).toBe(false)
    expect(USERNAME_PATTERN.test('abc')).toBe(true)
    expect(USERNAME_PATTERN.test('User_123')).toBe(true)
    expect(USERNAME_PATTERN.test('a-b')).toBe(false)
    expect(USERNAME_PATTERN.test('a'.repeat(33))).toBe(false)
  })

  it('validateUsernameFormat surfaces format issues', () => {
    expect(validateUsernameFormat('').ok).toBe(false)
    expect(validateUsernameFormat('ab').ok).toBe(false)
    expect(validateUsernameFormat('bad pass').ok).toBe(false)
    expect(validateUsernameFormat('good_user_1').ok).toBe(true)
  })

  it('normalizeUsername lowercases trimmed input', () => {
    expect(normalizeUsername('  Foo_Bar  ')).toBe('foo_bar')
  })

  it('evaluatePasswordStrength and isPasswordStrong agree', () => {
    const weak = evaluatePasswordStrength('short')
    expect(isPasswordStrong(weak)).toBe(false)

    const strong = evaluatePasswordStrength('Aa1!aaaa')
    expect(isPasswordStrong(strong)).toBe(true)
  })
})
