import type { PhoneCountryOption } from '../../lib/phoneCountries'
import { DEFAULT_PHONE_DIAL, PHONE_COUNTRY_OPTIONS } from '../../lib/phoneCountries'
import { digitsOnly } from '../../lib/phoneValidation'

type Props = {
  idPrefix: string
  dialCode: string
  nationalDigits: string
  onDialChange: (dial: string) => void
  onNationalChange: (digits: string) => void
}

export function PhoneCountryInput({
  idPrefix,
  dialCode,
  nationalDigits,
  onDialChange,
  onNationalChange,
}: Props) {
  const selectId = `${idPrefix}-phone-cc`
  const inputId = `${idPrefix}-phone-national`

  const handleNational = (raw: string) => {
    const d = digitsOnly(raw).slice(0, 15)
    onNationalChange(d)
  }

  return (
    <div className="login-phone-row">
      <label htmlFor={selectId} className="sr-only">
        Country calling code
      </label>
      <select
        id={selectId}
        className="login-phone-row__cc"
        value={dialCode || DEFAULT_PHONE_DIAL}
        onChange={(e) => onDialChange(e.target.value)}
        aria-label="Country calling code"
      >
        {PHONE_COUNTRY_OPTIONS.map((c: PhoneCountryOption) => (
          <option key={`${c.iso}-${c.dial}`} value={c.dial}>
            {c.label}
          </option>
        ))}
      </select>
      <label htmlFor={inputId} className="sr-only">
        Phone number
      </label>
      <input
        id={inputId}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        className="login-phone-row__num"
        value={nationalDigits}
        onChange={(e) => handleNational(e.target.value)}
        placeholder="Mobile number"
      />
    </div>
  )
}
