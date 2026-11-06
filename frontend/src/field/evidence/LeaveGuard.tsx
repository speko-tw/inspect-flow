import { useContext, useEffect } from 'react'
import { UNSAFE_DataRouterContext } from 'react-router'

import { ConfirmBox } from '../../ui/ConfirmBox'
import { useUnsavedNavigationGuard } from '../../ui/navigation'

/** 離開頁面時的原生提示文字（FEV-R15）。 */
export const LEAVE_MESSAGE = '照片尚未上傳，請勿關閉頁面'

/** Safari POP 使用取消／好，問句才能明確表達「好」代表放棄離開。 */
export const LEAVE_POP_MESSAGE = '照片尚未上傳，離開後照片會消失。要離開嗎？'

const EDIT_MESSAGE = '修改尚未儲存，離開後這次的修改會消失。要離開嗎？'

/**
 * 站內導覽被攔下時的頁內確認框。`useBlocker` 只能用在 Data Router，
 * 所以只在 Data Router 底下才掛這個元件（正式環境是；單元測試的
 * MemoryRouter 不是）。
 */
function RouterLeaveBox({
  active,
  kind,
}: {
  active: boolean
  kind: 'upload' | 'edit'
}) {
  const message = kind === 'edit' ? EDIT_MESSAGE : LEAVE_POP_MESSAGE
  const guard = useUnsavedNavigationGuard(active, message)
  if (!guard.pending) return null
  const editing = kind === 'edit'
  return (
    <ConfirmBox
      cancelLabel="留在這一頁"
      confirmLabel={editing ? '離開並放棄修改' : '離開並放棄照片'}
      headingLevel={3}
      onCancel={guard.stay}
      onConfirm={guard.leave}
      title={editing ? '修改尚未儲存' : '照片尚未上傳'}
      variant="danger"
    >
      <p>
        {editing
          ? '離開後，這次的修改會消失；照片本身不受影響。'
          : `${LEAVE_MESSAGE}。離開後，還沒上傳的照片會消失，無法找回。`}
      </p>
    </ConfirmBox>
  )
}

/**
 * 未完成的拍照流程與未儲存的既有照片修改都要先提示（FEV-R15、
 * FEV-AC22）。kind 區分會丟棄待上傳照片與只放棄本次修改，避免誤稱
 * 已上傳照片會消失；待上傳內容不存持久儲存（FEV-R08）。
 */
export function LeaveGuard({
  active,
  kind,
}: {
  active: boolean
  kind: 'upload' | 'edit'
}) {
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

  return inDataRouter ? <RouterLeaveBox active={active} kind={kind} /> : null
}
