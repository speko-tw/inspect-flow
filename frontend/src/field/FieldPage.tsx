// 一般使用者的「我的工作台」（#290）：我的資料、我的公司、我參與的
// 專案與角色、範本瀏覽、變更密碼、登出；系統管理者另有管理頁連結。
// 只顯示資料；各 API 的權限由後端把關。

import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'

import LogoutButton from '../auth/LogoutButton'
import { useCurrentUser } from '../auth/useCurrentUser'
import {
  fetchMyCompanyProfile,
  fetchMyProjects,
  type MyCompanyProfile,
  type MyProject,
} from './api'
import { listAllProjects, type ProjectSummary } from './projectTemplatesApi'

const EMPTY = '—'
const COMPANY_ERROR = '無法載入公司資料，請稍後再試。'
const PROJECTS_ERROR = '無法載入參與的專案，請稍後再試。'

type Loaded<T> =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; value: T }

function useLoaded<T>(load: () => Promise<T>): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    load()
      .then((value) => {
        if (!cancelled) {
          setState({ kind: 'ready', value })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ kind: 'error' })
        }
      })
    return () => {
      cancelled = true
    }
    // 只在掛載時載入一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return state
}

function text(value: string | null | undefined): string {
  return value ? value : EMPTY
}

export default function FieldPage() {
  const { user } = useCurrentUser()
  const location = useLocation()
  const from = `${location.pathname}${location.search}${location.hash}`
  // 從別頁導來時可帶一則提示（例如收回自己的管理者權限後）。
  const notice = (location.state as { notice?: unknown } | null)?.notice
  const profile = useLoaded(fetchMyCompanyProfile)
  const projects = useLoaded(fetchMyProjects)
  const [allProjects, setAllProjects] = useState<ProjectSummary[] | null>(null)

  useEffect(() => {
    let active = true
    listAllProjects()
      .then((items) => {
        if (active) setAllProjects(items)
      })
      .catch(() => {
        if (active) setAllProjects(null)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="topbar-brand">InspectFlow 工程查核系統</span>
        <h1>工作台</h1>
        <nav aria-label="我的功能">
          {user.is_admin && <Link to="/admin">進入管理頁</Link>}
          <Link to="/admin/templates">瀏覽範本庫</Link>
          <Link to="/change-password" state={{ from }}>
            變更密碼
          </Link>
        </nav>
        <span className="topbar-user">
          登入者：{user.name_zh ?? user.username}
        </span>
        <LogoutButton />
      </header>
      <main>
        {typeof notice === 'string' && <p role="status">{notice}</p>}
        <h2>我的工作台</h2>

        <section aria-labelledby="my-profile-heading">
          <h3 id="my-profile-heading">我的資料</h3>
          <table className="key-value">
            <tbody>
              <tr>
                <th scope="row">帳號名稱</th>
                <td>{user.username}</td>
              </tr>
              <tr>
                <th scope="row">中文姓名</th>
                <td>{text(user.name_zh)}</td>
              </tr>
              <tr>
                <th scope="row">英文姓名</th>
                <td>{text(user.name_en)}</td>
              </tr>
              <tr>
                <th scope="row">Email</th>
                <td>{text(user.email)}</td>
              </tr>
              <tr>
                <th scope="row">身分</th>
                <td>{user.is_admin ? '系統管理者' : '一般使用者'}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section aria-labelledby="my-company-heading">
          <h3 id="my-company-heading">我的公司</h3>
          {profile.kind === 'loading' && <p>載入中…</p>}
          {profile.kind === 'error' && <p role="alert">{COMPANY_ERROR}</p>}
          {profile.kind === 'ready' && (
            <CompanyDetails profile={profile.value} />
          )}
        </section>

        <section aria-labelledby="my-projects-heading">
          <h3 id="my-projects-heading">我參與的專案</h3>
          {projects.kind === 'loading' && <p>載入中…</p>}
          {projects.kind === 'error' && <p role="alert">{PROJECTS_ERROR}</p>}
          {projects.kind === 'ready' && (
            <ProjectsTable projects={projects.value} />
          )}
        </section>
        {allProjects && (
          <section aria-labelledby="all-projects-heading">
            <h3 id="all-projects-heading">所有專案</h3>
            {allProjects.length === 0 ? (
              <p>目前沒有專案。</p>
            ) : (
              <ul>
                {allProjects.map((project) => (
                  <li key={project.id}>
                    <Link to={`/field/projects/${project.id}`}>
                      {project.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

function CompanyDetails({ profile }: { profile: MyCompanyProfile }) {
  if (profile.company === null) {
    return <p>未連結公司</p>
  }
  return (
    <table className="key-value">
      <tbody>
        <tr>
          <th scope="row">公司</th>
          <td>{profile.company.name}</td>
        </tr>
        <tr>
          <th scope="row">部門</th>
          <td>{text(profile.department)}</td>
        </tr>
        <tr>
          <th scope="row">地點</th>
          <td>{text(profile.location)}</td>
        </tr>
        <tr>
          <th scope="row">工號</th>
          <td>{text(profile.employee_no)}</td>
        </tr>
      </tbody>
    </table>
  )
}

function ProjectsTable({ projects }: { projects: MyProject[] }) {
  if (projects.length === 0) {
    return <p>目前沒有參與的專案</p>
  }
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">專案代號</th>
          <th scope="col">工程名稱</th>
          <th scope="col">業主／委託單位</th>
          <th scope="col">工程地點</th>
          <th scope="col">預定開工</th>
          <th scope="col">預定完工</th>
          <th scope="col">我的角色</th>
          <th scope="col">查核項目</th>
        </tr>
      </thead>
      <tbody>
        {projects.map((project) => (
          <tr key={project.id}>
            <td>{project.project_code}</td>
            <td>{project.name}</td>
            <td>{project.client_name}</td>
            <td>{project.site_location}</td>
            <td>{text(project.planned_start_date)}</td>
            <td>{text(project.planned_completion_date)}</td>
            <td>
              {project.role_names.length > 0
                ? project.role_names.join('、')
                : '未指派角色'}
            </td>
            <td>
              <Link to={`/field/projects/${project.id}`}>套用範本</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
