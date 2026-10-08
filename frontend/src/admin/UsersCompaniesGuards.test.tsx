// 使用者與公司管理的防連點與輸入法 Enter（#507）。
//
// 每個表單與確認框各兩個測試：請求還沒回來時再送出只會送一次，
// 以及輸入法選字的 Enter 不送出。

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CurrentUser } from '../auth/api'
import { CurrentUserProvider } from '../auth/useCurrentUser'
import {
  deferred,
  expectImeEnterIgnored,
  type Deferred,
} from '../testing/submitGuard'
import CompaniesPage from './CompaniesPage'
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

type Call = { method: string; path: string }

/**
 * 列表請求立刻回應；`hold` 回傳 Deferred 時，該請求等到它完成才回應
 * （模擬「請求還沒回來」）。`fail` 回傳 true 時回 500。
 */
function stubBackend(
  options: {
    hold?: (call: Call) => Deferred<void> | undefined
    fail?: (call: Call) => boolean
    users?: User[]
  } = {},
) {
  const users = options.users ?? [regularUser]
  const calls: Call[] = []
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://testserver')
      const call = { method: init?.method ?? 'GET', path: url.pathname }
      calls.push(call)
      const gate = options.hold?.(call)
      if (gate) await gate.promise
      if (options.fail?.(call)) {
        return Response.json({ error: { code: 'x' } }, { status: 500 })
      }
      if (call.method === 'GET') {
        if (call.path === '/api/v1/users') {
          return Response.json({ items: users, next_cursor: null })
        }
        if (call.path === '/api/v1/companies') {
          return Response.json({ items: [company], next_cursor: null })
        }
        if (call.path.endsWith('/active-users')) {
          return Response.json({
            count: 1,
            users: [
              { id: 'user-1', username: 'anna.deng', name_zh: '鄧安娜' },
            ],
          })
        }
      }
      if (call.path.startsWith('/api/v1/users/')) {
        const id = call.path.split('/')[4]
        return Response.json(
          users.find((user) => user.id === id) ?? regularUser,
        )
      }
      return Response.json(company)
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  const count = (method: string, path: string | RegExp) =>
    calls.filter(
      (item) =>
        item.method === method &&
        (typeof path === 'string' ? item.path === path : path.test(item.path)),
    ).length
  return { calls, count }
}

function renderUsers() {
  render(
    <MemoryRouter>
      <CurrentUserProvider value={{ user: currentUser, clear: vi.fn() }}>
        <UsersPage onTemporaryPassword={vi.fn()} />
      </CurrentUserProvider>
    </MemoryRouter>,
  )
}

function formOf(element: HTMLElement): HTMLFormElement {
  return element.closest('form') as HTMLFormElement
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('UsersPage 搜尋表單（#507）', () => {
  it('連按 Enter 只搜尋一次', async () => {
    const searching: { gate?: Deferred<void> } = {}
    const backend = stubBackend({
      hold: (call) =>
        call.path === '/api/v1/users' ? searching.gate : undefined,
    })
    renderUsers()
    await screen.findByText('anna.deng')
    const before = backend.count('GET', '/api/v1/users')
    searching.gate = deferred()
    const form = formOf(screen.getByLabelText('搜尋使用者'))

    fireEvent.submit(form)
    fireEvent.submit(form)
    searching.gate.resolve()

    await screen.findByText('anna.deng')
    expect(backend.count('GET', '/api/v1/users')).toBe(before + 1)
  })

  it('輸入法選字的 Enter 不搜尋', async () => {
    const backend = stubBackend()
    renderUsers()
    await screen.findByText('anna.deng')
    const before = backend.calls.length

    expectImeEnterIgnored(screen.getByLabelText('搜尋使用者'))

    expect(backend.calls).toHaveLength(before)
  })
})

describe('UsersPage 修改使用者資料表單（#507）', () => {
  async function openDetails() {
    const row = await screen.findByRole('row', { name: /anna\.deng/ })
    fireEvent.click(within(row).getByRole('button', { name: '修改資料' }))
    return formOf(screen.getByRole('heading', { name: '修改使用者資料' }))
  }

  it('連按 Enter 只儲存一次', async () => {
    const gate = deferred()
    const backend = stubBackend({
      hold: (call) => (call.method === 'PATCH' ? gate : undefined),
    })
    renderUsers()
    const form = await openDetails()

    fireEvent.submit(form)
    fireEvent.submit(form)
    gate.resolve()

    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: '修改使用者資料' }),
      ).toBeNull(),
    )
    expect(backend.count('PATCH', '/api/v1/users/user-1')).toBe(1)
  })

  it('失敗之後可以再儲存', async () => {
    const backend = stubBackend({ fail: (call) => call.method === 'PATCH' })
    renderUsers()
    const form = await openDetails()

    fireEvent.submit(form)
    await screen.findByRole('alert')
    fireEvent.submit(form)

    await waitFor(() =>
      expect(backend.count('PATCH', '/api/v1/users/user-1')).toBe(2),
    )
  })

  it('輸入法選字的 Enter 不儲存', async () => {
    const backend = stubBackend()
    renderUsers()
    const form = await openDetails()

    expectImeEnterIgnored(within(form).getByLabelText('中文姓名'))

    expect(backend.count('PATCH', '/api/v1/users/user-1')).toBe(0)
  })
})

