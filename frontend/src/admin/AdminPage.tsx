import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router'

import LogoutButton from '../auth/LogoutButton'
import { useCurrentUser } from '../auth/useCurrentUser'
import CompaniesPage from './CompaniesPage'
import RolesPage from './roles/RolesPage'
import ProjectDetailPage from './projects/ProjectDetailPage'
import ProjectsPage from './projects/ProjectsPage'
import ProjectItemChangePage from './projectItems/ProjectItemChangePage'
import ProjectItemLinks from './projectItems/ProjectItemLinks'
import ProjectTemplatesPage from '../field/ProjectTemplatesPage'
import { projectItemApi } from './projectItems/api'
import TemplatesPage from './templates/TemplatesPage'
import TemporaryPassword from './TemporaryPassword'
import UsersPage from './UsersPage'

const PlanningPage = lazy(() => import('./planning/PlanningPage'))

function ProjectPlanningRoute() {
  const { projectId } = useParams()
  return (
    <Suspense fallback={<p>載入中…</p>}>
      <PlanningPage key={projectId} initialProjectId={projectId} />
    </Suspense>
  )
}

const NAV_ITEMS = [
  { to: '/admin/users', label: '使用者' },
  { to: '/admin/companies', label: '公司' },
  { to: '/admin/roles', label: '角色' },
  { to: '/admin/projects', label: '專案' },
  { to: '/admin/templates', label: '範本管理' },
  { to: '/change-password', label: '變更密碼' },
]

function MemberProjectItems() {
  const { projectId = '' } = useParams()
  return <ProjectItemLinks projectId={projectId} />
}

export default function AdminPage() {
  const location = useLocation()
  return <AdminPageContent key={location.key} />
}

function AdminPageContent() {
  const { user } = useCurrentUser()
  const location = useLocation()
  const navigate = useNavigate()
  const [temporaryPassword, setTemporaryPassword] = useState<{
    username: string
    password: string
    locationKey: string
  } | null>(null)
  const resultHeadingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (temporaryPassword) resultHeadingRef.current?.focus()
  }, [temporaryPassword])

  // 從別頁導來時可帶一則提示（例如變更密碼成功後）。
  const notice = (location.state as { notice?: unknown } | null)?.notice

  if (!user.is_admin && location.pathname.startsWith('/admin/templates')) {
    return (
      <main>
        <TemplatesPage />
        <NavLink to="/">返回工作台</NavLink>
      </main>
    )
  }

  const isMemberProjectRoute =
    /^\/admin\/projects\/[^/]+(?:\/templates|\/planning|\/inspection-items\/[^/]+)?\/?$/.test(
      location.pathname,
    )

  if (!user.is_admin && isMemberProjectRoute) {
    return (
      <main>
        <Routes>
          <Route element={<MemberProjectItems />} path="projects/:projectId" />
          <Route
            element={<ProjectTemplatesPage />}
            path="projects/:projectId/templates"
          />
          <Route
            element={<ProjectItemChangePage api={projectItemApi} />}
            path="projects/:projectId/inspection-items/:itemId"
          />
          <Route
            element={<ProjectPlanningRoute />}
            path="projects/:projectId/planning"
          />
        </Routes>
        <NavLink to="/field">返回工作台</NavLink>
      </main>
    )
  }
  if (!user.is_admin) {
    return (
      <main>
        <h1>無權限</h1>
        <p role="alert">只有系統管理者可以使用管理頁面。</p>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="topbar-brand">InspectFlow 工程查核系統</span>
        <h1>Admin</h1>
        {!temporaryPassword && (
          <nav aria-label="管理功能">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                onClick={() => setTemporaryPassword(null)}
                to={item.to}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
        <span className="topbar-user">
          登入者：{user.name_zh ?? user.username}
        </span>
        {!temporaryPassword && <LogoutButton />}
      </header>
      <main>
        {typeof notice === 'string' && <p role="status">{notice}</p>}
        {temporaryPassword &&
        location.pathname === '/admin/users' &&
        location.key === temporaryPassword.locationKey ? (
          <section
            aria-labelledby="temporary-password-heading"
            className="temporary-password-result"
            role="status"
          >
            <h2
              id="temporary-password-heading"
              ref={resultHeadingRef}
              tabIndex={-1}
            >
              使用者已新增
            </h2>
            <p>帳號：{temporaryPassword.username}</p>
            <p>離開此頁後無法再次查看，首次登入必須變更密碼。</p>
            <TemporaryPassword password={temporaryPassword.password} />
            <button
              onClick={() => {
                setTemporaryPassword(null)
                navigate('/admin/users', { replace: true })
              }}
              type="button"
            >
              已抄下，回到使用者列表
            </button>
          </section>
        ) : (
          <Routes>
            <Route
              index
              element={
                <Navigate replace state={location.state} to="/admin/users" />
              }
            />
            <Route
              path="users"
              element={
                <UsersPage
                  onTemporaryPassword={(username, password) =>
                    setTemporaryPassword({
                      username,
                      password,
                      locationKey: location.key,
                    })
                  }
                />
              }
            />
            <Route path="companies" element={<CompaniesPage />} />
            <Route path="roles" element={<RolesPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route
              path="projects/:projectId"
              element={<ProjectDetailPage />}
            />
            <Route
              path="projects/:projectId/templates"
              element={<ProjectTemplatesPage />}
            />
            <Route
              path="projects/:projectId/planning"
              element={<ProjectPlanningRoute />}
            />
            <Route
              path="projects/:projectId/inspection-items/:itemId"
              element={<ProjectItemChangePage api={projectItemApi} />}
            />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="*" element={<p>這個管理頁面尚未提供。</p>} />
          </Routes>
        )}
      </main>
    </div>
  )
}
