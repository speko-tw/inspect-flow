import type { ReactNode } from 'react'

export function InlineConfirm({
  children,
  onConfirm,
  onCancel,
  confirmLabel = '確認刪除',
}: {
  children: ReactNode
  onConfirm: () => void
  onCancel: () => void
  confirmLabel?: string
}) {
  return (
    <div
      className="tpl-inline-confirm"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onCancel()
        }
      }}
      role="group"
      aria-label="刪除確認"
    >
      <span>{children}</span>
      <button onClick={onCancel} type="button">
        取消
      </button>
      <button className="btn-danger" onClick={onConfirm} type="button">
        {confirmLabel}
      </button>
    </div>
  )
}
