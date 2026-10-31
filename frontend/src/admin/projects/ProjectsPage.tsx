import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { useCurrentUser } from '../../auth/useCurrentUser'
import { FormError } from '../../ui/Form'
import { managementErrorMessage } from '../api'
import { CursorListSearch } from '../CursorListSearch'
import { useCursorList } from '../useCursorList'
import {
  hasDuplicateCodeWarning,
  listCompanyRoles,
  listProjectsPage,
  type CompanyRole,
} from './api'
import { ROUTES } from '../../routes'
import MyProjectsPage from './MyProjectsPage'
import './ProjectCards.css'

/** 角色清單尚未載入時，仍以目前角色代碼避免清單顯示空白。 */
function roleLabel(roles: CompanyRole[], value: string): string {
  return roles.find((role) => role.value === value)?.label ?? value
}

/** 依 ADM-R23、ADM-R24 顯示可用的專案清單。 */
export default function ProjectsPage() {
  const { user } = useCurrentUser()
  return user.is_admin ? (
    <AdminProjectsPage />
  ) : (
    <MyProjectsPage canCreateProject={user.can_create_project} />
  )
}

function safeInitialProjectQuery(value: unknown): string {
  if (typeof value !== 'string') return ''
  if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(value.trim())) return ''
  return value
}

/** Admin 專案清單（ADM-R23、ADM-R32）。 */
function AdminProjectsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [initialQuery] = useState(() => {
    const state = location.state as { projectQuery?: unknown } | null
    return safeInitialProjectQuery(state?.projectQuery)
  })
  const pageHeadingRef = useRef<HTMLHeadingElement>(null)
  const noticeRef = useRef<HTMLParagraphElement>(null)
  const projectList = useCursorList(
    listProjectsPage,
    managementErrorMessage,
    initialQuery,
  )
  const {
    items: projects,
    query,
    setQuery,
    appliedQuery,
    error: listError,
    nextCursor,
    loading,
    loadingMore,
    search,
    clearSearch,
    loadMore,
  } = projectList
  const [notice] = useState(() => {
    const state = location.state as { projectNotice?: unknown } | null
    return typeof state?.projectNotice === 'string' ? state.projectNotice : ''
  })
  const [duplicateProjectCode] = useState(() => {
    const state = location.state as { duplicateProjectCode?: unknown } | null
    return typeof state?.duplicateProjectCode === 'string'
      ? state.duplicateProjectCode
      : ''
  })
  const [roles, setRoles] = useState<CompanyRole[]>([])

  useEffect(() => {
    pageHeadingRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (notice) noticeRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [notice])

  useEffect(() => {
    const state = location.state as {
      duplicateProjectCode?: unknown
      projectNotice?: unknown
    } | null
    if (
      typeof state?.projectNotice !== 'string' &&
      typeof state?.duplicateProjectCode !== 'string'
    )
      return
    navigate(location.pathname + location.search + location.hash, {
      replace: true,
      state: null,
    })
  }, [
    location.hash,
    location.pathname,
    location.search,
    location.state,
    navigate,
  ])

  useEffect(() => {
    let active = true
    listCompanyRoles()
      .then((items) => {
        if (active) setRoles(items)
      })
      .catch(() => {
        if (active) setRoles([])
      })
    return () => {
      active = false
    }
  }, [])

  const stateQuery = appliedQuery
    ? { returnTo: '/projects', returnQuery: appliedQuery }
    : { returnTo: '/projects' }

  return (
    <section aria-labelledby="projects-heading">
      <h1 id="projects-heading" ref={pageHeadingRef} tabIndex={-1}>
        專案
      </h1>
      {notice && (
        <p className="notice-success" ref={noticeRef} role="status">
          {notice}
        </p>
      )}
      {duplicateProjectCode && (
        <p role="alert">
          警告：專案代號「{duplicateProjectCode}」與其他專案重複，仍已儲存。
        </p>
      )}
      <Link className="btn btn-primary" to={ROUTES.projectNew.path}>
        新增專案
      </Link>
      {loading ? <p>載入中…</p> : null}
      <CursorListSearch
        disabled={loading}
        label="搜尋專案"
        onQueryChange={setQuery}
        onSearch={(event) => {
          event.preventDefault()
          void search(query)
        }}
        query={query}
      />
      <FormError>{listError}</FormError>
      {projects.length > 0 && (
        <section aria-labelledby="project-workspace-heading">
          <h2 id="project-workspace-heading">專案工作台</h2>
          <div className="project-workspace-grid">
            {projects.map((project) => {
              const applyTemplatesPath = [
                '/projects',
                project.id,
                'inspection-items',
                'templates',
              ].join('/')
              return (
                <article
                  className="project-workspace-card"
                  id={'project-card-' + project.id}
                  key={project.id}
                  tabIndex={-1}
                >
                  <p className="project-code">
                    {project.project_code}
                    {hasDuplicateCodeWarning(project) ? (
                      <span>（代號重複）</span>
                    ) : null}
                  </p>
                  <h3>{project.name}</h3>
                  <p>{project.site_location}</p>
                  {project.client_name ? (
                    <p>{'業主：' + project.client_name}</p>
                  ) : null}
                  <p>本公司角色：{roleLabel(roles, project.company_role)}</p>
                  <p>啟用成員 {project.member_count} 人</p>
                  {project.planned_start_date ? (
                    <p>{'預定開工：' + project.planned_start_date}</p>
                  ) : null}
                  {project.planned_completion_date ? (
                    <p>{'預定完工：' + project.planned_completion_date}</p>
                  ) : null}
                  <div className="card-actions project-card-actions">
                    <Link
                      className="btn btn-emphasis"
                      to={'/projects/' + project.id}
                    >
                      開啟專案
                    </Link>
                    <Link className="btn" to={applyTemplatesPath}>
                      套用範本
                    </Link>
                    <Link
                      className="btn"
                      to={'/projects/' + project.id + '/members'}
                    >
                      成員
                    </Link>
                    <Link
                      aria-label={'編輯專案「' + project.name + '」'}
                      className="btn"
                      state={stateQuery}
                      to={ROUTES.projectEdit.path.replace(
                        ':projectId',
                        project.id,
                      )}
                    >
                      編輯
                    </Link>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}
      {!loading && projects.length === 0 ? (
        appliedQuery ? (
          <p>
            找不到符合「{appliedQuery}」的專案。{' '}
            <button onClick={() => void clearSearch()} type="button">
              清除搜尋
            </button>
          </p>
        ) : (
          <p>目前沒有專案。</p>
        )
      ) : null}
      {nextCursor && (
        <button
          disabled={loading || loadingMore}
          onClick={() => void loadMore()}
          type="button"
        >
          {loadingMore ? '載入中…' : '載入更多'}
        </button>
      )}
    </section>
  )
}
