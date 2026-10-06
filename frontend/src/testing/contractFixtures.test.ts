import { describe, expect, it } from 'vitest'

import contract from '../auth/fixtures/current-user-contract.json'
import { landingPath } from '../auth/landing'
import { currentUserFixture, myProjectFixture } from './contractFixtures'

describe('contract fixtures (RG-M22)', () => {
  it('current user fixture has exactly the backend keys', () => {
    expect(Object.keys(currentUserFixture()).sort()).toEqual(
      contract.current_user_keys,
    )
  })

  it('my project fixture has exactly the backend keys', () => {
    expect(Object.keys(myProjectFixture()).sort()).toEqual(
      contract.my_project_keys,
    )
  })
})

describe('landingPath (#480)', () => {
  it.each([
    ['system admin', { is_admin: true }, '/admin'],
    [
      'office only',
      { has_office_access: true, has_field_access: false },
      '/admin/projects',
    ],
    [
      'field only',
      { has_office_access: false, has_field_access: true },
      '/field',
    ],
    [
      'both office and field',
      { has_office_access: true, has_field_access: true },
      '/admin/projects',
    ],
    [
      'neither',
      { has_office_access: false, has_field_access: false },
      '/field',
    ],
    [
      'admin who also has office access',
      { is_admin: true, has_office_access: true },
      '/admin',
    ],
  ])('%s', (_name, overrides, expected) => {
    expect(landingPath(currentUserFixture(overrides))).toBe(expected)
  })
})
