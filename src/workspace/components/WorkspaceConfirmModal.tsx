import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

type Props = {
  open: boolean
  titleId: string
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** Use danger styling on the primary action */
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}

// ── Input modal (for prompting a name/text value) ───────────────────────────
type InputModalProps = {
  open: boolean
  titleId: string
  title: string
  label?: string
  placeholder?: string
  defaultValue?: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm: (value: string) => void
  onClose: () => void
}

export function WorkspaceInputModal(props: InputModalProps) {
  const [value, setValue] = useState(props.defaultValue ?? '')

  // Reset value every time the modal opens
  useEffect(() => {
    if (props.open) setValue(props.defaultValue ?? '')
  }, [props.open, props.defaultValue])

  if (!props.open) return null

  const cancel = props.cancelLabel ?? 'Cancel'
  const trimmed = value.trim()

  const handleConfirm = () => {
    if (!trimmed) return
    props.onConfirm(trimmed)
    props.onClose()
  }

  return (
    <div
      className="ws-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div className="ws-modal ws-modal--confirm" role="dialog" aria-modal="true" aria-labelledby={props.titleId}>
        <div className="ws-modal-head">
          <h2 id={props.titleId}>{props.title}</h2>
          <button type="button" className="ws-btn ghost" aria-label="Close" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <div className="ws-modal-body">
          {props.label ? (
            <label className="ws-input-modal-label" htmlFor={`${props.titleId}-inp`}>
              {props.label}
            </label>
          ) : null}
          <input
            id={`${props.titleId}-inp`}
            className="ws-input ws-input-modal-field"
            type="text"
            value={value}
            placeholder={props.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConfirm()
              if (e.key === 'Escape') props.onClose()
            }}
            autoFocus
          />
        </div>
        <div className="ws-modal-foot">
          <button type="button" className="ws-btn ghost" onClick={props.onClose}>
            {cancel}
          </button>
          <button type="button" className="ws-btn primary" disabled={!trimmed} onClick={handleConfirm}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function WorkspaceConfirmModal(props: Props) {
  if (!props.open) return null

  const cancel = props.cancelLabel ?? 'Cancel'

  return (
    <div
      className="ws-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div className="ws-modal ws-modal--confirm" role="dialog" aria-modal="true" aria-labelledby={props.titleId}>
        <div className="ws-modal-head">
          <h2 id={props.titleId}>{props.title}</h2>
          <button type="button" className="ws-btn ghost" aria-label="Close" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <div className="ws-modal-body">{props.children}</div>
        <div className="ws-modal-foot">
          <button type="button" className="ws-btn ghost" onClick={props.onClose}>
            {cancel}
          </button>
          <button
            type="button"
            className={props.danger ? 'ws-btn danger' : 'ws-btn primary'}
            onClick={() => {
              props.onConfirm()
              props.onClose()
            }}
          >
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
