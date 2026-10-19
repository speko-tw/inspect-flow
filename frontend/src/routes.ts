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

/**
 * 現行路徑與既有授權摘要；此表只整理來源，
 * 不改變路由行為。
 */
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
  changePassword: {
    path: '/change-password',
    title: PAGE_TITLES.personalSettings,
    permission: 'authenticated',
  },
  adminShell: {
    path: '/admin/*',
    title: PAGE_TITLES.admin,
    permission: 'authenticated',
  },
  adminIndex: {
    path: '/admin',
    title: PAGE_TITLES.account,
    permission: 'authenticated',
  },
  adminPeople: {
    path: '/admin/people/:personId?',
    title: PAGE_TITLES.account,
    permission: 'admin-or-account-delegate',
  },
  adminCompanies: {
    path: '/admin/companies',
    title: PAGE_TITLES.company,
    permission: 'admin-only',
  },
  adminRoles: {
    path: '/admin/roles',
    title: PAGE_TITLES.projectRoles,
    permission: 'admin-only',
  },
  adminProjects: {
    path: '/admin/projects',
    title: PAGE_TITLES.projects,
    permission: 'project-list-access',
  },
  dashboard: {
    path: '/admin/dashboard/*',
    title: PAGE_TITLES.overview,
    permission: 'dashboard-access',
  },
  dashboardIndex: {
    path: '/admin/dashboard',
    title: PAGE_TITLES.overview,
    permission: 'dashboard-access',
  },
  dashboardTasks: {
    path: '/admin/dashboard/projects/:projectId/tasks',
    title: PAGE_TITLES.overview,
    permission: 'dashboard-access',
  },
  dashboardTask: {
    path: '/admin/dashboard/projects/:projectId/tasks/:taskId',
    title: PAGE_TITLES.projectTask,
    permission: 'dashboard-access',
  },
  adminAuditLogs: {
    path: '/admin/audit-logs',
    title: PAGE_TITLES.records,
    permission: 'admin-only',
  },
  adminTemplates: {
    path: '/admin/templates',
    title: PAGE_TITLES.templates,
    permission: 'template-library-access',
  },
  projectHome: {
    path: '/admin/projects/:projectId',
    title: PAGE_TITLES.projectHome,
    permission: 'project-access',
  },
  projectMembers: {
    path: '/admin/projects/:projectId/members',
    title: PAGE_TITLES.projectMembers,
    permission: 'project-access',
  },
  projectItems: {
    path: '/admin/projects/:projectId/inspection-items',
    title: PAGE_TITLES.projectItems,
    permission: 'project-access',
  },
  projectZones: {
    path: '/admin/projects/:projectId/zones',
    title: PAGE_TITLES.projectZones,
    permission: 'project-access',
  },
  projectInspectionTemplates: {
    path: '/admin/projects/:projectId/inspection-items/templates',
    title: PAGE_TITLES.templates,
    permission: 'project-template-access',
  },
  projectTemplatesAlias: {
    path: '/admin/projects/:projectId/templates',
    title: PAGE_TITLES.templates,
    permission: 'project-template-access',
  },
  projectPlanning: {
    path: '/admin/projects/:projectId/planning',
    title: PAGE_TITLES.projectPlanning,
    permission: 'project-access',
  },
  projectProgress: {
    path: '/admin/projects/:projectId/progress',
    title: PAGE_TITLES.projectProgress,
    permission: 'project-access',
  },
  projectProgressTask: {
    path: '/admin/projects/:projectId/progress/tasks/:taskId',
    title: PAGE_TITLES.projectTask,
    permission: 'project-access',
  },
  projectItemChange: {
    path: '/admin/projects/:projectId/inspection-items/:itemId',
    title: PAGE_TITLES.projectItemChange,
    permission: 'project-access',
  },
  fieldShell: {
    path: '/field/*',
    title: PAGE_TITLES.tasks,
    permission: 'authenticated',
  },
  fieldTasks: {
    path: '/field',
    title: PAGE_TITLES.tasks,
    permission: 'field-task-access',
  },
  fieldTask: {
    path: '/field/tasks/:id',
    title: PAGE_TITLES.tasks,
    permission: 'field-task-access',
  },
  legacyFieldProject: {
    path: '/field/projects/:projectId',
    title: PAGE_TITLES.templates,
    permission: 'authenticated',
  },
} as const satisfies Record<string, ProductRoute>

/** 將全站路徑轉成既有 shell 內部使用的相對路徑。 */
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