describe('UsersPage 公司連結表單（#507）', () => {
  async function openLink() {
    const row = await screen.findByRole('row', { name: /anna\.deng/ })
    fireEvent.click(within(row).getByRole('button', { name: '公司連結' }))
    return formOf(screen.getByRole('heading', { name: '連結公司' }))
  }

  it('連按 Enter 只儲存一次', async () => {
    const gate = deferred()
    const backend = stubBackend({
      hold: (call) => (call.method === 'PATCH' ? gate : undefined),
    })
    renderUsers()
    const form = await openLink()

    fireEvent.submit(form)
    fireEvent.submit(form)
    gate.resolve()

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: '連結公司' })).toBeNull(),
    )
    expect(backend.count('PATCH', '/api/v1/users/user-1')).toBe(1)
  })

  it('輸入法選字的 Enter 不儲存', async () => {
    const backend = stubBackend()
    renderUsers()
    const form = await openLink()

    expectImeEnterIgnored(within(form).getByLabelText('部門'))

    expect(backend.count('PATCH', '/api/v1/users/user-1')).toBe(0)
    expect(backend.count('PUT', /\/company$/)).toBe(0)
  })
})

describe('UsersPage 操作確認框（#507）', () => {
  async function openConfirm() {
    const row = await screen.findByRole('row', { name: /anna\.deng/ })
    fireEvent.click(within(row).getByRole('button', { name: '指派管理者' }))
    return screen.getByRole('region', { name: '操作確認' })
  }

  it('連點確認只送出一次', async () => {
    const gate = deferred()
    const backend = stubBackend({
      hold: (call) => (call.method === 'PUT' ? gate : undefined),
    })
    renderUsers()
    const box = await openConfirm()
    const confirm = within(box).getByRole('button', { name: '確認' })

    fireEvent.click(confirm)
    fireEvent.click(confirm)
    gate.resolve()

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: '操作確認' })).toBeNull(),
    )
    expect(backend.count('PUT', '/api/v1/users/user-1/admin')).toBe(1)
  })

  it('失敗之後可以再確認', async () => {
    const backend = stubBackend({ fail: (call) => call.method === 'PUT' })
    renderUsers()
    const box = await openConfirm()
    const confirm = within(box).getByRole('button', { name: '確認' })

    fireEvent.click(confirm)
    await within(box).findByRole('alert')
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(backend.count('PUT', '/api/v1/users/user-1/admin')).toBe(2),
    )
  })

  it('確認框不是表單，沒有 Enter 送出的路徑（輸入法 Enter 不適用）', async () => {
    stubBackend()
    renderUsers()
    const box = await openConfirm()

    expect(box.tagName).toBe('DIV')
  })
})

describe('UsersPage 進行中停用整張列表的動作按鈕（#507）', () => {
  const bob: User = {
    ...regularUser,
    id: 'user-2',
    username: 'bob.lin',
    email: 'bob@example.com',
    name_zh: '林鮑伯',
  }

  it('一個動作進行中，別列的動作按鈕與儲存鈕都停用，完成後恢復', async () => {
    const gate = deferred()
    stubBackend({
      users: [regularUser, bob],
      hold: (call) => (call.method === 'PUT' ? gate : undefined),
    })
    renderUsers()
    const bobRow = await screen.findByRole('row', { name: /bob\.lin/ })
    fireEvent.click(within(bobRow).getByRole('button', { name: '修改資料' }))
    const save = screen.getByRole('button', { name: '儲存資料' })
    const annaRow = screen.getByRole('row', { name: /anna\.deng/ })
    fireEvent.click(
      within(annaRow).getByRole('button', { name: '指派管理者' }),
    )
    const box = screen.getByRole('region', { name: '操作確認' })
    expect(
      within(bobRow).getByRole('button', { name: '指派管理者' }),
    ).toBeEnabled()
    expect(save).toBeEnabled()

    fireEvent.click(within(box).getByRole('button', { name: '確認' }))

    expect(
      within(bobRow).getByRole('button', { name: '指派管理者' }),
    ).toBeDisabled()
    expect(within(bobRow).getByRole('button', { name: '停用' })).toBeDisabled()
    expect(save).toBeDisabled()
    gate.resolve()
    // 完成後列表會重新載入，列重新長出來，按鈕都恢復可按。
    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /bob\.lin/ })).getByRole(
          'button',
          { name: '指派管理者' },
        ),
      ).toBeEnabled(),
    )
  })
})

