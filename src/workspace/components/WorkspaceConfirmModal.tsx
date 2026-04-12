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
