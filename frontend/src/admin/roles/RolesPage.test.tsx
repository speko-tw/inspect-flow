import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { Link, Route, Routes, useNavigate } from 'react-router'
import { DataMemoryRouter } from '../../testing/DataMemoryRouter'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CurrentUser } from '../../auth/api'
import { expectImeEnterIgnored, holdRequests } from '../../testing/submitGuard'
import { CurrentUserProvider } from '../../auth/useCurrentUser'
import AdminPage from '../AdminPage'
import { ManagementApiError } from '../api'
import { roleErrorMessage, type PermissionCode, type Role } from './api'

const MANAGE: PermissionCode = {
  code: 'project_member.manage',
  description: '管理專案成員與其角色',
}
const ALL_PROJECT_PERMISSION_CODES = [
  'project_member.manage',
  'project.update',
  'project.read',
  'project_inspection_item.edit',
  'project_inspection_item.read',
  'project_zone.read',
  'project_zone.manage',
  'inspection_plan.read',
  'inspection_plan.create',
  'inspection_plan.manage',
  'inspection_plan.archive',
  'inspection_plan.unarchive',
  'inspection_task.read',
  'inspection_task.manage',
  'inspection_task.create',
  'inspection_task.dispatch',
  'inspection_task.assign',
  'inspection_task.inspect',
  'inspection_task.delete_draft',
  'inspection_task.cancel',
]
const GROUPED_PERMISSIONS: PermissionCode[] = ALL_PROJECT_PERMISSION_CODES.map(
  (code) => ({
    code,
    description: `權限 ${code}`,
  }),
)
const PERMISSION_GROUP_TITLES = [
  '查核計畫',
  '查核任務',
  '專案',
  '專案查核項目',
  '成員',
  '分區',
]

