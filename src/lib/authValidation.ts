/** Letters, digits, underscore only; 3–32 chars (aligned with DB check). */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,32}$/

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

export function validateUsernameFormat(username: string): { ok: true } | { ok: false; message: string } {
  const t = username.trim()
  if (!t) {
    return { ok: false, message: 'Username is required.' }
  }
  if (/\s/.test(t)) {
    return { ok: false, message: 'Username cannot contain spaces.' }
  }
  if (!USERNAME_PATTERN.test(t)) {
    return {
      ok: false,
      message: 'Use 3–32 characters: letters, numbers, and underscores only (no special characters).',
    }
  }
  return { ok: true }
}

export type PasswordCriteria = {
  minLength: boolean
  hasUpper: boolean
  hasLower: boolean
  hasDigit: boolean
  hasSymbol: boolean
}

export const PASSWORD_MIN_LENGTH = 8

export function evaluatePasswordStrength(password: string): PasswordCriteria {
  return {
    minLength: password.length >= PASSWORD_MIN_LENGTH,
    hasUpper: /[A-Z]/.test(password),
    hasLower: /[a-z]/.test(password),
    hasDigit: /[0-9]/.test(password),
    hasSymbol: /[^A-Za-z0-9]/.test(password),
  }
}

export function isPasswordStrong(c: PasswordCriteria): boolean {
  return c.minLength && c.hasUpper && c.hasLower && c.hasDigit && c.hasSymbol
}
