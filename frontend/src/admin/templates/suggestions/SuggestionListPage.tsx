import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'

import AccessDeniedPage from '../../../components/layout/AccessDeniedPage'
import { isForbidden } from '../../../http'
import { BackLink } from '../../../layout/BackLink'
import {
  getMyStatusCounts,
  getPendingCount,
  listMySuggestions,
  listReviewSuggestions,
  type SuggestionStatus,
  type SuggestionSummary,
} from './api'
import { displayTitle, SUGGESTION_STATUS } from './content'
import { formatTime } from './format'
import { suggestionErrorMessage } from './messages'
import {
  PROJECT_FILTER_PARAM,
  projectItemsPath,
  suggestionPath,
  type SuggestionMode,
  type SuggestionNavState,
} from './paths'
import { SuggestionStatusBadge } from './SuggestionStatusBadge'
import './Suggestions.css'

const STATUSES = Object.keys(SUGGESTION_STATUS) as SuggestionStatus[]

type StatusFilter = SuggestionStatus | 'all'

/**
 * 本人清單（`mine`，TPL-R34）與管理者待審清單（`review`，TPL-R33）。
 *
 * 計數都來自後端：本人的各狀態件數用 `total_count`，管理者的待審數用
 * `pending-count`，兩者都不受目前頁次與搜尋影響（TPL-AC40）。搜尋只
 * 過濾已載入的件，規格的清單契約沒有關鍵字參數。
 */
