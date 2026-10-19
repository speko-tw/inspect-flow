import { describe, expect, it } from 'vitest'

import { canAccessRoute, routeForPath, ROUTES } from './routes'
import { canVisit } from './auth/landing'

describe('product route metadata', () => {
  const noAccess = {
    is_admin: false,
    can_inspect_tasks: false,
    can_create_project: false,
    has_project_access: false,
    delegated_modules: [],
    module_permissions: [],
  }

  it('declares a path, page title, and permission for every route', () => {
    for (const [name, route] of Object.entries(ROUTES)) {
      expect(route.path, name).toBeTruthy()
      expect(route.title, name).toBeTruthy()
      expect(route.permission, name).toBeTruthy()
    }
  })

  it('resolves active pages to their declared permission metadata', () => {
    const routesAndPaths = [
      [ROUTES.home, '/'],
      [ROUTES.login, '/login'],
      [ROUTES.setup, '/setup'],
      [ROUTES.settings, '/settings/profile'],
      [ROUTES.adminPeople, '/accounts/person-1'],
      [ROUTES.adminCompanies, '/companies'],
      [ROUTES.adminRoles, '/roles'],
      [ROUTES.adminAuditLogs, '/logs'],
      [ROUTES.adminProjects, '/projects'],
      [ROUTES.dashboardIndex, '/overview'],
      [ROUTES.dashboardTasks, '/overview/projects/p1/tasks'],
      [ROUTES.dashboardTask, '/overview/projects/p1/tasks/t1'],
      [ROUTES.adminTemplates, '/templates'],
      [ROUTES.projectHome, '/projects/p1'],
      [ROUTES.projectMembers, '/projects/p1/members'],
      [ROUTES.projectItems, '/projects/p1/inspection-items'],
      [ROUTES.projectZones, '/projects/p1/zones'],
      [
        ROUTES.projectInspectionTemplates,
        '/projects/p1/inspection-items/templates',
      ],
      [ROUTES.projectPlanning, '/projects/p1/planning'],
      [ROUTES.projectProgress, '/projects/p1/progress'],
      [ROUTES.projectProgressTask, '/projects/p1/progress/tasks/t1'],
      [ROUTES.projectItemChange, '/projects/p1/inspection-items/i1'],
      [ROUTES.fieldTasks, '/tasks'],
      [ROUTES.fieldTask, '/tasks/t1'],
      [ROUTES.fieldShell, '/tasks/t1/extra'],
    ] as const

    for (const [declaredRoute, path] of routesAndPaths) {
      const matchedRoute = routeForPath(path)
      expect(matchedRoute?.permission, path).toBe(declaredRoute.permission)
      expect(canVisit(noAccess, path), path).toBe(
        matchedRoute ? canAccessRoute(noAccess, matchedRoute) : true,
      )
    }
  })

  it('uses the route permission value for access decisions', () => {
    const delegate = { ...noAccess, delegated_modules: ['account.manage'] }
    const rolesRoute = routeForPath('/roles')

    expect(rolesRoute).toBe(ROUTES.adminRoles)
    expect(canAccessRoute(delegate, rolesRoute!)).toBe(false)
    expect(
      canAccessRoute(delegate, {
        ...rolesRoute!,
        permission: 'authenticated',
      }),
    ).toBe(true)
    expect(canVisit(delegate, '/roles')).toBe(false)
  })
})
