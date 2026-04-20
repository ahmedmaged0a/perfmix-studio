import { evaluatePasswordStrength, type PasswordCriteria } from '../../lib/authValidation'

const ROWS: { key: keyof PasswordCriteria; label: string }[] = [
  { key: 'minLength', label: 'At least 8 characters' },
  { key: 'hasUpper', label: 'One uppercase letter' },
  { key: 'hasLower', label: 'One lowercase letter' },
  { key: 'hasDigit', label: 'One number' },
  { key: 'hasSymbol', label: 'One special character' },
]

type Props = {
  password: string
  idPrefix: string
}

export function PasswordStrengthMeter({ password, idPrefix }: Props) {
  const c = evaluatePasswordStrength(password)
  return (
    <ul className="auth-password-criteria" aria-label="Password requirements" id={`${idPrefix}-pw-criteria`}>
      {ROWS.map((row) => (
        <li
          key={row.key}
          className={c[row.key] ? 'auth-password-criteria--ok' : undefined}
        >
          {row.label}
        </li>
      ))}
    </ul>
  )
}
