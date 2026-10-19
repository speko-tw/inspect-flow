import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Link,
  matchPath,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router'

import type { CurrentUser } from '../auth/api'
import {
  canBrowseTemplates,
  canManageTemplateLibrary,
  landingLabel,
  landingPath,
} from '../auth/landing'
import { useCurrentUser } from '../auth/useCurrentUser'
import AppHeader, { memberNavItems } from '../layout/AppHeader'
import { NAV_LABELS, PAGE_TITLES } from '../layout/navigationLabels'
import { nestedRoutePath, ROUTES } from '../routes'
import RequireValidRouteIds from '../RequireValidRouteIds'
import RouteNotFound from '../RouteNotFound'
import { isResourceId } from '../resourceId'
import { canOpenDashboard, hasGlobalDashboardAccess } from './dashboard/api'
import CompaniesPage from './CompaniesPage'
import PeoplePage from './people/PeoplePage'
import RolesPage from './roles/RolesPage'
import ProjectHomePage from './projectHome/ProjectHomePage'
import ProjectSectionPage from './projectHome/ProjectSectionPage'
import { WorkflowSummaryProvider } from './projectHome/WorkflowSummaryProvider'
import ProjectsPage from './projects/ProjectsPage'
import { projectItemApi } from './projectItems/api'
import { listMyProjects } from './projects/api'
import MyProjectsPage from './projects/MyProjectsPage'
import TemporaryPassword from './TemporaryPassword'

const PlanningPage = lazy(() => import('./planning/PlanningPage'))
const AuditLogPage = lazy(() => import('./audit-log/AuditLogPage'))
const TemplatesPage = lazy(() => import('./templates/TemplatesPage'))
const ProjectTemplatesPage = lazy(
  () => import('./projects/ProjectTemplatesPage'),
)
const ProjectItemChangePage = lazy(
  () => import('./projectItems/ProjectItemChangePage'),
)
const DashboardPage = lazy(() => import('./dashboard/DashboardPage'))
const DashboardTaskPage = lazy(() => import('./dashboard/DashboardTaskPage'))

function hasInvalidProjectRoute(pathname: string): boolean {
  const prefix = `${ROUTES.adminProjects.path}/`
  if (!pathname.startsWith(prefix)) return false
  const projectId = pathname.slice(prefix.length).split('/')[0]
  if (!projectId) return false
  return !isResourceId(projectId)
}

const PROJECT_PAGE_ROUTES = [
  ROUTES.projectHome,
  ROUTES.projectMembers,
  ROUTES.projectItems,
  ROUTES.projectZones,
  ROUTES.projectInspectionTemplates,
  ROUTES.projectTemplatesAlias,
  ROUTES.projectPlanning,
  ROUTES.projectProgress,
  ROUTES.projectProgressTask,
  ROUTES.projectItemChange,
]

type DashboardAccessState =
  | { kind: 'checking' }
  | { kind: 'allowed' }
  | { kind: 'denied' }
  | { kind: 'error' }

function AdminRouteSuspense({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p>載入中…</p>}>{children}</Suspense>
}

function ProjectPlanningRoute() {
  const { projectId } = useParams()
  return (
    <Suspense fallback={<p>載入中…</p>}>
      <PlanningPage key={projectId} initialProjectId={projectId} />
    </Suspense>
  )
}

function ProjectTemplatesRedirect() {
  const { projectId = '' } = useParams()
  return (
    <Navigate
      replace
      to={ROUTES.projectInspectionTemplates.path.replace(
        ':projectId',
        projectId,
      )}
    />
  )
}

