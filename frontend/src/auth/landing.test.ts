import { describe, expect, it } from 'vitest'

import { canVisit, landingPath, loginTarget } from './landing'

const NONE = {
  id: 'u1',
  is_admin: false,
  has_office_access: false,
  has_field_access: false,
  has_template_access: false,
}
const ADMIN = { ...NONE, is_admin: true }
const OFFICE = { ...NONE, has_office_access: true }
const FIELD = { ...NONE, has_field_access: true }
const TEMPLATE = { ...NONE, has_template_access: true }

describe('canVisit：新帳號看得到的頁面（#489）', () => {
  it.each([
    [ADMIN, '/admin/users'],
    [ADMIN, '/field/tasks/t1?scope=all'],
    [OFFICE, '/admin/projects'],
    [OFFICE, '/admin/projects/p1/planning?x=1#top'],
    [FIELD, '/field'],
    [FIELD, '/field/tasks/t1'],
    [TEMPLATE, '/admin/templates'],
    [TEMPLATE, '/admin/projects/p1/templates'],
    [NONE, '/change-password'],
    [NONE, '/somewhere-else'],
    [FIELD, '/administrator'],
    [OFFICE, '/fieldwork'],
  ])('可以：%j → %s', (user, path) => {
    expect(canVisit(user, path)).toBe(true)
  })

  it.each([
    [FIELD, '/admin/projects'],
    [FIELD, '/admin/users'],
    [OFFICE, '/field'],
    [OFFICE, '/admin/templates'],
    [OFFICE, '/admin/users'],
    [OFFICE, '/admin'],
    [TEMPLATE, '/admin/projects'],
    [TEMPLATE, '/admin/projects/p1/members'],
    [NONE, '/admin/projects'],
  ])('不可以：%j → %s', (user, path) => {
    expect(canVisit(user, path)).toBe(false)
  })
})

describe('loginTarget：登入後要去哪（#489）', () => {
  it('沒有上一位使用者時，沿用看得到的原頁面', () => {
    expect(loginTarget(OFFICE, '/admin/projects/p1', null)).toBe(
      '/admin/projects/p1',
    )
  })

  it('上一位是同一個人時，沿用原頁面', () => {
    expect(loginTarget(FIELD, '/field/tasks/t1', 'u1')).toBe('/field/tasks/t1')
  })

  it('上一位是別人時，一律去新帳號的落點', () => {
    expect(loginTarget(FIELD, '/field/tasks/t1', 'someone-else')).toBe(
      '/field',
    )
    expect(loginTarget(OFFICE, '/field', 'someone-else')).toBe(
      landingPath(OFFICE),
    )
  })

  it('原頁面新帳號看不到時，去落點', () => {
    expect(loginTarget(FIELD, '/admin/projects', 'u1')).toBe('/field')
    expect(loginTarget(TEMPLATE, '/field', null)).toBe('/admin/templates')
  })

  it('沒有原頁面或不安全的路徑，去落點', () => {
    expect(loginTarget(OFFICE, undefined, null)).toBe('/admin/projects')
    expect(loginTarget(OFFICE, '//evil.example', null)).toBe('/admin/projects')
  })
})