export default function SuggestionListPage({
  mode,
}: {
  mode: SuggestionMode
}) {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const navState = (location.state as SuggestionNavState | null) ?? {}
  const projectId =
    mode === 'mine' ? searchParams.get(PROJECT_FILTER_PARAM) : null
  const origin = navState.origin ?? (projectId ? 'project' : 'settings')
  const [status, setStatus] = useState<StatusFilter>(
    mode === 'review' ? 'PENDING' : 'all',
  )
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  // 讀到的件綁定篩選條件；條件一換，舊件立即視為未載入，不混進新條件。
  const key = `${mode}|${projectId ?? ''}|${status}`
  const [loaded, setLoaded] = useState<{
    key: string
    items: SuggestionSummary[]
    nextCursor: string | null
    error: string
  } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')
  const [denied, setDenied] = useState(false)
  const [counts, setCounts] = useState<Record<
    SuggestionStatus,
    number
  > | null>(null)
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  const fetchPage = useCallback(
    (cursor: string | null) => {
      if (mode === 'mine') {
        return listMySuggestions({
          status: status === 'all' ? undefined : status,
          source_project_id: projectId ?? undefined,
          cursor,
        })
      }
      return listReviewSuggestions({
        status: status === 'all' ? 'ALL' : status,
        cursor,
      })
    },
    [mode, projectId, status],
  )

  useEffect(() => {
    let active = true
    fetchPage(null)
      .then((page) => {
        if (!active) return
        setLoaded({
          key,
          items: page.items,
          nextCursor: page.next_cursor,
          error: '',
        })
      })
      .catch((caught: unknown) => {
        if (!active) return
        if (isForbidden(caught)) setDenied(true)
        else {
          setLoaded({
            key,
            items: [],
            nextCursor: null,
            error: suggestionErrorMessage(caught, 'read'),
          })
        }
      })
    return () => {
      active = false
    }
  }, [fetchPage, key])

  useEffect(() => {
    let active = true
    const read =
      mode === 'mine'
        ? getMyStatusCounts(projectId ?? undefined).then((value) => {
            if (active) setCounts(value)
          })
        : getPendingCount().then((value) => {
            if (active) setPendingCount(value.pending_count)
          })
    read.catch(() => {
      // 計數讀取失敗不擋清單；對應的數字不顯示，避免顯示錯的 0。
    })
    return () => {
      active = false
    }
  }, [mode, projectId])

  const current = loaded?.key === key ? loaded : null
  const loading = current === null
  const items = useMemo(() => current?.items ?? [], [current])
  const nextCursor = current?.nextCursor ?? null
  const error = moreError || current?.error || ''

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setMoreError('')
    try {
      const page = await fetchPage(nextCursor)
      setLoaded((current) =>
        current && current.key === key
          ? {
              ...current,
              items: [...current.items, ...page.items],
              nextCursor: page.next_cursor,
            }
          : current,
      )
    } catch (caught) {
      setMoreError(suggestionErrorMessage(caught, 'read'))
    } finally {
      setLoadingMore(false)
    }
  }

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matched = needle
      ? items.filter((item) =>
          [
            item.title,
            item.source_project_name,
            item.source_item_title,
            item.proposer_name,
          ]
            .join('\n')
            .toLowerCase()
            .includes(needle),
        )
      : items
    // 待審清單依最近送審時間排序：較舊件剛重送時排在前面（TPL-R34）。
    return mode === 'review'
      ? [...matched].sort((a, b) =>
          b.last_submitted_at.localeCompare(a.last_submitted_at),
        )
      : matched
  }, [items, mode, query])

  if (denied) return <AccessDeniedPage />

  const total = counts
    ? STATUSES.reduce((sum, key) => sum + counts[key], 0)
    : null
  const title = mode === 'mine' ? '我的範本建議' : '範本建議審核'
  const backTo =
    mode === 'review'
      ? '/templates'
      : origin === 'project' && projectId
        ? projectItemsPath(projectId)
        : '/settings'
  const backLabel =
    mode === 'review'
      ? '返回範本庫'
      : origin === 'project' && projectId
        ? '返回專案頁'
        : '返回個人設定'
  const projectName = items[0]?.source_project_name
  const empty =
    mode === 'mine' && projectId && total === 0 && !loading && !error
  const linkState = (): SuggestionNavState => ({
    origin,
    listSearch: location.search,
  })

  return (
    <section aria-labelledby="suggestion-list-heading" className="suggestions">
      <BackLink to={backTo}>{backLabel}</BackLink>
      <h1 id="suggestion-list-heading" ref={heading} tabIndex={-1}>
        {title}
      </h1>
      {mode === 'review' ? (
        <p>
          <strong>
            待審建議{pendingCount === null ? '' : `（${pendingCount}）`}
          </strong>{' '}
          <span className="muted-text">
            全體待審件數，不受下方搜尋與頁次影響。
          </span>
        </p>
      ) : (
        <>
          <p>
            只顯示你提出的建議；
            {projectId ? '本案共' : '共'} {total ?? '…'} 件，包含所有狀態。
          </p>
          {counts && (
            <p aria-label="各狀態件數" className="suggestion-status-counts">
              {STATUSES.map(
                (key) => `${SUGGESTION_STATUS[key].label} ${counts[key]} 件`,
              ).join('／')}
            </p>
          )}
        </>
      )}
      <form
        className="suggestion-filter"
        onSubmit={(event) => {
          event.preventDefault()
          setQuery(queryDraft)
        }}
      >
        <div>
          <label htmlFor="suggestion-status">狀態</label>
          <select
            id="suggestion-status"
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            value={status}
          >
            <option value="all">
              {mode === 'review' ? '全部（完整歷程）' : '全部狀態'}
            </option>
            {STATUSES.map((key) => (
              <option key={key} value={key}>
                {SUGGESTION_STATUS[key].label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="suggestion-search">名稱或來源專案</label>
          <input
            id="suggestion-search"
            onChange={(event) => setQueryDraft(event.target.value)}
            type="search"
            value={queryDraft}
          />
        </div>
        <button type="submit">搜尋</button>
      </form>
      {projectId && (
        <p>
          目前專案：{projectName ?? '本案'}{' '}
          <button
            className="link-button"
            onClick={() =>
              setSearchParams(
                {},
                { replace: true, state: { origin, listSearch: '' } },
              )
            }
            type="button"
          >
            顯示全部專案
          </button>
        </p>
      )}
      {query && <p className="muted-text">搜尋只比對已載入的件。</p>}
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p>載入中…</p>
      ) : (
        <>
          <p role="status">符合條件 {shown.length} 件</p>
          <ul className="suggestion-list">
            {shown.map((item) => (
              <li data-suggestion={item.id} key={item.id}>
                <div className="suggestion-row">
                  <div>
                    <SuggestionStatusBadge status={item.status} />
                    <h2>{displayTitle(item.title)}</h2>
                    <p>
                      {item.source_project_name}／{item.source_item_title}
                    </p>
                    <p>
                      提議人：{item.proposer_name} · 最新第 {item.revision_no}{' '}
                      版
                      {item.last_editor_id !== item.proposer_id &&
                        `（${item.last_editor_name}修改）`}
                    </p>
                    {mode === 'review' && (
                      <p>最近送審：{formatTime(item.last_submitted_at)}</p>
                    )}
                    {item.status === 'RETURNED' && item.latest_return && (
                      <p className="notice-info">
                        退回原因：{item.latest_return.reason}
                      </p>
                    )}
                    {item.approval && (
                      <p>
                        已入庫：{item.approval.category_name}／
                        {item.approval.system_name}／
                        {item.approval.template_title}
                      </p>
                    )}
                  </div>
                  <Link
                    aria-label={`${
                      mode === 'mine' ? '查看建議與歷程' : '開啟審核'
                    }：${displayTitle(item.title)}`}
                    className="btn"
                    state={linkState()}
                    to={suggestionPath(mode, item.id)}
                  >
                    {mode === 'mine' ? '查看建議與歷程' : '開啟審核'}
                  </Link>
                </div>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="suggestion-empty">
                {empty
                  ? '本案尚未提出範本建議。可返回專案頁，從查核項目提出。'
                  : '沒有符合條件的建議。請調整搜尋條件。'}
              </li>
            )}
          </ul>
          {nextCursor && (
            <button
              disabled={loadingMore}
              onClick={() => void loadMore()}
              type="button"
            >
              {loadingMore ? '載入中…' : '載入更多'}
            </button>
          )}
        </>
      )}
    </section>
  )
}
