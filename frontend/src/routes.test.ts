import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { canAccessRoute, routeForPath, ROUTES } from './routes'
import { canVisit } from './auth/landing'

type RouteRegistrations = {
  names: Set<string>
  indexNames: Set<string>
  literalPaths: Set<string>
}

function registeredRoutes(sourcePaths: string[]): RouteRegistrations {
  const registrations: RouteRegistrations = {
    names: new Set(),
    indexNames: new Set(),
    literalPaths: new Set(),
  }
  for (const path of sourcePaths) {
    mergeRegistrations(
      registrations,
      routeRegistrationsFromSource(readFileSync(path, 'utf8'), path),
    )
  }
  return registrations
}

function routeRegistrationsFromSource(
  sourceText: string,
  fileName = 'routes-counterexample.tsx',
): RouteRegistrations {
  const registrations: RouteRegistrations = {
    names: new Set(),
    indexNames: new Set(),
    literalPaths: new Set(),
  }
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const readRouteNames = (node: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'ROUTES'
    ) {
      registrations.names.add(node.name.text)
    }
    ts.forEachChild(node, readRouteNames)
  }

  const visit = (node: ts.Node) => {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) {
      ts.forEachChild(node, visit)
      return
    }
    if (!ts.isIdentifier(node.tagName) || node.tagName.text !== 'Route') {
      ts.forEachChild(node, visit)
      return
    }

    const indexProp = node.attributes.properties.find(
      (property) =>
        ts.isJsxAttribute(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === 'index',
    )
    if (indexProp) {
      let parent: ts.Node | undefined = node.parent
      while (parent && !ts.isFunctionDeclaration(parent)) {
        parent = parent.parent
      }
      const owner =
        parent && ts.isFunctionDeclaration(parent) ? parent.name?.text : ''
      registrations.indexNames.add(
        owner === 'DashboardRoute' ? 'dashboardIndex' : 'adminIndex',
      )
    }

    const pathProp = node.attributes.properties.find(
      (property): property is ts.JsxAttribute =>
        ts.isJsxAttribute(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === 'path',
    )
    if (!pathProp?.initializer) return
    if (ts.isStringLiteral(pathProp.initializer)) {
      registrations.literalPaths.add(pathProp.initializer.text)
      return
    }
    if (!ts.isJsxExpression(pathProp.initializer)) return

    const expression = pathProp.initializer.expression
    if (!expression) return
    if (
      ts.isCallExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === 'nestedRoutePath'
    ) {
      if (expression.arguments[0]) {
        readRouteNames(expression.arguments[0])
      }
      return
    }
    readRouteNames(expression)
  }
  visit(source)

  return registrations
}

function mergeRegistrations(
  target: RouteRegistrations,
  source: RouteRegistrations,
) {
  for (const name of source.names) target.names.add(name)
  for (const name of source.indexNames) target.indexNames.add(name)
  for (const path of source.literalPaths) target.literalPaths.add(path)
}

