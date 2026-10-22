// 使用者與公司管理操作的確認框防護測試（#507）。

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { DataMemoryRouter } from '../testing/DataMemoryRouter'
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
import type { Company, RestorePreview, User } from './api'

const company: Company = { id: 'company-1', name: '示範公司', is_active: true }

const regularUser: User = {
  id: 'user-1',
  username: 'anna.deng',
  email: 'anna@example.com',
  name_zh: '鄧安娜',
  name_en: null,
  company_id: company.id,
  company_name: company.name,
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

type Call = { method: string; path: string; body: string }

/**
 * 列表請求立刻回應；`hold` 回傳 Deferred 時，該請求等到它完成才回應
 * （模擬「請求還沒回來」）。`fail` 預設回 500，也可指定 API 錯誤。
 */
function stubBackend(
  options: {
    hold?: (call: Call) => Deferred<void> | undefined
    fail?: (call: Call) => boolean
    failureCode?: string
    failureStatus?: number
    users?: User[]
    companies?: Company[]
    activeCompanyUsers?: Record<
      string,
      Array<{ id: string; username: string; name_zh: string | null }>
    >
    preview?: Partial<RestorePreview>
    temporaryPassword?: string
  } = {},
) {
  const users = (options.users ?? [regularUser]).map((user) => ({ ...user }))
  const companies = (options.companies ?? [company]).map((item) => ({
    ...item,
  }))
  const calls: Call[] = []
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://testserver')
      const call = {
        method: init?.method ?? 'GET',
        path: url.pathname,
        body: String(init?.body ?? ''),
      }
      calls.push(call)
      const gate = options.hold?.(call)
      if (gate) await gate.promise
      if (options.fail?.(call)) {
        return Response.json(
          { error: { code: options.failureCode ?? 'x' } },
          { status: options.failureStatus ?? 500 },
        )
      }
      if (call.method === 'GET') {
        if (call.path === '/api/v1/users') {
          return Response.json({ items: users, next_cursor: null })
        }
        if (call.path === '/api/v1/companies') {
          return Response.json({ items: companies, next_cursor: null })
        }
        if (call.path.endsWith('/deactivation-check')) {
          return Response.json({
            user_id: 'user-1',
            last_manager_projects: [],
          })
        }
        if (call.path.endsWith('/reactivation-preview')) {
          const userId = call.path.split('/')[4]
          const previewUser = users.find((user) => user.id === userId)
          return Response.json({
            user_id: userId,
            username: previewUser?.username ?? 'anna.deng',
            is_external_collaborator: false,
            account_expires_on: null,
            account_expired: false,
            permission_codes: [],
            delegated_modules: [],
            project_memberships: [],
            tasks: [],
            ...options.preview,
          })
        }
        if (call.path.includes('/external-without-project')) {
          return Response.json({ items: [], next_cursor: null })
        }
        if (call.path.includes('/projects/unmanaged')) {
          return Response.json({ items: [], next_cursor: null })
        }
        if (call.path.endsWith('/active-users')) {
          const companyId = call.path.split('/')[4]
          const companyUsers = options.activeCompanyUsers?.[companyId] ?? [
            { id: 'user-1', username: 'anna.deng', name_zh: '鄧安娜' },
          ]
          return Response.json({
            count: companyUsers.length,
            users: companyUsers,
          })
        }
      }
      if (
        call.method === 'POST' &&
        call.path === '/api/v1/companies:batch-status'
      ) {
        const body = JSON.parse(call.body) as {
          items: Array<{ company_id: string; is_active: boolean }>
        }
        const updated = body.items.map((item) => {
          const target = companies.find(
            (entry) => entry.id === item.company_id,
          )
          if (target) target.is_active = item.is_active
          return target
        })
        return Response.json({ items: updated })
      }
      if (
        call.method === 'POST' &&
        call.path === '/api/v1/users:batch-active-status'
      ) {
        const body = JSON.parse(call.body) as {
          user_ids: string[]
          is_active: boolean
        }
        for (const user of users) {
          if (body.user_ids.includes(user.id)) user.is_active = body.is_active
        }
        return Response.json({
          items: users.filter((user) => body.user_ids.includes(user.id)),
        })
      }
      if (call.path.startsWith('/api/v1/users/')) {
        const id = call.path.split('/')[4]
        const target = users.find((user) => user.id === id)
        if (
          call.method === 'POST' &&
          call.path.endsWith('/temporary-password')
        ) {
          return Response.json({
            user_id: id,
            username: target?.username ?? regularUser.username,
            temporary_password: options.temporaryPassword ?? 'Temp-Pass-123',
            must_change_password: true,
          })
        }
        if (target && call.method === 'PUT' && call.path.endsWith('/active')) {
          // 讓列表重新載入後反映新狀態（#527：停用後再啟用）。
          target.is_active = (
            JSON.parse(String(init?.body)) as { is_active: boolean }
          ).is_active
        }
        if (
          target &&
          call.method === 'POST' &&
          call.path.endsWith(':reactivate')
        ) {
          target.is_active = true
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

function renderUsers(
  pageProps: {
    detailUserId?: string | null
    initialQuery?: string
    onQueryApplied?: (query: string) => void
    onSelectUser?: (id: string) => void
    onTemporaryPassword?: (
      username: string,
      password: string,
      source?: 'created' | 'reset',
    ) => void
  } = {},
) {
  const onTemporaryPassword = pageProps.onTemporaryPassword ?? vi.fn()
  render(
    <DataMemoryRouter>
      <CurrentUserProvider value={{ user: currentUser, clear: vi.fn() }}>
        <UsersPage onTemporaryPassword={onTemporaryPassword} {...pageProps} />
      </CurrentUserProvider>
    </DataMemoryRouter>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('UsersPage 帳號詳情', () => {
  it('列表使用 User.company_name 且不載入全公司清單', async () => {
    const backend = stubBackend()
    renderUsers({
      initialQuery: '',
    })

    const row = await screen.findByRole('row', { name: /anna\.deng/ })
    expect(within(row).getByText('示範公司／工程部')).toBeVisible()
    expect(backend.count('GET', '/api/v1/companies')).toBe(0)
  })

  it('開啟公司連結表單時才載入公司選項', async () => {
    const backend = stubBackend()
    renderUsers()

    const row = await screen.findByRole('row', { name: /anna\.deng/ })
    expect(backend.count('GET', '/api/v1/companies')).toBe(0)
    fireEvent.click(within(row).getByRole('button', { name: '公司連結' }))

    await waitFor(() => {
      expect(backend.count('GET', '/api/v1/companies')).toBe(1)
    })
    expect(
      await within(
        screen.getByRole('heading', { name: '連結公司' }).closest('form')!,
      ).findByRole('option', { name: '示範公司' }),
    ).toBeVisible()
  })

  it('延後載入外部帳號與無管理者專案提醒，展開時才送出請求', async () => {
    const backend = stubBackend()
    renderUsers()

    await screen.findByRole('row', { name: /anna\.deng/ })
    expect(
      backend.count('GET', /\/admin\/users\/external-without-project/),
    ).toBe(0)
    expect(backend.count('GET', /\/admin\/projects\/unmanaged/)).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: '檢查帳號與專案提醒' }))

    await waitFor(() => {
      expect(
        backend.count('GET', /\/admin\/users\/external-without-project/),
      ).toBe(1)
      expect(backend.count('GET', /\/admin\/projects\/unmanaged/)).toBe(1)
    })
  })

  it('shows basic account data without the list or create form', async () => {
    stubBackend()
    renderUsers({ detailUserId: 'user-1' })

    expect(
      await screen.findByRole('heading', { name: '鄧安娜' }),
    ).toBeVisible()
    expect(screen.getByText('帳號：anna.deng')).toBeVisible()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('button', { name: '新增帳號' })).toBeNull()
  })

  it('keeps system and non-local account edit guards in detail', async () => {
    const protectedAccount = {
      ...regularUser,
      is_system: true,
      auth_source: 'external',
    }
    stubBackend({ users: [protectedAccount] })
    renderUsers({ detailUserId: 'user-1' })
    await screen.findByRole('heading', { name: '鄧安娜' })
    fireEvent.click(screen.getByText('更多'))

    expect(screen.getByRole('button', { name: '修改資料' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '修改公司連結' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '指派管理者' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '停用帳號' })).toBeDisabled()
  })

  it('由帳號詳情重設臨時密碼並只回報這次結果', async () => {
    const onTemporaryPassword = vi.fn()
    const backend = stubBackend({ temporaryPassword: 'One-Time-123' })
    renderUsers({ detailUserId: 'user-1', onTemporaryPassword })
    await screen.findByRole('heading', { name: '鄧安娜' })
    fireEvent.click(screen.getByText('更多'))
    fireEvent.click(screen.getByRole('button', { name: '重設臨時密碼' }))

    await waitFor(() => {
      expect(
        backend.count('POST', '/api/v1/users/user-1/temporary-password'),
      ).toBe(1)
      expect(onTemporaryPassword).toHaveBeenCalledWith(
        'anna.deng',
        'One-Time-123',
        'reset',
      )
    })
  })

  it('重設臨時密碼失敗時顯示錯誤且不送第二次或清除帳號', async () => {
    const onTemporaryPassword = vi.fn()
    const backend = stubBackend({
      fail: (call) => call.path.endsWith('/temporary-password'),
    })
    renderUsers({ detailUserId: 'user-1', onTemporaryPassword })
    await screen.findByRole('heading', { name: '鄧安娜' })
    fireEvent.click(screen.getByText('更多'))
    fireEvent.click(screen.getByRole('button', { name: '重設臨時密碼' }))

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.getByRole('heading', { name: '鄧安娜' })).toBeVisible()
    expect(onTemporaryPassword).not.toHaveBeenCalled()
    expect(
      backend.count('POST', '/api/v1/users/user-1/temporary-password'),
    ).toBe(1)
  })

  it('requires in-page confirmation before deactivating from account detail', async () => {
    const backend = stubBackend({ users: [{ ...regularUser }] })
    renderUsers({ detailUserId: 'user-1' })
    await screen.findByRole('heading', { name: '鄧安娜' })
    fireEvent.click(screen.getByText('更多'))
    fireEvent.click(screen.getByRole('button', { name: '停用帳號' }))

    const panel = await screen.findByRole('region', { name: '操作確認' })
    expect(panel).toHaveClass('confirm-box-danger')
    expect(backend.count('PUT', '/api/v1/users/user-1/active')).toBe(0)
    fireEvent.click(within(panel).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('region', { name: '操作確認' })).toBeNull()
    expect(backend.count('PUT', '/api/v1/users/user-1/active')).toBe(0)

    fireEvent.click(screen.getByText('更多'))
    fireEvent.click(screen.getByRole('button', { name: '停用帳號' }))
    const confirmed = await screen.findByRole('region', { name: '操作確認' })
    await waitFor(() =>
      expect(
        within(confirmed).getByRole('button', { name: '確認' }),
      ).toBeEnabled(),
    )
    fireEvent.click(within(confirmed).getByRole('button', { name: '確認' }))
    await waitFor(() =>
      expect(backend.count('PUT', '/api/v1/users/user-1/active')).toBe(1),
    )
  })
})

describe('UsersPage 帳號清單導覽', () => {
  it('renders the account name as an unbordered detail link', async () => {
    stubBackend()
    renderUsers({ onSelectUser: vi.fn() })

    const accountLink = await screen.findByRole('link', { name: '鄧安娜' })
    expect(accountLink).toHaveAttribute('href', '/accounts/user-1')
    expect(accountLink).toHaveClass('users-account-name-link')
    expect(
      screen.queryByRole('button', { name: '鄧安娜' }),
    ).not.toBeInTheDocument()
  })
})

describe('自己的帳號保護（#414）', () => {
  const self = { ...regularUser, id: currentUser.id, username: 'me.admin' }
  it('不可勾選自己，並顯示原因', async () => {
    stubBackend({ users: [self] })
    renderUsers()
    expect(
      await screen.findByRole('checkbox', {
        name: '選取 me.admin',
      }),
    ).toBeDisabled()
    expect(screen.getByText('不能批次停用自己的帳號。')).toBeVisible()
  })
  it('詳情不可重設自己的臨時密碼，並顯示原因', async () => {
    stubBackend({ users: [self] })
    renderUsers({ detailUserId: self.id })
    await screen.findByRole('heading', { name: '鄧安娜' })
    fireEvent.click(screen.getByText('更多'))
    expect(screen.getByRole('button', { name: '重設臨時密碼' })).toBeDisabled()
    expect(screen.getByText('請到設定變更自己的密碼。')).toBeVisible()
  })
})

describe('UsersPage 批次停用帳號（#414）', () => {
  it('只送出已選帳號並在請求完成前顯示停用中狀態', async () => {
    const secondUser = { ...regularUser, id: 'user-2', username: 'bob.lin' }
    const gate = deferred()
    const backend = stubBackend({
      users: [regularUser, secondUser],
      hold: (call) =>
        call.path.endsWith(':batch-active-status') ? gate : undefined,
    })
    renderUsers({ onSelectUser: vi.fn() })
    await screen.findByRole('row', { name: /anna\.deng/ })
    fireEvent.click(screen.getByRole('checkbox', { name: '選取 anna.deng' }))
    fireEvent.click(screen.getByRole('button', { name: '批次停用帳號' }))
    fireEvent.click(
      await screen.findByRole('button', { name: '確認停用帳號' }),
    )

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '正在停用帳號…' }),
      ).toBeDisabled()
    })
    expect(
      backend.calls.find((call) => call.path.endsWith(':batch-active-status')),
    ).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ user_ids: ['user-1'], is_active: false }),
    })
    gate.resolve()
    expect(await screen.findByRole('status')).toHaveTextContent(
      '已停用 1 個帳號',
    )
  })

  it('整批失敗時保留原狀態與勾選，並顯示可讀錯誤', async () => {
    const backend = stubBackend({
      fail: (call) => call.path.endsWith(':batch-active-status'),
    })
    renderUsers({ onSelectUser: vi.fn() })
    const row = await screen.findByRole('row', { name: /anna\.deng/ })
    fireEvent.click(screen.getByRole('checkbox', { name: '選取 anna.deng' }))
    fireEvent.click(screen.getByRole('button', { name: '批次停用帳號' }))
    fireEvent.click(
      await screen.findByRole('button', { name: '確認停用帳號' }),
    )

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(within(row).getByText('啟用')).toBeVisible()
    expect(
      screen.getByRole('checkbox', { name: '選取 anna.deng' }),
    ).toBeChecked()
    expect(backend.count('POST', /:batch-active-status$/)).toBe(1)
  })

  it('批次啟用逐帳號顯示恢復項目，依勾選提交 restore bundle', async () => {
    const backend = stubBackend({
      users: [{ ...regularUser, is_active: false }],
      preview: {
        permission_codes: ['project.use'],
        delegated_modules: ['inspection'],
        project_memberships: [
          {
            project_id: 'project-1',
            project_code: 'P-1',
            project_name: '測試專案',
          },
        ],
        tasks: [
          {
            task_id: 'task-1',
            project_id: 'project-1',
            name: '未完成任務',
            status: 'PENDING',
          },
        ],
      },
    })
    renderUsers({ onSelectUser: vi.fn() })
    await screen.findByRole('row', { name: /anna\.deng/ })
    fireEvent.click(screen.getByRole('checkbox', { name: '選取 anna.deng' }))
    fireEvent.click(screen.getByRole('button', { name: '批次啟用帳號' }))

    const box = await screen.findByRole('region', { name: '批次啟用確認' })
    expect(within(box).getByText('project.use')).toBeVisible()
    expect(within(box).getByText('inspection')).toBeVisible()
    expect(within(box).getByText(/P-1／測試專案/)).toBeVisible()
    expect(within(box).getByText('未完成任務')).toBeVisible()
    fireEvent.click(within(box).getByLabelText('project.use'))
    fireEvent.click(within(box).getByLabelText('inspection'))
    fireEvent.click(within(box).getByLabelText(/P-1／測試專案/))
    fireEvent.click(within(box).getByLabelText(/未完成任務/))
    fireEvent.click(within(box).getByRole('button', { name: '確認啟用帳號' }))

    await waitFor(() => {
      expect(
        backend.calls.find((call) =>
          call.path.endsWith(':batch-active-status'),
        )?.body,
      ).toBe(
        JSON.stringify({
          user_ids: ['user-1'],
          is_active: true,
          restore: [
            {
              user_id: 'user-1',
              restore: {
                permission_codes: ['project.use'],
                delegated_modules: ['inspection'],
                project_ids: ['project-1'],
                task_ids: ['task-1'],
              },
            },
          ],
        }),
      )
    })
  })

  it('批次啟用整批失敗時保留原狀態與選取', async () => {
    const backend = stubBackend({
      users: [{ ...regularUser, is_active: false }],
      fail: (call) => call.path.endsWith(':batch-active-status'),
    })
    renderUsers({ onSelectUser: vi.fn() })
    const row = await screen.findByRole('row', { name: /anna\.deng/ })
    fireEvent.click(screen.getByRole('checkbox', { name: '選取 anna.deng' }))
    fireEvent.click(screen.getByRole('button', { name: '批次啟用帳號' }))
    const box = await screen.findByRole('region', { name: '批次啟用確認' })
    fireEvent.click(within(box).getByRole('button', { name: '確認啟用帳號' }))

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(within(row).getByText('停用')).toBeVisible()
    expect(
      screen.getByRole('checkbox', { name: '選取 anna.deng' }),
    ).toBeChecked()
    expect(backend.count('POST', /:batch-active-status$/)).toBe(1)
  })

  it('批次啟用各帳號保留獨立的恢復勾選', async () => {
    const bob = {
      ...regularUser,
      id: 'user-2',
      username: 'bob.lin',
      is_active: false,
    }
    const backend = stubBackend({
      users: [{ ...regularUser, is_active: false }, bob],
      preview: {
        permission_codes: ['project.use'],
        project_memberships: [
          {
            project_id: 'project-1',
            project_code: 'P-1',
            project_name: '測試專案',
          },
        ],
      },
    })
    renderUsers({ onSelectUser: vi.fn() })
    await screen.findByRole('row', { name: /anna\.deng/ })
    fireEvent.click(screen.getByRole('checkbox', { name: '選取 anna.deng' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '選取 bob.lin' }))
    fireEvent.click(screen.getByRole('button', { name: '批次啟用帳號' }))

    const box = await screen.findByRole('region', { name: '批次啟用確認' })
    const anna = within(box).getByRole('group', { name: 'anna.deng' })
    const bobGroup = within(box).getByRole('group', { name: 'bob.lin' })
    fireEvent.click(within(anna).getByLabelText('project.use'))
    fireEvent.click(within(bobGroup).getByLabelText(/P-1／測試專案/))
    fireEvent.click(within(box).getByRole('button', { name: '確認啟用帳號' }))

    await waitFor(() => {
      const call = backend.calls.find((item) =>
        item.path.endsWith(':batch-active-status'),
      )
      expect(call && JSON.parse(call.body)).toEqual({
        user_ids: ['user-1', 'user-2'],
        is_active: true,
        restore: [
          {
            user_id: 'user-1',
            restore: {
              permission_codes: ['project.use'],
              delegated_modules: [],
              project_ids: [],
              task_ids: [],
            },
          },
          {
            user_id: 'user-2',
            restore: {
              permission_codes: [],
              delegated_modules: [],
              project_ids: ['project-1'],
              task_ids: [],
            },
          },
        ],
      })
    })
  })

  it('到期外部帳號不能透過批次啟用確認', async () => {
    const backend = stubBackend({
      users: [
        {
          ...regularUser,
          is_active: false,
          is_external_collaborator: true,
        },
      ],
      preview: { account_expired: true },
    })
    renderUsers({ onSelectUser: vi.fn() })
    await screen.findByRole('row', { name: /anna\.deng/ })
    fireEvent.click(screen.getByRole('checkbox', { name: '選取 anna.deng' }))
    fireEvent.click(screen.getByRole('button', { name: '批次啟用帳號' }))
    const box = await screen.findByRole('region', { name: '批次啟用確認' })

    expect(within(box).getByRole('alert')).toHaveTextContent('外部帳號已到期')
    expect(
      within(box).getByRole('button', { name: '確認啟用帳號' }),
    ).toBeDisabled()
    expect(backend.count('POST', /:batch-active-status$/)).toBe(0)
  })
})

