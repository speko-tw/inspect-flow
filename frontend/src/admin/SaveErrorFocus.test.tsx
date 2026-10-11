// 使用者、公司、角色存檔失敗時，錯誤要出現在表單裡並取得焦點
// （#618 F-O02）。放在頁頂的話，列表一長就在視窗外，螢幕閱讀器使用者
// 也不會被帶過去。

import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CurrentUser } from '../auth/api'
import { CurrentUserProvider } from '../auth/useCurrentUser'
import CompaniesPage from './CompaniesPage'
import RolesPage from './roles/RolesPage'
import UsersPage from './UsersPage'
import type { Company, User } from './api'

const company: Company = { id: 'company-1', name: '示範公司', is_active: true }

const regularUser: User = {
  id: 'user-1',
  username: 'anna.deng',
  email: 'anna@example.com',
  name_zh: '鄧安娜',
  name_en: null,
  company_id: company.id,
  department: '工程部',
  location: null,
  employee_no: null,
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

const role = {
  id: 'role-1',
  name: '示範內業',
  permission_codes: [],
  user_count: 0,
  project_count: 0,
  created_at: '2026-10-01T00:00:00.000000Z',
  updated_at: '2026-10-01T00:00:00.000000Z',
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
  module_permissions: [],
}

/** 讀取成功；任何寫入（非 GET）回 409 與指定的錯誤碼。 */
function stubBackend(conflictCode: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname } = new URL(String(input), 'http://testserver')
      if ((init?.method ?? 'GET') !== 'GET') {
        return Response.json(
          { error: { code: conflictCode } },
          { status: 409 },
        )
      }
      if (pathname.endsWith('/users')) {
        return Response.json({ items: [regularUser], next_cursor: null })
      }
      if (pathname.endsWith('/companies')) {
        return Response.json({ items: [company], next_cursor: null })
      }
      if (pathname.endsWith('/roles/permission-codes')) {
        return Response.json({ items: [] })
      }
      if (pathname.endsWith('/roles')) return Response.json({ items: [role] })
      return Response.json({})
    }),
  )
}

function renderPage(page: React.ReactNode) {
  render(
    <MemoryRouter>
      <CurrentUserProvider value={{ user: currentUser, clear: vi.fn() }}>
        {page}
      </CurrentUserProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('存檔失敗的錯誤顯示在表單裡並聚焦（F-O02）', () => {
  it.each([
    ['修改資料', '儲存資料'],
    ['公司連結', '儲存公司連結'],
  ])('使用者「%s」表單', async (open, save) => {
    stubBackend('user.email_conflict')
    renderPage(<UsersPage onTemporaryPassword={vi.fn()} />)
    const row = await screen.findByRole('row', { name: /anna\.deng/ })
    fireEvent.click(within(row).getByRole('button', { name: open }))
    const form = (await screen.findByRole('button', { name: save })).closest(
      'form',
    ) as HTMLFormElement

    fireEvent.click(within(form).getByRole('button', { name: save }))

    const alert = await within(form).findByRole('alert')
    expect(alert).toHaveTextContent('Email 已被使用。')
    expect(alert).toHaveFocus()
    // 頁頂沒有另一份錯誤（也就沒有重複朗讀）。
    expect(screen.getAllByRole('alert')).toHaveLength(1)

    // 再失敗一次，焦點要再回到錯誤上，不因訊息相同而不動。
    within(form).getByRole('button', { name: save }).focus()
    fireEvent.click(within(form).getByRole('button', { name: save }))
    await vi.waitFor(() =>
      expect(within(form).getByRole('alert')).toHaveFocus(),
    )
  })

  it('公司表單', async () => {
    stubBackend('company.name_conflict')
    renderPage(<CompaniesPage />)
    await screen.findByRole('row', { name: /示範公司/ })
    const input = screen.getByLabelText('公司名稱')
    fireEvent.change(input, { target: { value: '新公司' } })
    const form = input.closest('form') as HTMLFormElement

    fireEvent.click(within(form).getByRole('button', { name: '新增公司' }))

    const alert = await within(form).findByRole('alert')
    expect(alert).toHaveTextContent('公司名稱已被使用。')
    expect(alert).toHaveFocus()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('角色表單', async () => {
    stubBackend('role.name_conflict')
    renderPage(<RolesPage />)
    await screen.findByRole('row', { name: /示範內業/ })
    const input = screen.getByLabelText('角色名稱')
    fireEvent.change(input, { target: { value: '新角色' } })
    const form = input.closest('form') as HTMLFormElement

    fireEvent.click(within(form).getByRole('button', { name: '新增角色' }))

    const alert = await within(form).findByRole('alert')
    expect(alert).toHaveFocus()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })
})