function assertRoutesAreDeclared(
  registrations: RouteRegistrations,
  declarations: Record<string, ProductRouteLike>,
) {
  const names = new Set(registrations.names)
  const ignoredPaths = new Set([
    '*',
    '/admin/*',
    '/field/*',
    '/change-password/*',
  ])
  const missing = [...names].filter((name) => !(name in declarations))
  const pathsWithoutDeclarations = [...registrations.literalPaths].filter(
    (path) =>
      !ignoredPaths.has(path) &&
      !Object.values(declarations).some(
        (route) =>
          route.path === path || route.path === path.replace(/\/\*$/, ''),
      ),
  )
  const paths = pathsWithoutDeclarations.join(', ')
  if (missing.length || pathsWithoutDeclarations.length) {
    throw new Error(
      [
        missing.length
          ? `Registered routes lack permissions: ${missing.join(', ')}`
          : '',
        pathsWithoutDeclarations.length
          ? `Registered paths lack permissions: ${paths}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
}

type ProductRouteLike = { path: string }

describe('product route metadata', () => {
  const noAccess = {
    is_admin: false,
    can_inspect_tasks: false,
    can_create_project: false,
    can_manage_project_planning_or_members: false,
    has_project_access: false,
    delegated_modules: [],
    module_permissions: [],
  }

  it('reserves account creation for admins before matching person IDs', () => {
    expect(routeForPath('/accounts/new')).toBe(ROUTES.adminAccountNew)
    expect(canAccessRoute(noAccess, ROUTES.adminAccountNew)).toBe(false)
    expect(
      canAccessRoute(
        { ...noAccess, delegated_modules: ['project'] },
        ROUTES.adminAccountNew,
      ),
    ).toBe(false)
    expect(
      canAccessRoute({ ...noAccess, is_admin: true }, ROUTES.adminAccountNew),
    ).toBe(true)
  })

  it('declares a path, page title, and permission for every route', () => {
    for (const [name, route] of Object.entries(ROUTES)) {
      expect(route.path, name).toBeTruthy()
      expect(route.title, name).toBeTruthy()
      expect(route.permission, name).toBeTruthy()
    }
  })

  it('keeps actual registered pages covered by route permissions', () => {
    const registrations = registeredRoutes([
      'src/App.tsx',
      'src/admin/AdminPage.tsx',
    ])
    // FieldPage 依 pathname 手動分流，兩個頁面不使用 React Router Route。
    registrations.names.add('fieldTasks')
    registrations.names.add('fieldTask')
    for (const name of registrations.indexNames) {
      registrations.names.add(name)
    }
    assertRoutesAreDeclared(registrations, ROUTES)

    const wrappers = new Set(['adminShell', 'fieldShell'])
    const registeredPages = new Set(
      [...registrations.names].filter((name) => !wrappers.has(name)),
    )
    const declaredPages = new Set(
      Object.keys(ROUTES).filter((name) => !wrappers.has(name)),
    )

    expect(registeredPages).toEqual(declaredPages)
  })

  it('finds a real JSX route path without a permission declaration', () => {
    const unregisteredProduct = routeRegistrationsFromSource(
      '<Routes><Route path="/unlisted" element={<UnlistedPage />} /></Routes>',
    )

    expect(() => assertRoutesAreDeclared(unregisteredProduct, ROUTES)).toThrow(
      'Registered paths lack permissions: /unlisted',
    )
  })

  it('resolves active pages to their declared permission metadata', () => {
    const routesAndPaths = [
      [ROUTES.home, '/'],
      [ROUTES.login, '/login'],
      [ROUTES.setup, '/setup'],
      [ROUTES.settings, '/settings/profile'],
      [ROUTES.adminAccountNew, '/accounts/new'],
      [ROUTES.adminPeople, '/accounts/person-1'],
      [ROUTES.adminCompanies, '/companies'],
      [ROUTES.adminCompanyNew, '/companies/new'],
      [ROUTES.adminCompanyDetail, '/companies/c1'],
      [ROUTES.adminRoleNew, '/roles/new'],
      [ROUTES.adminRoleDetail, '/roles/r1'],
      [ROUTES.adminRoleEdit, '/roles/r1/edit'],

      [ROUTES.adminRoles, '/roles'],
      [ROUTES.adminAuditLogs, '/logs'],
      [ROUTES.adminProjects, '/projects'],
      [ROUTES.projectNew, '/projects/new'],
      [ROUTES.dashboardIndex, '/overview'],
      [ROUTES.dashboardTasks, '/overview/projects/p1/tasks'],
      [ROUTES.dashboardTask, '/overview/projects/p1/tasks/t1'],
      [ROUTES.adminTemplates, '/templates'],
      [ROUTES.templateSaveFromProject, '/templates/from-project'],
      [ROUTES.projectHome, '/projects/p1'],
      [ROUTES.projectEdit, '/projects/p1/edit'],
      [ROUTES.projectMembers, '/projects/p1/members'],
      [ROUTES.projectMemberNew, '/projects/p1/members/new'],
      [ROUTES.projectMemberEdit, '/projects/p1/members/u1/edit'],
      [ROUTES.projectItems, '/projects/p1/inspection-items'],
      [ROUTES.projectZones, '/projects/p1/zones'],
      [ROUTES.projectZoneNew, '/projects/p1/zones/new'],
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
        matchedRoute ? canAccessRoute(noAccess, matchedRoute) : false,
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

  it('limits project creation to admins and users with create permission', () => {
    const creator = { ...noAccess, can_create_project: true }

    expect(canVisit(noAccess, '/projects/new')).toBe(false)
    expect(canVisit(creator, '/projects/new')).toBe(true)
    expect(canVisit({ ...noAccess, is_admin: true }, '/projects/new')).toBe(
      true,
    )
    expect(canVisit(creator, '/projects')).toBe(true)
  })
})

it('IP-AC28：planning deep links stay beneath the route-id guard', () => {
  const text = readFileSync('src/admin/AdminPage.tsx', 'utf8')
  const source = ts.createSourceFile(
    'AdminPage.tsx',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const expected = new Set([
    'projectPlanNew',
    'projectPlan',
    'projectTaskNew',
    'projectTask',
    'projectTaskEdit',
  ])
  const guarded = new Set<string>()
  function visit(node: ts.Node, underGuard = false) {
    if (ts.isJsxElement(node)) {
      const opening = node.openingElement
      const guard =
        opening.tagName.getText(source) === 'Route' &&
        opening.attributes.properties.some(
          (prop) =>
            ts.isJsxAttribute(prop) &&
            prop.name.getText(source) === 'element' &&
            prop.initializer
              ?.getText(source)
              .includes('<RequireValidRouteIds'),
        )
      ts.forEachChild(node, (child) => visit(child, underGuard || guard))
      return
    }
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(source) === 'Route'
    ) {
      const path = node.attributes.properties.find(
        (prop) =>
          ts.isJsxAttribute(prop) && prop.name.getText(source) === 'path',
      )
      if (path && ts.isJsxAttribute(path)) {
        for (const name of expected) {
          if (path.initializer?.getText(source).includes(`ROUTES.${name},`)) {
            expect(underGuard, name).toBe(true)
            guarded.add(name)
          }
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, underGuard))
  }
  visit(source)
  expect(guarded).toEqual(expected)
  const paths = [
    [ROUTES.projectPlanNew, '/projects/p1/planning/new'],
    [ROUTES.projectPlan, '/projects/p1/planning/plan1'],
    [ROUTES.projectTaskNew, '/projects/p1/planning/plan1/tasks/new'],
    [ROUTES.projectTask, '/projects/p1/planning/plan1/tasks/task1'],
    [ROUTES.projectTaskEdit, '/projects/p1/planning/plan1/tasks/task1/edit'],
  ] as const
  for (const [route, path] of paths) {
    expect(routeForPath(path)).toBe(route)
    expect(
      canAccessRoute({ is_admin: false, has_project_access: false }, route),
    ).toBe(false)
  }
})
