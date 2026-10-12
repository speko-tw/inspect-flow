import { useEffect, useRef } from 'react'

import { ConfirmBox } from '../../ui/ConfirmBox'
import type { UnsavedNavigationGuard } from './useUnsavedNavigationGuard'

/**
 * 站內連結被未儲存變更攔下時的頁內確認框（ADM-R15、ADM-R37、ADM-R38）。
 *
 * 捨棄未儲存內容無法復原，確認鈕用危險色；第一個按鈕叫「保留編輯」，
 * 開啟時捲動到確認框並聚焦該按鈕，按 Esc 等同保留編輯（ADM-R28）。
 */
export function UnsavedLeaveBox({ guard }: { guard: UnsavedNavigationGuard }) {
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!guard.pending) return
    // ADM-R28：長頁底部的確認框先捲動到可見範圍，再聚焦安全選項。
    box.current?.scrollIntoView?.({ block: 'center' })
    box.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [guard.pending])

  if (!guard.pending) return null
  return (
    <ConfirmBox
      cancelLabel="保留編輯"
      confirmLabel="捨棄變更"
      headingLevel={3}
      onCancel={guard.stay}
      onConfirm={guard.leave}
      rootRef={box}
      title="有尚未儲存的變更"
      variant="danger"
    >
      <p>離開後，已填寫但尚未儲存的內容會消失。</p>
    </ConfirmBox>
  )
}