describe('CompaniesPage 搜尋表單（#507）', () => {
  it('連按 Enter 只搜尋一次', async () => {
    const searching: { gate?: Deferred<void> } = {}
    const backend = stubBackend({
      hold: (call) =>
        call.path === '/api/v1/companies' ? searching.gate : undefined,
    })
    render(<CompaniesPage />)
    await screen.findByText('示範公司')
    const before = backend.count('GET', '/api/v1/companies')
    searching.gate = deferred()
    const form = formOf(screen.getByLabelText('搜尋公司'))

    fireEvent.submit(form)
    fireEvent.submit(form)
    searching.gate.resolve()

    await waitFor(() => expect(screen.queryByText('載入中…')).toBeNull())
    expect(backend.count('GET', '/api/v1/companies')).toBe(before + 1)
  })

  it('輸入法選字的 Enter 不搜尋', async () => {
    const backend = stubBackend()
    render(<CompaniesPage />)
    await screen.findByText('示範公司')
    const before = backend.calls.length

    expectImeEnterIgnored(screen.getByLabelText('搜尋公司'))

    expect(backend.calls).toHaveLength(before)
  })
})

describe('CompaniesPage 新增與改名表單（#507）', () => {
  it('連按 Enter 只新增一家公司', async () => {
    const gate = deferred()
    const backend = stubBackend({
      hold: (call) => (call.method === 'POST' ? gate : undefined),
    })
    render(<CompaniesPage />)
    await screen.findByText('示範公司')
    fireEvent.change(screen.getByLabelText('公司名稱'), {
      target: { value: '第二家公司' },
    })
    const form = formOf(screen.getByLabelText('公司名稱'))

    fireEvent.submit(form)
    fireEvent.submit(form)
    gate.resolve()

    await waitFor(() =>
      expect(screen.getByLabelText('公司名稱')).toHaveValue(''),
    )
    expect(backend.count('POST', '/api/v1/companies')).toBe(1)
  })

  it('失敗之後可以再送出', async () => {
    const backend = stubBackend({ fail: (call) => call.method === 'POST' })
    render(<CompaniesPage />)
    await screen.findByText('示範公司')
    fireEvent.change(screen.getByLabelText('公司名稱'), {
      target: { value: '第二家公司' },
    })
    const form = formOf(screen.getByLabelText('公司名稱'))

    fireEvent.submit(form)
    await screen.findByRole('alert')
    fireEvent.submit(form)

    await waitFor(() =>
      expect(backend.count('POST', '/api/v1/companies')).toBe(2),
    )
  })

  it('輸入法選字的 Enter 不送出', async () => {
    const backend = stubBackend()
    render(<CompaniesPage />)
    await screen.findByText('示範公司')
    fireEvent.change(screen.getByLabelText('公司名稱'), {
      target: { value: '第二家公司' },
    })

    expectImeEnterIgnored(screen.getByLabelText('公司名稱'))

    expect(backend.count('POST', '/api/v1/companies')).toBe(0)
  })
})

describe('CompaniesPage 停用公司（#507）', () => {
  it('連點「停用公司」只查一次啟用中的人員', async () => {
    const gate = deferred()
    const backend = stubBackend({
      hold: (call) => (call.path.endsWith('/active-users') ? gate : undefined),
    })
    render(<CompaniesPage />)
    await screen.findByText('示範公司')
    const button = screen.getByRole('button', { name: '停用公司' })

    fireEvent.click(button)
    fireEvent.click(button)
    gate.resolve()

    await screen.findByText('還有 1 位啟用中的人員')
    expect(backend.count('GET', /active-users$/)).toBe(1)
  })

  it('連點確認停用只送出一次', async () => {
    const gate = deferred()
    const backend = stubBackend({
      hold: (call) => (call.method === 'PUT' ? gate : undefined),
    })
    render(<CompaniesPage />)
    await screen.findByText('示範公司')
    fireEvent.click(screen.getByRole('button', { name: '停用公司' }))
    const confirm = await screen.findByRole('button', {
      name: '確認停用公司',
    })

    fireEvent.click(confirm)
    fireEvent.click(confirm)
    gate.resolve()

    await waitFor(() =>
      expect(screen.queryByText('還有 1 位啟用中的人員')).toBeNull(),
    )
    expect(backend.count('PUT', '/api/v1/companies/company-1/active')).toBe(1)
  })
})
