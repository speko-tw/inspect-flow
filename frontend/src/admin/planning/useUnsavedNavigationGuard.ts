import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router'

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

/** 攔截 #451 分區與規劃表單的離頁操作，保留使用者尚未儲存的內容。 */
export function useUnsavedNavigationGuard(hasUnsavedChanges: boolean): void {
  const location = useLocation()
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
      if (
        destination.origin !== window.location.origin ||
        (destination.pathname === location.pathname &&
          destination.search === location.search &&
          destination.hash === location.hash)
      ) {
        return
      }
      if (!hasUnsavedChanges || confirmLeave()) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
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
  }, [hasUnsavedChanges, location.hash, location.pathname, location.search])
}
