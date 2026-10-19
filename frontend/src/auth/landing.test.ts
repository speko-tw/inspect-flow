import { describe, expect, it } from 'vitest'

import { canVisit, landingPath, loginTarget } from './landing'

const NONE = {
  id: 'u1',
  is_admin: false,
  has_office_access: false,
  has_field_access: false,
  can_inspect_tasks: false,
  has_template_access: false,
  has_project_access: false,
  module_permissions: [],
  delegated_modules: [],
  can_create_project: false,
}
const ADMIN = { ...NONE, is_admin: true }
const OFFICE = { ...NONE, has_project_access: true }
const FIELD = { ...NONE, has_field_access: true, can_inspect_tasks: true }
const FIELD_PROJECT = {
  ...FIELD,
  has_project_access: true,
}
const TEMPLATE = {
  ...NONE,
  has_template_access: true,
  can_manage_template_library: true,
  module_permissions: ['template.manage'],
}
const TEMPLATE_USE_ONLY = {
  ...NONE,
  can_browse_templates: true,
  module_permissions: ['template.use'],
  can_manage_template_library: false,
}
const DELEGATE = { ...NONE, delegated_modules: ['account.manage'] }
const SUPERVISOR = {
  ...NONE,
  has_project_access: true,
  module_permissions: ['all_project_progress.read'],
}
const EXTERNAL = {
  ...NONE,
  has_project_access: true,
  is_external_collaborator: true,
}

describe('canVisit：新帳號看得到的頁面（#489）', () => {
  it.each([
    [ADMIN, '/accounts'],
    [ADMIN, '/accounts/user-1'],
    [DELEGATE, '/accounts'],
    [DELEGATE, '/accounts/user-1'],
    [ADMIN, '/tasks/t1?scope=all'],
    [OFFICE, '/projects'],
    [OFFICE, '/projects/p1/planning?x=1#top'],
    [FIELD_PROJECT, '/projects'],
    [FIELD_PROJECT, '/projects/p1'],
    [FIELD, '/tasks'],
    [FIELD, '/tasks/t1'],
    [TEMPLATE, '/templates'],
    [TEMPLATE, '/projects/p1/inspection-items/templates'],
    [TEMPLATE_USE_ONLY, '/projects/p1/inspection-items/templates'],
    [NONE, '/settings'],
    [NONE, '/somewhere-else'],
    [FIELD, '/administrator'],
    [OFFICE, '/fieldwork'],
  ])('可以：%j → %s', (user, path) => {
    expect(canVisit(user, path)).toBe(true)
  })

  it.each([
    [FIELD, '/projects'],
    [FIELD, '/accounts'],
    [FIELD, '/accounts/user-1'],
    [FIELD, '/projects/p1'],
    [OFFICE, '/tasks'],
    [OFFICE, '/templates'],
    [OFFICE, '/accounts'],
    [OFFICE, '/accounts/user-1'],
    [DELEGATE, '/companies'],
    [DELEGATE, '/roles'],
    [DELEGATE, '/logs'],
    [OFFICE, '/accounts'],
    [TEMPLATE, '/projects'],
    [TEMPLATE, '/projects/p1/members'],
    [TEMPLATE, '/projects/p1/inspection-items'],
    [NONE, '/projects'],
  ])('不可以：%j → %s', (user, path) => {
    expect(canVisit(user, path)).toBe(false)
  })
})

describe('各身分登入落點（role-tasks.md）', () => {
  it.each([
    ['系統管理者', ADMIN, '/overview'],
    ['全專案進度主管', SUPERVISOR, '/overview'],
    ['內業工程師', OFFICE, '/projects'],
    ['現場工程師', FIELD, '/tasks'],
    ['範本管理者', TEMPLATE, '/templates'],
    ['委派者', DELEGATE, '/accounts'],
    ['外部協作', EXTERNAL, '/projects'],
    ['全無權限', NONE, '/settings'],
  ])('%s → %s', (_label, user, expected) => {
    expect(landingPath(user)).toBe(expected)
  })
})

const NOBODY_BEFORE = { kind: 'none' } as const
const SIGNED_OUT = { kind: 'signedOut' } as const
const user = (userId: string) => ({ kind: 'user', userId }) as const

describe('loginTarget：登入後要去哪（#489）', () => {
  it('沒有任何記錄時（深層連結、重新整理後），沿用看得到的原頁面', () => {
    expect(loginTarget(OFFICE, '/projects/p1', NOBODY_BEFORE)).toBe(
      '/projects/p1',
    )
  })

  it('上一位是同一個人時，沿用原頁面', () => {
    expect(loginTarget(FIELD, '/tasks/t1', user('u1'))).toBe('/tasks/t1')
  })

  it('上一位是別人時，一律去新帳號的落點', () => {
    expect(loginTarget(FIELD, '/tasks/t1', user('someone'))).toBe('/tasks')
    expect(loginTarget(OFFICE, '/tasks', user('someone'))).toBe(
      landingPath(OFFICE),
    )
  })

  it('剛主動登出時一律去落點，連同一個人與看得到的原頁面也一樣', () => {
    expect(loginTarget(FIELD, '/tasks/t1', SIGNED_OUT)).toBe('/tasks')
    expect(loginTarget(OFFICE, '/projects/p1', SIGNED_OUT)).toBe('/projects')
  })

  it('原頁面新帳號看不到時，去落點', () => {
    expect(loginTarget(FIELD, '/projects', user('u1'))).toBe('/tasks')
    expect(loginTarget(TEMPLATE, '/tasks', NOBODY_BEFORE)).toBe('/templates')
  })

  it('template.use-only 不能進範本管理頁，也沒有範本管理落點', () => {
    expect(canVisit(TEMPLATE_USE_ONLY, '/templates')).toBe(false)
    expect(landingPath(TEMPLATE_USE_ONLY)).toBe('/settings')
    expect(loginTarget(TEMPLATE_USE_ONLY, '/templates', NOBODY_BEFORE)).toBe(
      '/settings',
    )
  })

  it('管理者登入後直接進總覽', () => {
    expect(landingPath(ADMIN)).toBe('/overview')
  })

  it('全無權限帳號登入後進設定頁', () => {
    expect(loginTarget(NONE, undefined, NOBODY_BEFORE)).toBe('/settings')
  })

  it('有專案與現場權限時依序以專案為落點', () => {
    expect(landingPath(FIELD_PROJECT)).toBe('/projects')
    expect(loginTarget(FIELD_PROJECT, undefined, NOBODY_BEFORE)).toBe(
      '/projects',
    )
  })

  it('沒有原頁面或不安全的路徑，去落點', () => {
    expect(loginTarget(OFFICE, undefined, NOBODY_BEFORE)).toBe('/projects')
    expect(loginTarget(OFFICE, '//evil.example', NOBODY_BEFORE)).toBe(
      '/projects',
    )
  })
})
