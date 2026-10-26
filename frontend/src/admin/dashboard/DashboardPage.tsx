import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import type { CurrentUser } from '../../auth/api'
import {
  hasGlobalDashboardAccess,
  getDashboardSummary,
  listAllDashboardProjects,
  listDashboardEngineers,
  listDashboardProjects,
  type DashboardEngineer,
  type DashboardProject,
  type DashboardSummary,
} from './api'
import './DashboardPage.css'
import { PageTabs } from '../../components/PageTabs'
import { Notice } from '../../ui/Notice'

type LoadState = 'loading' | 'ready' | 'error'
type Tab = 'projects' | 'engineers'

const PAGE_SIZE = 10
const ENGINEER_WORKLOAD_GUIDANCE =
  '前兩欄依建議指派人計，第三欄依實際開始的人計，' +
  '最後一欄是實際完成的累計件數；同一件任務可能重複計入，不能加總。'

function formatRate(rate: number): string {
  return new Intl.NumberFormat('zh-TW', {
    maximumFractionDigits: 1,
    style: 'percent',
  }).format(rate)
}

function formatPerson(person: DashboardEngineer): string {
  return person.name_zh
    ? `${person.name_zh}（${person.username}）`
    : person.username
}

/** ADM-R01、ADM-R04、ADM-R05：呈現後端計算的進度與人員工作量。 */
export default function DashboardPage({ user }: { user: CurrentUser }) {
  const navigate = useNavigate()
  const globalAccess = hasGlobalDashboardAccess(user)
  const [tab, setTab] = useState<Tab>('projects')
  const [projectsResult, setProjectsResult] = useState<{
    key: string
    state: LoadState
    items: DashboardProject[]
  }>({ key: '', state: 'loading', items: [] })
  const [summaryResult, setSummaryResult] = useState<{
    key: string
    state: LoadState
    value: DashboardSummary | null
  }>({ key: '', state: 'loading', value: null })
  const [selectedProject, setSelectedProject] = useState('')
  const [projectQuery, setProjectQuery] = useState('')
  const [projectPage, setProjectPage] = useState<DashboardProject[]>([])
  const [projectCursor, setProjectCursor] = useState<string | null>(null)
  const [projectListState, setProjectListState] =
    useState<LoadState>('loading')
  const [projectListKey, setProjectListKey] = useState('')
  const [engineerQuery, setEngineerQuery] = useState('')
  const [engineers, setEngineers] = useState<DashboardEngineer[]>([])
  const [engineerCursor, setEngineerCursor] = useState<string | null>(null)
  const [engineerState, setEngineerState] = useState<LoadState>('loading')
  const [engineerListKey, setEngineerListKey] = useState('')
  const [retryKey, setRetryKey] = useState(0)
  const projectRequestKey = `${projectQuery}:${retryKey}:${tab}`
  const engineerRequestKey = [
    selectedProject,
    engineerQuery,
    retryKey,
    tab,
  ].join(':')
  const visibleProjectListState =
    projectListKey === projectRequestKey ? projectListState : 'loading'
  const visibleEngineerListState =
    engineerListKey === engineerRequestKey ? engineerState : 'loading'
  const projectRequestKeyRef = useRef(projectRequestKey)
  const engineerRequestKeyRef = useRef(engineerRequestKey)
  useLayoutEffect(() => {
    projectRequestKeyRef.current = projectRequestKey
    engineerRequestKeyRef.current = engineerRequestKey
  }, [engineerRequestKey, projectRequestKey])
  const projectsKey = `${user.id}:${retryKey}`
  const projectsState =
    projectsResult.key === projectsKey ? projectsResult.state : 'loading'
  const projects =
    projectsResult.key === projectsKey ? projectsResult.items : []
  const summaryKey = `${projectsState}:${retryKey}:${selectedProject}`
  const noProjectScope =
    projectsState === 'ready' && !globalAccess && !selectedProject
  const summaryState =
    projectsState !== 'ready'
      ? 'loading'
      : noProjectScope
        ? 'ready'
        : summaryResult.key === summaryKey
          ? summaryResult.state
          : 'loading'
  const summary = summaryResult.key === summaryKey ? summaryResult.value : null
  const noEngineerScope =
    tab === 'engineers' &&
    projectsState === 'ready' &&
    !globalAccess &&
    !selectedProject
  const visibleEngineers = noEngineerScope ? [] : engineers
  const visibleEngineerState = noEngineerScope
    ? 'ready'
    : visibleEngineerListState
  const visibleProjectCursor =
    projectListKey === projectRequestKey ? projectCursor : null
  const visibleEngineerCursor =
    engineerListKey === engineerRequestKey ? engineerCursor : null

  useEffect(() => {
    let active = true
    listAllDashboardProjects()
      .then((items) => {
        if (!active) return
        setProjectsResult({
          key: projectsKey,
          state: 'ready',
          items,
        })
        if (!globalAccess && items.length > 0) {
          setSelectedProject((current) => current || items[0].project_id)
        }
      })
      .catch(() => {
        if (active) {
          setProjectsResult({
            key: projectsKey,
            state: 'error',
            items: [],
          })
        }
      })
    return () => {
      active = false
    }
  }, [globalAccess, projectsKey])

  useEffect(() => {
    if (projectsState !== 'ready' || noProjectScope) return
    let active = true
    getDashboardSummary(selectedProject || undefined)
      .then((value) => {
        if (active) {
          setSummaryResult({ key: summaryKey, state: 'ready', value })
        }
      })
      .catch(() => {
        if (active) {
          setSummaryResult({
            key: summaryKey,
            state: 'error',
            value: null,
          })
        }
      })
    return () => {
      active = false
    }
  }, [noProjectScope, projectsState, selectedProject, summaryKey])

  useEffect(() => {
    if (tab !== 'projects') return
    let active = true
    const timer = window.setTimeout(() => {
      setProjectListKey(projectRequestKey)
      setProjectListState('loading')
      listDashboardProjects({ q: projectQuery, limit: PAGE_SIZE })
        .then((page) => {
          if (active) {
            setProjectPage(page.items)
            setProjectCursor(page.next_cursor)
            setProjectListState('ready')
          }
        })
        .catch(() => {
          if (active) setProjectListState('error')
        })
    }, 180)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [projectQuery, projectRequestKey, retryKey, tab])

  useEffect(() => {
    if (tab !== 'engineers' || noEngineerScope) return
    let active = true
    const timer = window.setTimeout(() => {
      setEngineerListKey(engineerRequestKey)
      setEngineerState('loading')
      listDashboardEngineers({
        projectId: selectedProject || undefined,
        q: engineerQuery,
        limit: PAGE_SIZE,
      })
        .then((page) => {
          if (active) {
            setEngineers(page.items)
            setEngineerCursor(page.next_cursor)
            setEngineerState('ready')
          }
        })
        .catch(() => {
          if (active) setEngineerState('error')
        })
    }, 180)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [
    engineerQuery,
    engineerRequestKey,
    noEngineerScope,
    retryKey,
    selectedProject,
    tab,
  ])

  const selectedProjectRow = projects.find(
    (item) => item.project_id === selectedProject,
  )
  const visibleProjects = !selectedProject
    ? projectPage
    : selectedProjectRow &&
        (!projectQuery.trim() ||
          selectedProjectRow.name
            .toLocaleLowerCase()
            .includes(projectQuery.trim().toLocaleLowerCase()))
      ? [selectedProjectRow]
      : []

  async function loadMoreProjects() {
    if (!projectCursor) return
    const requestKey = projectRequestKey
    setProjectListState('loading')
    try {
      const page = await listDashboardProjects({
        q: projectQuery,
        cursor: projectCursor,
        limit: PAGE_SIZE,
      })
      if (projectRequestKeyRef.current !== requestKey) return
      setProjectPage((current) => [...current, ...page.items])
      setProjectCursor(page.next_cursor)
      setProjectListState('ready')
    } catch {
      if (projectRequestKeyRef.current !== requestKey) return
      setProjectListState('error')
    }
  }

  async function loadMoreEngineers() {
    if (!engineerCursor) return
    const requestKey = engineerRequestKey
    setEngineerState('loading')
    try {
      const page = await listDashboardEngineers({
        projectId: selectedProject || undefined,
        q: engineerQuery,
        cursor: engineerCursor,
        limit: PAGE_SIZE,
      })
      if (engineerRequestKeyRef.current !== requestKey) return
      setEngineers((current) => [...current, ...page.items])
      setEngineerCursor(page.next_cursor)
      setEngineerState('ready')
    } catch {
      if (engineerRequestKeyRef.current !== requestKey) return
      setEngineerState('error')
    }
  }

  function retry() {
    setProjectListState('loading')
    setEngineerState('loading')
    setRetryKey((key) => key + 1)
  }

  const scopeLabel =
    globalAccess && !selectedProject
      ? '全部可查看專案'
      : (selectedProjectRow?.name ?? '專案進度')

  return (
    <section aria-labelledby="dashboard-heading" className="dashboard-page">
      <div className="dashboard-heading">
        <div>
          <h1 id="dashboard-heading">
            {tab === 'projects' ? '專案進度總覽' : '工程師工作量'}
          </h1>
        </div>
        <p className="dashboard-description">
          專案進度與工程師工作量依目前可查看的範圍呈現。
        </p>
      </div>

      <PageTabs
        label="Dashboard 檢視"
        onChange={(next) => setTab(next as Tab)}
        tabs={[
          {
            id: 'projects',
            label: '專案進度',
            panelId: 'dashboard-panel-projects',
          },
          {
            id: 'engineers',
            label: '工程師工作量',
            panelId: 'dashboard-panel-engineers',
          },
        ]}
        value={tab}
      />

      <div className="dashboard-scope">
        <label htmlFor="dashboard-project-scope">檢視範圍</label>
        <select
          disabled={projectsState === 'loading' || projectsState === 'error'}
          id="dashboard-project-scope"
          onChange={(event) => setSelectedProject(event.target.value)}
          value={selectedProject}
        >
          {globalAccess && <option value="">全部可查看專案</option>}
          {projects.map((project) => (
            <option key={project.project_id} value={project.project_id}>
              {project.name}
            </option>
          ))}
        </select>
        <span className="dashboard-scope-hint">
          {globalAccess
            ? '範圍依你擁有的權限決定。'
            : '只會列出你具備進度查看權限的專案。'}
        </span>
      </div>

      {summaryState === 'loading' && (
        <p className="dashboard-status" role="status">
          正在載入進度摘要…
        </p>
      )}
      {summaryState === 'error' && (
        <Notice autoReveal={false} variant="error">
          <p>進度摘要載入失敗，請重試。</p>
          <button className="btn" onClick={retry} type="button">
            重新載入
          </button>
        </Notice>
      )}
      {summaryState === 'ready' && summary && (
        <div aria-label="進度摘要" className="dashboard-summary">
          <article className="dashboard-summary-card is-completion">
            <span>完成率</span>
            <strong>{formatRate(summary.completion_rate)}</strong>
            <progress
              aria-label={`完成率 ${formatRate(summary.completion_rate)}`}
              max="1"
              value={summary.completion_rate}
            />
          </article>
          <Metric label="待開始" value={summary.pending_count} />
          <Metric label="進行中" value={summary.in_progress_count} />
          <Metric label="已完成" value={summary.completed_count} />
        </div>
      )}

      {tab === 'projects' ? (
        <section
          aria-labelledby="dashboard-projects-heading"
          className="dashboard-panel"
          id="dashboard-panel-projects"
          role="tabpanel"
          tabIndex={0}
        >
          <div className="dashboard-section-heading">
            <div>
              <h2 id="dashboard-projects-heading">專案進度</h2>
              <p>只顯示進度，不含照片與查核結果。</p>
            </div>
            <label className="dashboard-search">
              <span className="visually-hidden">搜尋專案</span>
              <input
                onChange={(event) => setProjectQuery(event.target.value)}
                placeholder="搜尋專案名稱"
                type="search"
                value={projectQuery}
              />
            </label>
          </div>
          {visibleProjectListState === 'loading' && (
            <p className="dashboard-status" role="status">
              正在載入專案進度…
            </p>
          )}
          {visibleProjectListState === 'error' && (
            <RetryNotice onRetry={retry} text="專案進度載入失敗，請重試。" />
          )}
          {visibleProjectListState === 'ready' &&
            visibleProjects.length === 0 && (
              <div className="notice dashboard-empty-notice">
                <p>
                  {projectQuery.trim()
                    ? `找不到符合「${projectQuery.trim()}」的專案。`
                    : '目前沒有可查看的專案進度。'}
                </p>
                {projectQuery && (
                  <button
                    className="btn"
                    onClick={() => setProjectQuery('')}
                    type="button"
                  >
                    清除搜尋
                  </button>
                )}
              </div>
            )}
          {visibleProjectListState === 'ready' &&
            visibleProjects.length > 0 && (
              <ProjectList
                onSelect={(projectId) => {
                  setSelectedProject(projectId)
                  navigate(
                    '/overview/projects/' +
                      encodeURIComponent(projectId) +
                      '/tasks',
                  )
                }}
                projects={visibleProjects}
                scopeLabel={scopeLabel}
              />
            )}
          {globalAccess &&
            !selectedProject &&
            visibleProjectCursor &&
            visibleProjectListState === 'ready' && (
              <div className="dashboard-load-row">
                <button
                  className="btn"
                  onClick={() => void loadMoreProjects()}
                  type="button"
                >
                  載入更多專案
                </button>
              </div>
            )}
        </section>
      ) : (
        <section
          aria-labelledby="dashboard-engineers-heading"
          className="dashboard-panel"
          id="dashboard-panel-engineers"
          role="tabpanel"
          tabIndex={0}
        >
          <div className="dashboard-section-heading">
            <div>
              <h2 id="dashboard-engineers-heading">工程師工作量</h2>
            </div>
            <label className="dashboard-search">
              <span className="visually-hidden">搜尋工程師</span>
              <input
                onChange={(event) => setEngineerQuery(event.target.value)}
                placeholder="搜尋姓名或帳號"
                type="search"
                value={engineerQuery}
              />
            </label>
          </div>
          {visibleEngineerState === 'loading' && (
            <p className="dashboard-status" role="status">
              正在載入工程師工作量…
            </p>
          )}
          {visibleEngineerState === 'error' && (
            <RetryNotice
              onRetry={retry}
              text="工程師工作量載入失敗，請重試。"
            />
          )}
          {visibleEngineerState === 'ready' &&
            visibleEngineers.length === 0 && (
              <div className="notice dashboard-empty-notice">
                <p>
                  {engineerQuery.trim()
                    ? `找不到符合「${engineerQuery.trim()}」的工程師。`
                    : '目前範圍沒有工程師工作量資料。'}
                </p>
                {engineerQuery && (
                  <button
                    className="btn"
                    onClick={() => setEngineerQuery('')}
                    type="button"
                  >
                    清除搜尋
                  </button>
                )}
              </div>
            )}
          {visibleEngineerState === 'ready' && visibleEngineers.length > 0 && (
            <>
              <EngineerList engineers={visibleEngineers} />
              <p
                className="dashboard-workload-guidance"
                id="dashboard-workload-guidance"
              >
                {ENGINEER_WORKLOAD_GUIDANCE}
              </p>
            </>
          )}
          {visibleEngineerCursor && visibleEngineerState === 'ready' && (
            <div className="dashboard-load-row">
              <button
                className="btn"
                onClick={() => void loadMoreEngineers()}
                type="button"
              >
                載入更多工程師
              </button>
            </div>
          )}
        </section>
      )}
      {projectsState === 'error' && (
        <RetryNotice onRetry={retry} text="可查看專案清單載入失敗，請重試。" />
      )}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <article className="dashboard-summary-card">
      <span>{label}</span>
      <strong>{value.toLocaleString('zh-TW')}</strong>
    </article>
  )
}

function ProjectList({
  onSelect,
  projects,
  scopeLabel,
}: {
  onSelect: (projectId: string) => void
  projects: DashboardProject[]
  scopeLabel: string
}) {
  return (
    <div
      aria-label="專案進度清單"
      className="dashboard-project-list"
      role="table"
    >
      <div className="dashboard-project-head" role="row">
        <span role="columnheader">專案</span>
        <span role="columnheader">待開始</span>
        <span role="columnheader">進行中</span>
        <span role="columnheader">已完成</span>
        <span role="columnheader">已派出</span>
        <span role="columnheader">完成率</span>
      </div>
      {projects.map((project) => (
        <div
          className="dashboard-project-row"
          key={project.project_id}
          role="row"
        >
          <span className="dashboard-project-name" role="cell">
            <button
              className="dashboard-project-link"
              onClick={() => onSelect(project.project_id)}
              type="button"
            >
              {project.name}
            </button>
            <small>{scopeLabel}</small>
          </span>
          <span
            aria-label={`待開始：${project.pending_count}`}
            className="dashboard-count"
            data-label="待開始"
            role="cell"
          >
            {project.pending_count.toLocaleString('zh-TW')}
          </span>
          <span
            aria-label={`進行中：${project.in_progress_count}`}
            className="dashboard-count"
            data-label="進行中"
            role="cell"
          >
            {project.in_progress_count.toLocaleString('zh-TW')}
          </span>
          <span
            aria-label={`已完成：${project.completed_count}`}
            className="dashboard-count"
            data-label="已完成"
            role="cell"
          >
            {project.completed_count.toLocaleString('zh-TW')}
          </span>
          <span
            aria-label={`已派出：${project.completion_denominator_count}`}
            className="dashboard-count"
            data-label="已派出"
            role="cell"
          >
            {project.completion_denominator_count.toLocaleString('zh-TW')}
          </span>
          <span
            aria-label={`完成率：${formatRate(project.completion_rate)}`}
            className="dashboard-rate"
            data-label="完成率"
            role="cell"
          >
            <strong>{formatRate(project.completion_rate)}</strong>
            <progress
              aria-label={[
                project.name,
                `完成率 ${formatRate(project.completion_rate)}`,
              ].join(' ')}
              max="1"
              value={project.completion_rate}
            />
          </span>
        </div>
      ))}
    </div>
  )
}

function EngineerList({ engineers }: { engineers: DashboardEngineer[] }) {
  return (
    <div
      aria-describedby="dashboard-workload-guidance"
      aria-label="工程師工作量清單"
      className="dashboard-engineer-list"
      role="table"
    >
      <div className="dashboard-engineer-head" role="row">
        <span role="columnheader">工程師</span>
        <span role="columnheader">待開始</span>
        <span role="columnheader">進行中</span>
        <span role="columnheader">實際進行</span>
        <span role="columnheader">累計完成</span>
      </div>
      {engineers.map((engineer) => (
        <div
          className="dashboard-engineer-row"
          key={engineer.user_id}
          role="row"
        >
          <strong role="cell">{formatPerson(engineer)}</strong>
          <CountCell label="待開始" value={engineer.assigned_pending_count} />
          <CountCell
            label="進行中"
            value={engineer.assigned_in_progress_count}
          />
          <CountCell
            label="實際進行"
            value={engineer.started_in_progress_count}
          />
          <CountCell label="累計完成" value={engineer.completed_by_count} />
        </div>
      ))}
    </div>
  )
}

function CountCell({ label, value }: { label: string; value: number }) {
  return (
    <span
      aria-label={`${label}：${value}`}
      className="dashboard-count-cell"
      data-label={label}
      role="cell"
    >
      {value.toLocaleString('zh-TW')}
    </span>
  )
}

function RetryNotice({
  onRetry,
  text,
}: {
  onRetry: () => void
  text: string
}) {
  return (
    <Notice autoReveal={false} variant="error">
      <p>{text}</p>
      <button className="btn" onClick={onRetry} type="button">
        重新載入
      </button>
    </Notice>
  )
}
