import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'

import LogoutButton from '../auth/LogoutButton'
import { landingPath } from '../auth/landing'
import { useCurrentUser } from '../auth/useCurrentUser'
import { isForbidden } from '../http'
import RouteNotFound from '../RouteNotFound'
import { fetchFieldTasks, FieldApiError, type FieldTask } from './api'
import type { TaskListChange } from './StartAction'
import TaskDetail from './TaskDetail'

type Scope = 'mine' | 'all'
type Status = 'all' | FieldTask['status']
type ListState = {
  items: FieldTask[]
  nextCursor: string | null
  pages: number
  scrollY: number
}

const PAGE_SIZE = 10

/**
 * 把詳情頁已由後端確認的結果套到清單記憶，返回時卡片狀態正確，
 * 同時保留範圍、狀態、已載入頁數與捲動位置。
 */
function applyListChange(
  memory: Map<string, ListState>,
  change: TaskListChange,
) {
  for (const [key, saved] of memory) {
    const filter = key.split(':')[2]
    const items = saved.items.flatMap((task) => {
      if (task.id !== change.id) return [task]
      if ('removed' in change) return []
      // 待開始篩選裡的任務開始後已不符合篩選，與後端查詢結果一致。
      if (filter === 'PENDING') return []
      return [{ ...task, status: change.status }]
    })
    memory.set(key, { ...saved, items })
  }
}

function taskTitle(task: FieldTask) {
  const { first_title: first, item_count: count } = task.item_summary
  if (!first) return '查核任務'
  return count > 1 ? `${first} 等 ${count} 項` : first
}

function displayTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-TW', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date)
}

export default function FieldPage() {
  const { user } = useCurrentUser()
  const [listMemory] = useState(() => new Map<string, ListState>())
  const [returnKeys] = useState(() => new Set<string>())
  const location = useLocation()
  const detailId = location.pathname.match(/^\/field\/tasks\/([^/]+)\/?$/)?.[1]
  // `/field` 以外、也不是任務詳情的網址（例如 `/field/abc123`）：找不到。
  const unknownPath = !detailId && !/^\/field\/?$/.test(location.pathname)
  const from = `${location.pathname}${location.search}${location.hash}`
  const notice = (location.state as { notice?: unknown } | null)?.notice
  return (
    <div className="field-shell">
      <header className="field-top">
        <div className="field-brand">
          <strong>InspectFlow 工程查核系統</strong>
          <span>{user.name_zh ?? user.username}</span>
        </div>
        <nav className="field-top-actions" aria-label="我的功能">
          {user.has_office_access && (
            <Link to="/admin/projects">我的專案</Link>
          )}
          {user.has_template_access && (
            <Link to="/admin/templates">範本管理</Link>
          )}
          <Link to="/change-password" state={{ from }}>
            變更密碼
          </Link>
          <LogoutButton />
        </nav>
      </header>
      <main>
        {typeof notice === 'string' && <p role="status">{notice}</p>}
        {detailId ? (
          <TaskDetail
            key={detailId}
            taskId={detailId}
            homePath={landingPath(user)}
            onListChange={(change) => applyListChange(listMemory, change)}
          />
        ) : unknownPath ? (
          <RouteNotFound />
        ) : (
          <TaskList
            key={`${user.id}:${location.search}`}
            userId={user.id}
            memory={listMemory}
            returnKeys={returnKeys}
          />
        )}
      </main>
      {!detailId && !unknownPath && (
        <details className="field-profile">
          <summary>我的資料</summary>
          <p>帳號名稱：{user.username}</p>
          <p>中文姓名：{user.name_zh ?? '—'}</p>
          <p>英文姓名：{user.name_en ?? '—'}</p>
          <p>Email：{user.email ?? '—'}</p>
        </details>
      )}
    </div>
  )
}

