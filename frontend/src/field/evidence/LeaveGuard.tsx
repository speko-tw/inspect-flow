import { useContext, useEffect } from 'react'
import { UNSAFE_DataRouterContext } from 'react-router'

import { ConfirmBox } from '../../ui/ConfirmBox'
import { useUnsavedNavigationGuard } from '../../ui/navigation'

/** 離開頁面時的原生提示文字（FEV-R15）。 */
export const LEAVE_MESSAGE = '照片尚未上傳，請勿關閉頁面'

/**
 * 站內導覽被攔下時的頁內確認框。`useBlocker` 只能用在 Data Router，
 * 所以只在 Data Router 底下才掛這個元件（正式環境是；單元測試的
 * MemoryRouter 不是）。
 */
function RouterLeaveBox({ active }: { active: boolean }) {
  const guard = useUnsavedNavigationGuard(active, LEAVE_MESSAGE)
  if (!guard.pending) return null
  return (
    <ConfirmBox
      cancelLabel="留在這一頁"
      confirmLabel="離開並放棄照片"
      headingLevel={3}
      onCancel={guard.stay}
      onConfirm={guard.leave}
      title="照片尚未上傳"
      variant="danger"
    >
      <p>{LEAVE_MESSAGE}。離開後，還沒上傳的照片會消失，無法找回。</p>
    </ConfirmBox>
  )
}

/**
 * 有未確認編修、待上傳或上傳失敗的照片時，關閉分頁、重新整理與站內
 * 離開都要先提示（FEV-R15、FEV-AC22）。待上傳照片不存任何持久儲存
 * （FEV-R08），離開就是丟掉，所以提示說明這個後果。
 */
export function LeaveGuard({ active }: { active: boolean }) {
  const inDataRouter = useContext(UNSAFE_DataRouterContext) !== null

  useEffect(() => {
    if (!active) return
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      // 現代瀏覽器只顯示固定文字；舊瀏覽器會顯示這句。
      event.returnValue = LEAVE_MESSAGE
      return LEAVE_MESSAGE
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [active])

  return inDataRouter ? <RouterLeaveBox active={active} /> : null
}
