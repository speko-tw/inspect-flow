import { matchPath } from 'react-router'

import { PAGE_TITLES } from './terms'

export type RoutePermission =
  | 'public'
  | 'authenticated'
  | 'admin-only'
  | 'admin-or-account-delegate'
  | 'project-list-access'
  | 'dashboard-access'
  | 'template-library-access'
  | 'project-access'
  | 'project-template-access'
  | 'field-task-access'

export type ProductRoute = {
  path: string
  title: string
  permission: RoutePermission
}

/** 全站產品路由與進入頁面所需的權限。 */
export const ROUTES = {
  home: {
    path: '/',
    title: PAGE_TITLES.home,
    permission: 'public',
  },
  login: {
    path: '/login',
    title: PAGE_TITLES.login,
    permission: 'public',
  },
  setup: {
    path: '/setup',
    title: PAGE_TITLES.setup,
    permission: 'public',
  },
  settings: {
    path: '/settings',
    title: PAGE_TITLES.personalSettings,
    permission: 'authenticated',
  },
  adminShell: {
    path: '/*',
    title: PAGE_TITLES.admin,
    permission: 'authenticated',
  },
  adminIndex: {
    path: '/accounts',
    title: PAGE_TITLES.account,
    permission: 'admin-or-account-delegate',
  },
  adminAccountNew: {
    path: '/accounts/new',
    title: '新增帳號',
    permission: 'admin-only',
  },
  adminPeople: {
    path: '/accounts/:personId?',
    title: PAGE_TITLES.account,
    permission: 'admin-or-account-delegate',
  },
  adminCompanies: {
    path: '/companies',
    title: PAGE_TITLES.company,
    permission: 'admin-only',
  },
  adminRoles: {
    path: '/roles',
    title: PAGE_TITLES.projectRoles,
    permission: 'admin-only',
  },
  adminProjects: {
    path: '/projects',
    title: PAGE_TITLES.projects,
    permission: 'project-list-access',
  },
  dashboard: {
    path: '/overview/*',
    title: PAGE_TITLES.overview,
    permission: 'dashboard-access',
  },
  dashboardIndex: {
    path: '/overview',
    title: PAGE_TITLES.overview,
    permission: 'dashboard-access',
  },
  dashboardTasks: {
    path: '/overview/projects/:projectId/tasks',
    title: PAGE_TITLES.overview,
    permission: 'dashboard-access',
  },
  dashboardTask: {
    path: '/overview/projects/:projectId/tasks/:taskId',
    title: PAGE_TITLES.projectTask,
    permission: 'dashboard-access',
  },
  adminAuditLogs: {
    path: '/logs',
    title: PAGE_TITLES.records,
    permission: 'admin-only',
  },
  adminTemplates: {
    path: '/templates',
    title: PAGE_TITLES.templates,
    permission: 'template-library-access',
  },
  templateSaveFromProject: {
    path: '/templates/from-project',
    title: PAGE_TITLES.templates,
    permission: 'template-library-access',
  },
  projectHome: {
    path: '/projects/:projectId',
    title: PAGE_TITLES.projectHome,
    permission: 'project-access',
  },
  // ADM-R52：成員新增、角色修改與分區新增都有直接網址。
  projectMembers: {
    path: '/projects/:projectId/members',
    title: PAGE_TITLES.projectMembers,
    permission: 'project-access',
  },
  projectMemberNew: {
    path: '/projects/:projectId/members/new',
    title: PAGE_TITLES.projectMemberNew,
    permission: 'project-access',
  },
  projectMemberEdit: {
    path: '/projects/:projectId/members/:userId/edit',
    title: PAGE_TITLES.projectMemberEdit,
    permission: 'project-access',
  },
  projectItems: {
    path: '/projects/:projectId/inspection-items',
    title: PAGE_TITLES.projectItems,
    permission: 'project-access',
  },
  projectZones: {
    path: '/projects/:projectId/zones',
    title: PAGE_TITLES.projectZones,
    permission: 'project-access',
  },
  projectZoneNew: {
    path: '/projects/:projectId/zones/new',
    title: PAGE_TITLES.projectZoneNew,
    permission: 'project-access',
  },
  projectInspectionTemplates: {
    path: '/projects/:projectId/inspection-items/templates',
    title: PAGE_TITLES.templates,
    permission: 'project-template-access',
  },
  projectPlanning: {
    path: '/projects/:projectId/planning',
    title: PAGE_TITLES.projectPlanning,
    permission: 'project-access',
  },
  projectPlanNew: {
    path: '/projects/:projectId/planning/new',
    title: '建立計畫',
    permission: 'project-access',
  },
  projectPlan: {
    path: '/projects/:projectId/planning/:planId',
    title: '計畫詳情',
    permission: 'project-access',
  },
  projectTaskNew: {
    path: '/projects/:projectId/planning/:planId/tasks/new',
    title: '新增任務',
    permission: 'project-access',
  },
  projectTask: {
    path: '/projects/:projectId/planning/:planId/tasks/:taskId',
    title: '任務詳情',
    permission: 'project-access',
  },
  projectTaskEdit: {
    path: '/projects/:projectId/planning/:planId/tasks/:taskId/edit',
    title: '修改任務',
    permission: 'project-access',
  },
  projectProgress: {
    path: '/projects/:projectId/progress',
    title: PAGE_TITLES.projectProgress,
    permission: 'project-access',
  },
  projectProgressTask: {
    path: '/projects/:projectId/progress/tasks/:taskId',
    title: PAGE_TITLES.projectTask,
    permission: 'project-access',
  },
  projectItemChange: {
    path: '/projects/:projectId/inspection-items/:itemId',
    title: PAGE_TITLES.projectItemChange,
    permission: 'project-access',
  },
  fieldShell: {
    path: '/tasks/*',
    title: PAGE_TITLES.tasks,
    permission: 'field-task-access',
  },
  fieldTasks: {
    path: '/tasks',
    title: PAGE_TITLES.tasks,
    permission: 'field-task-access',
  },
  fieldTask: {
    path: '/tasks/:id',
    title: PAGE_TITLES.tasks,
    permission: 'field-task-access',
  },
} as const satisfies Record<string, ProductRoute>

