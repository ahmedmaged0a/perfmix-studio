/**
 * AppSelect — reusable custom select matching the app's design system.
 * Also exports MethodSelect — specialized HTTP method selector with colour coding.
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

export type AppSelectOption = { value: string; label: string }

function useDropdown() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onMouse = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouse)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouse)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return { open, setOpen, ref }
}

// ─────────────────────────────────────────────────────────────────────────────
// AppSelect — generic compact custom select
// ─────────────────────────────────────────────────────────────────────────────

type AppSelectProps = {
  value: string
  onChange: (v: string) => void
  options: AppSelectOption[]
  placeholder?: string
  /** Extra wrapper class */
  className?: string
}

export function AppSelect({ value, onChange, options, placeholder, className }: AppSelectProps) {
  const { open, setOpen, ref } = useDropdown()
  const selected = options.find((o) => o.value === value)?.label ?? placeholder ?? value

  return (
    <div ref={ref} className={`ws-app-select${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className={`ws-app-select-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="ws-app-select-value">{selected}</span>
        <ChevronDown
          size={11}
          className={`ws-app-select-chevron${open ? ' rotated' : ''}`}
        />
      </button>

      {open && (
        <div className="ws-app-select-menu" role="listbox">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={`ws-app-select-option${o.value === value ? ' active' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false) }}
            >
              <span className="ws-app-select-check">
                {o.value === value ? <Check size={11} strokeWidth={2.5} /> : null}
              </span>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MethodSelect — HTTP method badge with colour coding
// ─────────────────────────────────────────────────────────────────────────────

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

const METHOD_META: Record<HttpMethod, { color: string; bg: string }> = {
  GET:    { color: 'var(--method-get)',    bg: 'rgba(74,  222, 128, 0.1)' },
  POST:   { color: 'var(--method-post)',   bg: 'rgba(96,  165, 250, 0.1)' },
  PUT:    { color: 'var(--method-put)',    bg: 'rgba(251, 146,  60, 0.1)' },
  PATCH:  { color: 'var(--method-patch)',  bg: 'rgba(167, 139, 250, 0.1)' },
  DELETE: { color: 'var(--method-delete)', bg: 'rgba(248, 113, 113, 0.1)' },
}

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

type MethodSelectProps = {
  value: HttpMethod
  onChange: (v: HttpMethod) => void
}

export function MethodSelect({ value, onChange }: MethodSelectProps) {
  const { open, setOpen, ref } = useDropdown()
  const meta = METHOD_META[value] ?? METHOD_META.GET

  return (
    <div ref={ref} className="ws-method-select">
      <button
        type="button"
        className={`ws-method-select-trigger${open ? ' open' : ''}`}
        style={{ color: meta.color, background: meta.bg, borderColor: `color-mix(in srgb, ${meta.color} 35%, transparent)` }}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="HTTP method"
      >
        <span className="ws-method-select-badge">{value}</span>
        <ChevronDown
          size={10}
          className={`ws-method-select-chevron${open ? ' rotated' : ''}`}
        />
      </button>

      {open && (
        <div className="ws-method-select-menu" role="listbox">
          {HTTP_METHODS.map((m) => {
            const mm = METHOD_META[m]
            return (
              <button
                key={m}
                type="button"
                role="option"
                aria-selected={m === value}
                className={`ws-method-select-option${m === value ? ' active' : ''}`}
                onClick={() => { onChange(m); setOpen(false) }}
              >
                <span
                  className="ws-method-select-option-badge"
                  style={{ color: mm.color }}
                >
                  {m}
                </span>
                {m === value ? (
                  <Check size={11} strokeWidth={2.5} className="ws-method-select-check" style={{ color: mm.color }} />
                ) : null}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
