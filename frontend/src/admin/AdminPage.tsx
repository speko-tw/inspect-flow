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

import type { CurrentUser } from '../auth/api'
import LogoutButton from '../auth/LogoutButton'
import { landingLabel, landingPath } from '../auth/landing'
import { useCurrentUser } from '../auth/useCurrentUser'
import CompaniesPage from './CompaniesPage'
import RolesPage from './roles/RolesPage'
import ProjectHomePage from './projectHome/ProjectHomePage'
import ProjectSectionPage from './projectHome/ProjectSectionPage'
import MyProjectsPage from './projects/MyProjectsPage'
import ProjectsPage from './projects/ProjectsPage'
import ProjectItemChangePage from './projectItems/ProjectItemChangePage'
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

  const isProjectSectionRoute =
    /^\/admin\/projects\/[^/]+(?:\/(?:templates|members|inspection-items(?:\/[^/]+)?|zones|planning|progress))?\/?$/.test(
      location.pathname,
    )

  if (!user.is_admin) {
    return <MemberAdminShell user={user} />
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="topbar-brand">InspectFlow 工程查核系統</span>
        {isProjectSectionRoute ? <p>Admin</p> : <h1>Admin</h1>}
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
        {typeof notice === 'string' && (
          <p className="tpl-notice tpl-notice-ok" role="status">
            {notice}
          </p>
        )}
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
            <Route path="projects/:projectId" element={<ProjectHomePage />} />
            <Route
              path="projects/:projectId/members"
              element={<ProjectSectionPage section="members" />}
            />
            <Route
              path="projects/:projectId/inspection-items"
              element={<ProjectSectionPage section="inspection-items" />}
            />
            <Route
              path="projects/:projectId/zones"
              element={<ProjectSectionPage section="zones" />}
            />
            <Route
              path="projects/:projectId/templates"
              element={<ProjectTemplatesPage />}
            />
            <Route
              path="projects/:projectId/planning"
              element={
                <ProjectSectionPage section="planning">
                  <ProjectPlanningRoute />
                </ProjectSectionPage>
              }
            />
            <Route
              path="projects/:projectId/progress"
              element={<ProjectSectionPage section="progress" />}
            />
            <Route
              path="projects/:projectId/inspection-items/:itemId"
              element={
                <ProjectSectionPage section="inspection-items">
                  <ProjectItemChangePage api={projectItemApi} />
                </ProjectSectionPage>
              }
            />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="*" element={<p>這個管理頁面尚未提供。</p>} />
          </Routes>
        )}
      </main>
    </div>
  )
}

// 非系統管理者的管理頁外殼（#480）：頂部導覽只列後端存取摘要確認
// 有權限的項目，不出現點了才 403 的入口；使用者、公司、角色管理
// 只屬系統管理者，這裡一律不列。
function MemberAdminShell({ user }: { user: CurrentUser }) {
  const location = useLocation()
  // 從別頁導來時帶的提示（例如套用範本成功後）。
  const notice = (location.state as { notice?: unknown } | null)?.notice
  const navItems = [
    user.has_office_access || !user.has_template_access
      ? { to: '/admin/projects', label: '我的專案' }
      : null,
    user.has_template_access
      ? { to: '/admin/templates', label: '範本管理' }
      : null,
    user.has_field_access ? { to: '/field', label: '今日任務' } : null,
    { to: '/change-password', label: '變更密碼' },
  ].filter((item): item is { to: string; label: string } => item !== null)
  const indexTarget = landingPath(user)
  const projectRoutes = (
    <>
      <Route element={<ProjectHomePage />} path="projects/:projectId" />
      <Route
        element={<ProjectTemplatesPage />}
        path="projects/:projectId/templates"
      />
      <Route
        element={<ProjectSectionPage section="members" />}
        path="projects/:projectId/members"
      />
      <Route
        element={<ProjectSectionPage section="inspection-items" />}
        path="projects/:projectId/inspection-items"
      />
      <Route
        element={<ProjectSectionPage section="zones" />}
        path="projects/:projectId/zones"
      />
      <Route
        element={
          <ProjectSectionPage section="planning">
            <ProjectPlanningRoute />
          </ProjectSectionPage>
        }
        path="projects/:projectId/planning"
      />
      <Route
        element={<ProjectSectionPage section="progress" />}
        path="projects/:projectId/progress"
      />
      <Route
        element={
          <ProjectSectionPage section="inspection-items">
            <ProjectItemChangePage api={projectItemApi} />
          </ProjectSectionPage>
        }
        path="projects/:projectId/inspection-items/:itemId"
      />
    </>
  )
  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="topbar-brand">InspectFlow 工程查核系統</span>
        <nav aria-label="管理功能">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <span className="topbar-user">
          登入者：{user.name_zh ?? user.username}
        </span>
        <LogoutButton />
      </header>
      <main>
        {typeof notice === 'string' && (
          <p className="tpl-notice tpl-notice-ok" role="status">
            {notice}
          </p>
        )}
        <Routes>
          <Route
            index
            element={
              <Navigate replace state={location.state} to={indexTarget} />
            }
          />
          <Route path="projects" element={<MyProjectsPage />} />
          {projectRoutes}
          {user.has_template_access && (
            <Route path="templates" element={<TemplatesPage />} />
          )}
          <Route
            path="*"
            element={
              <>
                <h1>無權限</h1>
                <p role="alert">
                  {location.pathname.startsWith('/admin/templates')
                    ? '只有系統管理者或範本管理員可以使用範本管理。'
                    : '只有系統管理者可以使用這個管理頁面。'}
                </p>
                <NavLink className="button-link" to={indexTarget}>
                  返回{landingLabel(indexTarget)}
                </NavLink>
              </>
            }
          />
        </Routes>
      </main>
    </div>
  )
}
