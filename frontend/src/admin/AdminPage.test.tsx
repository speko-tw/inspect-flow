import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CurrentUser } from '../auth/api'
import { CurrentUserProvider } from '../auth/useCurrentUser'
import AdminPage from './AdminPage'
import {
  managementErrorMessage,
  ManagementApiError,
  type Company,
  type CreatedUser,
  type User,
} from './api'

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
}

function renderAdmin(path = '/admin/users', isAdmin = true) {
  const signedInUser = { ...currentUser, is_admin: isAdmin }
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          element={
            <CurrentUserProvider
              value={{ user: signedInUser, clear: vi.fn() }}
            >
              <AdminPage />
            </CurrentUserProvider>
          }
          path="/admin/*"
        />
      </Routes>
    </MemoryRouter>,
  )
}

function managementFetch({
  userRows = [builtInUser, regularUser],
  companyRows = [company],
  onCreate,
}: {
  userRows?: User[]
  companyRows?: Company[]
  onCreate?: (body: Record<string, unknown>) => CreatedUser
} = {}) {
  const rows = userRows.map((user) => ({ ...user }))
  const companies = companyRows.map((row) => ({ ...row }))
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/users') && (!init?.method || init.method === 'GET')) {
        return Response.json(rows)
      }
      if (
        url.endsWith('/companies') &&
        (!init?.method || init.method === 'GET')
      ) {
        return Response.json(companies)
      }
      if (url.endsWith('/users') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
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
      if (url.endsWith('/users/user-1') && init?.method === 'PATCH') {
        const row = rows.find((user) => user.id === 'user-1')
        if (row) {
          Object.assign(row, JSON.parse(String(init.body)) as Partial<User>)
        }
        return Response.json(row)
      }
      return Response.json({}, { status: 204 })
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('admin user and company pages', () => {
  it('lists users and protects the built-in admin controls', async () => {
    managementFetch()
    renderAdmin()

    expect(await screen.findByText('anna.deng')).toBeInTheDocument()
    expect(screen.getByText('admin', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('（系統帳號）')).toBeInTheDocument()
    const adminRow = screen.getByRole('row', { name: /admin.*系統帳號/ })
    expect(
      within(adminRow).getByRole('button', { name: '收回管理者' }),
    ).toBeDisabled()
    expect(
      within(adminRow).getByRole('button', { name: '停用' }),
    ).toBeDisabled()
  })

  it('shows and clears a temporary password', async () => {
    managementFetch({
      onCreate: (body) => ({
        ...regularUser,
        id: 'user-2',
        username: String(body.username),
        email: String(body.email),
        name_zh: String(body.name_zh),
        temporary_password: 'once-only-password',
      }),
    })
    renderAdmin()

    fireEvent.change(await screen.findByLabelText('帳號名稱'), {
      target: { value: 'bob.lee' },
    })
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'bob@example.com' },
    })
    fireEvent.change(screen.getByLabelText('中文姓名'), {
      target: { value: '李柏' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增使用者' }))

    expect(await screen.findByLabelText('臨時密碼')).toHaveTextContent(
      'once-only-password',
    )
    fireEvent.click(screen.getByRole('button', { name: '已抄下，關閉' }))
    expect(screen.queryByLabelText('臨時密碼')).not.toBeInTheDocument()
    expect(screen.queryByText('once-only-password')).not.toBeInTheDocument()
  })

  it('clears the password after leaving the page', async () => {
    managementFetch({
      onCreate: (body) => ({
        ...regularUser,
        id: 'user-2',
        username: String(body.username),
        email: String(body.email),
        name_zh: String(body.name_zh),
        temporary_password: 'leave-page-password',
      }),
    })
    renderAdmin()
    fireEvent.change(await screen.findByLabelText('帳號名稱'), {
      target: { value: 'bob.lee' },
    })
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'bob@example.com' },
    })
    fireEvent.change(screen.getByLabelText('中文姓名'), {
      target: { value: '李柏' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增使用者' }))
    expect(await screen.findByText('leave-page-password')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: '公司' }))
    expect(screen.queryByText('leave-page-password')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: '使用者' }))
    expect(
      await screen.findByRole('heading', { name: '使用者管理' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('leave-page-password')).not.toBeInTheDocument()
  })

  it('translates API conflicts to a Traditional Chinese message', async () => {
    managementFetch()
    renderAdmin()
    fireEvent.change(await screen.findByLabelText('帳號名稱'), {
      target: { value: 'bob.lee' },
    })
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'anna@example.com' },
    })
    fireEvent.change(screen.getByLabelText('中文姓名'), {
      target: { value: '李柏' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增使用者' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Email 已被使用。',
    )
  })

  it('edits users and toggles admin and active status', async () => {
    const fetchMock = managementFetch()
    renderAdmin()
    let userRow = await screen.findByRole('row', { name: /anna\.deng/ })
    fireEvent.click(within(userRow).getByRole('button', { name: '修改資料' }))
    const editForm = screen
      .getByRole('heading', { name: '修改使用者資料' })
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
    userRow = await screen.findByRole('row', { name: /anna\.new/ })

    fireEvent.click(
      within(userRow).getByRole('button', { name: '指派管理者' }),
    )
    await waitFor(() => {
      expect(screen.getByRole('row', { name: /anna\.new/ })).toHaveTextContent(
        '是',
      )
    })
    userRow = screen.getByRole('row', { name: /anna\.new/ })
    fireEvent.click(
      within(userRow).getByRole('button', { name: '收回管理者' }),
    )
    await waitFor(() => {
      expect(screen.getByRole('row', { name: /anna\.new/ })).toHaveTextContent(
        '否',
      )
    })
    userRow = screen.getByRole('row', { name: /anna\.new/ })
    fireEvent.click(within(userRow).getByRole('button', { name: '停用' }))
    await waitFor(() => {
      expect(screen.getByRole('row', { name: /anna\.new/ })).toHaveTextContent(
        '停用',
      )
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
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith('/users/user-1/active') &&
          init?.method === 'PUT',
      ),
    ).toBe(true)
  })

  it('enables and clears fields for linked companies', async () => {
    const unlinkedUser = {
      ...regularUser,
      company_id: null,
      department: null,
      location: null,
      employee_no: null,
    }
    const fetchMock = managementFetch({
      userRows: [builtInUser, unlinkedUser],
    })
    renderAdmin()
    const userRow = await screen.findByRole('row', { name: /anna\.deng/ })
    fireEvent.click(within(userRow).getByRole('button', { name: '公司連結' }))
    const linkForm = screen
      .getByRole('heading', { name: '連結公司' })
      .closest('form')
    expect(linkForm).not.toBeNull()
    const form = within(linkForm as HTMLFormElement)
    const department = form.getByLabelText('部門')
    expect(department).toBeDisabled()
    fireEvent.change(form.getByLabelText('公司'), {
      target: { value: company.id },
    })
    expect(department).toBeEnabled()
    fireEvent.change(department, { target: { value: '新部門' } })
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
    renderAdmin('/admin/users', false)
    expect(screen.getByRole('heading', { name: '無權限' })).toBeInTheDocument()
  })

  it('supports creating, renaming, and deactivating a company', async () => {
    const rows = [{ ...company }]
    let nextId = 2
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (
          url.endsWith('/companies') &&
          (!init?.method || init.method === 'GET')
        ) {
          return Response.json(rows)
        }
        if (url.endsWith('/companies') && init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as { name: string }
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
        if (url.includes('/companies/company-1/active')) {
          rows[0].is_active = false
          return Response.json(rows[0])
        }
        return Response.json({}, { status: 204 })
      }),
    )
    renderAdmin('/admin/companies')

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
    await waitFor(() => {
      expect(screen.getByText('停用', { selector: 'td' })).toBeInTheDocument()
    })
  })
})

describe('management error messages', () => {
  it.each([
    ['request.validation_failed', '資料格式不正確，請檢查輸入內容。'],
    ['resource.not_found', '找不到這筆資料，請重新整理後再試。'],
    ['server.internal_error', '系統發生錯誤，請稍後再試。'],
    ['permission.denied', '你沒有權限執行這項操作。'],
    ['user.builtin_protected', '內建 admin 帳號不可修改或停用。'],
    ['user.last_admin', '系統至少要保留一位啟用中的管理者。'],
    ['user.external_managed', '此帳號的基本資料由外部來源管理。'],
    ['company.inactive', '不能把使用者連結到已停用的公司。'],
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
})
