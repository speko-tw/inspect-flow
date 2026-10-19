import { describe, expect, it } from 'vitest'

import contract from '../auth/fixtures/current-user-contract.json'
import auditContract from '../admin/audit-log/fixtures/audit-log-contract.json'
import { landingPath } from '../auth/landing'
import {
  auditLogEntryFixture,
  auditLogPageFixture,
  currentUserFixture,
  myProjectFixture,
} from './contractFixtures'

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

  it('audit log fixtures have exactly the backend keys', () => {
    expect(Object.keys(auditLogEntryFixture()).sort()).toEqual(
      auditContract.audit_entry_keys,
    )
    expect(Object.keys(auditLogPageFixture()).sort()).toEqual(
      auditContract.audit_page_keys,
    )
  })
})

describe('landingPath (#480)', () => {
  it.each([
    ['system admin', { is_admin: true }, '/overview'],
    [
      'office only',
      {
        has_office_access: true,
        has_project_access: true,
        has_field_access: false,
        can_inspect_tasks: false,
      },
      '/projects',
    ],
    [
      'field only',
      {
        has_office_access: false,
        has_field_access: true,
        can_inspect_tasks: true,
      },
      '/tasks',
    ],
    [
      'both office and field',
      {
        has_office_access: true,
        has_project_access: true,
        has_field_access: true,
        can_inspect_tasks: true,
        can_manage_project_planning_or_members: true,
      },
      '/projects',
    ],
    [
      'neither',
      {
        has_office_access: false,
        has_field_access: false,
        can_inspect_tasks: false,
      },
      '/settings',
    ],
    [
      'template admin only',
      {
        has_office_access: false,
        has_field_access: false,
        can_inspect_tasks: false,
        has_template_access: true,
        can_manage_template_library: true,
      },
      '/templates',
    ],
    [
      'template admin who also has field access',
      {
        has_office_access: false,
        has_field_access: true,
        can_inspect_tasks: true,
        has_template_access: true,
        can_manage_template_library: true,
      },
      '/tasks',
    ],
    [
      'template admin who also has office access',
      {
        has_office_access: true,
        has_project_access: true,
        has_template_access: true,
        can_manage_template_library: true,
      },
      '/projects',
    ],
    [
      'admin who also has office access',
      { is_admin: true, has_office_access: true },
      '/overview',
    ],
  ])('%s', (_name, overrides, expected) => {
    expect(landingPath(currentUserFixture(overrides))).toBe(expected)
  })
})
