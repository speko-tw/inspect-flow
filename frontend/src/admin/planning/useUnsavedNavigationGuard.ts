import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

type BrowserHistoryIndex = number | null

interface GuardedRouteEntry {
  href: string
  state: unknown
  index: BrowserHistoryIndex
}

function historyIndex(state: unknown): BrowserHistoryIndex {
  if (typeof state !== 'object' || state === null || !('idx' in state)) {
    return null
  }
  const index = state.idx
  return typeof index === 'number' && Number.isInteger(index) ? index : null
}

/** 站內連結被攔下、等使用者決定時的狀態與兩個出口。 */
export interface UnsavedNavigationGuard {
  /** 有連結被攔下時為 true；頁面此時要顯示 `UnsavedLeaveBox`。 */
  pending: boolean
  /** 「保留編輯」：留在原頁，連結不執行。 */
  stay: () => void
  /** 「捨棄變更」：放行剛才被攔下的連結。 */
  leave: () => void
}

interface PendingLink {
  anchor: HTMLAnchorElement
  href: string
  locationKey: string
}

/**
 * 攔截 #451 分區與規劃表單的離頁操作，保留使用者尚未儲存的內容。
 *
 * 三種離開方式的確認方式不同（ADM-R28）：
 * - 站內連結：在頁內顯示確認框（回傳值交給 `UnsavedLeaveBox`），
 *   與其他表單的未儲存確認一致（ADM-R15、ADM-R38）。
 * - 上一頁／下一頁：BrowserRouter 沒有 data router 的 `useBlocker`，
 *   popstate 發生時瀏覽器游標已經移動，無法可靠改成頁內確認，
 *   只能維持原生確認並在取消時把游標移回來。
 * - 重新整理或關閉分頁：瀏覽器只允許原生提示。
 * 只有 hash 不同的連結不算離開（同頁錨點不會丟掉表單內容）。
 */
export function useUnsavedNavigationGuard(
  hasUnsavedChanges: boolean,
): UnsavedNavigationGuard {
  const location = useLocation()
  const navigate = useNavigate()
  const [pendingLink, setPendingLink] = useState<PendingLink | null>(null)
  // 放行時重新點一次同一個連結，Router 的 Link 才會帶著原本的 state 導頁；
  // 這一次點擊不能再被自己攔下。
  const bypassNextClick = useRef(false)
  const currentEntry = useRef<GuardedRouteEntry>({
    href: `${location.pathname}${location.search}${location.hash}`,
    state: window.history.state,
    index: historyIndex(window.history.state),
  })
  const currentIndex = useRef(historyIndex(window.history.state))
  const correctionTarget = useRef<BrowserHistoryIndex>(null)

  useLayoutEffect(() => {
    const state = window.history.state
    const index = historyIndex(state)
    currentEntry.current = {
      href: `${location.pathname}${location.search}${location.hash}`,
      state,
      index,
    }
    if (index !== null) currentIndex.current = index
  }, [location.hash, location.pathname, location.search])

  useEffect(() => {
    const actualIndex = historyIndex(window.history.state)
    if (actualIndex !== null) currentIndex.current = actualIndex

    function confirmLeave(): boolean {
      return window.confirm('有尚未儲存的變更。確定要離開嗎？')
    }

    function beforeUnload(event: BeforeUnloadEvent): void {
      if (!hasUnsavedChanges) return
      event.preventDefault()
      event.returnValue = ''
    }

    function interceptLink(event: MouseEvent): void {
      if (bypassNextClick.current) return
      if (
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
      const anchor = target.closest<HTMLAnchorElement>('a[href]')
      if (
        !anchor ||
        (anchor.target !== '' && anchor.target.toLowerCase() !== '_self') ||
        anchor.hasAttribute('download')
      ) {
        return
      }
      const destination = new URL(anchor.href, window.location.href)
      // 只有 hash 不同是同頁錨點，不會卸載頁面，不算離開（R4）。
      if (
        destination.origin !== window.location.origin ||
        (destination.pathname === location.pathname &&
          destination.search === location.search)
      ) {
        return
      }
      if (!hasUnsavedChanges) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      setPendingLink({
        anchor,
        href: `${destination.pathname}${destination.search}${destination.hash}`,
        locationKey: location.key,
      })
    }

    function interceptHistory(event: PopStateEvent): void {
      const nextIndex = historyIndex(event.state)
      const expectedCorrection = correctionTarget.current
      if (expectedCorrection !== null && nextIndex === expectedCorrection) {
        correctionTarget.current = null
        currentIndex.current = nextIndex
        // 這是取消後回復原頁的補償事件，不能再交給 Router 或重問一次。
        event.stopImmediatePropagation()
        return
      }
      correctionTarget.current = null

      if (!hasUnsavedChanges) {
        currentIndex.current = nextIndex
        return
      }
      if (confirmLeave()) {
        currentIndex.current = nextIndex
        return
      }

      // popstate 已移動瀏覽器游標；capture 階段停止 Router 更新畫面。
      event.stopImmediatePropagation()
      const previousIndex = currentIndex.current
      if (
        previousIndex !== null &&
        nextIndex !== null &&
        previousIndex !== nextIndex
      ) {
        correctionTarget.current = previousIndex
        window.history.go(previousIndex - nextIndex)
        return
      }

      // 非 BrowserRouter 歷史項目沒有 idx，只能以已知路由 push 回目前頁；
      // 這會捨棄 forward stack，但比猜方向移動或丟失未儲存內容安全。
      const previousEntry = currentEntry.current
      const nextKnownIndex = (previousIndex ?? previousEntry.index ?? 0) + 1
      const previousState =
        typeof previousEntry.state === 'object' && previousEntry.state !== null
          ? previousEntry.state
          : {}
      const restoredState = { ...previousState, idx: nextKnownIndex }
      window.history.pushState(restoredState, '', previousEntry.href)
      currentIndex.current = nextKnownIndex
      currentEntry.current = {
        ...previousEntry,
        state: restoredState,
        index: nextKnownIndex,
      }
    }

    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('popstate', interceptHistory, true)
    document.addEventListener('click', interceptLink, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('popstate', interceptHistory, true)
      document.removeEventListener('click', interceptLink, true)
    }
  }, [
    hasUnsavedChanges,
    location.hash,
    location.key,
    location.pathname,
    location.search,
  ])

  // 內容已存好或頁面已換掉時，舊的待決連結作廢，避免確認框殘留。
  const pending =
    hasUnsavedChanges && pendingLink?.locationKey === location.key
      ? pendingLink
      : null

  return {
    pending: pending !== null,
    stay: () => setPendingLink(null),
    leave: () => {
      if (!pending) return
      setPendingLink(null)
      if (pending.anchor.isConnected) {
        bypassNextClick.current = true
        try {
          pending.anchor.click()
        } finally {
          bypassNextClick.current = false
        }
      } else {
        navigate(pending.href)
      }
    },
  }
}
