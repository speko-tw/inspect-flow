// 使用者與公司管理操作的確認框防護測試（#507）。

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
  module_permissions: [],
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
        const target = users.find((user) => user.id === id)
        if (target && call.method === 'PUT' && call.path.endsWith('/active')) {
          // 讓列表重新載入後反映新狀態（#527：停用後再啟用）。
          target.is_active = (
            JSON.parse(String(init?.body)) as { is_active: boolean }
          ).is_active
        }
        return Response.json(target ?? regularUser)
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

afterEach(() => {
  vi.unstubAllGlobals()
})

const userFormCases = [
  {
    name: '使用者資料編輯',
    open: '修改資料',
    button: '儲存資料',
    input: '帳號名稱',
    method: 'PATCH',
    path: '/api/v1/users/user-1',
    prepare: () => {},
  },
  {
    name: '使用者公司連結',
    open: '公司連結',
    button: '儲存公司連結',
    input: '公司',
    method: 'PUT',
    path: '/api/v1/users/user-1/company',
    prepare: (input: HTMLElement) =>
      fireEvent.change(input, { target: { value: '' } }),
  },
] as const

describe.each(userFormCases)('$name 共用表單', (formCase) => {
  async function openForm(options: Parameters<typeof stubBackend>[0] = {}) {
    const backend = stubBackend(options)
    renderUsers()
    const row = await screen.findByRole('row', { name: /anna\.deng/ })
    fireEvent.click(within(row).getByRole('button', { name: formCase.open }))
    const button = await screen.findByRole('button', { name: formCase.button })
    return {
      backend,
      button,
      form: button.closest('form')!,
      input: within(button.closest('form')!).getByLabelText(formCase.input),
    }
  }

  it('pending 期間只呼叫一次 API，並停用送出按鈕', async () => {
    const gate = deferred()
    const { backend, button, form } = await openForm({
      hold: (call) =>
        call.method === formCase.method && call.path === formCase.path
          ? gate
          : undefined,
    })

    formCase.prepare(within(form).getByLabelText(formCase.input))
    fireEvent.click(button)
    fireEvent.submit(form)
    expect(button).toBeDisabled()
    expect(backend.count(formCase.method, formCase.path)).toBe(1)
    gate.resolve()
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: formCase.button }),
      ).toBeNull(),
    )
  })

  it('IME Enter 不送出真實 API', async () => {
    const { backend, input } = await openForm()
    formCase.prepare(input)
    expectImeEnterIgnored(input)
    expect(backend.count(formCase.method, formCase.path)).toBe(0)
  })

  it('API 失敗後可再次送出', async () => {
    const backend = stubBackend({
      fail: (call) =>
        call.method === formCase.method && call.path === formCase.path,
    })
    renderUsers()
    const row = await screen.findByRole('row', { name: /anna\.deng/ })
    fireEvent.click(within(row).getByRole('button', { name: formCase.open }))
    const button = await screen.findByRole('button', { name: formCase.button })
    formCase.prepare(
      within(button.closest('form')!).getByLabelText(formCase.input),
    )
    fireEvent.click(button)
    await waitFor(() =>
      expect(backend.count(formCase.method, formCase.path)).toBe(1),
    )
    fireEvent.click(button)
    await waitFor(() =>
      expect(backend.count(formCase.method, formCase.path)).toBe(2),
    )
  })
})

describe('使用者管理搜尋共用表單', () => {
  it('搜尋 pending 鎖送出，IME 略過，失敗後可重試', async () => {
    const gate = deferred()
    let holding = false
    let failing = false
    const backend = stubBackend({
      hold: (call) =>
        holding && call.method === 'GET' && call.path === '/api/v1/users'
          ? gate
          : undefined,
      fail: (call) =>
        failing && call.method === 'GET' && call.path === '/api/v1/users',
    })
    renderUsers()
    await screen.findByRole('row', { name: /anna\.deng/ })
    const input = screen.getByLabelText('搜尋使用者')
    const button = screen.getByRole('button', { name: '搜尋' })
    const form = button.closest('form')!

    const initialCount = backend.count('GET', '/api/v1/users')
    expectImeEnterIgnored(input)
    expect(backend.count('GET', '/api/v1/users')).toBe(initialCount)

    holding = true
    const before = initialCount
    fireEvent.change(input, { target: { value: 'anna' } })
    fireEvent.click(button)
    fireEvent.submit(form)
    expect(button).toBeDisabled()
    expect(backend.count('GET', '/api/v1/users')).toBe(before + 1)
    gate.resolve()
    await waitFor(() => expect(button).toBeEnabled())

    failing = true
    fireEvent.click(button)
    await waitFor(() =>
      expect(backend.count('GET', '/api/v1/users')).toBe(before + 2),
    )
    failing = false
    fireEvent.click(button)
    await waitFor(() =>
      expect(backend.count('GET', '/api/v1/users')).toBe(before + 3),
    )
  })
})

