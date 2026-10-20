import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { StrictMode } from 'react'
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router'
import { DataMemoryRouter } from '../testing/DataMemoryRouter'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { CurrentUser } from '../auth/api'
import { CurrentUserProvider } from '../auth/useCurrentUser'
import AdminPage from './AdminPage'
import { preloadLazyRoutes } from '../testing/preloadRoutes'
import {
  managementErrorMessage,
  ManagementApiError,
  type Company,
  type CreatedUser,
  type User,
} from './api'

beforeAll(preloadLazyRoutes)

const company: Company = {
  id: 'company-1',
  name: '示範公司',
  is_active: true,
}

const regularUser: User = {
  id: 'user-1',
  username: 'anna.deng',
  email: 'anna@example.com',
  name_zh: '鄧安娜',
  name_en: 'Anna Deng',
  company_id: company.id,
  company_name: company.name,
  department: '工程部',
  location: '台北',
  employee_no: 'E001',
  extension_1: null,
  extension_2: null,
  mobile: null,
  line_id: null,
  wechat_id: null,
  responsibilities: null,
  auth_source: 'local',
  is_active: true,
  is_admin: false,
  is_system: false,
}

const builtInUser: User = {
  ...regularUser,
  id: 'admin-id',
  username: 'admin',
  email: null,
  name_zh: null,
  name_en: null,
  company_id: null,
  department: null,
  location: null,
  employee_no: null,
  is_admin: true,
  is_system: true,
}

const currentUser: CurrentUser = {
  id: 'admin-id',
  username: 'admin',
  email: null,
  name_en: null,
  name_zh: null,
  is_admin: true,
  must_change_password: false,
  has_office_access: true,
  can_manage_project_planning_or_members: true,
  has_field_access: true,
  can_inspect_tasks: true,
  has_template_access: true,
  module_permissions: [],
  delegated_modules: [],
  can_create_project: true,
  has_project_access: true,
  is_external_collaborator: false,
}

function renderAdmin(
  path: string | { pathname: string; state: unknown } = '/accounts',
  isAdmin = true,
  access: Partial<
    Pick<
      CurrentUser,
      | 'has_office_access'
      | 'has_field_access'
      | 'can_inspect_tasks'
      | 'has_template_access'
      | 'can_browse_templates'
      | 'can_manage_template_library'
      | 'is_external_collaborator'
      | 'has_project_access'
      | 'can_create_project'
      | 'delegated_modules'
      | 'module_permissions'
    >
  > = {},
  strictMode = false,
  history?: { entries: string[]; index: number },
) {
  const signedInUser = { ...currentUser, is_admin: isAdmin, ...access }
  const page = (
    <DataMemoryRouter
      initialEntries={history?.entries ?? [path]}
      initialIndex={history?.index}
    >
      <Routes>
        <Route
          element={
            <>
              <CurrentUserProvider
                value={{ user: signedInUser, clear: vi.fn() }}
              >
                <AdminPage />
              </CurrentUserProvider>
              <TestNavigation />
            </>
          }
          path="/*"
        />
      </Routes>
    </DataMemoryRouter>
  )
  return render(strictMode ? <StrictMode>{page}</StrictMode> : page)
}

function TestNavigation() {
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <>
      <output data-testid="pathname">{location.pathname}</output>
      <Link to="/companies">測試 SPA 管理頁導覽</Link>
      <Link to="/roles">測試 SPA 離開管理頁</Link>
      <button onClick={() => navigate(-1)} type="button">
        測試瀏覽器上一頁
      </button>
      <button onClick={() => navigate(1)} type="button">
        測試瀏覽器下一頁
      </button>
    </>
  )
}

