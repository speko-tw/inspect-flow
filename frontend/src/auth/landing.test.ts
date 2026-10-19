import { describe, expect, it } from 'vitest'

import { canVisit, landingPath, loginTarget } from './landing'

const NONE = {
  id: 'u1',
  is_admin: false,
  has_office_access: false,
  has_field_access: false,
  has_template_access: false,
  has_project_access: false,
  module_permissions: [],
  delegated_modules: [],
  can_create_project: false,
}
const ADMIN = { ...NONE, is_admin: true }
const OFFICE = { ...NONE, has_office_access: true }
const FIELD = { ...NONE, has_field_access: true }
const FIELD_PROJECT = {
  ...FIELD,
  has_project_access: true,
}
const TEMPLATE = { ...NONE, has_template_access: true }
const TEMPLATE_USE_ONLY = {
  ...NONE,
  can_browse_templates: true,
  can_manage_template_library: false,
}
const DELEGATE = { ...NONE, delegated_modules: ['template.manage'] }
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
    [ADMIN, '/admin/people'],
    [ADMIN, '/admin/people/user-1'],
    [DELEGATE, '/admin/people'],
    [DELEGATE, '/admin/people/user-1'],
    [ADMIN, '/field/tasks/t1?scope=all'],
    [OFFICE, '/admin/projects'],
    [OFFICE, '/admin/projects/p1/planning?x=1#top'],
    [FIELD_PROJECT, '/admin/projects'],
    [FIELD_PROJECT, '/admin/projects/p1'],
    [FIELD, '/field'],
    [FIELD, '/field/tasks/t1'],
    [TEMPLATE, '/admin/templates'],
    [TEMPLATE_USE_ONLY, '/admin/templates'],
    [TEMPLATE, '/admin/projects/p1/templates'],
    [TEMPLATE, '/admin/projects/p1/inspection-items/templates'],
    [TEMPLATE_USE_ONLY, '/admin/projects/p1/inspection-items/templates'],
    [NONE, '/change-password'],
    [NONE, '/somewhere-else'],
    [FIELD, '/administrator'],
    [OFFICE, '/fieldwork'],
  ])('可以：%j → %s', (user, path) => {
    expect(canVisit(user, path)).toBe(true)
  })

  it.each([
    [FIELD, '/admin/projects'],
    [FIELD, '/admin/people'],
    [FIELD, '/admin/people/user-1'],
    [FIELD, '/admin/projects/p1'],
    [FIELD, '/admin/users'],
    [OFFICE, '/field'],
    [OFFICE, '/admin/templates'],
    [OFFICE, '/admin/people'],
    [OFFICE, '/admin/people/user-1'],
    [DELEGATE, '/admin/companies'],
    [DELEGATE, '/admin/roles'],
    [DELEGATE, '/admin/audit-logs'],
    [OFFICE, '/admin'],
    [TEMPLATE, '/admin/projects'],
    [TEMPLATE, '/admin/projects/p1/members'],
    [TEMPLATE, '/admin/projects/p1/inspection-items'],
    [NONE, '/admin/projects'],
  ])('不可以：%j → %s', (user, path) => {
    expect(canVisit(user, path)).toBe(false)
  })
})

describe('各身分登入落點（role-tasks.md）', () => {
  it.each([
    ['系統管理者', ADMIN, '/admin/dashboard'],
    ['全專案進度主管', SUPERVISOR, '/admin/dashboard'],
    ['內業工程師', OFFICE, '/admin/projects'],
    ['現場工程師', FIELD, '/field'],
    ['範本管理者', TEMPLATE, '/admin/templates'],
    ['委派者', DELEGATE, '/admin/people'],
    ['外部協作', EXTERNAL, '/admin/projects'],
    ['全無權限', NONE, '/change-password'],
  ])('%s → %s', (_label, user, expected) => {
    expect(landingPath(user)).toBe(expected)
  })
})

const NOBODY_BEFORE = { kind: 'none' } as const
const SIGNED_OUT = { kind: 'signedOut' } as const
const user = (userId: string) => ({ kind: 'user', userId }) as const

describe('loginTarget：登入後要去哪（#489）', () => {
  it('沒有任何記錄時（深層連結、重新整理後），沿用看得到的原頁面', () => {
    expect(loginTarget(OFFICE, '/admin/projects/p1', NOBODY_BEFORE)).toBe(
      '/admin/projects/p1',
    )
  })

  it('上一位是同一個人時，沿用原頁面', () => {
    expect(loginTarget(FIELD, '/field/tasks/t1', user('u1'))).toBe(
      '/field/tasks/t1',
    )
  })

  it('上一位是別人時，一律去新帳號的落點', () => {
    expect(loginTarget(FIELD, '/field/tasks/t1', user('someone'))).toBe(
      '/field',
    )
    expect(loginTarget(OFFICE, '/field', user('someone'))).toBe(
      landingPath(OFFICE),
    )
  })

  it('剛主動登出時一律去落點，連同一個人與看得到的原頁面也一樣', () => {
    expect(loginTarget(FIELD, '/field/tasks/t1', SIGNED_OUT)).toBe('/field')
    expect(loginTarget(OFFICE, '/admin/projects/p1', SIGNED_OUT)).toBe(
      '/admin/projects',
    )
  })

  it('原頁面新帳號看不到時，去落點', () => {
    expect(loginTarget(FIELD, '/admin/projects', user('u1'))).toBe('/field')
    expect(loginTarget(TEMPLATE, '/field', NOBODY_BEFORE)).toBe(
      '/admin/templates',
    )
  })

  it('template.use-only 可回到範本庫並以範本庫為預設落點', () => {
    expect(canVisit(TEMPLATE_USE_ONLY, '/admin/templates')).toBe(true)
    expect(landingPath(TEMPLATE_USE_ONLY)).toBe('/admin/templates')
    expect(
      loginTarget(TEMPLATE_USE_ONLY, '/admin/templates', NOBODY_BEFORE),
    ).toBe('/admin/templates')
  })

  it('管理者登入後直接進總覽', () => {
    expect(landingPath(ADMIN)).toBe('/admin/dashboard')
  })

  it('全無權限帳號登入後進設定頁', () => {
    expect(loginTarget(NONE, undefined, NOBODY_BEFORE)).toBe(
      '/change-password',
    )
  })

  it('現場加唯讀專案權限仍以今日任務為落點', () => {
    expect(landingPath(FIELD_PROJECT)).toBe('/field')
    expect(loginTarget(FIELD_PROJECT, undefined, NOBODY_BEFORE)).toBe('/field')
  })

  it('沒有原頁面或不安全的路徑，去落點', () => {
    expect(loginTarget(OFFICE, undefined, NOBODY_BEFORE)).toBe(
      '/admin/projects',
    )
    expect(loginTarget(OFFICE, '//evil.example', NOBODY_BEFORE)).toBe(
      '/admin/projects',
    )
  })
})