describe('使用者新增共用表單', () => {
  function fillUserForm() {
    fireEvent.change(screen.getByLabelText(/^帳號名稱/), {
      target: { value: 'ben.lin' },
    })
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'ben@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/^中文姓名/), {
      target: { value: '林本' },
    })
    fireEvent.click(screen.getByRole('radio', { name: '內部人員' }))
  }

  it('新增 pending 鎖送出，IME 略過，失敗後可重試', async () => {
    const gate = deferred()
    let failing = false
    const backend = stubBackend({
      hold: (call) =>
        call.method === 'POST' && call.path === '/api/v1/users'
          ? gate
          : undefined,
      fail: (call) =>
        failing && call.method === 'POST' && call.path === '/api/v1/users',
    })
    renderUsers()
    await screen.findByRole('row', { name: /anna\.deng/ })
    fillUserForm()
    const button = screen.getByRole('button', { name: '新增使用者' })
    const form = button.closest('form')!
    const input = screen.getByLabelText(/^帳號名稱/)

    expectImeEnterIgnored(input)
    expect(backend.count('POST', '/api/v1/users')).toBe(0)
    fireEvent.click(button)
    fireEvent.submit(form)
    expect(button).toBeDisabled()
    expect(backend.count('POST', '/api/v1/users')).toBe(1)
    gate.resolve()
    await waitFor(() => expect(button).toBeEnabled())

    failing = true
    fillUserForm()
    fireEvent.click(button)
    await waitFor(() => expect(backend.count('POST', '/api/v1/users')).toBe(2))
    failing = false
    fireEvent.click(button)
    await waitFor(() => expect(backend.count('POST', '/api/v1/users')).toBe(3))
  })
})

const companyFormCases = [
  {
    name: '公司管理搜尋',
    button: '搜尋',
    field: '搜尋公司',
    method: 'GET',
    path: '/api/v1/companies',
  },
  {
    name: '公司管理新增',
    button: '新增公司',
    field: '公司名稱',
    method: 'POST',
    path: '/api/v1/companies',
  },
] as const

