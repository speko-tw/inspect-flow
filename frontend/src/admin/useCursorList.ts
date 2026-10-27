import { useCallback, useEffect, useRef, useState } from 'react'

import type { ListPageOptions, Page } from './api'

type FetchPage<T> = (params: ListPageOptions) => Promise<Page<T>>
type ErrorMessage = (error: unknown) => string

/**
 * 管理列表（使用者、公司、專案）共用的搜尋、游標續載與過期請求防護。
 *
 * 使用限制：`fetchPage` 與 `getErrorMessage` 必須是穩定參照（模組層級
 * 函式，或以 `useCallback` 包好）。兩者都在 `loadFirstPage` 的依賴中，
 * 參照每次 render 都變會讓初次載入的 effect 重跑，不停重新送出請求。
 *
 * @param fetchPage 取得一頁資料；`cursor` 為空代表第一頁。
 * @param getErrorMessage 把請求失敗轉成給使用者看的訊息。
 */
export function useCursorList<T>(
  fetchPage: FetchPage<T>,
  getErrorMessage: ErrorMessage,
  initialQueryValue = '',
) {
  const [initialQuery] = useState(initialQueryValue)
  const [items, setItems] = useState<T[]>([])
  const [query, setQuery] = useState(initialQuery)
  const [appliedQuery, setAppliedQuery] = useState(initialQuery)
  const [error, setError] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  // 每次載入第一頁、卸載都會遞增；回應回來時 id 不符就丟棄，
  // 舊查詢晚回來不會蓋掉新結果（loadMore 沿用發出當下的 id）。
  const requestId = useRef(0)
  // F-O05：同一個查詢字串在途時再按搜尋（例如連點、Enter 加按鈕）
  // 不重複送出；token 用來確認清掉的是自己這一次的記錄，
  // 不會誤清之後換了查詢的新記錄。
  const pendingSearch = useRef<{
    query: string
    token: number
  } | null>(null)
  const searchToken = useRef(0)

  const loadFirstPage = useCallback(
    async (search: string) => {
      const id = ++requestId.current
      setError('')
      setItems([])
      setNextCursor(null)
      setLoadingMore(false)
      setLoading(true)
      try {
        const page = await fetchPage({ q: search, limit: 50 })
        if (id === requestId.current) {
          setItems(page.items)
          setNextCursor(page.next_cursor)
        }
      } catch (caught) {
        if (id === requestId.current) setError(getErrorMessage(caught))
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    },
    [fetchPage, getErrorMessage],
  )

  useEffect(() => {
    let active = true
    // 延後到 microtask：StrictMode 開發模式會立刻卸載再重掛，
    // 第一次掛載的 cleanup 先把 active 設為 false，就不會發出重複請求。
    queueMicrotask(() => {
      if (active) void loadFirstPage(initialQuery)
    })
    return () => {
      // 舊頁面的回應不可覆寫新列表或卸載後的狀態。
      active = false
      requestId.current += 1
    }
  }, [initialQuery, loadFirstPage])

  const search = useCallback(
    async (value: string) => {
      const applied = value.trim()
      if (pendingSearch.current?.query === applied) return
      const token = ++searchToken.current
      pendingSearch.current = { query: applied, token }
      setQuery(applied)
      setAppliedQuery(applied)
      try {
        await loadFirstPage(applied)
      } finally {
        if (pendingSearch.current?.token === token) {
          pendingSearch.current = null
        }
      }
    },
    [loadFirstPage],
  )

  const reload = useCallback(
    () => loadFirstPage(appliedQuery),
    [appliedQuery, loadFirstPage],
  )

  const loadMore = useCallback(async () => {
    if (!nextCursor || loading || loadingMore) return
    const id = requestId.current
    const cursor = nextCursor
    setLoadingMore(true)
    setError('')
    try {
      const page = await fetchPage({
        q: appliedQuery,
        cursor,
        limit: 50,
      })
      if (id === requestId.current) {
        setItems((current) => [...current, ...page.items])
        setNextCursor(page.next_cursor)
      }
    } catch (caught) {
      if (id === requestId.current) setError(getErrorMessage(caught))
    } finally {
      if (id === requestId.current) setLoadingMore(false)
    }
  }, [
    appliedQuery,
    fetchPage,
    getErrorMessage,
    loading,
    loadingMore,
    nextCursor,
  ])

  return {
    items,
    query,
    setQuery,
    appliedQuery,
    error,
    nextCursor,
    loading,
    loadingMore,
    search,
    clearSearch: () => search(''),
    reload,
    loadMore,
  }
}