function TaskList({
  userId,
  memory,
  returnKeys,
}: {
  userId: string
  memory: Map<string, ListState>
  returnKeys: Set<string>
}) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const scope: Scope = params.get('scope') === 'all' ? 'all' : 'mine'
  const rawStatus = params.get('status')
  const status: Status =
    rawStatus === 'PENDING' || rawStatus === 'IN_PROGRESS' ? rawStatus : 'all'
  const key = `${userId}:${scope}:${status}`
  const [restore] = useState(
    () =>
      returnKeys.has(key) ||
      (location.state as { restoreTaskList?: unknown } | null)
        ?.restoreTaskList === true,
  )
  const [state, setState] = useState<ListState | null>(() =>
    restore ? (memory.get(key) ?? null) : null,
  )
  const [loading, setLoading] = useState(() => !restore || !memory.has(key))
  const [error, setError] = useState<'forbidden' | 'other' | null>(null)
  const [retry, setRetry] = useState(0)
  const { user } = useCurrentUser()

  useEffect(() => {
    let active = true
    returnKeys.delete(key)
    const saved = restore ? memory.get(key) : null
    if (saved) {
      requestAnimationFrame(() => window.scrollTo(0, saved.scrollY))
      return () => {
        active = false
      }
    }
    fetchFieldTasks({
      assignedToMe: scope === 'mine',
      status: status === 'all' ? null : status,
      limit: PAGE_SIZE,
    })
      .then((page) => {
        if (!active) return
        const next = {
          items: page.items,
          nextCursor: page.next_cursor,
          pages: 1,
          scrollY: 0,
        }
        memory.set(key, next)
        setState(next)
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof FieldApiError && cause.status === 401) {
          navigate('/login', {
            state: { from: location.pathname + location.search },
          })
        } else {
          setError(isForbidden(cause) ? 'forbidden' : 'other')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [
    key,
    location.pathname,
    location.search,
    memory,
    navigate,
    retry,
    restore,
    returnKeys,
    scope,
    status,
  ])

  function updateFilter(nextScope: Scope, nextStatus: Status) {
    const next = new URLSearchParams()
    if (nextScope === 'all') next.set('scope', 'all')
    if (nextStatus !== 'all') next.set('status', nextStatus)
    setParams(next, { state: null })
  }

  async function loadMore() {
    if (!state?.nextCursor || loading) return
    setLoading(true)
    setError(null)
    try {
      const page = await fetchFieldTasks({
        assignedToMe: scope === 'mine',
        status: status === 'all' ? null : status,
        cursor: state.nextCursor,
        limit: PAGE_SIZE,
      })
      const next = {
        items: [...state.items, ...page.items],
        nextCursor: page.next_cursor,
        pages: state.pages + 1,
        scrollY: window.scrollY,
      }
      memory.set(key, next)
      setState(next)
    } catch (cause) {
      setError(isForbidden(cause) ? 'forbidden' : 'other')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <h1 className="field-heading">今日任務</h1>
      <p className="field-intro">已派出的未完成任務，依派送時間排列。</p>
      {error !== 'forbidden' && (
        <>
          <div className="field-scope" aria-label="任務範圍">
            {(['mine', 'all'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => updateFilter(value, status)}
              >
                {value === 'mine' ? '我的任務' : '全部'}
              </button>
            ))}
          </div>
          <div className="field-filter" aria-label="任務狀態">
            {(['all', 'PENDING', 'IN_PROGRESS'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={status === value}
                onClick={() => updateFilter(scope, value)}
              >
                {
                  {
                    all: '所有狀態',
                    PENDING: '待開始',
                    IN_PROGRESS: '進行中',
                  }[value]
                }
              </button>
            ))}
          </div>
        </>
      )}
      {loading && !state && <p role="status">載入任務中…</p>}
      {error === 'forbidden' && (
        <section className="field-notice field-error" role="alert">
          <h2>目前無法查看現場任務</h2>
          <p>你的帳號沒有任何專案的現場查核權限。請聯絡專案管理者確認權限。</p>
          {user.has_office_access && (
            <Link className="button-link" to="/admin/projects">
              前往我的專案
            </Link>
          )}
          {user.has_template_access && (
            <Link className="button-link" to="/admin/templates">
              前往範本管理
            </Link>
          )}
        </section>
      )}
      {error === 'other' && !state?.nextCursor && (
        <section className="field-notice field-error" role="alert">
          <h2>無法載入任務</h2>
          <p>請稍後再試。</p>
          <button
            type="button"
            onClick={() => {
              memory.delete(key)
              setState(null)
              setError(null)
              setLoading(true)
              setRetry((value) => value + 1)
            }}
          >
            重試
          </button>
        </section>
      )}
      {state && error !== 'forbidden' && (
        <>
          <p className="field-count">
            {scope === 'mine' ? '我的任務' : '全部可查核任務'} 已顯示{' '}
            {state.items.length} 筆
          </p>
          {state.items.length === 0 ? (
            <section className="field-notice">
              <h2>目前沒有符合的任務</h2>
              <p>你有現場查核權限，但目前沒有符合範圍與狀態的任務。</p>
              {scope === 'mine' && (
                <button
                  type="button"
                  onClick={() => updateFilter('all', status)}
                >
                  查看全部任務
                </button>
              )}
            </section>
          ) : (
            <div className="field-task-list">
              {state.items.map((task) => (
                <Link
                  className={`field-task-card ${task.status === 'IN_PROGRESS' ? 'progress' : ''}`}
                  key={task.id}
                  to={`/field/tasks/${task.id}${location.search}`}
                  onClick={() => {
                    returnKeys.add(key)
                    const saved = memory.get(key)
                    if (saved)
                      memory.set(key, {
                        ...saved,
                        scrollY: window.scrollY,
                      })
                  }}
                >
                  <span className="field-card-top">
                    <strong>{taskTitle(task)}</strong>
                    <span className="field-status">
                      {task.status === 'PENDING' ? '待開始' : '進行中'}
                    </span>
                  </span>
                  <span className="field-card-project">
                    {task.project_name}
                  </span>
                  <span className="field-card-meta">
                    <span>
                      地點：{task.location.location_text ?? '未指定'}
                    </span>
                    {task.location.zone_name && (
                      <span>分區：{task.location.zone_name}</span>
                    )}
                    <span>
                      建議指派：{task.suggested_assignee?.name_zh ?? '未指定'}
                    </span>
                  </span>
                  <span className="field-card-foot">
                    <span>派送 {displayTime(task.dispatched_at)}</span>
                    <strong>查看任務</strong>
                  </span>
                </Link>
              ))}
            </div>
          )}
          {state.nextCursor && (
            <>
              <button
                type="button"
                className="field-more"
                disabled={loading}
                onClick={loadMore}
              >
                {loading ? '載入中…' : '載入更多'}
              </button>
              {error === 'other' && (
                <section className="field-notice field-error" role="alert">
                  <h2>無法載入任務</h2>
                  <p>請稍後再試。</p>
                  <button type="button" onClick={() => void loadMore()}>
                    重試
                  </button>
                </section>
              )}
            </>
          )}
        </>
      )}
    </>
  )
}
