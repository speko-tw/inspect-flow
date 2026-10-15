import { useEffect, useRef, useState } from 'react'
import { useBlocker, useLocation } from 'react-router'

/** 站內導覽被攔下時，頁面用此狀態顯示確認框。 */
export interface UnsavedNavigationGuard {
  /** 有導覽待決時為 true。 */
  pending: boolean
  /** 保留編輯並取消導覽。 */
  stay: () => void
  /** 捨棄編輯並繼續導覽。 */
  leave: () => void
  /** 只放行已確認的單次程式化導覽。 */
  allowNavigation: (action: () => void) => void
}

/**
 * 依 ADM-R15、ADM-R28、ADM-R38 保護未儲存的 Admin 表單。
 *
 * Data Router blocker 可攔截站內連結與瀏覽器返回；
 * POP、重新整理與關閉分頁均使用瀏覽器原生確認。
 */
export function useUnsavedNavigationGuard(
  hasUnsavedChanges: boolean,
): UnsavedNavigationGuard {
  const location = useLocation()
  const [blockedAction, setBlockedAction] = useState<
    'POP' | 'PUSH' | 'REPLACE' | null
  >(null)
  const pendingFocus = useRef<HTMLElement | null>(null)
  const allowNavigation = useRef(false)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation, historyAction }) => {
      if (allowNavigation.current) {
        allowNavigation.current = false
        return false
      }
      setBlockedAction(historyAction)
      if (
        !pendingFocus.current &&
        document.activeElement instanceof HTMLElement
      ) {
        pendingFocus.current = document.activeElement
      }
      if (!hasUnsavedChanges) return false
      const hashOnly =
        currentLocation.pathname === nextLocation.pathname &&
        currentLocation.search === nextLocation.search &&
        currentLocation.hash !== nextLocation.hash
      // 同頁錨點不卸載表單；自連結會換 key，仍須攔截。
      return !hashOnly
    },
  )
  const activeChanges = useRef(hasUnsavedChanges)
  const handledPop = useRef<string | null>(null)

  useEffect(() => {
    activeChanges.current = hasUnsavedChanges

    function captureLink(event: MouseEvent): void {
      if (
        !hasUnsavedChanges ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }
      const target = event.target
      if (!(target instanceof Element)) return
      const link = target.closest<HTMLAnchorElement>('a[href]')
      if (!link || (link.target && link.target !== '_self')) return
      pendingFocus.current = link
    }

    function beforeUnload(event: BeforeUnloadEvent): void {
      if (!activeChanges.current) return
      event.preventDefault()
      event.returnValue = ''
    }

    document.addEventListener('click', captureLink, true)
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      document.removeEventListener('click', captureLink, true)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [hasUnsavedChanges])

  useEffect(() => {
    if (!hasUnsavedChanges && blocker.state === 'blocked') {
      blocker.reset()
      handledPop.current = null
      return
    }
    if (blocker.state !== 'blocked') {
      handledPop.current = null
      return
    }
    if (blocker.location.key === location.key) return
    if (handledPop.current === blocker.location.key) return
    // Back／Forward 用原生確認；站內連結由頁內確認框處理。
    if (blockedAction !== 'POP') return
    handledPop.current = blocker.location.key
    if (window.confirm('有尚未儲存的變更。確定要離開嗎？')) {
      blocker.proceed()
    } else {
      blocker.reset()
    }
  }, [blocker, blockedAction, hasUnsavedChanges, location.key])

  return {
    pending: blocker.state === 'blocked' && blockedAction !== 'POP',
    stay: () => {
      if (blocker.state === 'blocked') blocker.reset()
      pendingFocus.current?.focus()
      pendingFocus.current = null
    },
    leave: () => {
      if (blocker.state === 'blocked') blocker.proceed()
    },
    allowNavigation: (action) => {
      allowNavigation.current = true
      try {
        action()
      } finally {
        allowNavigation.current = false
      }
    },
  }
}
