import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

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

type LoadState = 'loading' | 'ready' | 'error'
type Tab = 'projects' | 'engineers'

const PAGE_SIZE = 10

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
  const [engineerQuery, setEngineerQuery] = useState('')
  const [engineers, setEngineers] = useState<DashboardEngineer[]>([])
  const [engineerCursor, setEngineerCursor] = useState<string | null>(null)
  const [engineerState, setEngineerState] = useState<LoadState>('loading')
  const [retryKey, setRetryKey] = useState(0)
  const projectRequestKey = `${projectQuery}:${retryKey}:${tab}`
  const engineerRequestKey = [
    selectedProject,
    engineerQuery,
    retryKey,
    tab,
  ].join(':')
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
  const visibleEngineerState = noEngineerScope ? 'ready' : engineerState

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
  }, [projectQuery, retryKey, tab])

  useEffect(() => {
    if (tab !== 'engineers' || noEngineerScope) return
    let active = true
    const timer = window.setTimeout(() => {
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
  }, [engineerQuery, noEngineerScope, retryKey, selectedProject, tab])

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

  function selectTab(next: Tab) {
    setTab(next)
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = tab === 'projects' ? 'engineers' : 'projects'
    setTab(next)
    document.getElementById(`dashboard-tab-${next}`)?.focus()
  }

  const scopeLabel =
    globalAccess && !selectedProject
      ? '全部可查看專案'
      : (selectedProjectRow?.name ?? '專案進度')

  return (
    <section aria-labelledby="dashboard-heading" className="dashboard-page">
      <div className="dashboard-heading">
        <div>
          <p className="dashboard-eyebrow">管理後台</p>
          <h1 id="dashboard-heading">
            {tab === 'projects' ? '專案進度總覽' : '工程師工作量'}
          </h1>
        </div>
        <p className="dashboard-description">
          專案進度與工程師工作量依目前可查看的範圍呈現。
        </p>
      </div>

      <div
        aria-label="Dashboard 檢視"
        className="dashboard-tabs"
        role="tablist"
      >
        <button
          aria-controls="dashboard-panel-projects"
          aria-selected={tab === 'projects'}
          className="dashboard-tab"
          id="dashboard-tab-projects"
          onClick={() => selectTab('projects')}
          onKeyDown={onTabKeyDown}
          role="tab"
          tabIndex={tab === 'projects' ? 0 : -1}
          type="button"
        >
          專案進度
        </button>
        <button
          aria-controls="dashboard-panel-engineers"
          aria-selected={tab === 'engineers'}
          className="dashboard-tab"
          id="dashboard-tab-engineers"
          onClick={() => selectTab('engineers')}
          onKeyDown={onTabKeyDown}
          role="tab"
          tabIndex={tab === 'engineers' ? 0 : -1}
          type="button"
        >
          工程師工作量
        </button>
      </div>

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
            ? '範圍依你的模組權限決定。'
            : '只會列出你具備進度查看權限的專案。'}
        </span>
      </div>

      {summaryState === 'loading' && (
        <p className="dashboard-status" role="status">
          正在載入進度摘要…
        </p>
      )}
      {summaryState === 'error' && (
        <div className="dashboard-notice is-error" role="alert">
          <p>進度摘要載入失敗，請重試。</p>
          <button className="dashboard-button" onClick={retry} type="button">
            重新載入
          </button>
        </div>
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
          {projectListState === 'loading' && (
            <p className="dashboard-status" role="status">
              正在載入專案進度…
            </p>
          )}
          {projectListState === 'error' && (
            <RetryNotice onRetry={retry} text="專案進度載入失敗，請重試。" />
          )}
          {projectListState === 'ready' && visibleProjects.length === 0 && (
            <div className="dashboard-notice is-empty">
              <p>
                {projectQuery.trim()
                  ? `找不到符合「${projectQuery.trim()}」的專案。`
                  : '目前沒有可查看的專案進度。'}
              </p>
              {projectQuery && (
                <button
                  className="dashboard-button"
                  onClick={() => setProjectQuery('')}
                  type="button"
                >
                  清除搜尋
                </button>
              )}
            </div>
          )}
          {projectListState === 'ready' && visibleProjects.length > 0 && (
            <ProjectList
              onSelect={setSelectedProject}
              projects={visibleProjects}
              scopeLabel={scopeLabel}
            />
          )}
          {globalAccess &&
            !selectedProject &&
            projectCursor &&
            projectListState === 'ready' && (
              <div className="dashboard-load-row">
                <button
                  className="dashboard-button"
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
              <p>同一人可能在不同歸屬欄位出現；各欄數字不可相加為人數。</p>
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
              <div className="dashboard-notice is-empty">
                <p>
                  {engineerQuery.trim()
                    ? `找不到符合「${engineerQuery.trim()}」的工程師。`
                    : '目前範圍沒有工程師工作量資料。'}
                </p>
                {engineerQuery && (
                  <button
                    className="dashboard-button"
                    onClick={() => setEngineerQuery('')}
                    type="button"
                  >
                    清除搜尋
                  </button>
                )}
              </div>
            )}
          {visibleEngineerState === 'ready' && visibleEngineers.length > 0 && (
            <EngineerList engineers={visibleEngineers} />
          )}
          {engineerCursor && visibleEngineerState === 'ready' && (
            <div className="dashboard-load-row">
              <button
                className="dashboard-button"
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
      aria-label="工程師工作量清單"
      className="dashboard-engineer-list"
      role="table"
    >
      <div className="dashboard-engineer-head" role="row">
        <span role="columnheader">工程師</span>
        <span role="columnheader">派任待開始</span>
        <span role="columnheader">派任進行中</span>
        <span role="columnheader">開始者進行中</span>
        <span role="columnheader">完成查核</span>
      </div>
      {engineers.map((engineer) => (
        <div
          className="dashboard-engineer-row"
          key={engineer.user_id}
          role="row"
        >
          <strong role="cell">{formatPerson(engineer)}</strong>
          <CountCell
            label="派任待開始"
            value={engineer.assigned_pending_count}
          />
          <CountCell
            label="派任進行中"
            value={engineer.assigned_in_progress_count}
          />
          <CountCell
            label="開始者進行中"
            value={engineer.started_in_progress_count}
          />
          <CountCell label="完成查核" value={engineer.completed_by_count} />
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
    <div className="dashboard-notice is-error" role="alert">
      <p>{text}</p>
      <button className="dashboard-button" onClick={onRetry} type="button">
        重新載入
      </button>
    </div>
  )
}
