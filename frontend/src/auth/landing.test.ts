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
    [TEMPLATE, '/admin/projects/p1/inspection-items/templates'],
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
    [TEMPLATE, '/admin/projects/p1/inspection-items'],
    [NONE, '/admin/projects'],
  ])('不可以：%j → %s', (user, path) => {
    expect(canVisit(user, path)).toBe(false)
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

  it('沒有原頁面或不安全的路徑，去落點', () => {
    expect(loginTarget(OFFICE, undefined, NOBODY_BEFORE)).toBe(
      '/admin/projects',
    )
    expect(loginTarget(OFFICE, '//evil.example', NOBODY_BEFORE)).toBe(
      '/admin/projects',
    )
  })
})