describe.each(companyFormCases)('$name 共用表單', (formCase) => {
  async function setup() {
    const gate = deferred()
    let hold = false
    let fail = false
    const backend = stubBackend({
      hold: (call) =>
        hold && call.method === formCase.method && call.path === formCase.path
          ? gate
          : undefined,
      fail: (call) =>
        fail && call.method === formCase.method && call.path === formCase.path,
    })
    render(<CompaniesPage />)
    await screen.findByText('示範公司')
    const button = screen.getByRole('button', { name: formCase.button })
    const form = button.closest('form')!
    const field = within(form).getByLabelText(formCase.field)
    if (formCase.method === 'POST') {
      fireEvent.change(field, { target: { value: '第二示範公司' } })
    } else {
      fireEvent.change(field, { target: { value: '示範' } })
    }
    return {
      backend,
      button,
      field,
      form,
      baseline: backend.count(formCase.method, formCase.path),
      gate,
      hold: () => {
        hold = true
      },
      fail: (value: boolean) => {
        fail = value
      },
    }
  }

  it('真實頁面 API pending 時只送一次，並停用按鈕', async () => {
    const test = await setup()
    test.hold()
    fireEvent.click(test.button)
    fireEvent.submit(test.form)
    expect(test.button).toBeDisabled()
    const expected = test.baseline + 1
    expect(test.backend.count(formCase.method, formCase.path)).toBe(expected)
    test.gate.resolve()
    await waitFor(() => expect(test.button).toBeEnabled())
  })

  it('IME Enter 不送出真實 API', async () => {
    const test = await setup()
    expectImeEnterIgnored(test.field)
    expect(test.backend.count(formCase.method, formCase.path)).toBe(
      test.baseline,
    )
  })

  it('API 失敗後可以再次送出', async () => {
    const test = await setup()
    const expected = test.baseline + 1
    test.fail(true)
    fireEvent.click(test.button)
    await waitFor(() =>
      expect(test.backend.count(formCase.method, formCase.path)).toBe(
        expected,
      ),
    )
    test.fail(false)
    fireEvent.click(test.button)
    await waitFor(() =>
      expect(test.backend.count(formCase.method, formCase.path)).toBe(
        expected + 1,
      ),
    )
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

describe('UsersPage 確認框顏色依動作效果（#527）', () => {
  const adminUser: User = {
    ...regularUser,
    id: 'user-9',
    username: 'amy.admin',
    email: 'amy@example.com',
    is_admin: true,
  }

  async function openFor(
    username: RegExp,
    button: string,
  ): Promise<HTMLElement> {
    const row = await screen.findByRole('row', { name: username })
    fireEvent.click(within(row).getByRole('button', { name: button }))
    return screen.getByRole('region', { name: '操作確認' })
  }

  function confirmButton(box: HTMLElement) {
    return within(box).getByRole('button', { name: '確認' })
  }

  it('停用是紅色', async () => {
    stubBackend()
    renderUsers()
    const box = await openFor(/anna\.deng/, '停用')

    expect(box).toHaveClass('confirm-box-danger')
    expect(confirmButton(box)).toHaveClass('btn-danger')
  })

  it('啟用是一般主色，確認前不送出，確認後才送出', async () => {
    const backend = stubBackend({
      users: [{ ...regularUser, is_active: false }],
    })
    renderUsers()
    const box = await openFor(/anna\.deng/, '啟用')

    expect(box).toHaveClass('confirm-box-neutral')
    expect(confirmButton(box)).toHaveClass('btn-primary')
    expect(box).toHaveTextContent('可以再次登入')
    expect(backend.count('PUT', '/api/v1/users/user-1/active')).toBe(0)

    fireEvent.click(confirmButton(box))

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: '操作確認' })).toBeNull(),
    )
    expect(backend.count('PUT', '/api/v1/users/user-1/active')).toBe(1)
  })

  it('指派管理者是一般主色', async () => {
    stubBackend()
    renderUsers()
    const box = await openFor(/anna\.deng/, '指派管理者')

    expect(box).toHaveClass('confirm-box-neutral')
    expect(confirmButton(box)).toHaveClass('btn-primary')
  })

  it('收回管理者是紅色', async () => {
    stubBackend({ users: [adminUser] })
    renderUsers()
    const box = await openFor(/amy\.admin/, '收回管理者')

    expect(box).toHaveClass('confirm-box-danger')
    expect(confirmButton(box)).toHaveClass('btn-danger')
  })

  it('管理者帳號停用是紅色，停用後再啟用是一般主色', async () => {
    const backend = stubBackend({ users: [{ ...adminUser }] })
    renderUsers()
    const deactivation = await openFor(/amy\.admin/, '停用')
    expect(deactivation).toHaveClass('confirm-box-danger')

    fireEvent.click(confirmButton(deactivation))
    await waitFor(() =>
      expect(backend.count('PUT', '/api/v1/users/user-9/active')).toBe(1),
    )
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: '操作確認' })).toBeNull(),
    )

    const activation = await openFor(/amy\.admin/, '啟用')
    expect(activation).toHaveClass('confirm-box-neutral')
    expect(confirmButton(activation)).toHaveClass('btn-primary')
    expect(confirmButton(activation)).not.toHaveClass('btn-danger')
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

describe('CompaniesPage 停用公司（#507）', () => {
  it('連點「停用公司」只查一次啟用中的人員', async () => {
    const gate = deferred()
    const backend = stubBackend({
      hold: (call) => (call.path.endsWith('/active-users') ? gate : undefined),
    })
    render(<CompaniesPage />)
    await screen.findByText('示範公司')
    const button = screen.getByRole('button', { name: '停用公司' })
    expect(screen.getByText('停用公司不會自動停用人員帳號。')).toBeVisible()

    fireEvent.click(button)
    fireEvent.click(button)
    gate.resolve()

    await screen.findByText('還有 1 位啟用中的人員')
    expect(
      screen.getByText(
        '只有勾選的人員會一併停用；未選取的人員帳號會維持啟用。',
      ),
    ).toBeVisible()
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