function managementFetch({
  userRows = [builtInUser, regularUser],
  companyRows = [company],
  memberProjectIds = [],
  viewerPermissionCodes = ['project_member.manage', 'inspection_plan.read'],
  onCreate,
  failAdminAction = false,
}: {
  userRows?: User[]
  companyRows?: Company[]
  memberProjectIds?: string[]
  viewerPermissionCodes?: string[]
  onCreate?: (body: Record<string, unknown>) => CreatedUser
  failAdminAction?: boolean
} = {}) {
  const rows = userRows.map((user) => ({ ...user }))
  const companies = companyRows.map((row) => ({ ...row }))
  const templateCategories = [{ id: 'category-1', name: '土木工程' }]
  const templateSystems = [
    { id: 'system-1', category_id: 'category-1', name: '護欄' },
  ]
  const templateItems = [
    {
      id: 'template-1',
      system_id: 'system-1',
      sequence: 1,
      title: '欄杆尺寸',
      instruction: '確認尺寸',
      inspection_points: [],
    },
  ]
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const parsed = new URL(url, 'http://testserver')
      const method = init?.method ?? 'GET'
      if (parsed.pathname.endsWith('/workflow-summary') && method === 'GET') {
        const projectId = parsed.pathname.split('/')[4]
        return Response.json({
          project: {
            id: projectId,
            project_code: 'DEMO-001',
            name: '示範工程',
            company_role: 'contractor',
          },
          member_count: 0,
          inspection_item_count: 0,
          zone_count: 0,
          plan_count: 0,
          task_counts: {
            DRAFT: 0,
            PENDING: 0,
            IN_PROGRESS: 0,
            COMPLETED: 0,
            CANCELLED: 0,
          },
          pending_reinspection_task_count: 0,
          next_steps: [],
          primary_step: null,
          task_counts_visible: false,
          draft_tasks_missing_assignee: 0,
          viewer_permission_codes: viewerPermissionCodes,
        })
      }
      if (parsed.pathname === '/api/v1/me/projects' && method === 'GET') {
        return Response.json(
          memberProjectIds.map((id) => ({
            id,
            project_code: 'DEMO-001',
            name: '示範工程',
            client_name: '示範公司',
            site_location: '台北',
            planned_start_date: null,
            planned_completion_date: null,
            role_names: ['內業'],
            has_office_access: true,
          })),
        )
      }
      if (
        parsed.pathname === '/api/v1/admin/dashboard/projects' &&
        method === 'GET'
      ) {
        return Response.json({ items: [], next_cursor: null })
      }
      if (parsed.pathname === '/api/v1/projects' && method === 'GET') {
        return Response.json({
          items: [
            {
              id: 'project-demo-1',
              project_code: 'DEMO-001',
              name: '示範工程',
              warnings: [],
            },
          ],
          next_cursor: null,
        })
      }
      if (
        parsed.pathname === '/api/v1/module-permissions' &&
        method === 'GET'
      ) {
        return Response.json({ items: [] })
      }
      if (
        parsed.pathname === '/api/v1/permission-bundles' &&
        method === 'GET'
      ) {
        return Response.json({
          items: [
            {
              id: 'office-bundle',
              name: '專案工程師常用',
              permission_codes: [
                'project.use',
                'project.create',
                'inspection.use',
                'template.use',
              ],
              created_at: '',
              updated_at: '',
            },
          ],
          next_cursor: null,
        })
      }
      if (parsed.pathname === '/api/v1/roles' && method === 'GET') {
        return Response.json({
          items: [
            {
              id: 'office-role',
              name: '專案工程師',
              permission_codes: ['project_member.manage'],
              user_count: 0,
              project_count: 0,
              created_at: '',
              updated_at: '',
              is_assignable: true,
              is_external_allowed: false,
            },
          ],
          next_cursor: null,
        })
      }
      if (
        parsed.pathname === '/api/v1/roles/creator-role' &&
        method === 'GET'
      ) {
        return Response.json({ role_id: 'office-role' })
      }
      if (
        /\/projects\/project-demo-1\/inspection-items$/.test(
          parsed.pathname,
        ) &&
        method === 'GET'
      ) {
        return Response.json({ items: [], next_cursor: null })
      }
      if (url.includes('/template-categories?')) {
        return Response.json({
          items: templateCategories,
          next_cursor: null,
        })
      }
      if (url.includes('/template-categories/category-1/systems?')) {
        return Response.json({
          items: templateSystems,
          next_cursor: null,
        })
      }
      if (url.includes('/template-systems/system-1/templates?')) {
        return Response.json({
          items: templateItems,
          next_cursor: null,
        })
      }
      if (parsed.pathname === '/api/v1/users' && method === 'GET') {
        const query = parsed.searchParams.get('q')?.toLowerCase() ?? ''
        const filtered = rows.filter((user) =>
          [
            user.username,
            user.name_zh,
            user.name_en,
            user.email,
            user.employee_no,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(query),
        )
        const start = Number(parsed.searchParams.get('cursor') ?? 0)
        const limit = Number(parsed.searchParams.get('limit') ?? 50)
        return Response.json({
          items: filtered.slice(start, start + limit),
          next_cursor:
            start + limit < filtered.length ? String(start + limit) : null,
        })
      }
      const userPath = /^\/api\/v1\/users\/([^/]+)$/.exec(parsed.pathname)
      if (userPath && method === 'GET') {
        return Response.json(rows.find((user) => user.id === userPath[1]))
      }
      if (parsed.pathname === '/api/v1/companies' && method === 'GET') {
        const query = parsed.searchParams.get('q')?.toLowerCase() ?? ''
        const filtered = companies.filter((row) =>
          row.name.toLowerCase().includes(query),
        )
        const start = Number(parsed.searchParams.get('cursor') ?? 0)
        const limit = Number(parsed.searchParams.get('limit') ?? 50)
        return Response.json({
          items: filtered.slice(start, start + limit),
          next_cursor:
            start + limit < filtered.length ? String(start + limit) : null,
        })
      }
      if (parsed.pathname === '/api/v1/companies' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { name: string }
        const created = {
          id: `company-${companies.length + 1}`,
          name: body.name,
          is_active: true,
        }
        companies.push(created)
        return Response.json(created, { status: 201 })
      }
      const companyMatch = /\/companies\/([^/]+)$/.exec(parsed.pathname)
      if (companyMatch && method === 'PATCH') {
        const row = companies.find((item) => item.id === companyMatch[1])
        if (row) {
          Object.assign(
            row,
            JSON.parse(String(init?.body)) as Partial<Company>,
          )
        }
        return Response.json(row)
      }
      if (parsed.pathname === '/api/v1/users' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        if (onCreate) {
          const createdUser = onCreate(body)
          rows.push(createdUser)
          return Response.json(createdUser, { status: 201 })
        }
        return Response.json(
          { error: { code: 'user.email_conflict' } },
          { status: 409 },
        )
      }
      if (
        parsed.pathname === '/api/v1/users/user-1/temporary-password' &&
        method === 'POST'
      ) {
        return Response.json({
          user_id: 'user-1',
          username: 'anna.deng',
          temporary_password: 'reset-once-123',
          must_change_password: true,
        })
      }
      if (
        /^\/api\/v1\/users\/[^/]+\/permission-bundles\/[^/]+:apply$/.test(
          parsed.pathname,
        ) &&
        method === 'POST'
      ) {
        return Response.json({ user_id: 'user-2', granted_codes: [] })
      }
      if (url.endsWith('/companies/company-1/active-users')) {
        return Response.json({
          count: 1,
          users: [{ id: 'user-1', username: 'anna.deng', name_zh: '鄧安娜' }],
        })
      }
      if (
        url.endsWith('/companies/company-1/active') &&
        init?.method === 'PUT'
      ) {
        return Response.json(company)
      }
      if (url.endsWith('/users/user-1/company')) {
        const body = JSON.parse(String(init?.body)) as {
          company_id: string | null
          department: string | null
          location: string | null
          employee_no: string | null
        }
        const row = rows.find((user) => user.id === 'user-1')
        if (row) {
          Object.assign(row, body)
        }
        return Response.json(row)
      }
      if (url.endsWith('/users/user-1/admin')) {
        if (failAdminAction) {
          return Response.json(
            { error: { code: 'user.builtin_protected' } },
            { status: 403 },
          )
        }
        const row = rows.find((user) => user.id === 'user-1')
        if (row) {
          row.is_admin = Boolean(
            (JSON.parse(String(init?.body)) as { is_admin: boolean }).is_admin,
          )
        }
        return Response.json(row)
      }
      if (url.endsWith('/users/user-1/active')) {
        const row = rows.find((user) => user.id === 'user-1')
        if (row) {
          row.is_active = Boolean(
            (JSON.parse(String(init?.body)) as { is_active: boolean })
              .is_active,
          )
        }
        return Response.json(row)
      }
      if (url.endsWith('/users/user-1/deactivation-check')) {
        return Response.json({ user_id: 'user-1', last_manager_projects: [] })
      }
      if (url.endsWith('/users/user-1/reactivation-preview')) {
        return Response.json({
          user_id: 'user-1',
          username: 'anna.deng',
          is_external_collaborator: false,
          account_expires_on: null,
          account_expired: false,
          permission_codes: [],
          delegated_modules: [],
          project_memberships: [],
          tasks: [],
        })
      }
      if (
        url.endsWith('/users/user-1:reactivate') &&
        init?.method === 'POST'
      ) {
        const row = rows.find((user) => user.id === 'user-1')
        if (row) row.is_active = true
        return Response.json(row)
      }
      if (url.endsWith('/users/user-1') && init?.method === 'PATCH') {
        const row = rows.find((user) => user.id === 'user-1')
        if (row) {
          Object.assign(row, JSON.parse(String(init.body)) as Partial<User>)
        }
        return Response.json(row)
      }
      if (parsed.pathname.endsWith('/audit-logs') && method === 'GET') {
        return Response.json({ items: [], next_cursor: null })
      }
      return new Response(null, { status: 204 })
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function createAccountThroughWizard(
  username: string,
  email = `${username}@example.com`,
  name = '李柏',
) {
  fireEvent.click(await screen.findByRole('button', { name: '新增帳號' }))
  await screen.findByRole('heading', { name: '設定帳號', level: 2 })
  fireEvent.change(screen.getByLabelText('帳號名稱'), {
    target: { value: username },
  })
  fireEvent.change(screen.getByLabelText('姓名'), {
    target: { value: name },
  })
  fireEvent.change(screen.getByLabelText('電子郵件'), {
    target: { value: email },
  })
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  fireEvent.click(screen.getByRole('radio', { name: /內業規劃/ }))
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  fireEvent.click(screen.getByRole('button', { name: '建立帳號' }))
}

async function openAccountDetails(username: string, displayName: string) {
  const row = await screen.findByRole('row', {
    name: new RegExp(username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  })
  fireEvent.click(within(row).getByRole('link', { name: displayName }))
  await screen.findByRole('heading', { name: displayName, level: 1 })
  return row
}

function openAccountMoreActions() {
  fireEvent.click(screen.getByText('更多'))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('管理表單未儲存導覽防護', () => {
  const cases = [
    {
      label: '帳號',
      path: '/accounts',
      entries: ['/roles', '/accounts', '/companies'],
      input: /^帳號名稱/,
      value: 'unsaved-user',
    },
    {
      label: '公司',
      path: '/companies',
      entries: ['/accounts', '/companies', '/roles'],
      input: '公司名稱',
      value: '未儲存公司',
    },
  ] as const

  it.each(cases)('$label表單攔截站內導覽與 Back/Forward', async (item) => {
    managementFetch()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderAdmin(item.path, true, {}, false, {
      entries: [...item.entries],
      index: 1,
    })
    await screen.findByRole('heading', {
      name: item.label === '帳號' ? '帳號' : '公司管理',
    })
    if (item.label === '帳號') {
      fireEvent.click(screen.getByRole('button', { name: '新增帳號' }))
      await screen.findByRole('heading', { name: '設定帳號', level: 2 })
    }
    fireEvent.change(screen.getByLabelText(item.input), {
      target: { value: item.value },
    })

    fireEvent.click(screen.getByRole('link', { name: '測試 SPA 管理頁導覽' }))
    expect(
      await screen.findByRole('heading', { name: '有尚未儲存的變更' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保留編輯' }))

    fireEvent.click(screen.getByRole('button', { name: '測試瀏覽器上一頁' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(confirm).toHaveBeenLastCalledWith(
      '有尚未儲存的變更。確定要離開嗎？',
    )
    expect(screen.getByTestId('pathname')).toHaveTextContent(item.path)

    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '測試瀏覽器下一頁' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2))
    const nextHeading =
      item.entries[2] === '/companies' ? '公司管理' : '專案角色'
    expect(
      await screen.findByRole('heading', { name: nextHeading }),
    ).toBeInTheDocument()
  })

  it.each(cases)('$label表單輸入後會攔截 beforeunload', async (item) => {
    managementFetch()
    renderAdmin(item.path)
    await screen.findByRole('heading', {
      name: item.label === '帳號' ? '帳號' : '公司管理',
    })
    if (item.label === '帳號') {
      fireEvent.click(screen.getByRole('button', { name: '新增帳號' }))
      await screen.findByRole('heading', { name: '設定帳號', level: 2 })
    }
    fireEvent.change(screen.getByLabelText(item.input), {
      target: { value: item.value },
    })
    const event = new Event('beforeunload', { cancelable: true })

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })
})

describe('admin user and company pages', () => {
  it('uses the PeoplePage route and shared navigation label for list and detail', async () => {
    managementFetch()
    renderAdmin('/accounts?q=anna')

    expect(
      await screen.findByRole('heading', { name: '帳號', level: 1 }),
    ).toBeVisible()
    expect(screen.getByTestId('pathname')).toHaveTextContent('/accounts')
    const nav = screen.getByRole('navigation', { name: '管理功能' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['總覽', '任務', '專案', '範本'])
    fireEvent.click(within(nav).getByRole('button', { name: /管理/ }))
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['總覽', '任務', '專案', '範本', '帳號', '公司', '角色', '紀錄'])
    expect(within(nav).getByRole('link', { name: '帳號' })).toHaveAttribute(
      'href',
      '/accounts',
    )
    expect(within(nav).getByRole('link', { name: '角色' })).toHaveAttribute(
      'href',
      '/roles',
    )
    expect(within(nav).queryByRole('link', { name: '設定' })).toBeNull()

    fireEvent.click(await screen.findByRole('link', { name: '鄧安娜' }))
    expect(
      await screen.findByRole('heading', { name: '鄧安娜', level: 1 }),
    ).toBeVisible()
    expect(screen.getByTestId('pathname')).toHaveTextContent(
      '/accounts/user-1',
    )
  })

  it.each(['/admin/users', '/admin/permissions'])(
    'does not retain the unpublished route %s',
    async (path) => {
      managementFetch()
      renderAdmin(path)

      expect(
        await screen.findByRole('heading', { name: '找不到這個頁面' }),
      ).toBeVisible()
    },
  )

  it('guards edited user details after actual input', async () => {
    managementFetch()
    renderAdmin('/accounts')
    await openAccountDetails('anna.deng', '鄧安娜')
    fireEvent.click(screen.getByRole('button', { name: '修改資料' }))
    const form = screen
      .getByRole('heading', { name: '修改帳號資料' })
      .closest('form') as HTMLFormElement
    fireEvent.change(within(form).getByLabelText('帳號名稱'), {
      target: { value: 'changed-user' },
    })
    const event = new Event('beforeunload', { cancelable: true })

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('guards edited company names after actual input', async () => {
    managementFetch()
    renderAdmin('/companies')
    const companyRow = await screen.findByRole('row', { name: /示範公司/ })
    fireEvent.click(within(companyRow).getByRole('button', { name: '改名稱' }))
    fireEvent.change(screen.getByLabelText('公司名稱'), {
      target: { value: '更新公司' },
    })
    const event = new Event('beforeunload', { cancelable: true })

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('starts one user list request when StrictMode replays the mount', async () => {
    const fetchMock = managementFetch()
    renderAdmin('/accounts', true, {}, true)

    expect(await screen.findByText('anna.deng')).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.filter(([input, init]) => {
        const url = new URL(String(input), 'http://testserver')
        return (
          url.pathname === '/api/v1/users' &&
          (init?.method ?? 'GET') === 'GET' &&
          url.searchParams.get('limit') === '50'
        )
      }),
    ).toHaveLength(1)
  })

  it('cancels the queued list request when StrictMode mounts are cleaned up', async () => {
    const fetchMock = managementFetch()
    const rendered = renderAdmin('/accounts', true, {}, true)
    rendered.unmount()
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    expect(
      fetchMock.mock.calls.filter(([input, init]) => {
        const url = new URL(String(input), 'http://testserver')
        return (
          url.pathname === '/api/v1/users' && (init?.method ?? 'GET') === 'GET'
        )
      }),
    ).toHaveLength(0)
  })

  it('lets Admin edit templates from the management page', async () => {
    managementFetch()
    renderAdmin('/templates')

    expect(
      await screen.findByRole('button', { name: '新增工程類別' }),
    ).toBeInTheDocument()
    const navigation = screen.getByRole('complementary', {
      name: '範本庫導覽',
    })
    expect(
      await screen.findByRole('button', {
        name: /在「土木工程」新增系統/,
      }),
    ).toBeInTheDocument()
    fireEvent.click(
      await within(navigation).findByRole('button', { name: '護欄' }),
    )
    expect(
      await screen.findByRole('button', { name: '新增查核項目' }),
    ).toBeInTheDocument()
    fireEvent.click(
      await within(navigation).findByRole('button', { name: '欄杆尺寸' }),
    )
    expect(
      await screen.findByRole('button', { name: '編輯查核項目' }),
    ).toBeInTheDocument()
  })

  it('lists users and protects the built-in admin controls', async () => {
    managementFetch()
    renderAdmin()

    expect(await screen.findByText('anna.deng')).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: '帳號清單，可水平捲動' }),
    ).toBeInTheDocument()
    // #713：頁面標題只有一個「帳號」，清單沒有重複標題與「能力摘要」欄。
    expect(
      screen.getAllByRole('heading', { level: 1, name: '帳號' }),
    ).toHaveLength(1)
    expect(
      screen.queryByRole('heading', { name: '帳號清單' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('columnheader', { name: '能力摘要' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('能力摘要')).not.toBeInTheDocument()
    const adminRow = await screen.findByRole('row', { name: /admin/ })
    expect(within(adminRow).getByRole('link', { name: 'admin' })).toBeVisible()
    expect(
      within(adminRow).queryByRole('button', { name: '修改資料' }),
    ).toBeNull()
    fireEvent.click(within(adminRow).getByRole('link', { name: 'admin' }))
    await screen.findByRole('heading', { name: 'admin', level: 1 })
    expect(screen.getByRole('button', { name: '修改資料' })).toBeDisabled()
    openAccountMoreActions()
    expect(screen.getByRole('button', { name: '修改公司連結' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '收回管理者' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '停用帳號' })).toBeDisabled()
  })

  it('searches users and loads the next cursor page', async () => {
    const rows = [0, 50].map((index) => ({
      ...regularUser,
      id: `paging-${index}`,
      username: `paging.user.${index}`,
      email: `paging.${index}@demo.example`,
      name_zh: `人員${index}`,
    }))
    const fetchMock = managementFetch({ userRows: rows })
    const pagingFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), 'http://testserver')
        if (url.pathname === '/api/v1/users' && !init?.method) {
          const query = url.searchParams.get('q') ?? ''
          const matches = rows.filter((row) => row.name_zh.includes(query))
          const cursor = url.searchParams.get('cursor')
          return Response.json({
            items: cursor ? matches.slice(1) : matches.slice(0, 1),
            next_cursor: !cursor && matches.length > 1 ? '1' : null,
          })
        }
        return fetchMock(input, init)
      },
    )
    vi.stubGlobal('fetch', pagingFetch)
    renderAdmin()

    expect(await screen.findByText('paging.user.0')).toBeInTheDocument()
    expect(screen.queryByText('paging.user.50')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '載入更多' }))
    expect(await screen.findByText('paging.user.50')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('搜尋帳號'), {
      target: { value: '人員' },
    })
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }))
    expect(await screen.findByText('paging.user.0')).toBeInTheDocument()
    expect(screen.queryByText('paging.user.50')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('搜尋帳號'), {
      target: { value: '草稿不應套用' },
    })
    fireEvent.click(screen.getByRole('button', { name: '載入更多' }))
    expect(await screen.findByText('paging.user.50')).toBeInTheDocument()
    expect(
      pagingFetch.mock.calls.some(([input]) => {
        const url = new URL(String(input), 'http://testserver')
        return (
          url.pathname === '/api/v1/users' &&
          url.searchParams.get('q') === '人員' &&
          url.searchParams.get('cursor') === '1'
        )
      }),
    ).toBe(true)
  })

  it('searches companies and loads the next cursor page', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({
      id: `company-${index}`,
      name: `目標公司${index}`,
      is_active: true,
    }))
    managementFetch({ companyRows: rows })
    renderAdmin('/companies')

    expect(await screen.findByText('目標公司0')).toBeInTheDocument()
    expect(screen.queryByText('目標公司50')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '載入更多' }))
    expect(await screen.findByText('目標公司50')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('搜尋公司'), {
      target: { value: '目標公司' },
    })
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }))
    expect(await screen.findByText('目標公司0')).toBeInTheDocument()
    expect(screen.queryByText('目標公司50')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('搜尋公司'), {
      target: { value: '草稿不應套用' },
    })
    fireEvent.click(screen.getByRole('button', { name: '載入更多' }))
    expect(await screen.findByText('目標公司50')).toBeInTheDocument()
  })

  it.each([
    {
      label: '帳號',
      path: '/accounts',
      searchLabel: '搜尋帳號',
      query: 'anna',
      result: 'anna.deng',
      endpoint: '/api/v1/users',
    },
    {
      label: '公司',
      path: '/companies',
      searchLabel: '搜尋公司',
      query: '示範',
      result: '示範公司',
      endpoint: '/api/v1/companies',
    },
    {
      label: '專案',
      path: '/projects',
      searchLabel: '搜尋專案',
      query: '示範工程',
      result: '示範工程',
      endpoint: '/api/v1/projects',
    },
  ])(
    'searches $label once per submit, including repeated queries',
    async ({ path, searchLabel, query, result, endpoint }) => {
      const fetchMock = managementFetch()
      renderAdmin(path)

      expect(await screen.findByText(result)).toBeInTheDocument()
      fireEvent.change(screen.getByLabelText(searchLabel), {
        target: { value: query },
      })
      const search = screen.getByRole('button', { name: '搜尋' })
      const requestCount = () =>
        fetchMock.mock.calls.filter(([input]) => {
          const url = new URL(String(input), 'http://testserver')
          return (
            url.pathname === endpoint && url.searchParams.get('q') === query
          )
        }).length

      fireEvent.click(search)
      await waitFor(() => expect(requestCount()).toBe(1))
      await waitFor(() => expect(search).toBeEnabled())
      fireEvent.click(search)
      await waitFor(() => expect(requestCount()).toBe(2))
    },
  )

  it('搜尋帳號時不會載入全公司清單', async () => {
    const fetchMock = managementFetch()
    renderAdmin()
    expect(await screen.findByText('anna.deng')).toBeInTheDocument()

    const companyRequests = () =>
      fetchMock.mock.calls.filter(([input]) => {
        const url = new URL(String(input), 'http://testserver')
        return url.pathname === '/api/v1/companies'
      }).length
    expect(companyRequests()).toBe(0)

    fireEvent.change(screen.getByLabelText('搜尋帳號'), {
      target: { value: 'anna' },
    })
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }))
    await waitFor(() => expect(companyRequests()).toBe(0))
  })

  it('shows and clears a temporary password', async () => {
    const password = 'once-only-password'
    const create = vi.fn((body: Record<string, unknown>) => ({
      ...regularUser,
      id: 'user-2',
      username: String(body.username),
      email: String(body.email),
      name_zh: String(body.name_zh),
      temporary_password: password,
    }))
    const fetchMock = managementFetch({
      onCreate: create,
    })
    renderAdmin()
    await createAccountThroughWizard('bob.lee')

    const passwordHeading = await screen.findByRole('heading', {
      name: '帳號已建立',
      level: 2,
    })
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes('/api/v1/companies'),
      ),
    ).toHaveLength(1)
    expect(passwordHeading).toBeVisible()
    expect(screen.getByLabelText('臨時密碼')).toHaveTextContent(password)
    expect(screen.getByRole('button', { name: '回清單' })).toBeVisible()
    expect(
      screen.getByRole('button', { name: '查看這個帳號的能力' }),
    ).toBeVisible()
    expectNoPasswordPersistence(password)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        company_id: null,
        department: null,
        location: null,
        employee_no: null,
      }),
    )
    expect(screen.getByRole('navigation', { name: '管理功能' })).toBeVisible()
    fireEvent.click(
      within(screen.getByRole('banner')).getByRole('button', {
        name: /^admin/,
      }),
    )
    expect(screen.getByRole('button', { name: '登出' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: '帳號已新增' })).toBeNull()
    expectNoPasswordPersistence(password)
    fireEvent.click(screen.getByRole('button', { name: '回清單' }))
    expect(
      await screen.findByRole('heading', { name: '臨時密碼抄下了嗎？' }),
    ).toBeVisible()
    expect(screen.getByLabelText('臨時密碼')).toHaveTextContent(password)
    fireEvent.click(screen.getByRole('button', { name: '留在此頁' }))
    expect(screen.getByLabelText('臨時密碼')).toHaveTextContent(password)

    fireEvent.click(screen.getByRole('button', { name: '回清單' }))
    fireEvent.click(screen.getByRole('button', { name: '離開此頁' }))
    expect(await screen.findByRole('heading', { name: '帳號' })).toBeVisible()
    expect(screen.queryByLabelText('臨時密碼')).not.toBeInTheDocument()
    expect(screen.queryByText(password)).not.toBeInTheDocument()
  })

  it('帳號詳情重設後顯示一次性密碼並可返回清單', async () => {
    const fetchMock = managementFetch()
    renderAdmin('/accounts/user-1')
    await screen.findByRole('heading', { name: '鄧安娜' })
    fireEvent.click(screen.getByText('更多'))
    fireEvent.click(screen.getByRole('button', { name: '重設臨時密碼' }))

    expect(
      await screen.findByRole('heading', { name: '臨時密碼已重設' }),
    ).toBeVisible()
    expect(screen.getByLabelText('臨時密碼')).toHaveTextContent(
      'reset-once-123',
    )
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith('/api/v1/users/user-1/temporary-password'),
      ),
    ).toHaveLength(1)
    fireEvent.click(
      screen.getByRole('button', { name: '已抄下，回到帳號清單' }),
    )
    expect(await screen.findByRole('heading', { name: '帳號' })).toBeVisible()
    expect(screen.queryByLabelText('臨時密碼')).not.toBeInTheDocument()
  })

  it('shows 複製 again for the second temporary password', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const passwords = ['first-password-1', 'second-password-2']
    let created = 0
    managementFetch({
      onCreate: (body) => ({
        ...regularUser,
        id: `user-new-${created}`,
        username: String(body.username),
        email: String(body.email),
        name_zh: String(body.name_zh),
        temporary_password: passwords[created++],
      }),
    })
    renderAdmin()

    async function createUser(username: string) {
      await createAccountThroughWizard(
        username,
        `${username}@example.com`,
        '測試',
      )
    }

    await createUser('first.user')
    await waitFor(() => {
      expect(screen.getByLabelText('臨時密碼')).toHaveTextContent(passwords[0])
    })
    fireEvent.click(screen.getByRole('button', { name: '複製' }))
    expect(
      await screen.findByRole('button', { name: '已複製' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '回清單' }))
    expect(
      await screen.findByRole('heading', { name: '臨時密碼抄下了嗎？' }),
    ).toBeVisible()
    expect(screen.getByLabelText('臨時密碼')).toHaveTextContent(passwords[0])
    fireEvent.click(screen.getByRole('button', { name: '離開此頁' }))
    await createUser('second.user')
    await waitFor(() => {
      expect(screen.getByLabelText('臨時密碼')).toHaveTextContent(passwords[1])
    })
    expect(screen.getByRole('button', { name: '複製' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '已複製' })).toBeNull()
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('clears the password after immediate navigation', async () => {
    const fetchMock = managementFetch({
      onCreate: (body) => ({
        ...regularUser,
        id: 'user-2',
        username: String(body.username),
        email: String(body.email),
        name_zh: String(body.name_zh),
        temporary_password: 'leave-page-password',
      }),
    })
    const originalFetch = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      const path = new URL(String(input), 'http://testserver').pathname
      if (path === '/api/v1/users/user-2/module-permissions') {
        return Response.json({
          permission_codes: [],
          delegated_modules: [],
        })
      }
      if (path === '/api/v1/users/user-2/participating-projects') {
        return Response.json({ items: [] })
      }
      return originalFetch(input, init)
    })
    renderAdmin()
    await createAccountThroughWizard('bob.lee')
    expect(await screen.findByLabelText('臨時密碼')).toHaveTextContent(
      'leave-page-password',
    )
    expect(
      await screen.findByRole('heading', { name: '帳號已建立', level: 2 }),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('link', { name: '測試 SPA 管理頁導覽' }))
    expect(
      await screen.findByRole('heading', { name: '臨時密碼抄下了嗎？' }),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '留在此頁' }))
    expect(screen.getByLabelText('臨時密碼')).toHaveTextContent(
      'leave-page-password',
    )

    fireEvent.click(screen.getByRole('link', { name: '測試 SPA 管理頁導覽' }))
    fireEvent.click(screen.getByRole('button', { name: '離開此頁' }))
    expect(
      await screen.findByRole('heading', { name: '公司管理' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: '有尚未儲存的變更' }),
    ).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('leave-page-password')).not.toBeInTheDocument()
    expectNoPasswordPersistence('leave-page-password')
  })

  it('clears the temporary password on browser back navigation', async () => {
    managementFetch({
      onCreate: (body) => ({
        ...regularUser,
        id: 'user-2',
        username: String(body.username),
        email: String(body.email),
        name_zh: String(body.name_zh),
        temporary_password: 'back-navigation-password',
      }),
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderAdmin('/accounts', true, {}, false, {
      entries: ['/companies', '/accounts'],
      index: 1,
    })
    await createAccountThroughWizard('bob.lee')
    expect(
      await screen.findByText('back-navigation-password'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '測試瀏覽器上一頁' }))
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith('臨時密碼抄下了嗎？'),
    )
    expect(screen.getByText('back-navigation-password')).toBeInTheDocument()
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '測試瀏覽器上一頁' }))
    expect(
      await screen.findByRole('heading', { name: '公司管理' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('back-navigation-password'),
    ).not.toBeInTheDocument()
    expectNoPasswordPersistence('back-navigation-password')
  })

  it('opens edit and company forms from account details', async () => {
    managementFetch()
    renderAdmin()
    await openAccountDetails('anna.deng', '鄧安娜')

    fireEvent.click(screen.getByRole('button', { name: '修改資料' }))
    const editForm = screen
      .getByRole('heading', { name: '修改帳號資料' })
      .closest('form')!
    expect(editForm).toBeInTheDocument()
    expect(screen.getByLabelText('帳號名稱')).toHaveValue('anna.deng')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    openAccountMoreActions()
    fireEvent.click(screen.getByRole('button', { name: '修改公司連結' }))
    const companyForm = screen
      .getByRole('heading', { name: '連結公司' })
      .closest('form')!
    await within(companyForm).findByRole('option', { name: '示範公司' })
    expect(within(companyForm).getByLabelText('公司')).toHaveValue('company-1')
  })

  it('shows company and department together in the user list', async () => {
    managementFetch({
      userRows: [
        builtInUser,
        regularUser,
        { ...regularUser, id: 'user-2', username: 'bob', department: null },
      ],
    })
    renderAdmin()
    const row = await screen.findByRole('row', { name: /anna\.deng/ })
    expect(within(row).getByText('示範公司／工程部')).toBeVisible()
    const noDepartment = screen.getByRole('row', { name: /bob/ })
    expect(within(noDepartment).getByText('示範公司')).toBeVisible()
    expect(
      within(screen.getByRole('row', { name: /admin/ })).getByText('未連結'),
    ).toBeVisible()
  })

  it('marks the current page in the navigation', async () => {
    managementFetch()
    renderAdmin('/companies')
    const nav = await screen.findByRole('navigation', { name: '管理功能' })
    const management = within(nav).getByRole('button', { name: /管理/ })
    expect(management).toHaveAttribute('aria-current', 'page')
    fireEvent.click(management)
    expect(within(nav).getByRole('link', { name: '公司' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      within(nav).getByRole('link', { name: '帳號' }),
    ).not.toHaveAttribute('aria-current')
  })

  it('opens the audit log page from the Admin navigation', async () => {
    const fetchMock = managementFetch()
    renderAdmin('/logs')

    expect(
      await screen.findByRole('heading', { name: '操作紀錄' }),
    ).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: '管理功能' })
    expect(within(nav).getByRole('button', { name: /管理/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    fireEvent.click(within(nav).getByRole('button', { name: /管理/ }))
    expect(within(nav).getByRole('link', { name: '紀錄' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes('/audit-logs?'),
        ),
      ).toBe(true)
    })
  })

  it('clears company fields when switching to another company', async () => {
    const secondCompany = { ...company, id: 'company-2', name: '第二家公司' }
    const fetchMock = managementFetch({
      companyRows: [company, secondCompany],
    })
    renderAdmin()
    await openAccountDetails('anna.deng', '鄧安娜')
    openAccountMoreActions()
    fireEvent.click(screen.getByRole('button', { name: '修改公司連結' }))
    const form = within(
      screen.getByRole('heading', { name: '連結公司' }).closest('form')!,
    )
    await form.findByRole('option', { name: '第二家公司' })
    expect(form.getByLabelText('部門')).toHaveValue('工程部')
    fireEvent.change(form.getByLabelText('公司'), {
      target: { value: 'company-2' },
    })
    expect(form.getByLabelText('部門')).toHaveValue('')
    expect(form.getByLabelText('地點')).toHaveValue('')
    expect(form.getByLabelText('工號')).toHaveValue('')
    fireEvent.click(form.getByRole('button', { name: '儲存公司連結' }))
    await waitFor(() => {
      const request = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith('/users/user-1/company') &&
          init?.method === 'PUT',
      )
      expect(JSON.parse(String(request?.[1]?.body))).toEqual({
        company_id: 'company-2',
        department: null,
        location: null,
        employee_no: null,
      })
    })
  })

  it('patches fields when the company stays the same', async () => {
    const fetchMock = managementFetch()
    renderAdmin()
    await openAccountDetails('anna.deng', '鄧安娜')
    openAccountMoreActions()
    fireEvent.click(screen.getByRole('button', { name: '修改公司連結' }))
    const form = within(
      screen.getByRole('heading', { name: '連結公司' }).closest('form')!,
    )
    fireEvent.change(form.getByLabelText('部門'), {
      target: { value: '產品部' },
    })
    fireEvent.click(form.getByRole('button', { name: '儲存公司連結' }))
    await waitFor(() => {
      const request = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith('/users/user-1') && init?.method === 'PATCH',
      )
      expect(JSON.parse(String(request?.[1]?.body))).toEqual({
        department: '產品部',
        location: '台北',
        employee_no: 'E001',
      })
    })
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith('/users/user-1/company'),
      ),
    ).toBe(false)
  })

  it('translates API conflicts to a Traditional Chinese message', async () => {
    managementFetch()
    renderAdmin()
    await createAccountThroughWizard('bob.lee', 'anna@example.com')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Email 已被使用。',
    )
  })

  it('keeps a failed admin action beside its confirmation', async () => {
    managementFetch({ failAdminAction: true })
    renderAdmin()
    await openAccountDetails('anna.deng', '鄧安娜')
    openAccountMoreActions()
    fireEvent.click(screen.getByRole('button', { name: '指派管理者' }))
    const confirmation = screen.getByRole('region', { name: '操作確認' })
    // 確認與取消固定排成 [取消][確認]，只有最終確認是危險色（#500）。
    const buttons = within(confirmation).getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual([
      '取消',
      '確認',
    ])
    // 指派管理者是授予權限，確認用主要色；停用與收回才用危險色。
    expect(buttons[1]).toHaveClass('btn-primary')
    expect(buttons[0]).not.toHaveClass('btn-danger', 'btn-primary')
    // ConfirmBox 的初始焦點由 effect 設定，等待它完成後再檢查。
    await waitFor(() =>
      expect(
        within(confirmation).getByRole('button', { name: '取消' }),
      ).toHaveFocus(),
    )
    fireEvent.click(
      within(confirmation).getByRole('button', {
        name: '確認',
      }),
    )
    expect(await within(confirmation).findByRole('alert')).toHaveTextContent(
      '內建 admin 帳號不可修改或停用。',
    )
    expect(confirmation).toBeInTheDocument()
    expect(within(confirmation).getAllByRole('alert')).toHaveLength(1)
  })

  it('edits users and toggles admin and active status', async () => {
    const fetchMock = managementFetch()
    renderAdmin()
    await openAccountDetails('anna.deng', '鄧安娜')
    fireEvent.click(screen.getByRole('button', { name: '修改資料' }))
    const editForm = screen
      .getByRole('heading', { name: '修改帳號資料' })
      .closest('form')
    expect(editForm).not.toBeNull()
    fireEvent.change(
      within(editForm as HTMLFormElement).getByLabelText('帳號名稱'),
      {
        target: { value: 'anna.new' },
      },
    )
    fireEvent.click(
      within(editForm as HTMLFormElement).getByRole('button', {
        name: '儲存資料',
      }),
    )
    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: '修改帳號資料' }),
      ).not.toBeInTheDocument()
    })
    expect(screen.getByText('帳號：anna.new')).toBeInTheDocument()
    openAccountMoreActions()
    fireEvent.click(screen.getByRole('button', { name: '指派管理者' }))
    const assignment = screen.getByRole('region', { name: '操作確認' })
    expect(assignment).toHaveTextContent('anna.new')
    expect(assignment).toHaveTextContent('系統全部權限')
    // 授予權限用主要色；立刻剝奪他人存取的動作才用危險色（#500）。
    expect(
      within(assignment).getByRole('button', { name: '確認' }),
    ).toHaveClass('btn-primary')
    // 同一列換另一個動作時確認框重新掛載，焦點回到取消（#501 審查）。
    await waitFor(() =>
      expect(
        within(assignment).getByRole('button', { name: '取消' }),
      ).toHaveFocus(),
    )
    ;(document.activeElement as HTMLElement).blur()
    fireEvent.click(screen.getByRole('button', { name: '停用帳號' }))
    const switched = screen.getByRole('region', { name: '操作確認' })
    expect(switched).toHaveTextContent('停用 anna.new')
    await waitFor(() =>
      expect(
        within(switched).getByRole('button', { name: '取消' }),
      ).toHaveFocus(),
    )
    fireEvent.click(within(switched).getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '指派管理者' }))
    fireEvent.click(
      within(screen.getByRole('region', { name: '操作確認' })).getByRole(
        'button',
        { name: '取消' },
      ),
    )
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith('/users/user-1/admin') &&
          init?.method === 'PUT',
      ),
    ).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '指派管理者' }))
    fireEvent.click(
      within(screen.getByRole('region', { name: '操作確認' })).getByRole(
        'button',
        { name: '確認' },
      ),
    )
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '收回管理者' }),
      ).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '收回管理者' }))
    expect(screen.getByRole('region', { name: '操作確認' })).toHaveTextContent(
      'anna.new',
    )
    expect(
      within(screen.getByRole('region', { name: '操作確認' })).getByRole(
        'button',
        { name: '確認' },
      ),
    ).toHaveClass('btn-danger')
    const adminActionsBeforeCancel = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith('/users/user-1/admin') && init?.method === 'PUT',
    ).length
    fireEvent.click(
      within(screen.getByRole('region', { name: '操作確認' })).getByRole(
        'button',
        { name: '取消' },
      ),
    )
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith('/users/user-1/admin') &&
          init?.method === 'PUT',
      ),
    ).toHaveLength(adminActionsBeforeCancel)
    fireEvent.click(screen.getByRole('button', { name: '收回管理者' }))
    fireEvent.click(
      within(screen.getByRole('region', { name: '操作確認' })).getByRole(
        'button',
        { name: '確認' },
      ),
    )
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '指派管理者' }),
      ).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '停用帳號' }))
    const deactivation = screen.getByRole('region', { name: '操作確認' })
    expect(deactivation).toHaveTextContent('anna.new')
    expect(deactivation).toHaveTextContent('無法登入')
    expect(
      within(deactivation).getByRole('button', { name: '確認' }),
    ).toHaveClass('btn-danger')
    fireEvent.click(within(deactivation).getByRole('button', { name: '取消' }))
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith('/users/user-1/active') &&
          init?.method === 'PUT',
      ),
    ).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '停用帳號' }))
    const disableConfirmation = screen.getByRole('region', {
      name: '操作確認',
    })
    await waitFor(() =>
      expect(
        within(disableConfirmation).getByRole('button', { name: '確認' }),
      ).toBeEnabled(),
    )
    fireEvent.click(
      within(disableConfirmation).getByRole('button', { name: '確認' }),
    )
    await waitFor(() => {
      expect(screen.getByText('狀態：已停用')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '啟用帳號' }))
    const activation = screen.getByRole('region', { name: '操作確認' })
    await waitFor(() =>
      expect(
        within(activation).getByRole('button', { name: '確認' }),
      ).toBeEnabled(),
    )
    fireEvent.click(within(activation).getByRole('button', { name: '確認' }))
    await waitFor(() => {
      expect(screen.getByText('狀態：啟用中')).toBeInTheDocument()
    })

    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith('/users/user-1') && init?.method === 'PATCH',
      ),
    ).toBe(true)
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith('/users/user-1/admin') &&
          init?.method === 'PUT',
      ),
    ).toBe(true)
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith('/users/user-1/active') &&
          init?.method === 'PUT',
      ),
    ).toHaveLength(1)
    const restoreRequest = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/users/user-1:reactivate') &&
        init?.method === 'POST',
    )
    expect(JSON.parse(String(restoreRequest?.[1]?.body))).toEqual({
      restore: {
        permission_codes: [],
        delegated_modules: [],
        project_ids: [],
        task_ids: [],
      },
    })
  })

  it('enables and clears fields for linked companies', async () => {
    const fetchMock = managementFetch()
    renderAdmin()
    await openAccountDetails('anna.deng', '鄧安娜')
    openAccountMoreActions()
    fireEvent.click(screen.getByRole('button', { name: '修改公司連結' }))
    const linkForm = screen
      .getByRole('heading', { name: '連結公司' })
      .closest('form')
    expect(linkForm).not.toBeNull()
    const form = within(linkForm as HTMLFormElement)
    const department = form.getByLabelText('部門')
    expect(department).toBeEnabled()
    fireEvent.change(form.getByLabelText('公司'), {
      target: { value: '' },
    })
    expect(department).toBeDisabled()
    expect(department).toHaveValue('')
    expect(form.getByLabelText('地點')).toHaveValue('')
    expect(form.getByLabelText('工號')).toHaveValue('')
    fireEvent.click(form.getByRole('button', { name: '儲存公司連結' }))

    await waitFor(() => {
      const request = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith('/users/user-1/company') &&
          init?.method === 'PUT',
      )
      expect(request).toBeDefined()
      expect(JSON.parse(String(request?.[1]?.body))).toEqual({
        company_id: null,
        department: null,
        location: null,
        employee_no: null,
      })
    })
  })

  it('shows a clear no-permission page to non-admin users', () => {
    managementFetch()
    renderAdmin('/accounts', false)
    expect(screen.getByRole('heading', { name: '無權限' })).toBeInTheDocument()
  })

  it.each(['/accounts', '/accounts/user-1', '/companies', '/roles', '/logs'])(
    'denies non-admin access to protected route %s',
    (path) => {
      managementFetch()
      renderAdmin(path, false)
      expect(
        screen.getByRole('heading', { name: '無權限' }),
      ).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: '紀錄' })).toBeNull()
    },
  )

  it('guards dirty planning forms from sidebar and top nav', async () => {
    const fetchMock = managementFetch()
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      const path = new URL(String(input), 'http://testserver').pathname
      if (path === '/api/v1/projects/project-demo-1') {
        return Response.json({ id: 'project-demo-1', name: '示範工程' })
      }
      if (
        path.endsWith('/zones') ||
        path.endsWith('/inspection-task-assignees')
      ) {
        return Response.json([])
      }
      if (path.endsWith('/inspection-plans')) {
        return Response.json({ items: [], next_cursor: null })
      }
      return original(input, init)
    })
    renderAdmin('/projects/project-demo-1/planning')

    await screen.findByRole('heading', { name: '計畫與任務' })
    const planName = await screen.findByLabelText(/計畫名稱/)
    fireEvent.change(planName, {
      target: { value: '尚未儲存的計畫名稱' },
    })

    const sections = screen.getByRole('navigation', { name: '專案區段' })
    const planningLink = within(sections).getByRole('link', {
      name: '計畫與任務',
    })
    fireEvent.click(planningLink)
    const selfLinkPrompt = await screen.findByRole('group', {
      name: '有尚未儲存的變更',
    })
    fireEvent.click(
      within(selfLinkPrompt).getByRole('button', { name: '保留編輯' }),
    )
    expect(planName).toHaveValue('尚未儲存的計畫名稱')

    const adminNav = screen.getByRole('navigation', { name: '管理功能' })
    fireEvent.click(within(adminNav).getByRole('link', { name: '專案' }))
    const topNavPrompt = await screen.findByRole('group', {
      name: '有尚未儲存的變更',
    })
    fireEvent.click(
      within(topNavPrompt).getByRole('button', { name: '保留編輯' }),
    )
    expect(planName).toHaveValue('尚未儲存的計畫名稱')

    const projectHomeLink = within(sections).getByRole('link', {
      name: '專案首頁',
    })
    fireEvent.click(projectHomeLink)
    fireEvent.click(
      within(
        await screen.findByRole('group', { name: '有尚未儲存的變更' }),
      ).getByRole('button', { name: '捨棄變更' }),
    )
    expect(
      await screen.findByRole('heading', { name: '專案首頁' }),
    ).toBeVisible()
  })

  it('allows non-admin users to open project planning routes', async () => {
    managementFetch()
    renderAdmin('/projects/project-demo-1/planning', false)

    expect(
      await screen.findByRole('heading', { name: '計畫與任務' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'DEMO-001｜示範工程' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '計畫與任務', current: 'page' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '無權限' })).toBeNull()
    expect(screen.queryByRole('link', { name: '帳號' })).toBeNull()
  })

  it('returns 404 for the retired project template shortcut', () => {
    managementFetch({ memberProjectIds: ['project-demo-1'] })
    renderAdmin('/projects/project-demo-1/templates')

    expect(
      screen.getByRole('heading', { name: '找不到這個頁面' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('pathname')).toHaveTextContent(
      '/projects/project-demo-1/templates',
    )
  })

  it('allows a non-member template manager to browse without workflow summary', async () => {
    const fetchMock = managementFetch()
    renderAdmin('/projects/project-demo-1/inspection-items/templates', false, {
      can_manage_template_library: true,
      module_permissions: ['template.manage'],
    })

    expect(
      await screen.findByRole('region', { name: '範本操作' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('DEMO-001｜示範工程')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回範本管理' })).toHaveAttribute(
      'href',
      '/templates',
    )
    expect(
      screen.queryByRole('link', {
        name: '返回查核項目',
      }),
    ).not.toBeInTheDocument()
    const navigation = screen.getByRole('complementary', {
      name: '範本庫導覽',
    })
    fireEvent.click(
      await within(navigation).findByRole('button', { name: '土木工程' }),
    )
    fireEvent.click(
      await within(navigation).findByRole('button', { name: '護欄' }),
    )
    await within(navigation).findByRole('button', { name: '欄杆尺寸' })
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith('/workflow-summary'),
      ),
    ).toBe(false)
    expect(
      screen.queryByRole('button', { name: '套用至專案' }),
    ).not.toBeInTheDocument()
    expect(
      await screen.findByText('你沒有修改此專案查核項目的權限。'),
    ).toBeInTheDocument()
    // 非成員沒有專案頁框，套用頁標題就是整頁唯一的 h1（F-O08）。
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(
      screen.getByRole('heading', { level: 1, name: '套用範本到專案' }),
    ).toBeInTheDocument()
  })

  it('現場-only 成員開套用頁時會導回權限落點', async () => {
    const fetchMock = managementFetch({
      memberProjectIds: ['project-demo-1'],
      viewerPermissionCodes: ['inspection_task.inspect'],
    })
    const signedInUser = {
      ...currentUser,
      is_admin: false,
      has_office_access: false,
      has_field_access: true,
      can_inspect_tasks: true,
      can_create_project: false,
      has_project_access: false,
      has_template_access: false,
    }
    render(
      <DataMemoryRouter
        initialEntries={[
          '/projects/project-demo-1/inspection-items/templates',
        ]}
      >
        <CurrentUserProvider value={{ user: signedInUser, clear: vi.fn() }}>
          <Routes>
            <Route element={<AdminPage />} path="/*" />
          </Routes>
          <TestNavigation />
        </CurrentUserProvider>
      </DataMemoryRouter>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('pathname')).toHaveTextContent('/tasks'),
    )
    expect(
      screen.queryByRole('region', { name: '範本操作' }),
    ).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith('/workflow-summary'),
      ),
    ).toBe(false)
  })

  it('opens template bypass for a non-member manager', async () => {
    managementFetch()
    renderAdmin('/projects/project-demo-1/inspection-items/templates', false, {
      has_office_access: false,
      has_field_access: false,
      can_inspect_tasks: false,
      can_manage_template_library: true,
      can_browse_templates: true,
      module_permissions: ['template.manage'],
    })

    expect(await screen.findByText('DEMO-001｜示範工程')).toBeVisible()
    expect(screen.getByRole('link', { name: '返回範本管理' })).toHaveAttribute(
      'href',
      '/templates',
    )
  })

  it('blocks field-only manager bypass for project members', async () => {
    const fetchMock = managementFetch({
      memberProjectIds: ['project-demo-1'],
      viewerPermissionCodes: ['inspection_task.inspect'],
    })
    const signedInUser = {
      ...currentUser,
      is_admin: false,
      has_office_access: false,
      has_field_access: true,
      can_inspect_tasks: true,
      can_create_project: false,
      has_project_access: false,
      has_template_access: true,
      can_browse_templates: true,
      can_manage_template_library: true,
      module_permissions: ['template.manage'],
    }
    render(
      <DataMemoryRouter
        initialEntries={[
          '/projects/project-demo-1/inspection-items/templates',
        ]}
      >
        <CurrentUserProvider value={{ user: signedInUser, clear: vi.fn() }}>
          <Routes>
            <Route element={<AdminPage />} path="/*" />
          </Routes>
          <TestNavigation />
        </CurrentUserProvider>
      </DataMemoryRouter>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('pathname')).toHaveTextContent('/tasks'),
    )
    expect(
      screen.queryByRole('region', { name: '範本操作' }),
    ).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith('/workflow-summary'),
      ),
    ).toBe(true)
  })

  it('opens the template apply route for template.use members', async () => {
    const fetchMock = managementFetch({
      memberProjectIds: ['project-demo-1'],
    })
    renderAdmin('/projects/project-demo-1/inspection-items/templates', false, {
      has_office_access: true,
      has_project_access: true,
      has_field_access: false,
      can_inspect_tasks: false,
      has_template_access: false,
      can_browse_templates: true,
    })

    expect(
      await screen.findByRole('region', { name: '範本操作' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'DEMO-001｜示範工程' }),
    ).toBeInTheDocument()
    // 專案頁框已有 h1，套用頁標題降為 h2，整頁只有一個 h1（F-O08）。
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: '套用範本到專案',
      }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const permissionCheck = screen.queryByText('正在確認專案權限…')
    expect(permissionCheck).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith('/workflow-summary'),
      ),
    ).toBe(true)
  })

  it('template.use-only 使用者不能進入範本管理頁', () => {
    const fetchMock = managementFetch()
    renderAdmin('/templates', false, {
      has_template_access: false,
      can_browse_templates: true,
      can_manage_template_library: false,
      is_external_collaborator: true,
    })

    expect(screen.getByRole('heading', { name: '無權限' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      '你沒有權限瀏覽範本庫。',
    )
    expect(screen.queryByRole('link', { name: '範本' })).toBeNull()
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes('/api/v1/template-categories'),
      ),
    ).toBe(false)
  })

  describe('non-admin navigation (#480)', () => {
    const nav = () => screen.getByRole('navigation', { name: '管理功能' })
    const labels = () =>
      within(nav())
        .queryAllByRole('link')
        .map((link) => link.textContent)

    it.each([
      ['內業工程師', '/projects', { has_project_access: true }, ['專案']],
      [
        '現場工程師',
        '/projects',
        { has_field_access: true, can_inspect_tasks: true },
        ['任務'],
      ],
      [
        '範本管理者',
        '/templates',
        {
          can_browse_templates: true,
          can_manage_template_library: true,
        },
        ['範本'],
      ],
      [
        '外部協作',
        '/projects',
        { has_project_access: true, is_external_collaborator: true },
        ['專案'],
      ],
      ['全無權限', '/settings', {}, []],
    ] as const)(
      '%s 只顯示授權導覽，不出現管理入口',
      async (_role, path, access, expected) => {
        managementFetch()
        renderAdmin(path, false, {
          has_office_access: false,
          has_field_access: false,
          can_inspect_tasks: false,
          has_template_access: false,
          has_project_access: false,
          can_create_project: false,
          ...access,
        })

        expect(labels()).toEqual(expected)
        expect(
          within(nav()).queryByRole('button', { name: /管理/ }),
        ).toBeNull()
        for (const label of ['帳號', '公司', '角色', '紀錄']) {
          expect(within(nav()).queryByRole('link', { name: label })).toBeNull()
        }
      },
    )

    it('全專案進度主管只看到總覽與專案', async () => {
      managementFetch()
      renderAdmin('/projects', false, {
        has_office_access: false,
        has_field_access: false,
        can_inspect_tasks: false,
        has_template_access: false,
        can_browse_templates: false,
        can_manage_template_library: false,
        has_project_access: true,
        can_create_project: false,
        module_permissions: ['all_project_progress.read'],
      })

      await screen.findByRole('link', { name: '總覽' })
      expect(labels()).toEqual(['總覽', '專案'])
      expect(within(nav()).queryByRole('button', { name: /管理/ })).toBeNull()
      for (const label of ['任務', '範本', '帳號', '公司', '角色', '紀錄']) {
        expect(within(nav()).queryByRole('link', { name: label })).toBeNull()
      }
    })

    it('project readers see the authorized project entry', async () => {
      managementFetch()
      renderAdmin('/projects', false, {
        has_office_access: false,
        has_field_access: false,
        can_inspect_tasks: false,
        has_template_access: false,
        has_project_access: true,
        can_create_project: false,
      })

      expect(labels()).toEqual(['專案'])
      expect(screen.queryByRole('button', { name: /管理/ })).toBeNull()
      expect(
        await screen.findByRole('heading', { name: '我的專案' }),
      ).toBeInTheDocument()
      expect(await screen.findByText(/目前沒有可檢視的專案/)).toBeVisible()
    })

    it.each([
      ['project reader', { has_project_access: true }],
      ['project creator', { can_create_project: true }],
    ])('shows the projects entry to a %s', async (_label, access) => {
      managementFetch()
      renderAdmin('/projects', false, {
        has_office_access: false,
        has_field_access: false,
        can_inspect_tasks: false,
        has_template_access: false,
        ...access,
      })

      expect(labels()).toEqual(['專案'])
      expect(
        await screen.findByRole('heading', { name: '我的專案' }),
      ).toBeInTheDocument()
    })

    it('shows the notice carried by the previous page (#487)', async () => {
      managementFetch()
      renderAdmin(
        {
          pathname: '/projects',
          state: { notice: '已新增 3 個項目到「示範工程」。' },
        },
        false,
        {
          has_office_access: true,
          has_field_access: false,
          can_inspect_tasks: false,
        },
      )

      const notice = await screen.findByText('已新增 3 個項目到「示範工程」。')
      expect(notice).toHaveAttribute('role', 'status')
    })

    it('never lists admin-only entries for any non-admin', () => {
      managementFetch()
      renderAdmin('/projects', false)

      expect(within(nav()).queryByRole('button', { name: /管理/ })).toBeNull()
    })

    it('shows a direct account link to a delegated account', async () => {
      managementFetch()
      renderAdmin('/accounts', false, {
        delegated_modules: ['template.manage'],
      })
      const navElement = nav()
      expect(
        within(navElement).getByRole('link', { name: '帳號' }),
      ).toHaveAttribute('href', '/accounts')
      expect(
        within(navElement).queryByRole('button', { name: /管理/ }),
      ).toBeNull()
      expect(
        within(navElement).queryByRole('link', { name: '公司' }),
      ).toBeNull()
      expect(
        within(navElement).queryByRole('link', { name: '角色' }),
      ).toBeNull()
      expect(
        within(navElement).queryByRole('link', { name: '紀錄' }),
      ).toBeNull()
    })

    it('opens delegated account list and detail without admin actions', async () => {
      const fetchMock = managementFetch()
      const original = fetchMock.getMockImplementation()!
      fetchMock.mockImplementation(async (input, init) => {
        const path = new URL(String(input), 'http://testserver').pathname
        if (path === '/api/v1/module-delegate/users/user-1') {
          return Response.json({
            id: 'user-1',
            username: 'anna.deng',
            name_zh: '鄧安娜',
          })
        }
        if (
          path === '/api/v1/module-delegate/users' &&
          (init?.method ?? 'GET') === 'GET'
        ) {
          return Response.json({
            items: [
              {
                id: 'user-1',
                username: 'anna.deng',
                name_zh: '鄧安娜',
                is_admin: false,
              },
            ],
            next_cursor: null,
          })
        }
        if (path === '/api/v1/users/user-1/module-permissions') {
          return Response.json({ permission_codes: [], delegated_modules: [] })
        }
        return original(input, init)
      })
      renderAdmin('/accounts', false, {
        delegated_modules: ['template.manage'],
      })

      expect(
        await screen.findByRole('heading', { name: '帳號', level: 1 }),
      ).toBeVisible()
      expect(
        await screen.findByRole('button', { name: '鄧安娜' }),
      ).toBeVisible()
      expect(screen.queryByRole('button', { name: '新增帳號' })).toBeNull()
      expect(screen.queryByRole('heading', { name: '基本資料' })).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: '鄧安娜' }))
      expect(
        await screen.findByRole('heading', { name: '鄧安娜', level: 1 }),
      ).toBeVisible()
      expect(screen.getByRole('heading', { name: '權限' })).toBeVisible()
      expect(screen.getByTestId('pathname')).toHaveTextContent(
        '/accounts/user-1',
      )
      expect(screen.queryByRole('button', { name: '新增帳號' })).toBeNull()
      expect(screen.queryByRole('button', { name: '修改資料' })).toBeNull()
      expect(screen.queryByRole('heading', { name: '基本資料' })).toBeNull()
      expect(
        fetchMock.mock.calls.some(
          ([url]) =>
            new URL(String(url), 'http://testserver').pathname ===
            '/api/v1/users',
        ),
      ).toBe(false)
    })

    it('does not show templates for a template.use-only user', () => {
      managementFetch()
      renderAdmin('/projects', false, {
        has_template_access: false,
        can_browse_templates: true,
        can_manage_template_library: false,
      })
      expect(labels()).not.toContain('範本')
    })

    it('shows task and project links only with their granted access', () => {
      managementFetch()
      renderAdmin('/projects', false, {
        has_office_access: true,
        has_project_access: true,
        has_field_access: true,
        can_inspect_tasks: true,
        has_template_access: false,
      })

      expect(labels()).toEqual(['任務', '專案'])
      expect(screen.getByRole('link', { name: '任務' })).toHaveAttribute(
        'href',
        '/tasks',
      )
    })

    it('explains template management access on /templates', () => {
      managementFetch()
      renderAdmin('/templates', false, {
        has_office_access: true,
        has_project_access: true,
        has_field_access: false,
        can_inspect_tasks: false,
        has_template_access: false,
      })

      expect(screen.getByRole('alert')).toHaveTextContent(
        '你沒有權限瀏覽範本庫。',
      )
    })

    it('does not route to template management without access', () => {
      managementFetch()
      renderAdmin('/templates', false, {
        has_office_access: true,
        has_project_access: true,
        has_field_access: false,
        can_inspect_tasks: false,
        has_template_access: false,
      })

      expect(
        screen.getByRole('heading', { name: '無權限' }),
      ).toBeInTheDocument()
      expect(labels()).toEqual(['專案'])
    })
  })

  it('lets members read items when edit permission is denied', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/workflow-summary')) {
        return Response.json({
          project: {
            id: 'project-1',
            project_code: 'DEMO-001',
            name: '示範工程',
            company_role: 'contractor',
          },
          member_count: 0,
          inspection_item_count: 1,
          zone_count: 0,
          plan_count: 0,
          task_counts: {
            DRAFT: 0,
            PENDING: 0,
            IN_PROGRESS: 0,
            COMPLETED: 0,
            CANCELLED: 0,
          },
          pending_reinspection_task_count: 0,
          next_steps: [],
          primary_step: null,
          task_counts_visible: false,
          draft_tasks_missing_assignee: 0,
          viewer_permission_codes: ['inspection_plan.read'],
        })
      }
      if (url.includes('/inspection-items/item-1/tasks')) {
        return Response.json(
          { error: { code: 'permission.denied' } },
          { status: 403 },
        )
      }
      return Response.json({
        items: [
          {
            id: 'item-1',
            sequence: 1,
            title: '混凝土表面',
            instruction: '檢查表面',
            inspection_points: [],
          },
        ],
        next_cursor: null,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    renderAdmin('/projects/project-1/inspection-items', false)
    fireEvent.click(
      await screen.findByRole('link', {
        name: '檢視「混凝土表面」',
      }),
    )
    expect(await screen.findByText('唯讀瀏覽')).toBeInTheDocument()
    expect(screen.getByLabelText('查核項目名稱')).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('沒有權限修改')
  })

  it('supports creating, renaming, and deactivating a company', async () => {
    const rows = [{ ...company }]
    let nextId = 2
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const parsed = new URL(url, 'http://testserver')
        const method = init?.method ?? 'GET'
        if (parsed.pathname === '/api/v1/companies' && method === 'GET') {
          return Response.json({ items: rows, next_cursor: null })
        }
        if (parsed.pathname === '/api/v1/companies' && method === 'POST') {
          const body = JSON.parse(String(init?.body)) as { name: string }
          rows.push({
            id: `company-${nextId++}`,
            name: body.name,
            is_active: true,
          })
          return Response.json(rows.at(-1), { status: 201 })
        }
        if (url.includes('/companies/company-1') && init?.method === 'PATCH') {
          const body = JSON.parse(String(init.body)) as { name: string }
          rows[0].name = body.name
          return Response.json(rows[0])
        }
        if (url.endsWith('/companies/company-1/active-users')) {
          return Response.json({
            count: 1,
            users: [{ id: 'active-1', username: 'worker', name_zh: '王小明' }],
          })
        }
        if (url.includes('/companies/company-1/active')) {
          const body = JSON.parse(String(init?.body)) as {
            disable_user_ids: string[]
          }
          expect(body.disable_user_ids).toEqual(['active-1'])
          rows[0].is_active = false
          return Response.json(rows[0])
        }
        return Response.json({}, { status: 204 })
      },
    )
    vi.stubGlobal('fetch', fetchMock)
    renderAdmin('/companies')

    expect(await screen.findByText('示範公司')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('公司名稱'), {
      target: { value: '第二家公司' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增公司' }))
    expect(await screen.findByText('第二家公司')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: '改名稱' })[0])
    fireEvent.change(screen.getByLabelText('公司名稱'), {
      target: { value: '更新後公司' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存名稱' }))
    expect(await screen.findByText('更新後公司')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: '停用公司' })[0])
    expect(
      await screen.findByText('還有 1 個啟用中的帳號'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByText('還有 1 個啟用中的帳號')).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith('/companies/company-1/active') &&
          init?.method === 'PUT',
      ),
    ).toBe(false)

    fireEvent.click(screen.getAllByRole('button', { name: '停用公司' })[0])
    expect(
      await screen.findByText('還有 1 個啟用中的帳號'),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '確認停用公司' }),
      ).toBeEnabled()
    })
    fireEvent.click(screen.getByLabelText('王小明（worker）'))
    await waitFor(() => {
      expect(screen.getByLabelText('王小明（worker）')).toBeChecked()
    })
    const deactivateCompany = screen.getByRole('button', {
      name: '確認停用公司',
    })
    expect(deactivateCompany).toHaveClass('btn-danger')
    expect(deactivateCompany.closest('.confirm-box')).toHaveClass(
      'confirm-box-danger',
    )
    fireEvent.click(deactivateCompany)
    await waitFor(() => {
      expect(
        screen.getByText('停用', { selector: '.badge' }),
      ).toBeInTheDocument()
    })
  })

  it('sends an empty disable list when no users are selected', async () => {
    let activeRequestBody: unknown
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const parsed = new URL(url, 'http://testserver')
        if (parsed.pathname === '/api/v1/companies' && !init?.method) {
          return Response.json({ items: [company], next_cursor: null })
        }
        if (url.endsWith('/companies/company-1/active-users')) {
          return Response.json({
            count: 1,
            users: [{ id: 'active-1', username: 'worker', name_zh: '王小明' }],
          })
        }
        if (url.endsWith('/companies/company-1/active')) {
          activeRequestBody = JSON.parse(String(init?.body))
          return Response.json({ ...company, is_active: false })
        }
        return Response.json({}, { status: 204 })
      }),
    )
    renderAdmin('/companies')
    fireEvent.click(await screen.findByRole('button', { name: '停用公司' }))
    expect(
      await screen.findByText('還有 1 個啟用中的帳號'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '確認停用公司' }))
    await waitFor(() => {
      expect(activeRequestBody).toEqual({
        is_active: false,
        disable_user_ids: [],
      })
    })
  })
})

