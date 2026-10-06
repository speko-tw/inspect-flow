// 依後端實際回應形狀建立的測試資料（RG-M22）。形狀以
// `auth/fixtures/current-user-contract.json` 為準，後端
// `tests/api/test_access_summary.py` 用同一份檔案驗證真實回應，
// 前端的 `contractFixtures.test.ts` 驗證這裡的資料沒有多欄或缺欄。

import type { CurrentUser } from '../auth/api'
import type { MyProject } from '../admin/projects/api'

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
