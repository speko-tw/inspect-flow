import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'

import { useCurrentUser } from '../../auth/useCurrentUser'
import { isForbidden, isNotFound } from '../../http'
import RouteNotFound from '../../RouteNotFound'
import { StatusBadge } from '../../ui/Badge'
import { planningClient, type InspectionTask } from '../planning/api'
import { getWorkflowSummary, type WorkflowSummary } from '../projectHome/api'
import ProjectDeniedPage from '../projectHome/ProjectDeniedPage'
import { listProgressTasks, type ProgressFilter } from './api'

interface ListState {
  items: InspectionTask[]
  nextCursor: string | null
  pages: number
  scrollY: number
}

// ADM-R44：從詳情或瀏覽器返回後沿用已載入頁及位置；依帳號隔離。
const listMemory = new Map<string, ListState>()

const FILTERS: Array<{ id: ProgressFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'DRAFT', label: '草稿' },
  { id: 'PENDING', label: '待開始' },
  { id: 'IN_PROGRESS', label: '進行中' },
  { id: 'COMPLETED', label: '已完成' },
  { id: 'CANCELLED', label: '已取消' },
  { id: 'reinspection', label: '待重查' },
]

function currentFilter(search: string): ProgressFilter {
  const value = new URLSearchParams(search).get('status')
  return FILTERS.find(({ id }) => id === value)?.id ?? 'all'
}

/** #497 合併後只需替換此處的卡片標題規則（ADM-R44）。 */
export function progressTaskTitle(task: InspectionTask): string {
  const { first_title: first, count } = task.item_summary
  if (!first) return '查核任務'
  return count > 1 ? `${first}等 ${count} 項` : first
}

function taskLocation(task: InspectionTask): string {
  return (
    [task.zone?.name, task.location_text].filter(Boolean).join('／') ||
    '未填地點'
  )
}

function needsReinspection(task: InspectionTask): boolean {
  return (
    !task.plan.archived &&
    (task.status === 'PENDING' || task.status === 'IN_PROGRESS') &&
    task.items.some((item) => item.needs_reinspection)
  )
}

function displayTime(value: string | null): string {
  if (!value) return '尚未派出'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-TW', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date)
}

function filterCount(
  summary: WorkflowSummary | null,
  filter: ProgressFilter,
): number | null {
  if (!summary?.task_counts_visible) return null
  if (filter === 'reinspection') {
    return summary.pending_reinspection_task_count
  }
  if (filter !== 'all') return summary.task_counts[filter]
  return Object.values(summary.task_counts).reduce(
    (total, count) => total + count,
    0,
  )
}

/** 依 ADM-R43、ADM-R44 呈現唯讀進度與任務詳情。 */
export default function ProgressPage({
  viewerPermissions,
}: {
  viewerPermissions: string[]
}) {
  const { projectId = '', taskId } = useParams()
  const location = useLocation()
  const filter = currentFilter(location.search)
  if (taskId) {
    return (
      <ProgressDetail
        key={taskId}
        taskId={taskId}
        projectId={projectId}
        filter={filter}
        canViewPlanning={viewerPermissions.includes('inspection_plan.read')}
      />
    )
  }
  return (
    <ProgressList
      key={`${projectId}:${filter}`}
      projectId={projectId}
      filter={filter}
      canViewPlanning={viewerPermissions.includes('inspection_plan.read')}
    />
  )
}

