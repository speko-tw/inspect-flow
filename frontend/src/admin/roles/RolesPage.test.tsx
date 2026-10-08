import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
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
  has_field_access: true,
  has_template_access: true,
}

function renderRoles(path = '/admin/roles') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          element={
            <CurrentUserProvider value={{ user: currentUser, clear: vi.fn() }}>
              <AdminPage />
            </CurrentUserProvider>
          }
          path="/admin/*"
        />
      </Routes>
    </MemoryRouter>,
  )
}

interface FakeOptions {
  roles?: Role[]
  permissions?: PermissionCode[]
  // 針對指定的 method + 路徑尾端回傳錯誤碼，例如 'POST /roles'。
  failures?: Record<string, { status: number; code: string }>
  pageSize?: number
}

function rolesFetch({
  roles = [],
  permissions = [MANAGE],
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
      if (method === 'GET' && path === '/roles') {
        const start = Number(url.searchParams.get('cursor') ?? 0)
        const items = rows.slice(start, start + pageSize)
        const end = start + pageSize
        return Response.json({
          items,
          next_cursor: end < rows.length ? String(end) : null,
        })
      }
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Partial<Role>)
        : {}
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

describe('admin role management page', () => {
  it('opens from the admin navigation and lists roles', async () => {
    rolesFetch({
      roles: [
        makeRole('r1', 'Viewer'),
        makeRole('r2', 'Coordinator', [MANAGE.code]),
      ],
    })
    renderRoles('/admin/users')

    fireEvent.click(screen.getByRole('link', { name: '角色' }))

    expect(
      await screen.findByRole('heading', { name: '角色管理' }),
    ).toBeInTheDocument()
    const coordinator = await screen.findByRole('row', {
      name: /Coordinator/,
    })
    expect(coordinator).toHaveTextContent('管理專案成員與其角色')
    expect(screen.getByRole('row', { name: /Viewer/ })).toHaveTextContent(
      '（無）',
    )
  })

  it('shows a placeholder when no permission can be configured', async () => {
    rolesFetch({ permissions: [] })
    renderRoles()

    expect(
      await screen.findByText('目前尚無可設定的權限，功能上線後會出現'),
    ).toBeInTheDocument()
    expect(screen.getByText('目前沒有角色。')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('creates a role with the checked permissions', async () => {
    const fetchMock = rolesFetch()
    renderRoles()

    fireEvent.change(await screen.findByLabelText('角色名稱'), {
      target: { value: '  Site Lead  ' },
    })
    fireEvent.click(
      await screen.findByRole('checkbox', { name: '管理專案成員與其角色' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '新增角色' }))

    expect(
      await screen.findByRole('row', { name: /Site Lead/ }),
    ).toHaveTextContent('管理專案成員與其角色')
    const [[, init]] = calls(fetchMock, 'POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      name: 'Site Lead',
      permission_codes: [MANAGE.code],
    })
    expect(screen.getByLabelText('角色名稱')).toHaveValue('')
  })

  it('shows the impact and asks to confirm before saving changes', async () => {
    const fetchMock = rolesFetch({
      roles: [
        makeRole('r1', 'Viewer', [MANAGE.code], {
          user_count: 5,
          project_count: 2,
        }),
      ],
    })
    renderRoles()

    fireEvent.click(
      await screen.findByRole('button', { name: '修改角色 Viewer' }),
    )
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
      '此變更會影響 2 個專案中的 5 位使用者',
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

    fireEvent.click(
      await screen.findByRole('button', { name: '修改角色 Viewer' }),
    )
    fireEvent.click(
      screen.getByRole('checkbox', { name: '管理專案成員與其角色' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '儲存角色' }))

    expect(
      await screen.findByText(/此變更會影響 0 個專案中的 0 位使用者/),
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

    fireEvent.click(
      await screen.findByRole('button', { name: '修改角色 Viewer' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '儲存角色' }))

    await waitFor(() =>
      expect(screen.getByLabelText('角色名稱')).toHaveValue(''),
    )
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

    fireEvent.click(
      await screen.findByRole('button', { name: '刪除角色 Viewer' }),
    )
    const confirmation = await screen.findByRole('region', {
      name: '刪除「Viewer」',
    })
    expect(confirmation).toHaveTextContent(
      '刪除會影響 2 個專案中的 1 位使用者',
    )
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

    fireEvent.click(screen.getByRole('button', { name: '刪除角色 Viewer' }))
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
      screen.getByRole('row', { name: /Coordinator/ }),
    ).toBeInTheDocument()
  })

  it('shows a zero impact before deleting an unused role', async () => {
    rolesFetch({ roles: [makeRole('r1', 'Viewer')] })
    renderRoles()

    fireEvent.click(
      await screen.findByRole('button', { name: '刪除角色 Viewer' }),
    )
    expect(
      await screen.findByText(/刪除會影響 0 個專案中的 0 位使用者/),
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
    renderRoles()

    fireEvent.change(await screen.findByLabelText('角色名稱'), {
      target: { value: 'viewer' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增角色' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '角色名稱已被使用（不分大小寫）。',
    )
    expect(screen.getByLabelText('角色名稱')).toHaveValue('viewer')
  })

  it('leaves edit mode when the edited role was deleted elsewhere', async () => {
    rolesFetch({
      roles: [makeRole('r1', 'Viewer')],
      failures: {
        'PATCH /roles/r1': { status: 404, code: 'role.not_found' },
      },
    })
    renderRoles()

    fireEvent.click(
      await screen.findByRole('button', { name: '修改角色 Viewer' }),
    )
    fireEvent.change(screen.getByLabelText('角色名稱'), {
      target: { value: 'Reader' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存角色' }))
    fireEvent.click(
      await screen.findByRole('button', { name: '確認修改角色' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '找不到這個角色，可能已被刪除，請重新整理後再試。',
    )
    expect(
      screen.getByRole('heading', { name: '新增角色' }),
    ).toBeInTheDocument()
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
    ).toHaveTextContent('report.read')
    fireEvent.click(screen.getByRole('button', { name: '修改角色 Legacy' }))
    expect(
      screen.getByRole('checkbox', { name: /report\.read/ }),
    ).toBeChecked()
  })
})

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

describe('role forms guard (#507)', () => {
  it('creates one role when Enter is pressed twice quickly', async () => {
    const fetchMock = rolesFetch()
    renderRoles()
    fireEvent.change(await screen.findByLabelText('角色名稱'), {
      target: { value: 'Site Lead' },
    })
    const gate = holdRequests(fetchMock, 'POST', /\/roles$/)
    const form = screen.getByLabelText('角色名稱').closest('form')
    expect(form).not.toBeNull()

    fireEvent.submit(form as HTMLFormElement)
    fireEvent.submit(form as HTMLFormElement)
    gate.resolve()

    await screen.findByRole('row', { name: /Site Lead/ })
    expect(calls(fetchMock, 'POST')).toHaveLength(1)
  })

  it('accepts another submit after a failed one', async () => {
    const fetchMock = rolesFetch({
      failures: { 'POST /roles': { status: 500, code: 'server.error' } },
    })
    renderRoles()
    fireEvent.change(await screen.findByLabelText('角色名稱'), {
      target: { value: 'Site Lead' },
    })
    const form = screen
      .getByLabelText('角色名稱')
      .closest('form') as HTMLFormElement

    fireEvent.submit(form)
    await screen.findByRole('alert')
    fireEvent.submit(form)

    await waitFor(() => expect(calls(fetchMock, 'POST')).toHaveLength(2))
  })

  it('does not submit when Enter only confirms an IME choice', async () => {
    const fetchMock = rolesFetch()
    renderRoles()
    fireEvent.change(await screen.findByLabelText('角色名稱'), {
      target: { value: 'Site Lead' },
    })

    expectImeEnterIgnored(screen.getByLabelText('角色名稱'))

    expect(calls(fetchMock, 'POST')).toHaveLength(0)
  })

  it('opens the update confirmation once on a double submit', async () => {
    const fetchMock = rolesFetch({ roles: [makeRole('r1', 'Viewer')] })
    renderRoles()
    fireEvent.click(
      await screen.findByRole('button', { name: '修改角色 Viewer' }),
    )
    fireEvent.change(screen.getByLabelText('角色名稱'), {
      target: { value: 'Reader' },
    })
    const gate = holdRequests(fetchMock, 'GET', /\/roles\/r1$/)
    const form = screen
      .getByLabelText('角色名稱')
      .closest('form') as HTMLFormElement
    const before = calls(fetchMock, 'GET').length

    fireEvent.submit(form)
    fireEvent.submit(form)
    gate.resolve()

    await screen.findByRole('region', { name: '修改「Viewer」' })
    expect(calls(fetchMock, 'GET')).toHaveLength(before + 1)
  })

  it('saves once when the update confirmation is clicked twice', async () => {
    const fetchMock = rolesFetch({ roles: [makeRole('r1', 'Viewer')] })
    renderRoles()
    fireEvent.click(
      await screen.findByRole('button', { name: '修改角色 Viewer' }),
    )
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

    await screen.findByRole('row', { name: /Reader/ })
    expect(calls(fetchMock, 'PATCH')).toHaveLength(1)
  })

  it('looks up the impact once on a double click', async () => {
    const fetchMock = rolesFetch({ roles: [makeRole('r1', 'Viewer')] })
    renderRoles()
    const button = await screen.findByRole('button', {
      name: '刪除角色 Viewer',
    })
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
    fireEvent.click(
      await screen.findByRole('button', { name: '刪除角色 Viewer' }),
    )
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