function ProjectTemplatesRoute() {
  const { projectId = '' } = useParams()
  const { user } = useCurrentUser()
  const canManageTemplates = canManageTemplateLibrary(user)
  const canBrowseTemplateLibrary = canBrowseTemplates(user)
  const [membership, setMembership] = useState<{
    projectId: string
    isMember: boolean
  } | null>(null)

  useEffect(() => {
    if (user.is_admin) return
    let active = true
    listMyProjects()
      .then((projects) => {
        if (active) {
          setMembership({
            projectId,
            isMember: projects.some((project) => project.id === projectId),
          })
        }
      })
      .catch(() => {
        if (active) setMembership({ projectId, isMember: false })
      })
    return () => {
      active = false
    }
  }, [canManageTemplates, projectId, user.is_admin])

  const isProjectMember =
    membership?.projectId === projectId ? membership.isMember : null

  // ADM-R17、TPL-R23：非成員範本管理員直接瀏覽獨立頁，
  // 不載入 workflow-summary；成員仍由 ProjectSectionPage 依 ADM-R25 分流。
  if (!user.is_admin && !canBrowseTemplateLibrary) {
    return <Navigate replace to={landingPath(user)} />
  }

  if (!user.is_admin && isProjectMember !== true) {
    if (isProjectMember === null) {
      return <p role="status">正在確認專案權限…</p>
    }
    if (!canManageTemplates) {
      return <Navigate replace to={landingPath(user)} />
    }
    return (
      <AdminRouteSuspense>
        <ProjectTemplatesPage standalone viewerPermissions={[]} />
      </AdminRouteSuspense>
    )
  }

  return (
    <ProjectSectionPage section="inspection-items">
      {(viewerPermissions, canApplyTemplates) => (
        <AdminRouteSuspense>
          <ProjectTemplatesPage
            canApplyTemplates={canApplyTemplates}
            viewerPermissions={viewerPermissions}
          />
        </AdminRouteSuspense>
      )}
    </ProjectSectionPage>
  )
}

// 兩種管理外殼共用同一份專案路由，避免權限分流時路徑或守衛逐漸不一致。
// 專案與查核項目的路由參數先驗格式，見 RequireValidRouteIds。安全規則：
// 新的專案子路由必須放在這個 layout route 底下；放在外面就不受 id 守衛
// 保護，特製網址會直接打到別的 API 端點。
const PROJECT_ROUTES = (
  <Route element={<RequireValidRouteIds />}>
    <Route
      element={<ProjectHomePage />}
      path={nestedRoutePath(ROUTES.projectHome, ROUTES.adminShell)}
    />
    <Route
      element={<ProjectSectionPage section="members" />}
      path={nestedRoutePath(ROUTES.projectMembers, ROUTES.adminShell)}
    />
    <Route
      element={<ProjectSectionPage section="inspection-items" />}
      path={nestedRoutePath(ROUTES.projectItems, ROUTES.adminShell)}
    />
    <Route
      element={<ProjectSectionPage section="zones" />}
      path={nestedRoutePath(ROUTES.projectZones, ROUTES.adminShell)}
    />
    <Route
      element={<ProjectTemplatesRoute />}
      path={nestedRoutePath(
        ROUTES.projectInspectionTemplates,
        ROUTES.adminShell,
      )}
    />
    <Route
      element={<ProjectTemplatesRedirect />}
      path={nestedRoutePath(ROUTES.projectTemplatesAlias, ROUTES.adminShell)}
    />
    <Route
      element={
        <ProjectSectionPage section="planning">
          <ProjectPlanningRoute />
        </ProjectSectionPage>
      }
      path={nestedRoutePath(ROUTES.projectPlanning, ROUTES.adminShell)}
    />
    <Route
      element={<ProjectSectionPage section="progress" />}
      path={nestedRoutePath(ROUTES.projectProgress, ROUTES.adminShell)}
    />
    <Route
      element={<ProjectSectionPage section="progress" />}
      path={nestedRoutePath(ROUTES.projectProgressTask, ROUTES.adminShell)}
    />
    <Route
      element={
        <ProjectSectionPage section="inspection-items">
          <AdminRouteSuspense>
            <ProjectItemChangePage api={projectItemApi} />
          </AdminRouteSuspense>
        </ProjectSectionPage>
      }
      path={nestedRoutePath(ROUTES.projectItemChange, ROUTES.adminShell)}
    />
  </Route>
)

const DASHBOARD_NAV_ITEM = {
  to: ROUTES.dashboardIndex.path,
  label: NAV_LABELS.overview,
}

const MANAGEMENT_ITEMS = [
  {
    to: ROUTES.adminPeople.path.replace('/:personId?', ''),
    label: PAGE_TITLES.account,
  },
  { to: ROUTES.adminCompanies.path, label: PAGE_TITLES.company },
  { to: ROUTES.adminRoles.path, label: NAV_LABELS.roles },
  { to: ROUTES.adminAuditLogs.path, label: NAV_LABELS.records },
]

export default function AdminPage() {
  const { user } = useCurrentUser()
  return (
    <WorkflowSummaryProvider key={user.id}>
      <AdminPageContent />
    </WorkflowSummaryProvider>
  )
}