/** 路由權限判斷需要的使用者存取摘要。 */
export type RouteAccessUser = {
  is_admin: boolean
  can_inspect_tasks?: boolean
  can_create_project?: boolean
  can_manage_project_planning_or_members?: boolean
  has_project_access?: boolean
  can_browse_templates?: boolean
  can_manage_template_library?: boolean
  delegated_modules?: readonly string[]
  module_permissions?: readonly string[]
}

/** 依路由宣告的權限類別判斷是否可進入；資料 API 仍是最終授權。 */
export function canAccessRoute(
  user: RouteAccessUser,
  route: ProductRoute,
): boolean {
  const modules = user.module_permissions ?? []
  switch (route.permission) {
    case 'public':
    case 'authenticated':
      return true
    case 'admin-only':
      return user.is_admin
    case 'admin-or-account-delegate':
      return user.is_admin || (user.delegated_modules?.length ?? 0) > 0
    case 'project-list-access':
      return Boolean(
        user.is_admin || user.has_project_access || user.can_create_project,
      )
    case 'dashboard-access':
      return user.is_admin || modules.includes('all_project_progress.read')
    case 'template-library-access':
      return Boolean(
        user.is_admin ||
        user.can_manage_template_library ||
        modules.includes('template.manage'),
      )
    case 'project-access':
      return Boolean(user.is_admin || user.has_project_access)
    case 'project-template-access':
      return Boolean(
        user.is_admin ||
        user.has_project_access ||
        user.can_browse_templates ||
        user.can_manage_template_library ||
        modules.includes('template.manage') ||
        modules.includes('template.use'),
      )
    case 'field-task-access':
      return Boolean(user.is_admin || user.can_inspect_tasks)
  }
  return false
}

const ACCESS_ROUTES: Array<{ route: ProductRoute; end: boolean }> = [
  { route: ROUTES.home, end: true },
  { route: ROUTES.login, end: true },
  { route: ROUTES.setup, end: true },
  { route: ROUTES.settings, end: false },
  { route: ROUTES.dashboardTask, end: true },
  { route: ROUTES.dashboardTasks, end: true },
  { route: ROUTES.dashboardIndex, end: true },
  { route: ROUTES.dashboard, end: false },
  { route: ROUTES.adminAccountNew, end: true },
  { route: ROUTES.adminPeople, end: false },
  { route: ROUTES.adminCompanies, end: false },
  { route: ROUTES.adminRoles, end: false },
  { route: ROUTES.adminAuditLogs, end: false },
  { route: ROUTES.projectInspectionTemplates, end: true },
  { route: ROUTES.projectProgressTask, end: true },
  { route: ROUTES.projectProgress, end: true },
  { route: ROUTES.projectPlanNew, end: true },
  { route: ROUTES.projectTaskNew, end: true },
  { route: ROUTES.projectTaskEdit, end: true },
  { route: ROUTES.projectTask, end: true },
  { route: ROUTES.projectPlan, end: true },
  { route: ROUTES.projectPlanning, end: true },
  { route: ROUTES.projectItemChange, end: true },
  { route: ROUTES.projectItems, end: true },
  { route: ROUTES.projectMemberEdit, end: true },
  { route: ROUTES.projectMemberNew, end: true },
  { route: ROUTES.projectZones, end: true },
  { route: ROUTES.projectZoneNew, end: true },
  { route: ROUTES.projectMembers, end: true },
  { route: ROUTES.projectHome, end: true },
  { route: ROUTES.adminProjects, end: true },
  { route: ROUTES.templateSaveFromProject, end: true },
  { route: ROUTES.adminTemplates, end: false },
  { route: ROUTES.fieldTask, end: true },
  { route: ROUTES.fieldTasks, end: true },
  { route: ROUTES.fieldShell, end: false },
]

/** 依宣告的頁面路由尋找路徑對應權限；外殼萬用路由不參與比對。 */
export function routeForPath(pathname: string): ProductRoute | undefined {
  return ACCESS_ROUTES.find(({ route, end }) =>
    matchPath({ path: route.path, end }, pathname),
  )?.route
}

/** 將全站路徑轉成外殼內使用的相對路徑。 */
export function nestedRoutePath(
  route: ProductRoute,
  parent: ProductRoute,
): string {
  const prefix = parent.path.replace(/\/\*$/, '').replace(/\/$/, '')
  if (!route.path.startsWith(`${prefix}/`)) {
    throw new Error(`Route ${route.path} is outside ${parent.path}`)
  }
  return route.path.slice(prefix.length + 1)
}

/** 以參數填入產品路徑，並編碼每個動態識別值。 */
export function routePath(
  route: ProductRoute,
  params: Record<string, string>,
): string {
  return Object.entries(params).reduce((path, [name, value]) => {
    const encodedValue = encodeURIComponent(value)
    return path
      .replace(`:${name}?`, encodedValue)
      .replace(`:${name}`, encodedValue)
  }, route.path)
}
