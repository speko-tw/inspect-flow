import { SuggestedAssignee } from '../ui/SuggestedAssignee'
import { useEffect, useRef, useState } from 'react'
import {
  Link,
  matchPath,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router'

import { landingPath } from '../auth/landing'
import { useCurrentUser } from '../auth/useCurrentUser'
import { Button } from '../components/Button'
import { ResourceState } from '../components/layout/LayoutPatterns'
import AccessDeniedPage from '../components/layout/AccessDeniedPage'
import { isForbidden } from '../http'
import AppHeader, { memberNavItems } from '../layout/AppHeader'
import { PAGE_TITLES } from '../layout/navigationLabels'
import { canAccessRoute, ROUTES } from '../routes'
import RouteNotFound from '../RouteNotFound'
import { StatusBadge } from '../ui/Badge'
import {
  fetchFieldTasks,
  fetchRecentCompletedTasks,
  FieldApiError,
  type CompletedFieldTask,
  type FieldTask,
} from './api'
import type { TaskListChange } from './StartAction'
import TaskDetail from './TaskDetail'
import './field-redesign.css'

type Scope = 'mine' | 'all'
type Status = 'all' | FieldTask['status']
type ListState = {
  items: FieldTask[]
  nextCursor: string | null
  pages: number
  scrollY: number
}
type CompletedListState = {
  items: CompletedFieldTask[]
  nextCursor: string | null
  totalCount: number
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
  return task.name
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

/**
 * 顯示 Field 任務清單與唯讀詳情入口，遵守 FUI-R02、FUI-R03。
 *
 * @returns Field 首頁內容與共用導覽。
 */
export default function FieldPage() {
  const { user } = useCurrentUser()
  const [listMemory] = useState(() => new Map<string, ListState>())
  const [returnKeys] = useState(() => new Set<string>())
  const [completedMemory] = useState(
    () => new Map<string, CompletedListState>(),
  )
  const [completedReturnKeys] = useState(() => new Set<string>())
  const location = useLocation()
  const taskListKey = new URLSearchParams(location.search)
  taskListKey.delete('recent')
  const detailPattern = new RegExp(
    `^${ROUTES.fieldTask.path.replace(':id', '([^/]+)')}/?$`,
  )
  const detailId = location.pathname.match(detailPattern)?.[1]
  // `/tasks` 以外、也不是任務詳情的網址會顯示找不到頁面。
  const unknownPath =
    !detailId &&
    !matchPath({ path: ROUTES.fieldTasks.path, end: true }, location.pathname)
  const notice = (location.state as { notice?: unknown } | null)?.notice
  const taskAccessDenied =
    !unknownPath && !canAccessRoute(user, ROUTES.fieldTasks)
  return (
    <>
      <AppHeader
        navItems={memberNavItems(user)}
        navLabel={user.is_admin ? '管理功能' : '我的功能'}
        user={user}
      />
      <div className="field-shell field-redesign">
        <main>
          {typeof notice === 'string' && (
            <p className="notice-success" role="status">
              {notice}
            </p>
          )}
          {taskAccessDenied ? (
            <AccessDeniedPage headingLevel={2} />
          ) : detailId ? (
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
              key={`${user.id}:${taskListKey.toString()}`}
              userId={user.id}
              memory={listMemory}
              returnKeys={returnKeys}
              completedMemory={completedMemory}
              completedReturnKeys={completedReturnKeys}
            />
          )}
        </main>
      </div>
    </>
  )
}

function TaskList({
  userId,
  memory,
  returnKeys,
  completedMemory,
  completedReturnKeys,
}: {
  userId: string
  memory: Map<string, ListState>
  returnKeys: Set<string>
  completedMemory: Map<string, CompletedListState>
  completedReturnKeys: Set<string>
}) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const locationRef = useRef(location.pathname + location.search)
  useEffect(() => {
    locationRef.current = location.pathname + location.search
  }, [location.pathname, location.search])
  const scope: Scope = params.get('scope') === 'all' ? 'all' : 'mine'
  const allowAutoScope = !params.has('scope') && !params.has('status')
  const noAssignedTasks =
    (location.state as { defaultedToAll?: boolean } | null)?.defaultedToAll ===
    true
  const rawStatus = params.get('status')
  const status: Status =
    rawStatus === 'PENDING' || rawStatus === 'IN_PROGRESS' ? rawStatus : 'all'
  const key = `${userId}:${scope}:${status}`
  const completedKey = `${userId}:${scope}`
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
  const recentExpanded = params.get('recent') === '1'
  const [restoreCompleted] = useState(
    () =>
      completedReturnKeys.has(completedKey) &&
      (location.state as { restoreTaskList?: unknown } | null)
        ?.restoreTaskList === true,
  )
  const [completedState, setCompletedState] =
    useState<CompletedListState | null>(() =>
      restoreCompleted ? (completedMemory.get(completedKey) ?? null) : null,
    )
  const recentTasks = completedState?.items ?? []
  const recentCount = completedState?.totalCount ?? null
  const recentCursor = completedState?.nextCursor ?? null
  const [recentLoading, setRecentLoading] = useState(() => !completedState)
  const [recentError, setRecentError] = useState(false)
  const [recentRetry, setRecentRetry] = useState(0)
  const recentRequest = useRef(0)
  // FUI-R02：預設範圍要等指派查詢完成才知道；決定前標題中性為「任務」，
  // 避免先出現「我的任務」再改成「全部任務」。
  const pendingDefaultScope = allowAutoScope && !state

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
        // T16：先以真實指派查詢決定預設，不從管理者身分猜有沒有任務。
        if (allowAutoScope && scope === 'mine' && page.items.length === 0) {
          setParams(
            { scope: 'all' },
            {
              replace: true,
              state: { ...location.state, defaultedToAll: true },
            },
          )
          return
        }
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
          navigate(ROUTES.login.path, {
            state: { from: locationRef.current },
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
    location.state,
    memory,
    navigate,
    retry,
    restore,
    returnKeys,
    scope,
    status,
    allowAutoScope,
    setParams,
  ])

  useEffect(() => {
    let active = true
    const requestId = ++recentRequest.current
    if (restoreCompleted) {
      completedReturnKeys.delete(completedKey)
      const saved = completedMemory.get(completedKey)
      if (saved) {
        requestAnimationFrame(() => window.scrollTo(0, saved.scrollY))
        return () => {
          active = false
          recentRequest.current += 1
        }
      }
    } else {
      completedReturnKeys.delete(completedKey)
    }
    fetchRecentCompletedTasks({
      assignedToMe: scope === 'mine',
      limit: PAGE_SIZE,
    })
      .then((page) => {
        if (!active || requestId !== recentRequest.current) return
        const next = {
          items: page.items,
          nextCursor: page.next_cursor,
          totalCount: page.total_count,
          scrollY: window.scrollY,
        }
        completedMemory.set(completedKey, next)
        setCompletedState(next)
      })
      .catch((cause: unknown) => {
        if (active && requestId === recentRequest.current) {
          if (cause instanceof FieldApiError && cause.status === 401) {
            navigate(ROUTES.login.path, {
              state: { from: locationRef.current },
            })
          } else {
            setRecentError(true)
          }
        }
      })
      .finally(() => {
        if (active && requestId === recentRequest.current) {
          setRecentLoading(false)
        }
      })
    return () => {
      active = false
      recentRequest.current += 1
    }
  }, [
    completedKey,
    completedMemory,
    completedReturnKeys,
    location.pathname,
    navigate,
    recentRetry,
    restoreCompleted,
    scope,
  ])

  function updateFilter(nextScope: Scope, nextStatus: Status) {
    const next = new URLSearchParams()
    next.set('scope', nextScope)
    if (nextStatus !== 'all') next.set('status', nextStatus)
    if (recentExpanded) next.set('recent', '1')
    setParams(next, { state: { defaultedToAll: noAssignedTasks } })
  }

  function toggleRecent() {
    const next = new URLSearchParams(params)
    if (recentExpanded) next.delete('recent')
    else next.set('recent', '1')
    setParams(next)
  }

  function retryRecent() {
    setRecentLoading(true)
    setRecentError(false)
    setCompletedState(null)
    completedMemory.delete(completedKey)
    setRecentRetry((value) => value + 1)
  }

  async function loadMoreRecent() {
    if (!recentCursor || recentLoading) return
    const requestId = recentRequest.current
    setRecentLoading(true)
    setRecentError(false)
    try {
      const page = await fetchRecentCompletedTasks({
        assignedToMe: scope === 'mine',
        completedWithinDays: 14,
        cursor: recentCursor,
        limit: PAGE_SIZE,
      })
      if (requestId !== recentRequest.current) return
      const next = {
        items: [...recentTasks, ...page.items],
        nextCursor: page.next_cursor,
        totalCount: page.total_count,
        scrollY: window.scrollY,
      }
      completedMemory.set(completedKey, next)
      setCompletedState(next)
    } catch {
      if (requestId === recentRequest.current) setRecentError(true)
    } finally {
      if (requestId === recentRequest.current) setRecentLoading(false)
    }
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
      <h1 className="field-heading">
        {/* FUI-R02：查詢未決時沿用中性標題，範圍確定後才顯示對應標題。 */}
        {pendingDefaultScope
          ? '任務'
          : scope === 'all'
            ? '全部任務'
            : PAGE_TITLES.tasks}
      </h1>
      <p className="field-intro">已派出的未完成任務，依派送時間排列。</p>
      {noAssignedTasks && scope === 'mine' && Boolean(state?.items.length) && (
        <section className="field-notice" aria-label="我的任務提醒">
          <p>目前沒有指派給你的任務。</p>
          <Button onClick={() => updateFilter('all', 'all')}>
            查看全部任務
          </Button>
        </section>
      )}
      {error !== 'forbidden' && (
        <>
          <div className="field-scope" aria-label="任務範圍">
            {(['mine', 'all'] as const).map((value) => (
              <Button
                key={value}
                variant="secondary"
                type="button"
                aria-pressed={scope === value}
                className="field-filter-button"
                onClick={() => updateFilter(value, status)}
              >
                {value === 'mine' ? '我的任務' : '全部'}
              </Button>
            ))}
          </div>
          <div className="field-filter" aria-label="任務狀態">
            {(['all', 'PENDING', 'IN_PROGRESS'] as const).map((value) => (
              <Button
                key={value}
                variant="secondary"
                type="button"
                aria-pressed={status === value}
                className="field-filter-button"
                onClick={() => updateFilter(scope, value)}
              >
                {
                  {
                    all: '所有狀態',
                    PENDING: '待開始',
                    IN_PROGRESS: '進行中',
                  }[value]
                }
              </Button>
            ))}
          </div>
        </>
      )}
      {loading && !state && (
        <ResourceState
          state="loading"
          title="載入任務中"
          message="正在取得可查核任務。"
        />
      )}
      {error === 'forbidden' && <AccessDeniedPage headingLevel={2} />}
      {error === 'other' && !state?.nextCursor && (
        <section className="field-notice field-notice-error" role="alert">
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
              <h2>
                {scope === 'mine' && status === 'all'
                  ? '目前沒有指派給你的任務'
                  : '目前沒有符合的任務'}
              </h2>
              <p>你有現場查核權限，但目前沒有符合範圍與狀態的任務。</p>
              {scope === 'mine' && (
                <Button
                  variant="secondary"
                  type="button"
                  className="field-inline-action"
                  onClick={() => updateFilter('all', status)}
                >
                  查看全部任務
                </Button>
              )}
            </section>
          ) : (
            <div className="field-task-list">
              {state.items.map((task) => (
                <Link
                  className={`field-task-card ${task.status === 'IN_PROGRESS' ? 'progress' : ''}`}
                  key={task.id}
                  to={`${ROUTES.fieldTask.path.replace(
                    ':id',
                    task.id,
                  )}${location.search}`}
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
                    <StatusBadge status={task.status} />
                  </span>
                  {task.item_summary.first_title && (
                    <span className="field-card-item-summary">
                      {task.item_summary.first_title}
                      {task.item_summary.item_count > 1 &&
                        `等 ${task.item_summary.item_count} 項`}
                    </span>
                  )}
                  <span className="field-card-project">
                    {task.project_name}
                  </span>
                  <span className="field-card-meta">
                    {task.location.zone_name && (
                      <span>分區：{task.location.zone_name}</span>
                    )}
                    {/* IP-R10：空補充地點不代表地點未指定。 */}
                    {task.location.location_text && (
                      <span>補充地點：{task.location.location_text}</span>
                    )}
                    <span>
                      建議指派：
                      <SuggestedAssignee
                        person={task.suggested_assignee}
                        status={task.status}
                        archived={Boolean(task.plan_archived)}
                      />
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
              <Button
                variant="secondary"
                type="button"
                className="field-more"
                disabled={loading}
                onClick={loadMore}
              >
                {loading ? '載入中…' : '載入更多'}
              </Button>
              {error === 'other' && (
                <section
                  className="field-notice field-notice-error"
                  role="alert"
                >
                  <h2>無法載入任務</h2>
                  <p>請稍後再試。</p>
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => void loadMore()}
                  >
                    重試
                  </Button>
                </section>
              )}
            </>
          )}
        </>
      )}
      {error !== 'forbidden' && (
        <section className="field-recent-completed">
          <h2>
            <Button
              variant="secondary"
              type="button"
              aria-expanded={recentExpanded}
              aria-controls="recent-completed-list"
              onClick={toggleRecent}
            >
              <span aria-hidden="true">{recentExpanded ? '▾' : '▸'}</span>{' '}
              近期已完成 ({recentCount ?? '…'})
            </Button>
          </h2>
          {recentExpanded && (
            <div id="recent-completed-list">
              {recentLoading && recentTasks.length === 0 && (
                <ResourceState
                  state="loading"
                  title="載入近期已完成任務中"
                  message="正在取得最近 14 天完成的任務。"
                />
              )}
              {recentError && (
                <section
                  className="field-notice field-notice-error"
                  role="alert"
                >
                  <h3>無法載入近期已完成任務</h3>
                  <p>請稍後再試。</p>
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={retryRecent}
                  >
                    重試
                  </Button>
                </section>
              )}
              {!recentLoading && !recentError && recentTasks.length === 0 && (
                <section className="field-notice">
                  <p>最近 14 天沒有已完成的任務。</p>
                </section>
              )}
              {recentTasks.length > 0 && (
                <div className="field-task-list">
                  {recentTasks.map((task) => (
                    <Link
                      className="field-task-card"
                      key={task.id}
                      to={`${ROUTES.fieldTask.path.replace(
                        ':id',
                        task.id,
                      )}${location.search}`}
                      onClick={() => {
                        returnKeys.add(key)
                        const saved = memory.get(key)
                        if (saved) {
                          memory.set(key, {
                            ...saved,
                            scrollY: window.scrollY,
                          })
                        }
                        completedReturnKeys.add(completedKey)
                        const completedSaved =
                          completedMemory.get(completedKey)
                        if (completedSaved) {
                          completedMemory.set(completedKey, {
                            ...completedSaved,
                            scrollY: window.scrollY,
                          })
                        }
                      }}
                    >
                      <span className="field-card-top">
                        <strong>{task.name}</strong>
                        <StatusBadge status="COMPLETED" />
                      </span>
                      <span className="field-card-project">
                        {task.project_name}
                      </span>
                      <span className="field-card-meta">
                        {task.location.zone_name && (
                          <span>分區：{task.location.zone_name}</span>
                        )}
                        {task.location.location_text && (
                          <span>補充地點：{task.location.location_text}</span>
                        )}
                      </span>
                      <span className="field-card-foot">
                        <span>完成 {displayTime(task.completed_at)}</span>
                        <strong>查看任務</strong>
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              {recentCursor && (
                <Button
                  variant="secondary"
                  type="button"
                  className="field-more"
                  disabled={recentLoading}
                  onClick={loadMoreRecent}
                >
                  {recentLoading ? '載入中…' : '載入更多'}
                </Button>
              )}
            </div>
          )}
        </section>
      )}
    </>
  )
}