function expectNoPasswordPersistence(password: string) {
  const storedValues = [window.localStorage, window.sessionStorage].flatMap(
    (storage) =>
      Object.keys(storage).flatMap((key) => [key, storage.getItem(key) ?? '']),
  )
  expect(storedValues.join('\n')).not.toContain(password)
  expect(window.location.href).not.toContain(password)
  expect(window.location.search).not.toContain(password)
  expect(window.location.hash).not.toContain(password)
}

describe('management error messages', () => {
  it.each([
    ['request.validation_failed', '資料格式不正確，請檢查輸入內容。'],
    ['resource.not_found', '找不到這筆資料，請重新整理後再試。'],
    ['permission.denied', '你沒有權限執行這項操作。'],
    ['user.builtin_protected', '內建 admin 帳號不可修改或停用。'],
    ['user.last_admin', '系統至少要保留一位啟用中的管理者。'],
    ['user.external_managed', '此帳號的基本資料由外部來源管理。'],
    ['company.inactive', '不能把帳號連結到已停用的公司。'],
    ['user.username_conflict', '帳號名稱已被使用。'],
    ['user.email_conflict', 'Email 已被使用。'],
    ['user.employee_no_conflict', '這家公司已有相同工號。'],
    ['company.name_conflict', '公司名稱已被使用。'],
    ['auth.password_invalid', '密碼長度不符合要求。'],
  ])('maps %s to a Traditional Chinese message', (code, message) => {
    expect(managementErrorMessage(new ManagementApiError(422, code))).toBe(
      message,
    )
  })

  it.each([
    [401, '登入狀態已失效，請重新登入。'],
    [403, '你沒有權限執行這項操作。'],
    [500, '伺服器暫時無法處理，請稍後再試。'],
    [503, '伺服器暫時無法處理，請稍後再試。'],
    [422, '操作失敗，請稍後再試。'],
  ])('maps status %s without a code to a shared message', (status, text) => {
    expect(managementErrorMessage(new ManagementApiError(status))).toBe(text)
  })

  it('treats a non-API failure as a network problem', () => {
    expect(managementErrorMessage(new TypeError('Failed to fetch'))).toBe(
      '無法連線到伺服器，請稍後再試。',
    )
  })
})