const userFormCases = [
  {
    name: '使用者資料編輯',
    open: '修改資料',
    button: '儲存資料',
    input: '帳號名稱',
    method: 'PATCH',
    path: '/api/v1/users/user-1',
    prepare: (input: HTMLElement) =>
      fireEvent.change(input, { target: { value: 'changed' } }),
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

  it('實際修改欄位會攔截 beforeunload', async () => {
    const { form, input } = await openForm()
    formCase.prepare(input)
    const event = new Event('beforeunload', { cancelable: true })

    window.dispatchEvent(event)

    expect(form).toBeInTheDocument()
    expect(event.defaultPrevented).toBe(true)
  })

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

describe('使用者公司連結錯誤', () => {
  it('工號衝突時說明如何修正後重試', async () => {
    const unlinkedUser = {
      ...regularUser,
      company_id: null,
      department: null,
      employee_no: null,
      location: null,
    }
    const backend = stubBackend({
      users: [unlinkedUser],
      fail: (call) =>
        call.method === 'PUT' && call.path === '/api/v1/users/user-1/company',
      failureCode: 'user.employee_no_conflict',
      failureStatus: 409,
    })
    renderUsers()
    const row = await screen.findByRole('row', { name: /anna\.deng/ })
    fireEvent.click(within(row).getByRole('button', { name: '公司連結' }))
    const form = within(
      screen.getByRole('heading', { name: '連結公司' }).closest('form')!,
    )
    await form.findByRole('option', { name: '示範公司' })
    fireEvent.change(form.getByLabelText('公司'), {
      target: { value: company.id },
    })
    fireEvent.change(form.getByLabelText('工號'), {
      target: { value: 'A001' },
    })
    fireEvent.click(form.getByRole('button', { name: '儲存公司連結' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '這家公司已有相同工號。請修改工號，讓它在該公司內唯一後再試一次。',
    )
    expect(backend.count('PUT', '/api/v1/users/user-1/company')).toBe(1)
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
    const input = screen.getByLabelText('搜尋帳號')
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
    fireEvent.click(screen.getByRole('radio', { name: '內部帳號' }))
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
    const button = screen.getByRole('button', { name: '新增帳號' })
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
    render(
      <DataMemoryRouter>
        <CurrentUserProvider value={{ user: currentUser, clear: vi.fn() }}>
          <CompaniesPage />
        </CurrentUserProvider>
      </DataMemoryRouter>,
    )
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

    await waitFor(() => expect(confirmButton(box)).toBeEnabled())
    fireEvent.click(confirmButton(box))

    const restoreRequestCount = () =>
      backend.count('POST', '/api/v1/users/user-1:reactivate')
    await waitFor(() => expect(restoreRequestCount()).toBe(1))
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: '操作確認' })).toBeNull(),
    )
  })

  it('啟用只送出 Admin 勾選的預覽項目', async () => {
    const backend = stubBackend({
      users: [{ ...regularUser, is_active: false }],
      preview: {
        permission_codes: ['project.use'],
        delegated_modules: ['inspection'],
        project_memberships: [
          {
            project_id: 'project-1',
            project_code: 'P-1',
            project_name: '測試專案',
          },
        ],
        tasks: [
          {
            task_id: 'task-1',
            project_id: 'project-1',
            name: '未完成任務',
            status: 'PENDING',
          },
        ],
      },
    })
    renderUsers()
    const box = await openFor(/anna\.deng/, '啟用')
    const permission = await within(box).findByLabelText('project.use')
    const membership = within(box).getByLabelText(/P-1／測試專案/)
    fireEvent.click(permission)
    fireEvent.click(membership)
    await waitFor(() => expect(confirmButton(box)).toBeEnabled())
    fireEvent.click(confirmButton(box))

    await waitFor(() =>
      expect(
        backend.calls.find((call) => call.path.endsWith(':reactivate'))?.body,
      ).toBe(
        JSON.stringify({
          restore: {
            permission_codes: ['project.use'],
            delegated_modules: [],
            project_ids: ['project-1'],
            task_ids: [],
          },
        }),
      ),
    )
  })

  it('到期的外部帳號顯示提示並阻止確認', async () => {
    stubBackend({
      users: [
        {
          ...regularUser,
          is_active: false,
          is_external_collaborator: true,
        },
      ],
      preview: { account_expired: true },
    })
    renderUsers()
    const box = await openFor(/anna\.deng/, '啟用')
    expect(await within(box).findByRole('alert')).toHaveTextContent(
      '外部帳號已到期',
    )
    expect(confirmButton(box)).toBeDisabled()
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

    await waitFor(() => expect(confirmButton(deactivation)).toBeEnabled())
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
    render(
      <DataMemoryRouter>
        <CurrentUserProvider value={{ user: currentUser, clear: vi.fn() }}>
          <CompaniesPage />
        </CurrentUserProvider>
      </DataMemoryRouter>,
    )
    await screen.findByText('示範公司')
    const button = screen.getByRole('button', { name: '停用公司' })
    expect(screen.getByText('停用公司不會自動停用帳號。')).toBeVisible()

    fireEvent.click(button)
    fireEvent.click(button)
    gate.resolve()

    await screen.findByText('還有 1 個啟用中的帳號')
    expect(
      screen.getByText('只有勾選的帳號會一併停用；未選取的帳號會維持啟用。'),
    ).toBeVisible()
    expect(backend.count('GET', /active-users$/)).toBe(1)
  })

  it('連點確認停用只送出一次', async () => {
    const gate = deferred()
    const backend = stubBackend({
      hold: (call) => (call.method === 'PUT' ? gate : undefined),
    })
    render(
      <DataMemoryRouter>
        <CurrentUserProvider value={{ user: currentUser, clear: vi.fn() }}>
          <CompaniesPage />
        </CurrentUserProvider>
      </DataMemoryRouter>,
    )
    await screen.findByText('示範公司')
    fireEvent.click(screen.getByRole('button', { name: '停用公司' }))
    const confirm = await screen.findByRole('button', {
      name: '確認停用公司',
    })

    fireEvent.click(confirm)
    fireEvent.click(confirm)
    gate.resolve()

    await waitFor(() =>
      expect(screen.queryByText('還有 1 個啟用中的帳號')).toBeNull(),
    )
    expect(backend.count('PUT', '/api/v1/companies/company-1/active')).toBe(1)
  })
})

