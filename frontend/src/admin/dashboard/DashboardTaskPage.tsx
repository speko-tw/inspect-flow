import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { Badge, Button, InfoRow, Tag } from '../../components'
import { HttpError } from '../../http'
import {
  ListDetailLayout,
  ResourceState,
} from '../../components/layout/LayoutPatterns'
import { STATUS_BADGES } from '../../ui/statusBadge'
import { ROUTES } from '../../routes'
import {
  getDashboardTask,
  listDashboardProjects,
  listDashboardTasks,
  type DashboardTask,
} from './api'
import './DashboardTaskPage.css'
import '../../styles/g7-shell.css'

type LoadState = 'loading' | 'ready' | 'error' | 'denied'

const PAGE_SIZE = 50

function taskStatus(status: string) {
  const known = STATUS_BADGES[status as keyof typeof STATUS_BADGES]
  return {
    label: known?.label ?? status,
    variant: known?.variant ?? 'neutral',
  }
}

function taskLocation(task: DashboardTask): string {
  return (
    [task.location.zone_name, task.location.location_text]
      .filter((value): value is string => Boolean(value))
      .join('・') || '未提供地點'
  )
}

/** ADM-R06：以四項白名單欄位
 * 呈現專案任務的唯讀清單與明細。
 */
export default function DashboardTaskPage() {
  const { projectId = '', taskId } = useParams()
  const navigate = useNavigate()
  const basePath = ROUTES.dashboardTasks.path.replace(
    ':projectId',
    encodeURIComponent(projectId),
  )
  const [projectName, setProjectName] = useState(projectId)
  const [listResult, setListResult] = useState<{
    requestKey: string
    tasks: DashboardTask[]
    nextCursor: string | null
    state: LoadState
  }>({ requestKey: '', tasks: [], nextCursor: null, state: 'loading' })
  const [detailResult, setDetailResult] = useState<{
    requestKey: string
    task: DashboardTask | null
    state: LoadState
  }>({ requestKey: '', task: null, state: 'loading' })
  const [retryKey, setRetryKey] = useState(0)
  const listRequestKey = `${projectId}:${retryKey}`
  const detailRequestKey = `${projectId}:${taskId ?? ''}:${retryKey}`
  const currentList =
    listResult.requestKey === listRequestKey
      ? listResult
      : { tasks: [], nextCursor: null, state: 'loading' as const }
  const currentDetail =
    detailResult.requestKey === detailRequestKey
      ? detailResult
      : {
          task: null,
          state: taskId ? ('loading' as const) : ('ready' as const),
        }

  useEffect(() => {
    let active = true
    listDashboardProjects({ limit: 100 })
      .then((page) => {
        if (!active) return
        const project = page.items.find(
          (item) => item.project_id === projectId,
        )
        if (project) setProjectName(project.name)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [projectId])

  useEffect(() => {
    let active = true
    listDashboardTasks(projectId, { limit: PAGE_SIZE })
      .then((page) => {
        if (!active) return
        setListResult({
          requestKey: listRequestKey,
          tasks: page.items,
          nextCursor: page.next_cursor,
          state: 'ready',
        })
      })
      .catch((error: unknown) => {
        if (!active) return
        setListResult({
          requestKey: listRequestKey,
          tasks: [],
          nextCursor: null,
          state:
            error instanceof HttpError && error.status === 403
              ? 'denied'
              : 'error',
        })
      })
    return () => {
      active = false
    }
  }, [projectId, retryKey, listRequestKey])

  useEffect(() => {
    if (!taskId) return
    let active = true
    getDashboardTask(projectId, taskId)
      .then((task) => {
        if (!active) return
        setDetailResult({
          requestKey: detailRequestKey,
          task,
          state: 'ready',
        })
      })
      .catch((error: unknown) => {
        if (!active) return
        setDetailResult({
          requestKey: detailRequestKey,
          task: null,
          state:
            error instanceof HttpError && error.status === 403
              ? 'denied'
              : 'error',
        })
      })
    return () => {
      active = false
    }
  }, [projectId, retryKey, taskId, detailRequestKey])

  async function loadMore() {
    if (!currentList.nextCursor) return
    setListResult({
      requestKey: listRequestKey,
      tasks: currentList.tasks,
      nextCursor: currentList.nextCursor,
      state: 'loading',
    })
    try {
      const page = await listDashboardTasks(projectId, {
        cursor: currentList.nextCursor,
        limit: PAGE_SIZE,
      })
      setListResult({
        requestKey: listRequestKey,
        tasks: [...currentList.tasks, ...page.items],
        nextCursor: page.next_cursor,
        state: 'ready',
      })
    } catch (error) {
      setListResult({
        requestKey: listRequestKey,
        tasks: currentList.tasks,
        nextCursor: currentList.nextCursor,
        state:
          error instanceof HttpError && error.status === 403
            ? 'denied'
            : 'error',
      })
    }
  }

  function retry() {
    setRetryKey((current) => current + 1)
  }

  if (currentList.state === 'denied' || currentDetail.state === 'denied') {
    return (
      <section className="dashboard-task-page" aria-labelledby="task-denied">
        <h1 id="task-denied">目前無法查看專案進度</h1>
        <p role="alert">你目前沒有查看此專案任務的權限。</p>
        <Link className="dashboard-task-back" to={ROUTES.dashboardIndex.path}>
          返回專案進度總覽
        </Link>
      </section>
    )
  }

  return (
    <main className="dashboard-task-page">
      <nav aria-label="頁面路徑" className="dashboard-task-crumb">
        <Link to={ROUTES.dashboardIndex.path}>全部專案進度</Link>
        <span aria-hidden="true">／</span>
        <span>{projectName}</span>
      </nav>
      <header className="dashboard-task-heading">
        <div>
          <p className="dashboard-task-eyebrow">專案任務</p>
          <h1>{projectName}</h1>
          <p>以下是此專案目前可查看的任務進度。</p>
        </div>
        <Tag className="dashboard-task-scope">全部進度・唯讀</Tag>
      </header>
      <p className="dashboard-task-notice">
        {'顯示任務、狀態、地點與建議指派。 ' +
          '照片與查核結果不在此權限範圍。'}
      </p>
      <ListDetailLayout
        detail={
          taskId ? (
            <TaskDetail
              detail={currentDetail.task}
              onRetry={retry}
              projectName={projectName}
              state={currentDetail.state}
            />
          ) : undefined
        }
        detailTitle="任務明細"
        list={
          <TaskList
            activeTaskId={taskId}
            basePath={basePath}
            items={currentList.tasks}
            loadMore={() => void loadMore()}
            nextCursor={currentList.nextCursor}
            onRetry={retry}
            projectName={projectName}
            state={currentList.state}
          />
        }
        listTitle="任務清單"
        onBack={() => navigate(basePath)}
      />
    </main>
  )
}

function TaskList({
  activeTaskId,
  basePath,
  items,
  loadMore,
  nextCursor,
  onRetry,
  projectName,
  state,
}: {
  activeTaskId?: string
  basePath: string
  items: DashboardTask[]
  loadMore: () => void
  nextCursor: string | null
  onRetry: () => void
  projectName: string
  state: LoadState
}) {
  return (
    <section className="dashboard-task-panel">
      <header className="dashboard-task-panel-heading">
        <h2>任務清單</h2>
        {state === 'ready' && <span>{items.length} 項</span>}
      </header>
      {state === 'loading' && (
        <ResourceState
          message="正在載入專案任務。"
          state="loading"
          title="載入中"
        />
      )}
      {state === 'error' && (
        <ResourceState
          actionLabel="重新載入"
          message="任務清單載入失敗，請重試。"
          onAction={onRetry}
          state="error"
          title="無法載入任務"
        />
      )}
      {state === 'ready' && items.length === 0 && (
        <ResourceState
          message="此專案目前沒有可查看的任務。"
          state="empty"
          title="目前沒有任務"
        />
      )}
      {state === 'ready' && items.length > 0 && (
        <ul className="dashboard-task-list">
          {items.map((task) => {
            const status = taskStatus(task.status)
            const assignee =
              task.suggested_assignee?.name_zh ??
              task.suggested_assignee?.user_id ??
              '未提供建議指派'
            return (
              <li key={task.task_id}>
                <Link
                  aria-current={
                    activeTaskId === task.task_id ? 'true' : undefined
                  }
                  className="dashboard-task-row"
                  to={`${basePath}/${encodeURIComponent(task.task_id)}`}
                  state={{ projectName }}
                >
                  <span className="dashboard-task-row-title">
                    <strong>{taskLocation(task)}</strong>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </span>
                  <span className="dashboard-task-row-meta">
                    <small className="dashboard-task-number">
                      任務編號：{task.task_id}
                    </small>
                    <span>建議指派：{assignee}</span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {state === 'ready' && nextCursor && (
        <Button
          className="dashboard-task-more"
          onClick={loadMore}
          variant="secondary"
        >
          載入更多任務
        </Button>
      )}
    </section>
  )
}

function TaskDetail({
  detail,
  onRetry,
  projectName,
  state,
}: {
  detail: DashboardTask | null
  onRetry: () => void
  projectName: string
  state: LoadState
}) {
  if (state === 'loading') {
    return (
      <ResourceState
        message="正在載入任務明細。"
        state="loading"
        title="載入中"
      />
    )
  }
  if (state === 'error' || !detail) {
    return (
      <ResourceState
        actionLabel="重新載入"
        message="任務明細載入失敗，請重試。"
        onAction={onRetry}
        state="error"
        title="無法載入任務明細"
      />
    )
  }
  const status = taskStatus(detail.status)
  const assignee =
    detail.suggested_assignee?.name_zh ??
    detail.suggested_assignee?.user_id ??
    '未提供建議指派'
  return (
    <article className="dashboard-task-detail">
      <header className="dashboard-task-detail-heading">
        <div>
          <h2>{taskLocation(detail)}</h2>
          <small className="dashboard-task-number">
            任務編號：{detail.task_id}
          </small>
          <p>{projectName}</p>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </header>
      <div className="dashboard-task-facts">
        <InfoRow label="狀態" value={status.label} />
        <InfoRow label="地點" value={taskLocation(detail)} />
        <InfoRow label="建議指派" value={assignee} />
      </div>
      <footer className="dashboard-task-detail-footer">
        <Tag>唯讀</Tag>
        <span>此頁不提供照片與查核結果。</span>
      </footer>
    </article>
  )
}