function AdminPageContent() {
  const { user } = useCurrentUser()
  const location = useLocation()
  const navigate = useNavigate()
  const invalidProjectRoute = hasInvalidProjectRoute(location.pathname)
  const [temporaryPassword, setTemporaryPassword] = useState<{
    username: string
    password: string
    locationKey: string
  } | null>(null)
  const resultHeadingRef = useRef<HTMLHeadingElement>(null)
  const hasGlobalAccess = hasGlobalDashboardAccess(user)
  const [dashboardAccessResult, setDashboardAccessResult] = useState<{
    key: string
    state: DashboardAccessState
  }>({ key: '', state: { kind: 'checking' } })
  const [dashboardRetry, setDashboardRetry] = useState(0)
  const dashboardAccessKey = `${user.id}:${dashboardRetry}`
  const dashboardAccess = hasGlobalAccess
    ? { kind: 'allowed' as const }
    : dashboardAccessResult.key === dashboardAccessKey
      ? dashboardAccessResult.state
      : { kind: 'checking' as const }

  useEffect(() => {
    if (hasGlobalAccess || invalidProjectRoute) return
    let active = true
    canOpenDashboard(user)
      .then((allowed) => {
        if (active) {
          setDashboardAccessResult({
            key: dashboardAccessKey,
            state: { kind: allowed ? 'allowed' : 'denied' },
          })
        }
      })
      .catch(() => {
        if (active) {
          setDashboardAccessResult({
            key: dashboardAccessKey,
            state: { kind: 'error' },
          })
        }
      })
    return () => {
      active = false
    }
  }, [dashboardAccessKey, hasGlobalAccess, invalidProjectRoute, user])

  useEffect(() => {
    if (temporaryPassword) resultHeadingRef.current?.focus()
  }, [temporaryPassword])

  if (
    temporaryPassword &&
    (location.pathname !==
      ROUTES.adminPeople.path.replace('/:personId?', '') ||
      location.key !== temporaryPassword.locationKey)
  ) {
    setTemporaryPassword(null)
  }

  // 從別頁導來時可帶一則提示（例如變更密碼成功後）。
  const notice = (location.state as { notice?: unknown } | null)?.notice

  const isProjectSectionRoute = PROJECT_PAGE_ROUTES.some((route) =>
    matchPath({ path: route.path, end: true }, location.pathname),
  )

  if (!user.is_admin) {
    return (
      <MemberAdminShell
        dashboardAccess={dashboardAccess}
        onRetryDashboard={() => setDashboardRetry((key) => key + 1)}
        user={user}
      />
    )
  }

  return (
    <div
      className={
        location.pathname.startsWith(ROUTES.dashboard.path.replace('/*', ''))
          ? 'app-shell dashboard-shell'
          : 'app-shell'
      }
    >
      <AppHeader
        badge={
          isProjectSectionRoute ? (
            <p className="topbar-badge">Admin</p>
          ) : (
            <h1 className="topbar-badge">Admin</h1>
          )
        }
        locked={temporaryPassword !== null}
        lockedNote="請先抄下臨時密碼，才能離開這一頁。"
        navItems={adminNavigationItems(user, dashboardAccess)}
        managementItems={MANAGEMENT_ITEMS}
        navLabel="管理功能"
        onNavigate={() => setTemporaryPassword(null)}
        user={user}
      />
      <main>
        {typeof notice === 'string' && (
          <p className="notice-success" role="status">
            {notice}
          </p>
        )}
        {temporaryPassword &&
        location.pathname ===
          ROUTES.adminPeople.path.replace('/:personId?', '') &&
        location.key === temporaryPassword.locationKey ? (
          <section
            aria-labelledby="temporary-password-heading"
            className="temporary-password-result notice-success"
            role="status"
          >
            <h2
              id="temporary-password-heading"
              ref={resultHeadingRef}
              tabIndex={-1}
            >
              帳號已新增
            </h2>
            <p>帳號：{temporaryPassword.username}</p>
            <p>離開此頁後無法再次查看，首次登入必須變更密碼。</p>
            <TemporaryPassword password={temporaryPassword.password} />
            <button
              onClick={() => {
                setTemporaryPassword(null)
                navigate(ROUTES.adminPeople.path.replace('/:personId?', ''), {
                  replace: true,
                })
              }}
              type="button"
            >
              已抄下，回到帳號列表
            </button>
          </section>
        ) : (
          <Routes>
            <Route
              index
              element={
                <Navigate
                  replace
                  state={location.state}
                  to={ROUTES.adminPeople.path.replace('/:personId?', '')}
                />
              }
            />
            <Route
              path={nestedRoutePath(ROUTES.adminPeople, ROUTES.adminShell)}
              element={
                <PeoplePage
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
            <Route
              path={nestedRoutePath(ROUTES.adminCompanies, ROUTES.adminShell)}
              element={<CompaniesPage />}
            />
            <Route
              path={nestedRoutePath(ROUTES.adminRoles, ROUTES.adminShell)}
              element={<RolesPage />}
            />
            <Route
              path={nestedRoutePath(ROUTES.adminProjects, ROUTES.adminShell)}
              element={<ProjectsPage />}
            />
            <Route
              path={nestedRoutePath(ROUTES.dashboard, ROUTES.adminShell)}
              element={
                <DashboardRoute
                  access={dashboardAccess}
                  onRetry={() => setDashboardRetry((key) => key + 1)}
                  user={user}
                />
              }
            />
            <Route
              path={nestedRoutePath(ROUTES.adminAuditLogs, ROUTES.adminShell)}
              element={
                <AdminRouteSuspense>
                  <AuditLogPage />
                </AdminRouteSuspense>
              }
            />
            {PROJECT_ROUTES}
            <Route
              path={nestedRoutePath(ROUTES.adminTemplates, ROUTES.adminShell)}
              element={
                <AdminRouteSuspense>
                  <TemplatesPage canManage />
                </AdminRouteSuspense>
              }
            />
            <Route path="*" element={<RouteNotFound />} />
          </Routes>
        )}
      </main>
    </div>
  )
}

// 非系統管理者的管理頁外殼（#480）：頂部導覽只列後端存取摘要確認
// 有權限的項目，不出現點了才 403 的入口；人員、公司、角色管理
// 只屬系統管理者，這裡一律不列。
function MemberAdminShell({
  dashboardAccess,
  onRetryDashboard,
  user,
}: {
  dashboardAccess: DashboardAccessState
  onRetryDashboard: () => void
  user: CurrentUser
}) {
  const location = useLocation()
  // 從別頁導來時帶的提示（例如套用範本成功後）。
  const notice = (location.state as { notice?: unknown } | null)?.notice
  const indexTarget = landingPath(user)
  const canManageAccounts = user.delegated_modules.length > 0
  const isAdminOnlyPage = [
    ROUTES.adminCompanies,
    ROUTES.adminRoles,
    ROUTES.adminAuditLogs,
  ].some((route) =>
    matchPath({ path: route.path, end: false }, location.pathname),
  )
  const restrictedPage =
    (matchPath(
      { path: ROUTES.adminPeople.path, end: false },
      location.pathname,
    ) &&
      !canManageAccounts) ||
    isAdminOnlyPage ||
    (!canBrowseTemplates(user) &&
      matchPath(
        { path: ROUTES.adminTemplates.path, end: false },
        location.pathname,
      ))
  return (
    <div
      className={
        location.pathname.startsWith(ROUTES.dashboard.path.replace('/*', ''))
          ? 'app-shell dashboard-shell'
          : 'app-shell'
      }
    >
      <AppHeader
        navItems={memberNavigationItems(user, dashboardAccess)}
        managementItems={
          canManageAccounts
            ? [
                {
                  to: ROUTES.adminPeople.path.replace('/:personId?', ''),
                  label: PAGE_TITLES.account,
                },
              ]
            : []
        }
        navLabel="管理功能"
        user={user}
      />
      <main>
        {typeof notice === 'string' && (
          <p className="notice-success" role="status">
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
          <Route
            path={nestedRoutePath(ROUTES.adminProjects, ROUTES.adminShell)}
            element={
              // 專案查閱權限可進入唯讀清單，不改變現場帳號的首頁落點。
              user.has_office_access ||
              user.has_project_access ||
              user.can_create_project ? (
                <MyProjectsPage canCreateProject={user.can_create_project} />
              ) : (
                <Navigate replace to={indexTarget} />
              )
            }
          />
          {canManageAccounts && (
            <Route
              path={nestedRoutePath(ROUTES.adminPeople, ROUTES.adminShell)}
              element={<PeoplePage onTemporaryPassword={() => undefined} />}
            />
          )}
          <Route
            path={nestedRoutePath(ROUTES.dashboard, ROUTES.adminShell)}
            element={
              <DashboardRoute
                access={dashboardAccess}
                onRetry={onRetryDashboard}
                user={user}
              />
            }
          />
          {PROJECT_ROUTES}
          {canBrowseTemplates(user) && (
            <Route
              path={nestedRoutePath(ROUTES.adminTemplates, ROUTES.adminShell)}
              element={
                <AdminRouteSuspense>
                  <TemplatesPage canManage={canManageTemplateLibrary(user)} />
                </AdminRouteSuspense>
              }
            />
          )}
          <Route
            path="*"
            element={
              // 使用者、公司、角色是管理者專用頁，其下任何路徑（例如
              // /admin/users/abc）沿用無權限頁；其他不存在的網址一律
              // 顯示找不到（#493）。
              restrictedPage ? (
                <>
                  <h1>無權限</h1>
                  <p role="alert">
                    {location.pathname.startsWith(ROUTES.adminTemplates.path)
                      ? '你沒有權限瀏覽範本庫。'
                      : '只有系統管理者可以使用這個管理頁面。'}
                  </p>
                  <Link className="btn" to={indexTarget}>
                    返回{landingLabel(indexTarget)}
                  </Link>
                </>
              ) : (
                <RouteNotFound />
              )
            }
          />
        </Routes>
      </main>
    </div>
  )
}

function memberNavigationItems(
  user: CurrentUser,
  access: DashboardAccessState,
) {
  const items = memberNavItems(user)
  if (
    (user.has_office_access ||
      user.has_project_access ||
      user.can_create_project) &&
    !items.some((item) => item.to === '/admin/projects')
  ) {
    items.unshift({
      to: ROUTES.adminProjects.path,
      label: NAV_LABELS.projects,
    })
  }
  if (access.kind === 'allowed') items.push(DASHBOARD_NAV_ITEM)
  return items
}

function adminNavigationItems(
  user: CurrentUser,
  access: DashboardAccessState,
) {
  const items = memberNavItems(user)
  if (user.is_admin || user.has_office_access) {
    if (!items.some((item) => item.to === '/admin/projects')) {
      items.push({ to: ROUTES.adminProjects.path, label: NAV_LABELS.projects })
    }
  }
  if (
    (user.is_admin || access.kind === 'allowed') &&
    !items.some((item) => item.to === DASHBOARD_NAV_ITEM.to)
  ) {
    items.push(DASHBOARD_NAV_ITEM)
  }
  return items
}

function DashboardRoute({
  access,
  onRetry,
  user,
}: {
  access: DashboardAccessState
  onRetry: () => void
  user: CurrentUser
}) {
  if (access.kind === 'checking') {
    return <p role="status">正在確認總覽權限…</p>
  }
  if (access.kind === 'denied') {
    return (
      <section aria-labelledby="dashboard-denied-heading">
        <h1 id="dashboard-denied-heading">無權限</h1>
        <p role="alert">你目前沒有可查看的專案進度。</p>
      </section>
    )
  }
  if (access.kind === 'error') {
    return (
      <section aria-labelledby="dashboard-access-error-heading">
        <h1 id="dashboard-access-error-heading">{PAGE_TITLES.overview}</h1>
        <p role="alert">目前無法確認總覽權限，請重試。</p>
        <button className="btn" onClick={onRetry} type="button">
          重新確認
        </button>
      </section>
    )
  }
  return (
    <AdminRouteSuspense>
      <Routes>
        <Route element={<DashboardPage user={user} />} index />
        <Route
          element={
            hasGlobalDashboardAccess(user) ? (
              <DashboardTaskPage />
            ) : (
              <DashboardTaskDenied />
            )
          }
          path={nestedRoutePath(ROUTES.dashboardTasks, ROUTES.dashboard)}
        />
        <Route
          element={
            hasGlobalDashboardAccess(user) ? (
              <DashboardTaskPage />
            ) : (
              <DashboardTaskDenied />
            )
          }
          path={nestedRoutePath(ROUTES.dashboardTask, ROUTES.dashboard)}
        />
        <Route path="*" element={<RouteNotFound />} />
      </Routes>
    </AdminRouteSuspense>
  )
}

const dashboardTaskDeniedMessage = [
  '查看全部專案任務需要',
  '「看全部專案進度」權限。',
].join('')

function DashboardTaskDenied() {
  return (
    <section aria-labelledby="dashboard-task-denied">
      <h1 id="dashboard-task-denied">無權限</h1>
      <p role="alert">{dashboardTaskDeniedMessage}</p>
      <Link to={ROUTES.dashboardIndex.path}>返回專案進度總覽</Link>
    </section>
  )
}
