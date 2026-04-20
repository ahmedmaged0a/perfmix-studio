import { describe, expect, it } from 'vitest'
import { EMPTY_K6_PLACEHOLDER, isRunnableK6Script } from './k6ScriptRunnable'

describe('isRunnableK6Script', () => {
  it('rejects empty and whitespace', () => {
    expect(isRunnableK6Script('')).toBe(false)
    expect(isRunnableK6Script('   \n\t  ')).toBe(false)
  })

  it('rejects workspace placeholder', () => {
    expect(isRunnableK6Script(EMPTY_K6_PLACEHOLDER)).toBe(false)
  })

  it('rejects comments only', () => {
    expect(isRunnableK6Script('// hello\n// world')).toBe(false)
  })

  it('accepts generated-style script', () => {
    expect(
      isRunnableK6Script(`import http from 'k6/http';
export default function () {}`),
    ).toBe(true)
  })
})