describe('CompaniesPage 批次狀態（#414）', () => {
  it('一併停用帳號時不能選自己，並說明原因', async () => {
    stubBackend({
      activeCompanyUsers: {
        'company-1': [
          { id: currentUser.id, username: 'me.admin', name_zh: '我' },
        ],
      },
    })
    render(
      <DataMemoryRouter>
        <CurrentUserProvider value={{ user: currentUser, clear: vi.fn() }}>
          <CompaniesPage />
        </CurrentUserProvider>
      </DataMemoryRouter>,
    )
    await screen.findByText('示範公司')
    fireEvent.click(
      screen.getByRole('checkbox', { name: '選取公司 示範公司' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '批次停用公司' }))
    expect(
      await screen.findByRole('checkbox', { name: /我（me.admin）/ }),
    ).toBeDisabled()
    expect(screen.getByText('不能批次停用自己的帳號。')).toBeVisible()
  })

  it('停用前逐公司確認並送出原子批次本體', async () => {
    const gate = deferred()
    const backend = stubBackend({
      hold: (call) => (call.path.endsWith(':batch-status') ? gate : undefined),
    })
    render(
      <DataMemoryRouter>
        <CurrentUserProvider value={{ user: currentUser, clear: vi.fn() }}>
          <CompaniesPage />
        </CurrentUserProvider>
      </DataMemoryRouter>,
    )
    await screen.findByText('示範公司')
    fireEvent.click(
      screen.getByRole('checkbox', { name: '選取公司 示範公司' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '批次停用公司' }))

    const confirm = await screen.findByRole('button', {
      name: '確認批次停用公司',
    })
    expect(await screen.findByText('選擇要一併停用的帳號')).toBeVisible()
    fireEvent.click(screen.getByRole('checkbox', { name: /鄧安娜/ }))
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '正在停用公司…' }),
      ).toBeDisabled(),
    )
    expect(backend.count('POST', '/api/v1/companies:batch-status')).toBe(1)
    expect(
      backend.calls.find((call) => call.path.endsWith(':batch-status'))?.body,
    ).toBe(
      JSON.stringify({
        items: [
          {
            company_id: 'company-1',
            is_active: false,
            disable_user_ids: ['user-1'],
          },
        ],
      }),
    )
    gate.resolve()
    expect(await screen.findByRole('status')).toHaveTextContent(
      '已停用 1 間公司',
    )
  })

  it('批次失敗時保留公司狀態與勾選，顯示錯誤', async () => {
    const backend = stubBackend({
      fail: (call) => call.path.endsWith(':batch-status'),
    })
    render(
      <DataMemoryRouter>
        <CurrentUserProvider value={{ user: currentUser, clear: vi.fn() }}>
          <CompaniesPage />
        </CurrentUserProvider>
      </DataMemoryRouter>,
    )
    const row = await screen.findByRole('row', { name: /示範公司/ })
    fireEvent.click(
      screen.getByRole('checkbox', { name: '選取公司 示範公司' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '批次停用公司' }))
    fireEvent.click(
      await screen.findByRole('button', { name: '確認批次停用公司' }),
    )

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(within(row).getByText('啟用')).toBeVisible()
    expect(
      screen.getByRole('checkbox', { name: '選取公司 示範公司' }),
    ).toBeChecked()
    expect(backend.count('POST', '/api/v1/companies:batch-status')).toBe(1)
  })
})