function makeRole(
  id: string,
  name: string,
  codes: string[] = [],
  usage: { user_count: number; project_count: number } = {
    user_count: 0,
    project_count: 0,
  },
): Role {
  return {
    id,
    name,
    permission_codes: codes,
    inactive_user_count: 0,
    ...usage,
    created_at: '2026-10-01T00:00:00.000000Z',
    updated_at: '2026-10-01T00:00:00.000000Z',
  }
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

function RoleNavigation() {
  const navigate = useNavigate()
  return (
    <>
      <Link to="/accounts">返回帳號</Link>
      <Link replace to="/roles/new">
        前往新增角色
      </Link>
      <button onClick={() => navigate(-1)} type="button">
        上一頁
      </button>
      <button onClick={() => navigate(1)} type="button">
        下一頁
      </button>
    </>
  )
}

function renderRoles(
  path = '/roles',
  history?: { entries: string[]; index: number },
) {
  const view = render(
    <DataMemoryRouter
      initialEntries={history?.entries ?? [path]}
      initialIndex={history?.index}
    >
      <Routes>
        <Route
          element={
            <CurrentUserProvider value={{ user: currentUser, clear: vi.fn() }}>
              <AdminPage />
              <RoleNavigation />
            </CurrentUserProvider>
          }
          path="/*"
        />
      </Routes>
    </DataMemoryRouter>,
  )
  return view
}

async function openNewRole() {
  fireEvent.click(await screen.findByRole('link', { name: '前往新增角色' }))
  await screen.findByLabelText('角色名稱')
}

async function openRoleDetail(name: string) {
  if (screen.queryByRole('heading', { name, level: 1 })) return
  fireEvent.click(await screen.findByRole('link', { name }))
  await screen.findByRole('heading', { name, level: 1 })
}

async function openRoleEditor(name: string) {
  await openRoleDetail(name)
  fireEvent.click(screen.getByRole('link', { name: '修改角色' }))
  await screen.findByLabelText('角色名稱')
}

interface FakeOptions {
  roles?: Role[]
  permissions?: PermissionCode[]
  creatorRoleId?: string
  // 針對指定的 method + 路徑尾端回傳錯誤碼，例如 'POST /roles'。
  failures?: Record<string, { status: number; code: string }>
  pageSize?: number
}

function rolesFetch({
  roles = [],
  permissions = [MANAGE],
  creatorRoleId = '',
  failures = {},
  pageSize = 100,
}: FakeOptions = {}) {
  const rows = roles.map((role) => ({ ...role }))
  let nextId = 1
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const method = init?.method ?? 'GET'
      const path = url.pathname.replace('/api/v1', '')
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Partial<Role> & {
            role_id?: string
          })
        : {}
      const failure = failures[`${method} ${path}`]
      if (failure) {
        return Response.json(
          { error: { code: failure.code } },
          { status: failure.status },
        )
      }
      if (method === 'GET' && path === '/roles/permission-codes') {
        return Response.json({ items: permissions })
      }
      if (path === '/roles/creator-role') {
        if (method === 'GET') {
          return Response.json({ role_id: creatorRoleId })
        }
        if (method === 'PATCH') {
          return Response.json({ role_id: body.role_id })
        }
      }
      if (method === 'GET' && path === '/roles') {
        const start = Number(url.searchParams.get('cursor') ?? 0)
        const items = rows.slice(start, start + pageSize)
        const end = start + pageSize
        return Response.json({
          items,
          next_cursor: end < rows.length ? String(end) : null,
        })
      }
      if (method === 'POST' && path === '/roles') {
        const created = makeRole(
          `new-${nextId++}`,
          String(body.name),
          body.permission_codes ?? [],
        )
        rows.push(created)
        return Response.json(created, { status: 201 })
      }
      const row = rows.find((item) => path === `/roles/${item.id}`)
      if (!row) {
        return Response.json(
          { error: { code: 'role.not_found' } },
          { status: 404 },
        )
      }
      if (method === 'GET') {
        return Response.json(row)
      }
      if (method === 'PATCH') {
        Object.assign(row, body)
        return Response.json(row)
      }
      if (method === 'DELETE') {
        rows.splice(rows.indexOf(row), 1)
        return new Response(null, { status: 204 })
      }
      return Response.json({}, { status: 500 })
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function calls(
  fetchMock: ReturnType<typeof rolesFetch>,
  method: string,
): Array<[string, RequestInit | undefined]> {
  return fetchMock.mock.calls
    .filter(([, init]) => (init?.method ?? 'GET') === method)
    .map(([input, init]) => [String(input), init])
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('角色表單未儲存導覽防護', () => {
  async function fillName() {
    fireEvent.change(await screen.findByLabelText('角色名稱'), {
      target: { value: '未儲存角色' },
    })
  }

  it('實際輸入後攔截站內導覽與 Back/Forward', async () => {
    rolesFetch()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderRoles('/roles/new', {
      entries: ['/accounts', '/roles/new', '/companies'],
      index: 1,
    })
    await screen.findByRole('heading', { name: '新增角色' })
    await fillName()

    fireEvent.click(screen.getByRole('link', { name: '返回帳號' }))
    expect(
      await screen.findByRole('heading', { name: '有尚未儲存的變更' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保留編輯' }))

    confirm.mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: '上一頁' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(
      screen.getByRole('heading', { name: '新增角色' }),
    ).toBeInTheDocument()

    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '下一頁' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2))
    expect(
      await screen.findByRole('heading', { name: '公司管理' }),
    ).toBeInTheDocument()
  })

  it('編輯既有角色時以原始值判斷 dirty state', async () => {
    rolesFetch({ roles: [makeRole('role-1', '檢視者')] })
    renderRoles()
    await screen.findByRole('row', { name: /檢視者/ })
    await openRoleEditor('檢視者')
    fireEvent.change(screen.getByLabelText('角色名稱'), {
      target: { value: '未儲存檢視者' },
    })
    const event = new Event('beforeunload', { cancelable: true })

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('新增角色是主要按鈕，表單展開後讓位給建立角色', async () => {
    rolesFetch({ roles: [makeRole('role-1', '檢視者')] })
    renderRoles('/roles')
    await screen.findByRole('heading', { name: '專案角色' })
    const create = screen.getByRole('link', { name: '新增角色' })
    expect(create).toHaveClass('btn-primary')

    fireEvent.click(create)

    expect(await screen.findByLabelText('角色名稱')).toHaveValue('')
    expect(screen.queryByRole('link', { name: '新增角色' })).toBeNull()
    expect(screen.getByRole('button', { name: '建立角色' })).toHaveClass(
      'btn-primary',
    )
    expect(document.querySelectorAll('.btn-primary')).toHaveLength(1)
  })

  it('未修改角色時可直接切換到新增表單', async () => {
    rolesFetch({ roles: [makeRole('role-1', '檢視者')] })
    renderRoles()
    await screen.findByRole('row', { name: /檢視者/ })
    await openRoleEditor('檢視者')
    await openNewRole()

    expect(
      await screen.findByRole('heading', { name: '新增角色' }),
    ).toBeVisible()
    expect(screen.getByLabelText('角色名稱')).toHaveValue('')
    expect(
      screen.queryByRole('region', { name: '有尚未儲存的變更' }),
    ).toBeNull()
  })

  it('新增表單已有內容時再次按新增不清除草稿', async () => {
    rolesFetch({ roles: [makeRole('role-1', '檢視者')] })
    renderRoles('/roles/new')
    await screen.findByRole('heading', { name: '新增角色' })
    await openNewRole()
    fireEvent.change(screen.getByLabelText('角色名稱'), {
      target: { value: '新草稿' },
    })
    await openNewRole()

    expect(screen.getByLabelText('角色名稱')).toHaveValue('新草稿')
  })

  it('修改角色後切換新增可取消並保留編輯內容', async () => {
    rolesFetch({ roles: [makeRole('role-1', '檢視者')] })
    renderRoles()
    await screen.findByRole('row', { name: /檢視者/ })
    await openRoleEditor('檢視者')
    fireEvent.change(screen.getByLabelText('角色名稱'), {
      target: { value: '修改中的檢視者' },
    })
    await openNewRole()

    expect(
      await screen.findByRole('heading', { name: '有尚未儲存的變更' }),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '保留編輯' }))
    expect(screen.getByLabelText('角色名稱')).toHaveValue('修改中的檢視者')
    expect(
      screen.getByRole('heading', { name: '修改角色「檢視者」' }),
    ).toBeVisible()
  })

  it('確認捨棄角色編輯後清空欄位並開啟新增表單', async () => {
    rolesFetch({ roles: [makeRole('role-1', '檢視者')] })
    renderRoles()
    await screen.findByRole('row', { name: /檢視者/ })
    await openRoleEditor('檢視者')
    fireEvent.change(screen.getByLabelText('角色名稱'), {
      target: { value: '修改中的檢視者' },
    })
    await openNewRole()
    await screen.findByRole('heading', { name: '有尚未儲存的變更' })
    fireEvent.click(screen.getByRole('button', { name: '捨棄變更' }))

    expect(
      await screen.findByRole('heading', { name: '新增角色' }),
    ).toBeVisible()
    expect(screen.getByLabelText('角色名稱')).toHaveValue('')
  })

  it('實際輸入後攔截 beforeunload', async () => {
    rolesFetch()
    renderRoles('/roles/new')
    await screen.findByRole('heading', { name: '新增角色' })
    await fillName()
    const event = new Event('beforeunload', { cancelable: true })

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })
})

describe('admin role management page', () => {
  it('先顯示角色與持有人數，設定與新增區預設收合', async () => {
    rolesFetch({
      roles: [
        makeRole('r1', '專案工程師', [], {
          user_count: 4,
          project_count: 2,
        }),
      ],
    })
    renderRoles('/roles')

    const row = await screen.findByRole('row', { name: /專案工程師/ })
    expect(row).toHaveTextContent('4 個帳號')
    expect(
      screen.getByRole('button', { name: '設定新專案預設角色' }),
    ).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('link', { name: '新增角色' })).toHaveAttribute(
      'href',
      '/roles/new',
    )
    expect(screen.queryByLabelText('角色名稱')).not.toBeInTheDocument()
  })

  it('管理→角色→現場工程師持有人數只需兩次點擊', async () => {
    rolesFetch({
      roles: [
        makeRole('r1', '現場工程師', [], { user_count: 3, project_count: 2 }),
        makeRole('r2', 'Coordinator', [MANAGE.code]),
      ],
    })
    renderRoles('/accounts')

    fireEvent.click(screen.getByRole('button', { name: /管理/ }))
    fireEvent.click(screen.getByRole('link', { name: '角色' }))

    expect(
      await screen.findByRole('heading', { name: '專案角色' }),
    ).toBeInTheDocument()
    const coordinator = await screen.findByRole('row', {
      name: /Coordinator/,
    })
    expect(coordinator).toHaveTextContent('管理專案成員與其角色')
    const fieldRole = screen.getByRole('row', { name: /現場工程師/ })
    expect(fieldRole).toHaveTextContent('3 個帳號')
    expect(
      within(fieldRole).getByRole('link', { name: '現場工程師' }),
    ).toHaveAttribute('href', '/roles/r1')
    expect(screen.queryByText(/權限組合/)).toBeNull()
  })

  it('編輯可指派與外部協作帳號可用旗標', async () => {
    const fetchMock = rolesFetch({
      roles: [
        {
          ...makeRole('r1', '現場工程師'),
          is_assignable: true,
          is_external_allowed: false,
        },
      ],
    })
    renderRoles()

    await openRoleEditor('現場工程師')
    const assignable = screen.getByRole('checkbox', {
      name: '非管理者可指派',
    })
    const external = screen.getByRole('checkbox', {
      name: '外部協作帳號可用',
    })
    expect(assignable).toBeChecked()
    expect(external).not.toBeChecked()
    fireEvent.click(assignable)
    fireEvent.click(external)
    fireEvent.click(screen.getByRole('button', { name: '儲存角色' }))
    fireEvent.click(
      await screen.findByRole('button', { name: '確認修改角色' }),
    )

    await waitFor(() => expect(calls(fetchMock, 'PATCH')).toHaveLength(1))
    expect(JSON.parse(String(calls(fetchMock, 'PATCH')[0][1]?.body))).toEqual({
      is_assignable: false,
      is_external_allowed: true,
    })
  })

  it('顯示並更新新專案預設角色', async () => {
    const fetchMock = rolesFetch({
      roles: [makeRole('r1', '專案工程師'), makeRole('r2', '現場工程師')],
      creatorRoleId: 'r1',
    })
    renderRoles()

    fireEvent.click(screen.getByRole('button', { name: '設定新專案預設角色' }))
    const select = await screen.findByRole('combobox', {
      name: '新專案預設角色',
    })
    expect(select).toHaveValue('r1')
    fireEvent.change(select, { target: { value: 'r2' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存預設角色' }))

    await waitFor(() =>
      expect(
        calls(fetchMock, 'PATCH').some(([url]) =>
          url.endsWith('/roles/creator-role'),
        ),
      ).toBe(true),
    )
    const [[url, init]] = calls(fetchMock, 'PATCH').filter(([target]) =>
      target.endsWith('/roles/creator-role'),
    )
    expect(url).toBe('/api/v1/roles/creator-role')
    expect(JSON.parse(String(init?.body))).toEqual({ role_id: 'r2' })
  })

  it('keeps the role name column from wrapping (#526)', async () => {
    rolesFetch({ roles: [makeRole('r1', '示範內業')] })
    renderRoles()
    const table = await screen.findByRole('table')
    expect(table).toHaveClass('roles-table')
  })

  it('expands a summary to full permission descriptions', async () => {
    rolesFetch({
      roles: [makeRole('r1', '示範內業', [MANAGE.code])],
    })
    renderRoles()

    const row = await screen.findByRole('row', { name: /示範內業/ })
    const button = within(row).getByRole('button', {
      name: '「示範內業」完整權限',
    })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(within(row).getByText('管理專案成員與其角色')).toBeVisible()
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows a placeholder when no permission can be configured', async () => {
    rolesFetch({ permissions: [] })
    renderRoles('/roles/new')

    expect(
      await screen.findByText('目前尚無可設定的權限，功能上線後會出現'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: '返回角色清單' }))
    expect(await screen.findByText('目前沒有角色。')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('groups permissions in six project categories', async () => {
    rolesFetch({ permissions: GROUPED_PERMISSIONS })
    renderRoles('/roles/new')

    for (const title of PERMISSION_GROUP_TITLES) {
      expect(await screen.findByRole('group', { name: title })).toBeVisible()
    }
    const groupedCodes = PERMISSION_GROUP_TITLES.flatMap((title) =>
      within(screen.getByRole('group', { name: title }))
        .getAllByRole('checkbox')
        .map((input) => (input as HTMLInputElement).value),
    )
    expect(groupedCodes.sort()).toEqual(
      [...ALL_PROJECT_PERMISSION_CODES].sort(),
    )
  })

  it('keeps unclassified permissions in an other group', async () => {
    rolesFetch({
      permissions: [
        { code: 'legacy_report.read', description: '讀取舊式報告' },
      ],
    })
    renderRoles('/roles/new')

    expect(
      within(await screen.findByRole('group', { name: '其他' })).getByRole(
        'checkbox',
        { name: '讀取舊式報告' },
      ),
    ).toBeVisible()
  })

  it('lets the user cancel a new role form without saving', async () => {
    const fetchMock = rolesFetch()
    renderRoles('/roles/new')

    fireEvent.change(await screen.findByLabelText('角色名稱'), {
      target: { value: '未儲存角色' },
    })
    fireEvent.click(screen.getByRole('link', { name: '取消' }))
    await screen.findByRole('heading', { name: '有尚未儲存的變更' })
    fireEvent.click(screen.getByRole('button', { name: '捨棄變更' }))
    await screen.findByRole('heading', { name: '專案角色' })
    expect(screen.queryByLabelText('角色名稱')).not.toBeInTheDocument()
    expect(calls(fetchMock, 'POST')).toHaveLength(0)
    expect(screen.getByRole('link', { name: '新增角色' })).toBeVisible()
  })

  it('creates a role with the checked permissions', async () => {
    const fetchMock = rolesFetch()
    renderRoles('/roles/new')

    fireEvent.change(await screen.findByLabelText('角色名稱'), {
      target: { value: '  Site Lead  ' },
    })
    fireEvent.click(
      await screen.findByRole('checkbox', { name: '管理專案成員與其角色' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '建立角色' }))

    await screen.findByRole('heading', { name: 'Site Lead', level: 1 })
    fireEvent.click(screen.getByRole('link', { name: '返回角色清單' }))
    expect(
      await screen.findByRole('row', { name: /Site Lead/ }),
    ).toHaveTextContent('管理專案成員與其角色')
    const [[, init]] = calls(fetchMock, 'POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      name: 'Site Lead',
      permission_codes: [MANAGE.code],
    })
    await openNewRole()
    expect(screen.getByLabelText('角色名稱')).toHaveValue('')
  })

  it('confirms the fresh impact before saving changes', async () => {
    const fetchMock = rolesFetch({
      roles: [
        makeRole('r1', 'Viewer', [MANAGE.code], {
          user_count: 5,
          project_count: 2,
        }),
      ],
    })
    renderRoles()

    await openRoleEditor('Viewer')
    expect(screen.getByLabelText('角色名稱')).toHaveValue('Viewer')
    expect(
      screen.getByRole('checkbox', { name: '管理專案成員與其角色' }),
    ).toBeChecked()
    fireEvent.change(screen.getByLabelText('角色名稱'), {
      target: { value: 'Reader' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存角色' }))

    const confirmation = await screen.findByRole('region', {
      name: '修改「Viewer」',
    })
    expect(confirmation).toHaveTextContent(
      '此變更會影響 2 個專案中的 5 個帳號',
    )
    // 影響範圍向後端重新取得，而且確認前不送出修改。
    expect(calls(fetchMock, 'GET').map(([url]) => url)).toContain(
      '/api/v1/roles/r1',
    )
    expect(calls(fetchMock, 'PATCH')).toHaveLength(0)
    expect(screen.getByLabelText('角色名稱')).toBeDisabled()

    fireEvent.click(within(confirmation).getByRole('button', { name: '取消' }))
    expect(calls(fetchMock, 'PATCH')).toHaveLength(0)
    expect(screen.getByLabelText('角色名稱')).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '儲存角色' }))
    fireEvent.click(
      await screen.findByRole('button', { name: '確認修改角色' }),
    )

    await screen.findByRole('heading', { name: 'Reader', level: 1 })
    fireEvent.click(screen.getByRole('link', { name: '返回角色清單' }))
    expect(
      await screen.findByRole('row', { name: /Reader/ }),
    ).toBeInTheDocument()
    const [[url, init]] = calls(fetchMock, 'PATCH')
    expect(url).toBe('/api/v1/roles/r1')
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'Reader' })
  })

  it('sends changed permissions and shows a zero impact too', async () => {
    const fetchMock = rolesFetch({
      roles: [makeRole('r1', 'Viewer', [MANAGE.code])],
    })
    renderRoles()

    await openRoleEditor('Viewer')
    fireEvent.click(
      screen.getByRole('checkbox', { name: '管理專案成員與其角色' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '儲存角色' }))

    expect(
      await screen.findByText(/此變更會影響 0 個專案中的 0 個帳號/),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '確認修改角色' }))
    await waitFor(() => expect(calls(fetchMock, 'PATCH')).toHaveLength(1))
    expect(JSON.parse(String(calls(fetchMock, 'PATCH')[0][1]?.body))).toEqual({
      permission_codes: [],
    })
  })

  it('does not call the API when nothing changed', async () => {
    const fetchMock = rolesFetch({ roles: [makeRole('r1', 'Viewer')] })
    renderRoles()

    await openRoleEditor('Viewer')
    fireEvent.click(screen.getByRole('button', { name: '儲存角色' }))

    await screen.findByRole('heading', { name: 'Viewer', level: 1 })
    expect(screen.queryByLabelText('角色名稱')).toBeNull()
    expect(calls(fetchMock, 'PATCH')).toHaveLength(0)
    expect(screen.queryByText('確認修改角色')).not.toBeInTheDocument()
  })

  it('shows the impact and asks to confirm before deleting', async () => {
    const fetchMock = rolesFetch({
      roles: [
        // 同一人在兩個專案持有此角色：只算 1 位使用者、2 個專案。
        makeRole('r1', 'Viewer', [], { user_count: 1, project_count: 2 }),
        makeRole('r2', 'Coordinator'),
      ],
    })
    renderRoles()

    await openRoleDetail('Viewer')
    const trigger = screen.getByRole('button', { name: '刪除角色' })
    // 不可逆刪除的觸發鈕用外框紅；實心紅只留給確認框內的確認鈕。
    expect(trigger).toHaveClass('btn-danger-outline')
    expect(trigger).not.toHaveClass('btn-danger')
    fireEvent.click(trigger)
    const confirmation = await screen.findByRole('region', {
      name: '刪除「Viewer」',
    })
    expect(confirmation).toHaveTextContent('刪除會影響 2 個專案中的 1 個帳號')
    expect(confirmation).toHaveTextContent('角色指派都會一併移除')
    // 確認區沿用共用的確認框樣式，[取消][確認] 兩顆按鈕之間有間距（#500）。
    expect(confirmation).toHaveClass('confirm-box-danger')
    expect(
      within(confirmation)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['取消', '確認刪除角色'])
    expect(calls(fetchMock, 'DELETE')).toHaveLength(0)

    fireEvent.click(within(confirmation).getByRole('button', { name: '取消' }))
    expect(screen.queryByText('確認刪除角色')).not.toBeInTheDocument()
    expect(calls(fetchMock, 'DELETE')).toHaveLength(0)

    await openRoleDetail('Viewer')
    fireEvent.click(screen.getByRole('button', { name: '刪除角色' }))
    fireEvent.click(
      await screen.findByRole('button', { name: '確認刪除角色' }),
    )

    await waitFor(() =>
      expect(
        screen.queryByRole('row', { name: /Viewer/ }),
      ).not.toBeInTheDocument(),
    )
    expect(calls(fetchMock, 'DELETE')[0][0]).toBe('/api/v1/roles/r1')
    expect(
      await screen.findByRole('row', { name: /Coordinator/ }),
    ).toBeInTheDocument()
  })

  it('shows a zero impact before deleting an unused role', async () => {
    rolesFetch({ roles: [makeRole('r1', 'Viewer')] })
    renderRoles()

    await openRoleDetail('Viewer')
    fireEvent.click(screen.getByRole('button', { name: '刪除角色' }))
    expect(
      await screen.findByText(/刪除會影響 0 個專案中的 0 個帳號/),
    ).toBeInTheDocument()
  })

  it('loads every page of roles', async () => {
    const fetchMock = rolesFetch({
      roles: [makeRole('r1', 'Alpha'), makeRole('r2', 'Beta')],
      pageSize: 1,
    })
    renderRoles()

    expect(
      await screen.findByRole('row', { name: /Beta/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Alpha/ })).toBeInTheDocument()
    expect(calls(fetchMock, 'GET').map(([url]) => url)).toContain(
      '/api/v1/roles?limit=100&cursor=1',
    )
  })

  it('shows a clear message for a duplicate role name', async () => {
    rolesFetch({
      roles: [makeRole('r1', 'Viewer')],
      failures: {
        'POST /roles': { status: 409, code: 'role.name_conflict' },
      },
    })
    renderRoles('/roles/new')

    fireEvent.change(await screen.findByLabelText('角色名稱'), {
      target: { value: 'viewer' },
    })
    fireEvent.click(screen.getByRole('button', { name: '建立角色' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '角色名稱已被使用（不分大小寫）。',
    )
    expect(screen.getByLabelText('角色名稱')).toHaveValue('viewer')
  })

  it('shows not found when the edited role was deleted', async () => {
    rolesFetch({
      roles: [makeRole('r1', 'Viewer')],
      failures: {
        'PATCH /roles/r1': { status: 404, code: 'role.not_found' },
      },
    })
    renderRoles()

    await openRoleEditor('Viewer')
    fireEvent.change(screen.getByLabelText('角色名稱'), {
      target: { value: 'Reader' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存角色' }))
    fireEvent.click(
      await screen.findByRole('button', { name: '確認修改角色' }),
    )

    expect(
      await screen.findByRole('heading', { name: '找不到這個角色' }),
    ).toBeVisible()
    expect(screen.queryByLabelText('角色名稱')).toBeNull()
    expect(screen.getByRole('link', { name: '返回角色清單' })).toHaveAttribute(
      'href',
      '/roles',
    )
  })

  it('shows not found when the fresh impact lookup returns 404', async () => {
    const failures: NonNullable<FakeOptions['failures']> = {}
    const fetchMock = rolesFetch({
      roles: [makeRole('r1', 'Viewer')],
      failures,
    })
    renderRoles()
    await openRoleEditor('Viewer')
    failures['GET /roles/r1'] = { status: 404, code: 'role.not_found' }
    fireEvent.change(screen.getByLabelText('角色名稱'), {
      target: { value: 'Reader' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存角色' }))
    expect(
      await screen.findByRole('heading', { name: '找不到這個角色' }),
    ).toBeVisible()
    expect(screen.queryByRole('form')).toBeNull()
    expect(calls(fetchMock, 'PATCH')).toHaveLength(0)
    expect(calls(fetchMock, 'POST')).toHaveLength(0)
  })

  it('keeps delete-impact errors beside the detail action', async () => {
    const failures: NonNullable<FakeOptions['failures']> = {}
    rolesFetch({ roles: [makeRole('r1', 'Viewer')], failures })
    renderRoles()
    await openRoleDetail('Viewer')
    failures['GET /roles/r1'] = { status: 500, code: 'server.internal_error' }
    const trigger = screen.getByRole('button', { name: '刪除角色' })
    const area = trigger.closest('section') as HTMLElement
    fireEvent.click(trigger)
    const alert = await within(area).findByRole('alert')
    expect(alert).toHaveTextContent('伺服器暫時無法處理')
    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.queryByRole('region', { name: '刪除「Viewer」' })).toBeNull()
  })

  it('shows a load error when the role list cannot be fetched', async () => {
    rolesFetch({
      failures: {
        'GET /roles': { status: 500, code: 'server.internal_error' },
      },
    })
    renderRoles()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '伺服器暫時無法處理，請稍後再試。',
    )
  })

  it('keeps unregistered permission codes visible while editing', async () => {
    rolesFetch({ roles: [makeRole('r1', 'Legacy', ['report.read'])] })
    renderRoles()

    expect(
      await screen.findByRole('row', { name: /Legacy/ }),
    ).toHaveTextContent('可使用部分功能')
    expect(screen.getByRole('row', { name: /Legacy/ })).not.toHaveTextContent(
      'report.read',
    )
    await openRoleEditor('Legacy')
    expect(
      screen.getByRole('checkbox', { name: /report\.read/ }),
    ).toBeChecked()
  })
})

describe.each([['角色管理新增／編輯', '建立角色']])(
  '%s 共用表單',
  (_name, submitLabel) => {
    function fillForm() {
      fireEvent.change(screen.getByLabelText('角色名稱'), {
        target: { value: '表單測試角色' },
      })
      fireEvent.click(
        screen.getByRole('checkbox', { name: MANAGE.description }),
      )
    }

    it('真實頁面 API pending 時只送一次並停用按鈕', async () => {
      const fetchMock = rolesFetch()
      renderRoles('/roles/new')
      await screen.findByLabelText('角色名稱')
      fillForm()
      const button = screen.getByRole('button', { name: submitLabel })
      const form = button.closest('form')!
      const gate = holdRequests(fetchMock, 'POST', /\/roles$/)

      fireEvent.click(button)
      fireEvent.submit(form)

      expect(button).toBeDisabled()
      expect(calls(fetchMock, 'POST')).toHaveLength(1)
      gate.resolve()
      expect(
        await screen.findByRole('heading', { name: '表單測試角色', level: 1 }),
      ).toBeInTheDocument()
    })

    it('IME Enter 不送出真實 API', async () => {
      const fetchMock = rolesFetch()
      renderRoles('/roles/new')
      await screen.findByLabelText('角色名稱')
      fillForm()

      expectImeEnterIgnored(screen.getByLabelText('角色名稱'))
      expect(calls(fetchMock, 'POST')).toHaveLength(0)
    })

    it('API 失敗後可以再次送出', async () => {
      const failures: FakeOptions['failures'] = {
        'POST /roles': { status: 500, code: 'server.error' },
      }
      const fetchMock = rolesFetch({ failures })
      renderRoles('/roles/new')
      await screen.findByLabelText('角色名稱')
      fillForm()
      const button = screen.getByRole('button', { name: submitLabel })
      const form = button.closest('form')!

      fireEvent.click(button)
      await screen.findByRole('alert')
      delete failures['POST /roles']
      fireEvent.submit(form)

      await waitFor(() => expect(calls(fetchMock, 'POST')).toHaveLength(2))
    })
  },
)

describe('roleErrorMessage', () => {
  it('maps role error codes and falls back to the shared messages', () => {
    expect(
      roleErrorMessage(
        new ManagementApiError(422, 'role.permission_code_invalid'),
      ),
    ).toBe('權限代碼無效，請重新整理頁面後再選擇。')
    expect(roleErrorMessage(new ManagementApiError(403))).toBe(
      '你沒有權限執行這項操作。',
    )
    expect(roleErrorMessage(new ManagementApiError(401))).toBe(
      '登入狀態已失效，請重新登入。',
    )
    expect(roleErrorMessage(new ManagementApiError(422, 'x.unknown'))).toBe(
      '操作失敗，請稍後再試。',
    )
    expect(roleErrorMessage(new Error('network'))).toBe(
      '無法連線到伺服器，請稍後再試。',
    )
  })
})

describe('role confirmation guards (#507)', () => {
  it('saves once when the update confirmation is clicked twice', async () => {
    const fetchMock = rolesFetch({ roles: [makeRole('r1', 'Viewer')] })
    renderRoles()
    await openRoleEditor('Viewer')
    fireEvent.change(screen.getByLabelText('角色名稱'), {
      target: { value: 'Reader' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存角色' }))
    const confirm = await screen.findByRole('button', {
      name: '確認修改角色',
    })
    const gate = holdRequests(fetchMock, 'PATCH', /\/roles\/r1$/)

    fireEvent.click(confirm)
    fireEvent.click(confirm)
    gate.resolve()

    await screen.findByRole('heading', { name: 'Reader', level: 1 })
    expect(calls(fetchMock, 'PATCH')).toHaveLength(1)
  })

  it('looks up the impact once on a double click', async () => {
    const fetchMock = rolesFetch({ roles: [makeRole('r1', 'Viewer')] })
    renderRoles()
    await openRoleDetail('Viewer')
    const button = screen.getByRole('button', { name: '刪除角色' })
    const gate = holdRequests(fetchMock, 'GET', /\/roles\/r1$/)
    const before = calls(fetchMock, 'GET').length

    fireEvent.click(button)
    fireEvent.click(button)
    gate.resolve()

    await screen.findByRole('region', { name: '刪除「Viewer」' })
    expect(calls(fetchMock, 'GET')).toHaveLength(before + 1)
  })

  it('deletes once on a double confirm click', async () => {
    const fetchMock = rolesFetch({ roles: [makeRole('r1', 'Viewer')] })
    renderRoles()
    await openRoleDetail('Viewer')
    fireEvent.click(screen.getByRole('button', { name: '刪除角色' }))
    const confirm = await screen.findByRole('button', {
      name: '確認刪除角色',
    })
    const gate = holdRequests(fetchMock, 'DELETE', /\/roles\/r1$/)

    fireEvent.click(confirm)
    fireEvent.click(confirm)
    gate.resolve()

    await waitFor(() =>
      expect(screen.queryByRole('row', { name: /Viewer/ })).toBeNull(),
    )
    expect(calls(fetchMock, 'DELETE')).toHaveLength(1)
  })
})

describe('#734 T7 角色操作回饋位置', () => {
  it('儲存確認留在編輯表單內，成功在被修改的角色清單上方', async () => {
    rolesFetch({ roles: [makeRole('r1', 'Viewer')] })
    renderRoles()
    await openRoleEditor('Viewer')
    const input = screen.getByLabelText('角色名稱')
    await waitFor(() => expect(input).toHaveFocus())
    const form = input.closest('form') as HTMLFormElement
    fireEvent.change(input, { target: { value: 'Reader' } })
    fireEvent.click(within(form).getByRole('button', { name: '儲存角色' }))
    const box = await within(form).findByRole('region', {
      name: '修改「Viewer」',
    })
    fireEvent.click(within(box).getByRole('button', { name: '確認修改角色' }))
    const heading = await screen.findByRole('heading', {
      name: 'Reader',
      level: 1,
    })
    const detail = heading.closest('section') as HTMLElement
    expect(await within(detail).findByRole('status')).toHaveTextContent(
      '已更新角色「Reader」。',
    )
    expect(within(detail).getByRole('status')).not.toHaveFocus()
    expect(heading).toBeVisible()
    expect(within(detail).queryByRole('form')).toBeNull()
  })

  it('刪除確認留在該角色的操作列', async () => {
    rolesFetch({ roles: [makeRole('r1', 'Viewer')] })
    renderRoles()
    await openRoleDetail('Viewer')
    const trigger = screen.getByRole('button', { name: '刪除角色' })
    const cell = trigger.closest('section') as HTMLElement
    fireEvent.click(trigger)
    const box = await within(cell).findByRole('region', {
      name: '刪除「Viewer」',
    })
    await waitFor(() => {
      expect(within(box).getByRole('button', { name: '取消' })).toHaveFocus()
    })
  })
})

it('持有人數保留總數並標出其中停用者，確認影響範圍仍用總數', async () => {
  rolesFetch({
    roles: [
      {
        ...makeRole('r1', '含停用者角色', [], {
          user_count: 5,
          project_count: 2,
        }),
        inactive_user_count: 1,
      },
    ],
  })
  renderRoles()
  const row = await screen.findByRole('row', { name: /含停用者角色/ })
  expect(row).toHaveTextContent('5 個帳號（含 1 個已停用）')
  await openRoleDetail('含停用者角色')
  fireEvent.click(screen.getByRole('button', { name: '刪除角色' }))
  const box = await screen.findByRole('region', {
    name: '刪除「含停用者角色」',
  })
  expect(box).toHaveTextContent('會影響 2 個專案中的 5 個帳號')
})
