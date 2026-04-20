import { useCallback, useId, useRef, type ClipboardEvent, type KeyboardEvent } from 'react'

/** Supabase email OTP uses 8 digits for this project’s auth settings */
export const EMAIL_OTP_DIGIT_COUNT = 8

const N = EMAIL_OTP_DIGIT_COUNT

type Props = {
  value: string
  onChange: (next: string) => void
  idPrefix: string
  disabled?: boolean
  'aria-label'?: string
}

function onlyDigits(s: string, max: number): string {
  return s.replace(/\D/g, '').slice(0, max)
}

export function OtpDigitGroup({ value, onChange, idPrefix, disabled, 'aria-label': ariaLabel }: Props) {
  const groupId = useId()
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const digits = onlyDigits(value, N)
  const cells = Array.from({ length: N }, (_, i) => digits[i] ?? '')

  const focusAt = (index: number) => {
    const el = inputRefs.current[Math.max(0, Math.min(index, N - 1))]
    el?.focus()
    el?.select()
  }

  const handleCellChange = useCallback(
    (index: number, raw: string) => {
      const digit = onlyDigits(raw, 1)
      if (!digit) {
        onChange(digits.slice(0, index))
        return
      }

      let effIndex = index
      if (index > digits.length) {
        effIndex = digits.length
        queueMicrotask(() => focusAt(effIndex))
      }

      let next: string
      if (effIndex < digits.length) {
        next = digits.slice(0, effIndex) + digit + digits.slice(effIndex + 1)
      } else {
        next = (digits + digit).slice(0, N)
      }
      onChange(onlyDigits(next, N))

      if (digit && effIndex < N - 1) {
        queueMicrotask(() => focusAt(effIndex + 1))
      }
    },
    [digits, onChange],
  )

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !cells[index] && index > 0) {
      e.preventDefault()
      const next = digits.slice(0, index - 1)
      onChange(next)
      focusAt(index - 1)
      return
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault()
      focusAt(index - 1)
    }
    if (e.key === 'ArrowRight' && index < N - 1) {
      e.preventDefault()
      focusAt(index + 1)
    }
  }

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pasted = onlyDigits(e.clipboardData.getData('text') ?? '', N)
    if (!pasted) return
    onChange(pasted)
    focusAt(Math.min(pasted.length, N - 1))
  }

  return (
    <div
      className="login-otp-row"
      role="group"
      aria-label={ariaLabel ?? 'One-time code digits'}
      id={`${groupId}-otp`}
    >
      {cells.map((char, index) => (
        <input
          key={`${idPrefix}-otp-${index}`}
          ref={(el) => {
            inputRefs.current[index] = el
          }}
          id={`${idPrefix}-otp-${index}`}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          disabled={disabled}
          className="login-otp-digit"
          value={char}
          aria-label={`Digit ${index + 1} of ${N}`}
          onChange={(e) => handleCellChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  )
}
