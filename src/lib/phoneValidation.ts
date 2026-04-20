/** E.164: leading +, country code starting 1–9, 7–15 digits total after +. */
const E164_REGEX = /^\+[1-9]\d{6,14}$/

export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '')
}

/** Combine ITU dial prefix (e.g. +20, +1) and national digits into one E.164 string. */
export function buildE164FromParts(dialCode: string, nationalDigits: string): string | null {
  const dial = dialCode.trim().replace(/^\+/, '')
  const national = nationalDigits.replace(/\D/g, '')
  if (!dial || !national) return null
  const full = `+${dial}${national}`
  return E164_REGEX.test(full) ? full : null
}

export function isValidE164(value: string): boolean {
  const t = value.trim()
  return E164_REGEX.test(t)
}

export function validatePhoneParts(dialCode: string, nationalDigits: string): { ok: true; e164: string } | { ok: false; message: string } {
  const e164 = buildE164FromParts(dialCode, nationalDigits)
  if (!e164) {
    return {
      ok: false,
      message: 'Choose a country code and enter a valid mobile number (digits only).',
    }
  }
  return { ok: true, e164 }
}
