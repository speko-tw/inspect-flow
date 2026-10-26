// 使用者與公司管理操作的確認框防護測試（#507）。

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
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
import type { ParticipatingProject } from './module-permissions/api'

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
    detailUser?: User
    companies?: Company[]
    activeCompanyUsers?: Record<
      string,
      Array<{ id: string; username: string; name_zh: string | null }>
    >
    preview?: Partial<RestorePreview>
    previews?: Record<string, Partial<RestorePreview>>
    participatingProjects?: Record<string, ParticipatingProject[]>
    lastManagerProjects?: Array<{
      id: string
      project_code: string
      name: string
    }>
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
        if (call.path.endsWith('/participating-projects')) {
          const userId = call.path.split('/')[4]
          return Response.json({
            items: options.participatingProjects?.[userId] ?? [],
          })
        }
        if (call.path.endsWith('/deactivation-check')) {
          return Response.json({
            user_id: 'user-1',
            last_manager_projects: options.lastManagerProjects ?? [],
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
            ...options.previews?.[userId],
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
        return Response.json(target ?? options.detailUser ?? regularUser)
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
  return render(
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

  it('進入清單自動載入提醒，沒有提醒時整塊隱藏', async () => {
    const backend = stubBackend()
    renderUsers()
    await screen.findByRole('row', { name: /anna\.deng/ })
    await waitFor(() => {
      expect(backend.count('GET', /external-without-project/)).toBe(1)
      expect(backend.count('GET', /projects\/unmanaged/)).toBe(1)
    })
    expect(screen.queryByText('檢查帳號與專案提醒')).toBeNull()
    expect(screen.queryByText('沒有需要處理的帳號或專案提醒。')).toBeNull()
    expect(screen.queryByText(/提醒：/)).toBeNull()
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

  it('details retain the main action order and add temporary password reset', async () => {
    stubBackend()
    renderUsers({ detailUserId: 'user-1' })
    await screen.findByRole('heading', { name: '鄧安娜' })

    expect(screen.queryByText('更多')).not.toBeInTheDocument()
    const actions = screen.getByRole('button', {
      name: '修改資料',
    }).parentElement!
    const labels = within(actions)
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(labels).toEqual([
      '修改資料',
      '修改公司連結',
      '指派管理者',
      '停用帳號',
      '重設臨時密碼',
    ])
    expect(
      within(actions).getByRole('button', { name: '停用帳號' }),
    ).toHaveClass('btn-danger')
  })

  it('deactivation uses the name and shows a success notice', async () => {
    const backend = stubBackend()
    renderUsers({ detailUserId: 'user-1' })
    await screen.findByRole('heading', { name: '鄧安娜' })
    fireEvent.click(screen.getByRole('button', { name: '停用帳號' }))

    const box = await screen.findByRole('region', { name: '操作確認' })
    expect(box).toHaveTextContent(
      '要停用的帳號：鄧安娜（anna.deng）他會立刻被登出，之後不能再登入。',
    )
    expect(box).toHaveTextContent(
      '他的功能權限與專案成員關係會先留著，重新啟用時由你逐項決定要不要恢復。',
    )
    const confirm = within(box).getByRole('button', { name: '確認停用帳號' })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)
    await waitFor(() =>
      expect(backend.count('PUT', '/api/v1/users/user-1/active')).toBe(1),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      '鄧安娜 已停用。',
    )
  })

  it('keeps success notices with the changed account', async () => {
    const secondUser = {
      ...regularUser,
      id: 'user-2',
      username: 'lin.chen',
      name_zh: '林陳美',
    }
    const backend = stubBackend({ users: [regularUser, secondUser] })
    const view = renderUsers({ detailUserId: 'user-1' })
    await screen.findByRole('heading', { name: '鄧安娜' })
    fireEvent.click(screen.getByRole('button', { name: '停用帳號' }))
    const box = await screen.findByRole('region', { name: '操作確認' })
    const confirm = within(box).getByRole('button', { name: '確認停用帳號' })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)
    await waitFor(() =>
      expect(backend.count('PUT', '/api/v1/users/user-1/active')).toBe(1),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      '鄧安娜 已停用。',
    )

    view.rerender(
      <DataMemoryRouter>
        <CurrentUserProvider value={{ user: currentUser, clear: vi.fn() }}>
          <UsersPage detailUserId="user-2" onTemporaryPassword={vi.fn()} />
        </CurrentUserProvider>
      </DataMemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: '林陳美' }),
    ).toBeVisible()
    expect(screen.queryByText('鄧安娜 已停用。')).toBeNull()
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
    fireEvent.click(screen.getByRole('button', { name: '重設臨時密碼' }))
    fireEvent.click(await screen.findByRole('button', { name: '確認重設' }))

    await waitFor(() => {
      expect(
        backend.count('POST', '/api/v1/users/user-1/temporary-password'),
      ).toBe(1)
      expect(onTemporaryPassword).toHaveBeenCalledWith(
        'anna.deng',
        'One-Time-123',
        'reset',
        '鄧安娜',
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
    fireEvent.click(screen.getByRole('button', { name: '重設臨時密碼' }))
    fireEvent.click(await screen.findByRole('button', { name: '確認重設' }))

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
    fireEvent.click(screen.getByRole('button', { name: '停用帳號' }))

    const panel = await screen.findByRole('region', { name: '操作確認' })
    expect(panel).toHaveClass('confirm-box-danger')
    expect(backend.count('PUT', '/api/v1/users/user-1/active')).toBe(0)
    fireEvent.click(within(panel).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('region', { name: '操作確認' })).toBeNull()
    expect(backend.count('PUT', '/api/v1/users/user-1/active')).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: '停用帳號' }))
    const confirmed = await screen.findByRole('region', { name: '操作確認' })
    await waitFor(() =>
      expect(
        within(confirmed).getByRole('button', { name: '確認停用帳號' }),
      ).toBeEnabled(),
    )
    fireEvent.click(
      within(confirmed).getByRole('button', { name: '確認停用帳號' }),
    )
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
    expect(within(box).getByText('使用專案功能')).toBeVisible()
    expect(within(box).getByText('查核權限管理')).toBeVisible()
    expect(within(box).getByText(/P-1／測試專案/)).toBeVisible()
    expect(within(box).getByText('未完成任務（待開始）')).toBeVisible()
    fireEvent.click(within(box).getByLabelText('使用專案功能'))
    fireEvent.click(within(box).getByLabelText('查核權限管理'))
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
    const anna = within(box).getByRole('group', { name: /anna\.deng/ })
    const bobGroup = within(box).getByRole('group', { name: /bob\.lin/ })
    fireEvent.click(within(anna).getByLabelText('使用專案功能'))
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

    expect(within(box).getByRole('status')).toHaveTextContent(
      '1 個外部帳號已過到期日',
    )
    expect(
      within(box).getByRole('link', { name: '改到期日：鄧安娜' }),
    ).toHaveAttribute('href', '/accounts/user-1?edit=expiry')
    expect(
      within(box).getByRole('button', { name: '確認啟用其餘 0 個帳號' }),
    ).toBeDisabled()
    expect(backend.count('POST', /:batch-active-status$/)).toBe(0)
    expect(within(box).queryByText(/請逐一確認每個帳號要恢復/)).toBeNull()
    expect(within(box).queryByRole('group')).toBeNull()
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
  it('獨立清單停用確認也使用明確標籤與四項後果', async () => {
    const backend = stubBackend()
    renderUsers()
    const row = await screen.findByRole('row', { name: /anna\.deng/ })
    fireEvent.click(within(row).getByRole('button', { name: '停用' }))
    const box = await screen.findByRole('region', { name: '操作確認' })
    expect(within(box).getAllByRole('listitem')).toHaveLength(4)
    const confirm = within(box).getByRole('button', {
      name: '確認停用帳號',
    })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(within(box).getByRole('button', { name: '取消' }))
    expect(backend.count('PUT', '/api/v1/users/user-1/active')).toBe(0)
  })

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
    expect(
      within(box).getByRole('button', { name: '確認停用帳號' }),
    ).toHaveClass('btn-danger')
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
    const permission = await within(box).findByLabelText('使用專案功能')
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

  it('沒有任何恢復項目時以一句話說明，不顯示空標題', async () => {
    stubBackend({ users: [{ ...regularUser, is_active: false }] })
    renderUsers({ detailUserId: 'user-1' })
    await screen.findByRole('heading', { name: '鄧安娜' })
    fireEvent.click(screen.getByRole('button', { name: '啟用帳號' }))
    const box = await screen.findByRole('region', { name: '操作確認' })

    expect(
      within(box).getByText('這個帳號沒有需要恢復的權限或專案。'),
    ).toBeInTheDocument()
    expect(within(box).queryByText('選擇要恢復的權限')).toBeNull()
    expect(within(box).queryByText('選擇要恢復的委派範圍')).toBeNull()
    expect(within(box).queryByText('選擇要恢復的專案成員關係')).toBeNull()
    expect(
      within(box).queryByText('選擇要保留的未完成任務建議指派'),
    ).toBeNull()
  })

  it('部分內容只顯示有項目的恢復區塊', async () => {
    stubBackend({
      users: [{ ...regularUser, is_active: false }],
      preview: { permission_codes: ['project.use'] },
    })
    renderUsers({ detailUserId: 'user-1' })
    await screen.findByRole('heading', { name: '鄧安娜' })
    fireEvent.click(screen.getByRole('button', { name: '啟用帳號' }))
    const box = await screen.findByRole('region', { name: '操作確認' })

    expect(await within(box).findByLabelText('使用專案功能')).toBeVisible()
    expect(within(box).getByText('選擇要恢復的權限')).toBeInTheDocument()
    expect(within(box).queryByText('選擇要恢復的委派範圍')).toBeNull()
    expect(within(box).queryByText('選擇要恢復的專案成員關係')).toBeNull()
    expect(
      within(box).queryByText('選擇要保留的未完成任務建議指派'),
    ).toBeNull()
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

    const confirm = within(deactivation).getByRole('button', {
      name: '確認停用帳號',
    })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)
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

describe('帳號詳情與批次的審查修正（#414）', () => {
  it('自己的密碼提示顯示在五顆按鈕列之後', async () => {
    const self = { ...regularUser, id: currentUser.id }
    stubBackend({ users: [self] })
    renderUsers({ detailUserId: self.id })
    const hint = await screen.findByText('請到設定變更自己的密碼。')
    expect(hint.closest('.account-detail-actions')).toBeNull()
    const row = screen.getByRole('button', { name: '修改資料' }).parentElement!
    expect(
      row.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('重設臨時密碼錯誤顯示在按鈕列之後', async () => {
    stubBackend({ fail: (c) => c.path.endsWith('/temporary-password') })
    renderUsers({ detailUserId: regularUser.id })
    fireEvent.click(
      await screen.findByRole('button', { name: '重設臨時密碼' }),
    )
    fireEvent.click(await screen.findByRole('button', { name: '確認重設' }))
    const alert = await screen.findByRole('alert')
    expect(alert.closest('.account-detail-actions')).toBeNull()
  })

  it('批次啟用沒有恢復項目時逐帳號顯示空狀態', async () => {
    stubBackend({ users: [{ ...regularUser, is_active: false }] })
    renderUsers()
    fireEvent.click(
      await screen.findByRole('checkbox', { name: '選取 anna.deng' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '批次啟用帳號' }))
    const box = await screen.findByRole('region', { name: '批次啟用確認' })
    expect(
      within(box).getByText('這個帳號沒有需要恢復的權限或專案。'),
    ).toBeVisible()
  })

  it('詳情的公司選項載入失敗時顯示原因並可重試', async () => {
    let fail = true
    const backend = stubBackend({
      fail: (c) => c.path === '/api/v1/companies' && fail,
    })
    renderUsers({ detailUserId: regularUser.id })
    fireEvent.click(
      await screen.findByRole('button', { name: '修改公司連結' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '公司清單載入失敗',
    )
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '重新載入公司清單' }))
    expect(
      await screen.findByRole('option', { name: '示範公司' }),
    ).toBeInTheDocument()
    expect(backend.count('GET', '/api/v1/companies')).toBe(2)
    expect(screen.queryByText(/公司清單載入失敗/)).toBeNull()
  })
})

describe('第二輪審查的帳號錯誤隔離（#414）', () => {
  it('切換詳情帳號後不顯示上一個帳號的重設密碼錯誤', async () => {
    const second = { ...regularUser, id: 'user-2', name_zh: '另一個帳號' }
    stubBackend({
      users: [regularUser, second],
      fail: (c) => c.path.endsWith('/temporary-password'),
    })
    const view = renderUsers({ detailUserId: regularUser.id })
    fireEvent.click(
      await screen.findByRole('button', {
        name: '重設臨時密碼',
      }),
    )
    fireEvent.click(await screen.findByRole('button', { name: '確認重設' }))
    await screen.findByRole('alert')
    view.rerender(
      <DataMemoryRouter>
        <CurrentUserProvider value={{ user: currentUser, clear: vi.fn() }}>
          <UsersPage detailUserId="user-2" onTemporaryPassword={vi.fn()} />
        </CurrentUserProvider>
      </DataMemoryRouter>,
    )
    await screen.findByRole('heading', { name: '另一個帳號' })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('#727 帳號操作保護', () => {
  it('重設密碼先確認後果，取消不發請求', async () => {
    const backend = stubBackend()
    renderUsers({ detailUserId: regularUser.id })
    fireEvent.click(
      await screen.findByRole('button', { name: '重設臨時密碼' }),
    )
    const box = screen.getByRole('region', { name: '操作確認' })
    expect(box).toHaveTextContent('他目前的密碼與登入狀態會立刻失效')
    expect(within(box).getByRole('button', { name: '確認重設' })).toHaveClass(
      'btn-danger',
    )
    expect(backend.count('POST', /temporary-password$/)).toBe(0)
    fireEvent.click(within(box).getByRole('button', { name: '取消' }))
    expect(backend.count('POST', /temporary-password$/)).toBe(0)
  })

  it('批次停用後準備啟用及取消，清除兩種舊訊息', async () => {
    stubBackend()
    renderUsers({ onSelectUser: vi.fn() })
    fireEvent.click(
      await screen.findByRole('checkbox', { name: '選取 anna.deng' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '批次停用帳號' }))
    fireEvent.click(
      await screen.findByRole('button', { name: '確認停用帳號' }),
    )
    await screen.findByText('已停用 1 個帳號。')
    fireEvent.click(
      await screen.findByRole('checkbox', { name: '選取 anna.deng' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '批次啟用帳號' }))
    const box = await screen.findByRole('region', { name: '批次啟用確認' })
    expect(screen.queryByText('已停用 1 個帳號。')).toBeNull()
    fireEvent.click(within(box).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('region', { name: '批次啟用確認' })).toBeNull()
    expect(
      screen.getByRole('checkbox', { name: '選取 anna.deng' }),
    ).toBeChecked()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('#727 恢復項目的共用白話內容', () => {
  it.each(['single', 'batch'])(
    '%s 不顯示英文碼且具姓名 legend',
    async (mode) => {
      stubBackend({
        users: [{ ...regularUser, is_active: false }],
        preview: {
          permission_codes: ['project.use', 'inspection.use'],
          delegated_modules: ['inspection'],
          tasks: [
            {
              task_id: 't1',
              project_id: 'project-1',
              name: '管線查核',
              status: 'IN_PROGRESS',
            },
          ],
        },
      })
      renderUsers(mode === 'batch' ? { onSelectUser: vi.fn() } : {})
      let box: HTMLElement
      if (mode === 'batch') {
        fireEvent.click(
          await screen.findByRole('checkbox', { name: '選取 anna.deng' }),
        )
        fireEvent.click(screen.getByRole('button', { name: '批次啟用帳號' }))
        box = await screen.findByRole('region', { name: '批次啟用確認' })
      } else {
        const row = await screen.findByRole('row', { name: /anna\.deng/ })
        fireEvent.click(within(row).getByRole('button', { name: '啟用' }))
        box = await screen.findByRole('region', { name: '操作確認' })
        await within(box).findByText('選擇要恢復的權限')
      }
      expect(
        within(box).getByRole('group', { name: '鄧安娜（anna.deng）' }),
      ).toBeVisible()
      expect(
        within(box).getByRole('checkbox', { name: '使用專案功能' }),
      ).toBeVisible()
      expect(
        within(box).getByRole('checkbox', { name: '使用查核功能' }),
      ).toBeVisible()
      expect(
        within(box).getByRole('checkbox', { name: '查核權限管理' }),
      ).toBeVisible()
      expect(
        within(box).getByRole('checkbox', { name: '管線查核（進行中）' }),
      ).toBeVisible()
      expect(box).not.toHaveTextContent(
        /project\.use|inspection\.use|IN_PROGRESS/,
      )
    },
  )
})

describe('#727 批次錯誤清除', () => {
  it.each([true, false])(
    '取消與搜尋清除批次錯誤（啟用狀態 %s）',
    async (active) => {
      stubBackend({
        users: [{ ...regularUser, is_active: active }],
        fail: (call) => call.path.endsWith(':batch-active-status'),
      })
      renderUsers({ onSelectUser: vi.fn() })
      const select = await screen.findByRole('checkbox', {
        name: '選取 anna.deng',
      })
      fireEvent.click(select)
      const action = active ? '停用' : '啟用'
      fireEvent.click(
        screen.getByRole('button', { name: `批次${action}帳號` }),
      )
      const box = await screen.findByRole('region', {
        name: `批次${action}確認`,
      })
      fireEvent.click(
        within(box).getByRole('button', { name: `確認${action}帳號` }),
      )
      await screen.findByRole('alert')
      fireEvent.click(within(box).getByRole('button', { name: '取消' }))
      expect(screen.queryByRole('alert')).toBeNull()
      fireEvent.click(
        screen.getByRole('button', { name: `批次${action}帳號` }),
      )
      const retry = await screen.findByRole('region', {
        name: `批次${action}確認`,
      })
      fireEvent.click(
        within(retry).getByRole('button', { name: `確認${action}帳號` }),
      )
      await screen.findByRole('alert')
      fireEvent.click(screen.getByRole('button', { name: '搜尋' }))
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    },
  )
})

describe('#727 重設確認的預覽錯誤隔離', () => {
  it('停用預覽失敗後改重設，不沿用停用錯誤', async () => {
    stubBackend({ fail: (call) => call.path.endsWith('/deactivation-check') })
    renderUsers({ detailUserId: regularUser.id })
    fireEvent.click(await screen.findByRole('button', { name: '停用帳號' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '重設臨時密碼' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: '確認重設' })).toBeEnabled()
  })
})

describe('#727c 反向批次訊息清除', () => {
  it('啟用成功後準備停用即清除舊訊息，取消不再寫入', async () => {
    const backend = stubBackend({
      users: [{ ...regularUser, is_active: false }],
    })
    renderUsers({ onSelectUser: vi.fn() })
    fireEvent.click(
      await screen.findByRole('checkbox', { name: '選取 anna.deng' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '批次啟用帳號' }))
    fireEvent.click(
      await screen.findByRole('button', { name: '確認啟用帳號' }),
    )
    await screen.findByText('已啟用 1 個帳號。')
    fireEvent.click(
      await screen.findByRole('checkbox', { name: '選取 anna.deng' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '批次停用帳號' }))
    const box = await screen.findByRole('region', { name: '批次停用確認' })
    expect(screen.queryByText('已啟用 1 個帳號。')).toBeNull()
    fireEvent.click(within(box).getByRole('button', { name: '取消' }))
    expect(backend.count('POST', /:batch-active-status$/)).toBe(1)
    expect(screen.queryByRole('region', { name: '批次停用確認' })).toBeNull()
  })
})

describe('#734 T1/T2/T3 帳號批次回饋', () => {
  it.each([true, false])(
    '啟用狀態 %s 的確認與結果在觸發處同一容器',
    async (active) => {
      stubBackend({ users: [{ ...regularUser, is_active: active }] })
      renderUsers({ onSelectUser: vi.fn() })
      fireEvent.click(
        await screen.findByRole('checkbox', {
          name: '選取 anna.deng',
        }),
      )
      const area = screen.getByRole('region', { name: '批次帳號操作' })
      const action = active ? '停用' : '啟用'
      fireEvent.click(
        within(area).getByRole('button', {
          name: `批次${action}帳號`,
        }),
      )
      const box = await within(area).findByRole('region', {
        name: `批次${action}確認`,
      })
      if (active) {
        expect(
          within(box).getByRole('heading', { name: '停用 1 個帳號？' }),
        ).toBeVisible()
        expect(
          within(box).getByRole('list', { name: '要停用的帳號' }),
        ).toHaveTextContent('anna.deng')
        expect(box).toHaveTextContent('會立刻被登出，之後不能再登入')
        expect(box).toHaveTextContent('功能權限與專案成員關係會先留著')
        expect(box).toHaveTextContent(
          '已派出但沒做完的任務不會自動轉走，請通知內業改派',
        )
      }
      fireEvent.click(
        within(box).getByRole('button', {
          name: `確認${action}帳號`,
        }),
      )
      expect(await within(area).findByRole('status')).toHaveTextContent(
        `已${action} 1 個帳號。`,
      )
    },
  )

  it('共用頁面進詳情再回清單，不會帶回舊批次訊息', async () => {
    stubBackend()
    function KeptUsersPage() {
      const [detail, setDetail] = useState<string | undefined>()
      return (
        <>
          <button onClick={() => setDetail('user-1')}>查看詳情</button>
          <button onClick={() => setDetail(undefined)}>返回清單</button>
          <UsersPage detailUserId={detail} onTemporaryPassword={vi.fn()} />
        </>
      )
    }
    render(
      <DataMemoryRouter>
        <CurrentUserProvider value={{ user: currentUser, clear: vi.fn() }}>
          <KeptUsersPage />
        </CurrentUserProvider>
      </DataMemoryRouter>,
    )
    fireEvent.click(
      await screen.findByRole('checkbox', {
        name: '選取 anna.deng',
      }),
    )
    const area = screen.getByRole('region', { name: '批次帳號操作' })
    fireEvent.click(
      within(area).getByRole('button', {
        name: '批次停用帳號',
      }),
    )
    fireEvent.click(
      await within(area).findByRole('button', {
        name: '確認停用帳號',
      }),
    )
    await within(area).findByText('已停用 1 個帳號。')
    fireEvent.click(screen.getByRole('button', { name: '查看詳情' }))
    expect(screen.queryByText('已停用 1 個帳號。')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '返回清單' }))
    await screen.findByRole('region', { name: '批次帳號操作' })
    expect(screen.queryByText('已停用 1 個帳號。')).toBeNull()
  })
})

describe('#734 T7 公司操作回饋位置', () => {
  function renderCompanies() {
    return render(
      <DataMemoryRouter>
        <CurrentUserProvider value={{ user: currentUser, clear: vi.fn() }}>
          <CompaniesPage />
        </CurrentUserProvider>
      </DataMemoryRouter>,
    )
  }

  it('公司停用確認與結果留在該公司的操作列', async () => {
    stubBackend({ activeCompanyUsers: { 'company-1': [regularUser] } })
    renderCompanies()
    const row = await screen.findByRole('row', { name: /示範公司/ })
    fireEvent.click(within(row).getByRole('button', { name: '停用公司' }))
    const box = await within(row).findByRole('region', {
      name: '停用「示範公司」',
    })
    fireEvent.click(within(box).getByRole('button', { name: '確認停用公司' }))
    expect(await within(row).findByRole('status')).toHaveTextContent(
      '已停用公司「示範公司」。',
    )
  })

  it('改名會聚焦表單，成功提示留在送出處', async () => {
    stubBackend()
    renderCompanies()
    fireEvent.click(await screen.findByRole('button', { name: '改名稱' }))
    const input = screen.getByLabelText('公司名稱')
    await waitFor(() => expect(input).toHaveFocus())
    const form = input.closest('form') as HTMLElement
    fireEvent.change(input, { target: { value: '新公司名稱' } })
    fireEvent.click(within(form).getByRole('button', { name: '儲存名稱' }))
    expect(await within(form).findByRole('status')).toHaveTextContent(
      '已將公司名稱更新為「新公司名稱」。',
    )
  })

  it('公司批次的確認與結果同屬工具列容器', async () => {
    stubBackend()
    renderCompanies()
    fireEvent.click(
      await screen.findByRole('checkbox', {
        name: '選取公司 示範公司',
      }),
    )
    const area = screen.getByRole('region', { name: '批次公司操作' })
    fireEvent.click(within(area).getByRole('button', { name: '批次停用公司' }))
    const box = await within(area).findByRole('region', {
      name: '批次停用確認',
    })
    fireEvent.click(
      within(box).getByRole('button', { name: '確認批次停用公司' }),
    )
    expect(await within(area).findByRole('status')).toHaveTextContent(
      '已停用 1 間公司。',
    )
  })
})

it('詳情停用確認也顯示最後管理者專案警告，四項後果各自條列', async () => {
  stubBackend({
    lastManagerProjects: [
      {
        id: 'project-1',
        project_code: 'P-1',
        name: '待接手專案',
      },
    ],
  })
  renderUsers({ detailUserId: 'user-1' })
  fireEvent.click(await screen.findByRole('button', { name: '停用帳號' }))
  const box = await screen.findByRole('region', { name: '操作確認' })
  expect(await within(box).findByText(/停用後下列專案/)).toBeVisible()
  expect(
    within(box).getByRole('link', { name: 'P-1／待接手專案' }),
  ).toHaveAttribute('href', '/projects/project-1/planning')
  const consequences = within(box)
    .getByText(/他會立刻被登出/)
    .closest('ul')!
  expect(within(consequences).getAllByRole('listitem')).toHaveLength(4)
  expect(consequences).toHaveTextContent('過去的查核紀錄與專案資料都會保留')
  expect(consequences).toHaveTextContent('請通知內業改派')
})

it.each(['詳情', '清單', '批次'])(
  '一般成員的%s停用確認提供改派連結，取消不寫入',
  async (entry) => {
    const backend = stubBackend({
      participatingProjects: {
        'user-1': [
          {
            id: 'project-1',
            project_code: 'P-1',
            name: '示範工地',
            roles: [{ id: 'field', name: '現場工程師' }],
          },
        ],
      },
    })
    renderUsers(entry === '詳情' ? { detailUserId: 'user-1' } : {})
    if (entry === '批次') {
      fireEvent.click(
        await screen.findByRole('checkbox', { name: '選取 anna.deng' }),
      )
      fireEvent.click(screen.getByRole('button', { name: '批次停用帳號' }))
    } else {
      fireEvent.click(
        await screen.findByRole('button', {
          name: entry === '詳情' ? '停用帳號' : '停用',
        }),
      )
    }
    const box = await screen.findByRole('region', {
      name: entry === '批次' ? '批次停用確認' : '操作確認',
    })
    expect(
      await within(box).findByRole('link', {
        name: '計畫與任務：P-1／示範工地',
      }),
    ).toHaveAttribute('href', '/projects/project-1/planning')
    expect(box).not.toHaveTextContent('將沒有啟用中的管理成員')
    fireEvent.click(within(box).getByRole('button', { name: '取消' }))
    expect(backend.calls.filter((call) => call.method !== 'GET')).toEqual([])
  },
)

it('改派專案載入失敗時保留確認，禁止在影響資料未齊時停用', async () => {
  const backend = stubBackend({
    fail: (call) => call.path.endsWith('/participating-projects'),
  })
  renderUsers({ detailUserId: 'user-1' })
  fireEvent.click(await screen.findByRole('button', { name: '停用帳號' }))
  const box = await screen.findByRole('region', { name: '操作確認' })
  await within(box).findByRole('alert')
  const confirm = within(box).getByRole('button', { name: '確認停用帳號' })
  expect(confirm).toBeDisabled()
  fireEvent.click(confirm)
  expect(backend.calls.filter((call) => call.method !== 'GET')).toEqual([])
  fireEvent.click(within(box).getByRole('button', { name: '取消' }))
  expect(screen.queryByRole('region', { name: '操作確認' })).toBeNull()
})

it('提醒自動載入失敗才顯示錯誤與重試，重試成功無提醒則隱藏', async () => {
  let failed = true
  const backend = stubBackend({
    fail: (call) => failed && call.path.endsWith('/external-without-project'),
  })
  renderUsers()
  await screen.findByRole('alert')
  failed = false
  fireEvent.click(screen.getByRole('button', { name: '重試' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(backend.count('GET', /external-without-project/)).toBe(2)
  expect(screen.queryByText(/提醒：/)).toBeNull()
})

it('批次啟用排除到期者，警示附編輯連結且只送出其餘帳號', async () => {
  const bob = {
    ...regularUser,
    id: 'user-2',
    username: 'bob',
    name_zh: '林柏',
    is_active: false,
  }
  const backend = stubBackend({
    users: [
      { ...regularUser, is_active: false, is_external_collaborator: true },
      bob,
    ],
    previews: { 'user-1': { account_expired: true } },
  })
  renderUsers({ onSelectUser: vi.fn() })
  fireEvent.click(
    await screen.findByRole('checkbox', {
      name: '選取 anna.deng',
    }),
  )
  fireEvent.click(screen.getByRole('checkbox', { name: '選取 bob' }))
  const area = screen.getByRole('region', { name: '批次帳號操作' })
  fireEvent.click(within(area).getByRole('button', { name: '批次啟用帳號' }))
  const box = await within(area).findByRole('region', { name: '批次啟用確認' })
  expect(within(box).getByRole('status')).toHaveTextContent(
    '1 個外部帳號已過到期日',
  )
  expect(
    within(box).getByRole('link', { name: '改到期日：鄧安娜' }),
  ).toHaveAttribute('href', '/accounts/user-1?edit=expiry')
  expect(within(box).getAllByRole('group')).toHaveLength(1)
  fireEvent.click(
    within(box).getByRole('button', {
      name: '確認啟用其餘 1 個帳號',
    }),
  )
  await within(area).findByText('已啟用 1 個帳號。')
  const body = JSON.parse(
    backend.calls.find((call) => call.path.endsWith(':batch-active-status'))!
      .body,
  )
  expect(body.user_ids).toEqual(['user-2'])
  expect(
    body.restore.map((item: { user_id: string }) => item.user_id),
  ).toEqual(['user-2'])
})

it('到期參數 replace 消費一次，取消重開不再聚焦日期', async () => {
  stubBackend({ users: [{ ...regularUser, is_external_collaborator: true }] })
  function LocationProbe() {
    const location = useLocation()
    const navigate = useNavigate()
    return (
      <>
        <output aria-label="測試網址">
          {location.pathname + location.search}
        </output>
        <button onClick={() => navigate(-1)}>測試上一頁</button>
      </>
    )
  }
  render(
    <DataMemoryRouter
      initialEntries={['/before', '/accounts/user-1?edit=expiry&keep=1']}
    >
      <CurrentUserProvider value={{ user: currentUser, clear: vi.fn() }}>
        <UsersPage detailUserId="user-1" onTemporaryPassword={vi.fn()} />
        <LocationProbe />
      </CurrentUserProvider>
    </DataMemoryRouter>,
  )
  const date = await screen.findByLabelText(/外部帳號到期日/)
  await waitFor(() => expect(date).toHaveFocus())
  expect(date).toHaveAttribute('type', 'date')
  await waitFor(() =>
    expect(screen.getByLabelText('測試網址')).toHaveTextContent(
      '/accounts/user-1?keep=1',
    ),
  )
  const currentDate = screen.getByLabelText(/外部帳號到期日/)
  await waitFor(() => expect(currentDate).toHaveFocus())
  fireEvent.click(
    within(currentDate.closest('form')!).getByRole('button', {
      name: '取消',
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: '修改資料' }))
  const reopened = await screen.findByLabelText(/外部帳號到期日/)
  expect(reopened).not.toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: '測試上一頁' }))
  await waitFor(() =>
    expect(screen.getByLabelText('測試網址')).toHaveTextContent('/before'),
  )
})

it('清單外的到期詳情只載入一次，消費參數不重掛表單', async () => {
  const listGate = deferred()
  const backend = stubBackend({
    users: [],
    detailUser: { ...regularUser, is_external_collaborator: true },
    hold: (call) => (call.path === '/api/v1/users' ? listGate : undefined),
  })
  function LocationProbe() {
    const location = useLocation()
    return <output aria-label="測試網址">{location.search}</output>
  }
  const view = render(
    <DataMemoryRouter initialEntries={['/accounts/user-1?edit=expiry']}>
      <CurrentUserProvider value={{ user: currentUser, clear: vi.fn() }}>
        <UsersPage detailUserId="user-1" onTemporaryPassword={vi.fn()} />
        <LocationProbe />
      </CurrentUserProvider>
    </DataMemoryRouter>,
  )
  const date = await screen.findByLabelText(/外部帳號到期日/)
  await waitFor(() => expect(date).toHaveFocus())
  const form = date.closest('form')
  fireEvent.change(date, { target: { value: '2030-01-01' } })
  await waitFor(() =>
    expect(screen.getByLabelText('測試網址')).toBeEmptyDOMElement(),
  )
  // 清單仍在載入，replace 不得重取詳情或重掛表單（#741）。
  expect(backend.count('GET', '/api/v1/users/user-1')).toBe(1)
  expect(screen.getByLabelText(/外部帳號到期日/)).toBe(date)
  expect(date.closest('form')).toBe(form)
  expect(date).toHaveValue('2030-01-01')
  view.unmount()
  listGate.resolve()
})

it('提醒背景失敗不搶搜尋焦點，主動重試失敗才聚焦錯誤', async () => {
  const backend = stubBackend({
    fail: (call) => call.path.endsWith('/external-without-project'),
  })
  renderUsers()
  const search = screen.getByLabelText('搜尋帳號')
  search.focus()
  fireEvent.change(search, { target: { value: '林' } })
  const alert = await screen.findByRole('alert')
  expect(search).toHaveFocus()
  expect(search).toHaveValue('林')
  expect(alert).not.toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: '重試' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
  expect(backend.count('GET', /external-without-project/)).toBe(2)
})

it('批次兩個帳號共用專案只顯示一個改派連結', async () => {
  const other = { ...regularUser, id: 'user-2', username: 'other' }
  const project = {
    id: 'project-1',
    project_code: 'P-1',
    name: '共同工地',
    roles: [{ id: 'field', name: '現場工程師' }],
  }
  stubBackend({
    users: [regularUser, other],
    participatingProjects: {
      'user-1': [project],
      'user-2': [project],
    },
  })
  renderUsers()
  for (const username of ['anna.deng', 'other'])
    fireEvent.click(
      await screen.findByRole('checkbox', {
        name: `選取 ${username}`,
      }),
    )
  fireEvent.click(screen.getByRole('button', { name: '批次停用帳號' }))
  const box = await screen.findByRole('region', { name: '批次停用確認' })
  expect(
    within(box).getAllByRole('link', {
      name: '計畫與任務：P-1／共同工地',
    }),
  ).toHaveLength(1)
})

it.each(['清單', '批次'])(
  '%s參與專案查詢失敗時禁止停用且顯示錯誤',
  async (entry) => {
    const backend = stubBackend({
      fail: (call) => call.path.endsWith('/participating-projects'),
    })
    renderUsers()
    if (entry === '批次') {
      fireEvent.click(
        await screen.findByRole('checkbox', {
          name: '選取 anna.deng',
        }),
      )
      fireEvent.click(screen.getByRole('button', { name: '批次停用帳號' }))
      const area = screen.getByRole('region', { name: '批次帳號操作' })
      expect(await within(area).findByRole('alert')).toBeVisible()
      expect(
        screen.queryByRole('region', {
          name: '批次停用確認',
        }),
      ).toBeNull()
    } else {
      fireEvent.click(await screen.findByRole('button', { name: '停用' }))
      const box = await screen.findByRole('region', { name: '操作確認' })
      expect(await within(box).findByRole('alert')).toBeVisible()
      expect(
        within(box).getByRole('button', {
          name: '確認停用帳號',
        }),
      ).toBeDisabled()
    }
    expect(backend.calls.filter((call) => call.method !== 'GET')).toEqual([])
  },
)

it('批次預覽同時最多六個帳號、十二個 GET 在途', async () => {
  const users = Array.from({ length: 8 }, (_, index) => ({
    ...regularUser,
    id: `user-${index + 1}`,
    username: `person-${index + 1}`,
  }))
  const gates = users.map(() => deferred<void>())
  stubBackend({
    users,
    hold: (call) => {
      if (!/\/(deactivation-check|participating-projects)$/.test(call.path))
        return undefined
      return gates[Number(call.path.split('/')[4].split('-')[1]) - 1]
    },
  })
  const original = globalThis.fetch
  let inFlight = 0
  let maximum = 0
  const accounts = new Map<string, number>()
  let maximumAccounts = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (...args: Parameters<typeof fetch>) => {
      const path = new URL(String(args[0]), 'http://localhost').pathname
      if (!/\/(deactivation-check|participating-projects)$/.test(path))
        return original(...args)
      const id = path.split('/')[4]
      accounts.set(id, (accounts.get(id) ?? 0) + 1)
      maximumAccounts = Math.max(maximumAccounts, accounts.size)
      maximum = Math.max(maximum, ++inFlight)
      try {
        return await original(...args)
      } finally {
        inFlight--
        const count = accounts.get(id)! - 1
        if (count) accounts.set(id, count)
        else accounts.delete(id)
      }
    }),
  )
  renderUsers()
  // 一次核對全部帳號，避免每次選取都重掃整個清單（#744）。
  const checkboxes = await screen.findAllByRole('checkbox', {
    name: /^選取 person-/,
  })
  expect(checkboxes.map((box) => box.getAttribute('aria-label'))).toEqual(
    users.map((user) => `選取 ${user.username}`),
  )
  for (const checkbox of checkboxes) fireEvent.click(checkbox)
  fireEvent.click(screen.getByRole('button', { name: '批次停用帳號' }))
  try {
    await waitFor(() => expect(inFlight).toBeGreaterThanOrEqual(12))
    expect(maximumAccounts).toBe(6)
    expect(maximum).toBe(12)
    await act(async () => {
      gates[0].resolve()
    })
    await waitFor(() => expect(accounts.has('user-7')).toBe(true))
    expect(maximumAccounts).toBe(6)
    expect(maximum).toBe(12)
  } finally {
    await act(async () => {
      gates.forEach((gate) => gate.resolve())
    })
  }
  expect(
    await screen.findByRole('region', {
      name: '批次停用確認',
    }),
  ).toBeVisible()
})
