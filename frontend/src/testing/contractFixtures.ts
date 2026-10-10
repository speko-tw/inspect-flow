// 依後端實際回應形狀建立的測試資料（RG-M22）。共用契約位於
// `auth/fixtures/` 與 `admin/audit-log/fixtures/`；後端 API 測試
// 驗證真實回應，這裡的測試驗證模擬資料沒有多欄或缺欄。

import type { CurrentUser } from '../auth/api'
import type { MyProject } from '../admin/projects/api'
import type { AuditLogEntry, AuditLogPage } from '../admin/audit-log/api'

export function currentUserFixture(
  overrides: Partial<CurrentUser> = {},
): CurrentUser {
  return {
    id: 'user-1',
    username: 'demo',
    email: 'demo@example.com',
    name_en: null,
    name_zh: '示範使用者',
    is_admin: false,
    must_change_password: false,
    has_office_access: false,
    has_field_access: false,
    has_template_access: false,
    company: null,
    department: null,
    location: null,
    employee_no: null,
    ...overrides,
  }
}

export function myProjectFixture(
  overrides: Partial<MyProject> = {},
): MyProject {
  return {
    id: 'project-1',
    project_code: 'DEMO-1',
    name: '示範工程',
    client_name: '示範業主',
    site_location: '示範工地',
    planned_start_date: null,
    planned_completion_date: null,
    role_names: [],
    has_office_access: true,
    ...overrides,
  }
}

export function auditLogEntryFixture(
  overrides: Partial<AuditLogEntry> = {},
): AuditLogEntry {
  return {
    id: '00000000-0000-0000-0000-000000000002',
    created_at: '2026-10-10T08:30:00Z',
    created_by: '00000000-0000-0000-0000-000000000001',
    project_id: '00000000-0000-0000-0000-000000000412',
    event_type: 'project_zone.created',
    entity_type: 'project_zone',
    entity_id: '00000000-0000-0000-0000-000000000100',
    before: null,
    after: { name: '一樓' },
    ...overrides,
  }
}

export function auditLogPageFixture(
  overrides: Partial<AuditLogPage> = {},
): AuditLogPage {
  return {
    items: [auditLogEntryFixture()],
    next_cursor: null,
    ...overrides,
  }
}
