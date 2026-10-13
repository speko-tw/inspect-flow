import { useCallback, useEffect, useRef, useState } from 'react'

export interface CursorPage<T> {
  items: T[]
  next_cursor: string | null
}

export interface CursorPageParams {
  q?: string
  cursor?: string | null
  limit?: number
}

type FetchPage<T> = (params: CursorPageParams) => Promise<CursorPage<T>>
type ErrorMessage = (error: unknown) => string

/** 管理列表共用的搜尋、游標續載與過期請求防護。 */
export function useCursorList<T>(
  fetchPage: FetchPage<T>,
  getErrorMessage: ErrorMessage,
) {
  const [items, setItems] = useState<T[]>([])
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [error, setError] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const requestId = useRef(0)
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
    queueMicrotask(() => {
      if (active) void loadFirstPage('')
    })
    return () => {
      // 舊頁面的回應不可覆寫新列表或卸載後的狀態。
      active = false
      requestId.current += 1
    }
  }, [loadFirstPage])

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