function ProgressList({
  projectId,
  filter,
  canViewPlanning,
}: {
  projectId: string
  filter: ProgressFilter
  canViewPlanning: boolean
}) {
  const { user } = useCurrentUser()
  const key = `${user.id}:${projectId}:${filter}`
  const [state, setState] = useState<ListState | null>(
    () => listMemory.get(key) ?? null,
  )
  const [loading, setLoading] = useState(() => !listMemory.has(key))
  const [error, setError] = useState<'forbidden' | 'other' | null>(null)
  const [summary, setSummary] = useState<WorkflowSummary | null>(null)
  const [summaryError, setSummaryError] = useState(false)
  const [summaryRetry, setSummaryRetry] = useState(0)
  const base = `/admin/projects/${projectId}`

  useEffect(() => {
    let active = true
    getWorkflowSummary(projectId)
      .then((value) => {
        if (active) {
          setSummary(value)
          setSummaryError(false)
        }
      })
      .catch(() => {
        if (active) {
          setSummary(null)
          setSummaryError(true)
        }
      })
    return () => {
      active = false
    }
  }, [projectId, summaryRetry])

  useEffect(() => {
    const saved = listMemory.get(key)
    if (saved) {
      requestAnimationFrame(() => window.scrollTo(0, saved.scrollY))
      return
    }
    let active = true
    listProgressTasks(projectId, filter)
      .then((page) => {
        if (!active) return
        const next = {
          items: page.items,
          nextCursor: page.next_cursor,
          pages: 1,
          scrollY: 0,
        }
        listMemory.set(key, next)
        setState(next)
      })
      .catch((cause: unknown) => {
        if (active) setError(isForbidden(cause) ? 'forbidden' : 'other')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [filter, key, projectId])

  useEffect(() => {
    return () => {
      const saved = listMemory.get(key)
      if (saved) listMemory.set(key, { ...saved, scrollY: window.scrollY })
    }
  }, [key])

  function loadMore() {
    if (!state?.nextCursor || loading) return
    setLoading(true)
    setError(null)
    listProgressTasks(projectId, filter, state.nextCursor)
      .then((page) => {
        const seen = new Set(state.items.map((task) => task.id))
        const next = {
          items: [
            ...state.items,
            ...page.items.filter((task) => !seen.has(task.id)),
          ],
          nextCursor: page.next_cursor,
          pages: state.pages + 1,
          scrollY: window.scrollY,
        }
        listMemory.set(key, next)
        setState(next)
      })
      .catch(() => setError('other'))
      .finally(() => setLoading(false))
  }

  if (error === 'forbidden') return <ProjectDeniedPage />
  return (
    <section
      aria-labelledby="project-section-heading"
      className="progress-page"
    >
      <h2 id="project-section-heading">進度</h2>
      <nav aria-label="任務狀態" className="progress-filters">
        {FILTERS.map(({ id, label }) => {
          const count = filterCount(summary, id)
          const to = `${base}/progress${id === 'all' ? '' : `?status=${id}`}`
          return (
            <Link
              key={id}
              to={to}
              replace
              aria-current={filter === id ? 'true' : undefined}
            >
              {label}
              {count === null ? '' : ` ${count}`}
            </Link>
          )
        })}
      </nav>
      {summaryError && (
        <div role="alert">
          無法載入任務數字。
          <button type="button" onClick={() => setSummaryRetry((n) => n + 1)}>
            重新載入數字
          </button>
        </div>
      )}
      {loading && !state && <p role="status">載入任務中…</p>}
      {state?.items.length === 0 && (
        <p>
          {filter === 'all'
            ? '還沒有任務，請到計畫與任務建立。'
            : '這個狀態目前沒有任務。'}{' '}
          {filter === 'all' && canViewPlanning && (
            <Link to={`${base}/planning`}>前往計畫與任務</Link>
          )}
        </p>
      )}
      {state && state.items.length > 0 && (
        <ul className="progress-cards">
          {state.items.map((task) => (
            <li key={task.id}>
              <Link
                to={`${base}/progress/tasks/${task.id}${
                  filter === 'all' ? '' : `?status=${filter}`
                }`}
                className="progress-card"
              >
                <strong>{progressTaskTitle(task)}</strong>
                <StatusBadge status={task.status} />
                <span>{taskLocation(task)}</span>
                <span>建議指派：{task.assignee?.name_zh || '未指派'}</span>
                <span>計畫：{task.plan.name}</span>
                {needsReinspection(task) && <span>待重查</span>}
                {task.plan.archived && <span>計畫已封存</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {error === 'other' && (
        <div role="alert">
          無法載入任務。
          <button
            type="button"
            onClick={() => {
              if (state?.nextCursor) loadMore()
              else {
                listMemory.delete(key)
                setState(null)
                setLoading(true)
                listProgressTasks(projectId, filter)
                  .then((page) => {
                    const next = {
                      items: page.items,
                      nextCursor: page.next_cursor,
                      pages: 1,
                      scrollY: 0,
                    }
                    listMemory.set(key, next)
                    setState(next)
                    setError(null)
                  })
                  .catch(() => setError('other'))
                  .finally(() => setLoading(false))
              }
            }}
          >
            重新載入
          </button>
        </div>
      )}
      {state?.nextCursor && (
        <button type="button" onClick={loadMore} disabled={loading}>
          載入更多
        </button>
      )}
    </section>
  )
}

function ProgressDetail({
  taskId,
  projectId,
  filter,
  canViewPlanning,
}: {
  taskId: string
  projectId: string
  filter: ProgressFilter
  canViewPlanning: boolean
}) {
  const [task, setTask] = useState<InspectionTask | null>(null)
  const [error, setError] = useState<'missing' | 'forbidden' | 'other' | null>(
    null,
  )
  const [retry, setRetry] = useState(0)
  const base = `/admin/projects/${projectId}`
  const back = `${base}/progress${filter === 'all' ? '' : `?status=${filter}`}`
  useEffect(() => {
    let active = true
    planningClient
      .getTask(taskId)
      .then((value) => {
        if (!active) return
        if (value.project_id !== projectId) setError('missing')
        else setTask(value)
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            isNotFound(cause)
              ? 'missing'
              : isForbidden(cause)
                ? 'forbidden'
                : 'other',
          )
      })
    return () => {
      active = false
    }
  }, [projectId, retry, taskId])

  if (error === 'missing')
    return (
      <RouteNotFound
        title="找不到這筆任務"
        message="網址可能輸入錯誤，或這筆任務已不存在。"
      />
    )
  if (error === 'forbidden') return <ProjectDeniedPage />
  return (
    <section
      aria-labelledby="project-section-heading"
      className="progress-page"
    >
      <Link to={back}>返回進度</Link>
      <h2 id="project-section-heading">任務詳情</h2>
      {error === 'other' && (
        <div role="alert">
          無法載入任務詳情。
          <button
            type="button"
            onClick={() => {
              setError(null)
              setRetry((n) => n + 1)
            }}
          >
            重新載入
          </button>
        </div>
      )}
      {!task && !error && <p role="status">載入任務中…</p>}
      {task && (
        <>
          <h3>{progressTaskTitle(task)}</h3>
          <dl className="progress-detail">
            <dt>狀態</dt>
            <dd>
              <StatusBadge status={task.status} />
            </dd>
            <dt>計畫</dt>
            <dd>
              {task.plan.name}
              {task.plan.archived && '（計畫已封存）'}
            </dd>
            <dt>地點</dt>
            <dd>{taskLocation(task)}</dd>
            <dt>建議指派</dt>
            <dd>{task.assignee?.name_zh || '未指派'}</dd>
            <dt>實際開始者</dt>
            <dd>{task.started_by_user?.name_zh || '尚未開始'}</dd>
            <dt>實際完成者</dt>
            <dd>{task.completed_by_user?.name_zh || '尚未完成'}</dd>
            <dt>派出時間</dt>
            <dd>{displayTime(task.dispatched_at)}</dd>
          </dl>
          <h3>查核項目</h3>
          <ul>
            {task.items.map((item) => (
              <li key={item.id}>
                {item.current_snapshot?.title ?? '未命名項目'}
                {item.needs_reinspection && '（待重查）'}
              </li>
            ))}
          </ul>
          {canViewPlanning && (
            <Link to={`${base}/planning`}>前往計畫與任務</Link>
          )}
        </>
      )}
    </section>
  )
}
