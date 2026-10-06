// 登入、變更密碼、收回自己的管理者權限後的導向（#284 第 1～3 項）。
// 用完整的 `App` 與路由驗證，後端以 fetch 替身模擬。

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest'

import App from './App'
import type { CurrentUser } from './auth/api'
import {
  currentUserFixture,
  myProjectFixture,
} from './testing/contractFixtures'
import { preloadLazyRoutes } from './testing/preloadRoutes'

const ADMIN = currentUserFixture({
  id: 'admin-1',
  username: 'boss',
  email: 'boss@example.com',
  name_zh: '主管',
  is_admin: true,
  has_office_access: true,
  has_field_access: true,
  has_template_access: true,
})

const NON_ADMIN = { ...ADMIN, id: 'member-1', is_admin: false }
// 五種身分的存取摘要（#480）；欄位與形狀由 current-user-contract.json 守住。
const MEMBER = {
  ...NON_ADMIN,
  has_office_access: false,
  has_field_access: true,
  has_template_access: false,
}
const OFFICE = {
  ...NON_ADMIN,
  has_office_access: true,
  has_field_access: false,
  has_template_access: false,
}
const BOTH = {
  ...NON_ADMIN,
  has_office_access: true,
  has_field_access: true,
  has_template_access: false,
}
const TEMPLATE_ONLY = {
  ...NON_ADMIN,
  has_office_access: false,
  has_field_access: false,
  has_template_access: true,
}
const TEMPLATE_FIELD = { ...TEMPLATE_ONLY, has_field_access: true }
const NOBODY = {
  ...NON_ADMIN,
  has_office_access: false,
  has_field_access: false,
  has_template_access: false,
}

const MY_PROJECTS = [
  myProjectFixture({
    id: 'project-a',
    project_code: 'DEMO-A',
    name: '示範工程甲',
    role_names: ['內業'],
  }),
]

const WORKFLOW_SUMMARY = {
  project: { id: 'project-a', project_code: 'DEMO-A', name: '示範工程甲' },
  viewer_permission_codes: ['project_member.manage', 'inspection_plan.read'],
  member_count: 1,
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
  task_counts_visible: true,
  pending_reinspection_task_count: 0,
  draft_tasks_missing_assignee: 0,
  primary_step: null,
  next_steps: [],
}

type CurrentUserBody = CurrentUser | null

interface Backend {
  /** 目前登入的人；`null` 代表未登入。測試中可隨時改。 */
  me: CurrentUserBody
  /** 登入成功時回傳的人。 */
  loginAs: CurrentUser
  fetchMock: Mock<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >
}

function stubBackend(
  me: CurrentUserBody,
  loginAs: CurrentUser = ADMIN,
): Backend {
  const backend = { me, loginAs } as Backend
  backend.fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.endsWith('/setup/status')) {
        return Response.json({ setup_required: false })
      }
      if (url.endsWith('/auth/me')) {
        return backend.me === null
          ? Response.json(
              { error: { code: 'auth.not_authenticated' } },
              {
                status: 401,
              },
            )
          : Response.json(backend.me)
      }
      if (url.endsWith('/auth/login') && method === 'POST') {
        backend.me = backend.loginAs
        return Response.json(backend.loginAs)
      }
      if (url.endsWith('/auth/password') && method === 'POST') {
        return new Response(null, { status: 204 })
      }
      if (url.includes('/users?') || url.endsWith('/users')) {
        return Response.json({
          items: [
            {
              id: ADMIN.id,
              username: ADMIN.username,
              email: ADMIN.email,
              name_zh: ADMIN.name_zh,
              name_en: null,
              company_id: null,
              department: null,
              location: null,
              employee_no: null,
              auth_source: 'local',
              is_active: true,
              is_admin: backend.me?.is_admin ?? false,
              is_system: false,
            },
          ],
          next_cursor: null,
        })
      }
      if (url.endsWith(`/users/${ADMIN.id}/admin`) && method === 'PUT') {
        // 收回後，列表與目前使用者 API 都不再是管理者。
        backend.me = { ...MEMBER }
        return Response.json({})
      }
      if (url.includes('/field/inspection-tasks?')) {
        if (
          backend.me !== null &&
          !backend.me.is_admin &&
          !backend.me.has_field_access
        ) {
          return Response.json(
            { error: { code: 'permission.denied' } },
            { status: 403 },
          )
        }
        return Response.json({ items: [], next_cursor: null })
      }
      if (url.endsWith('/workflow-summary')) {
        return Response.json(WORKFLOW_SUMMARY)
      }
      if (url.endsWith('/me/projects')) {
        return Response.json(MY_PROJECTS)
      }
      return Response.json([])
    },
  )
  vi.stubGlobal('fetch', backend.fetchMock)
  return backend
}

function renderApp(path: string, state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <App />
    </MemoryRouter>,
  )
}

async function signIn() {
  fireEvent.change(await screen.findByLabelText('帳號名稱或 Email'), {
    target: { value: 'boss' },
  })
  fireEvent.change(screen.getByLabelText('密碼'), {
    target: { value: 'secret-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: '登入' }))
}

// 拆包模組的首次載入成本放在 hook，不佔各測試斷言的 1 秒（#295）。
beforeAll(preloadLazyRoutes)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('登入後依身分導向（#284 第 1 項）', () => {
  it('admin 登入後進管理頁', async () => {
    stubBackend(null, ADMIN)
    renderApp('/login')
    await signIn()

    expect(
      await screen.findByRole('heading', { name: '使用者管理' }),
    ).toBeInTheDocument()
  })

  it('一般使用者登入後進現場頁', async () => {
    stubBackend(null, MEMBER)
    renderApp('/login')
    await signIn()

    expect(
      await screen.findByRole('heading', { name: '今日任務' }),
    ).toBeInTheDocument()
  })

  it('安全的 from 優先於身分預設落點', async () => {
    stubBackend(null, ADMIN)
    renderApp('/login', { from: '/field' })
    await signIn()

    expect(
      await screen.findByRole('heading', { name: '今日任務' }),
    ).toBeInTheDocument()
  })

  it('不安全的 from 被忽略，仍依身分導向', async () => {
    stubBackend(null, ADMIN)
    renderApp('/login', { from: '//evil.example' })
    await signIn()

    expect(
      await screen.findByRole('heading', { name: '使用者管理' }),
    ).toBeInTheDocument()
  })

  it('變更密碼完成後（沒有 from）依身分導向：admin 進管理頁', async () => {
    stubBackend(ADMIN)
    renderApp('/change-password')
    await screen.findByRole('heading', { name: '變更密碼' })

    fireEvent.change(screen.getByLabelText('目前密碼'), {
      target: { value: 'old-password' },
    })
    fireEvent.change(screen.getByLabelText('新密碼'), {
      target: { value: 'new-password-1' },
    })
    fireEvent.change(screen.getByLabelText('再輸入一次新密碼'), {
      target: { value: 'new-password-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '變更密碼' }))

    expect(
      await screen.findByRole('heading', { name: '使用者管理' }),
    ).toBeInTheDocument()
  })

  it('變更密碼完成後（沒有 from）依身分導向：一般使用者進現場頁', async () => {
    stubBackend(MEMBER)
    renderApp('/change-password')
    await screen.findByRole('heading', { name: '變更密碼' })

    fireEvent.change(screen.getByLabelText('目前密碼'), {
      target: { value: 'old-password' },
    })
    fireEvent.change(screen.getByLabelText('新密碼'), {
      target: { value: 'new-password-1' },
    })
    fireEvent.change(screen.getByLabelText('再輸入一次新密碼'), {
      target: { value: 'new-password-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '變更密碼' }))

    expect(
      await screen.findByRole('heading', { name: '今日任務' }),
    ).toBeInTheDocument()
  })

  it('已登入者開 / 直接導向：admin 進管理頁', async () => {
    stubBackend(ADMIN)
    renderApp('/')

    expect(
      await screen.findByRole('heading', { name: '使用者管理' }),
    ).toBeInTheDocument()
  })

  it('已登入者開 / 直接導向：一般使用者進現場頁', async () => {
    stubBackend(MEMBER)
    renderApp('/')

    expect(
      await screen.findByRole('heading', { name: '今日任務' }),
    ).toBeInTheDocument()
  })

  it('未登入者開 / 導向登入頁，不再顯示公開首頁', async () => {
    stubBackend(null)
    renderApp('/')

    expect(
      await screen.findByRole('heading', { name: '登入' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull()
  })

  it('目前使用者 API 失敗（非 401）時 / 顯示錯誤而不是導向登入頁', async () => {
    const backend = stubBackend(ADMIN)
    backend.fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/setup/status')) {
        return Response.json({ setup_required: false })
      }
      return new Response(null, { status: 500 })
    })
    renderApp('/')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法確認登入狀態',
    )
    expect(screen.queryByRole('heading', { name: '登入' })).toBeNull()
  })
})

describe('依後端存取摘要決定落點（#480）', () => {
  // 五種身分 × 三個入口（登入、變更密碼、開 /）。
  const identities = [
    ['系統管理者', ADMIN, '使用者管理'],
    ['純內業', OFFICE, '我的專案'],
    ['純現場', MEMBER, '今日任務'],
    ['兩者皆有', BOTH, '我的專案'],
    ['兩者皆無', NOBODY, '今日任務'],
    ['只有範本管理員', TEMPLATE_ONLY, '範本管理'],
    ['範本管理員兼現場', TEMPLATE_FIELD, '今日任務'],
  ] as const

  async function changePassword() {
    await screen.findByRole('heading', { name: '變更密碼' })
    fireEvent.change(screen.getByLabelText('目前密碼'), {
      target: { value: 'old-password' },
    })
    fireEvent.change(screen.getByLabelText('新密碼'), {
      target: { value: 'new-password-1' },
    })
    fireEvent.change(screen.getByLabelText('再輸入一次新密碼'), {
      target: { value: 'new-password-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '變更密碼' }))
  }

  it.each(identities)('登入：%s', async (_name, user, heading) => {
    stubBackend(null, user)
    renderApp('/login')
    await signIn()

    expect(await screen.findByRole('heading', { name: heading })).toBeVisible()
  })

  it.each(identities)('變更密碼後：%s', async (_name, user, heading) => {
    stubBackend(user)
    renderApp('/change-password')
    await changePassword()

    expect(await screen.findByRole('heading', { name: heading })).toBeVisible()
  })

  it.each(identities)('開 /：%s', async (_name, user, heading) => {
    stubBackend(user)
    renderApp('/')

    expect(await screen.findByRole('heading', { name: heading })).toBeVisible()
  })

  it('純內業的專案清單只列有內業權限的專案，沒有新增專案', async () => {
    const backend = stubBackend(OFFICE)
    const original = backend.fetchMock.getMockImplementation()!
    backend.fetchMock.mockImplementation(async (input, init) =>
      String(input).endsWith('/me/projects')
        ? Response.json([
            ...MY_PROJECTS,
            {
              ...MY_PROJECTS[0],
              id: 'project-b',
              project_code: 'DEMO-B',
              name: '示範工程乙',
            },
            {
              ...MY_PROJECTS[0],
              id: 'project-c',
              project_code: 'DEMO-C',
              name: '只有現場的工程',
              has_office_access: false,
            },
          ])
        : original(input, init),
    )
    renderApp('/')

    await screen.findByRole('heading', { name: '我的專案' })
    expect(await screen.findByText('示範工程甲')).toBeVisible()
    expect(screen.getByText('示範工程乙')).toBeVisible()
    expect(screen.queryByText('只有現場的工程')).toBeNull()
    expect(screen.queryByText('新增專案')).toBeNull()
    const links = screen.getAllByRole('link', { name: '進入專案' })
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/admin/projects/project-a',
      '/admin/projects/project-b',
    ])
  })

  it('範本管理員兼現場：現場頁有範本管理入口，點了進得去（#480）', async () => {
    stubBackend(TEMPLATE_FIELD)
    renderApp('/')

    await screen.findByRole('heading', { name: '今日任務' })
    expect(screen.queryByRole('link', { name: '專案管理' })).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: '範本管理' }))
    expect(
      await screen.findByRole('heading', { name: '範本管理' }),
    ).toBeVisible()
  })

  it('只有範本管理員的 /field 說明頁有前往範本管理，沒有前往專案管理', async () => {
    stubBackend(TEMPLATE_ONLY)
    renderApp('/field')

    expect(
      await screen.findByRole('link', { name: '前往範本管理' }),
    ).toHaveAttribute('href', '/admin/templates')
    expect(screen.queryByRole('link', { name: '前往專案管理' })).toBeNull()
  })

  it('兩者皆無的帳號在 /field 看到權限說明，沒有前往專案管理', async () => {
    stubBackend(NOBODY)
    renderApp('/')

    expect(
      await screen.findByRole('heading', { name: '目前無法查看現場任務' }),
    ).toBeVisible()
    expect(screen.queryByRole('link', { name: '前往專案管理' })).toBeNull()
  })
})

describe('出路與 404（#480）', () => {
  it.each([
    ['系統管理者', ADMIN, '返回管理頁', '/admin'],
    ['純內業', OFFICE, '返回我的專案', '/admin/projects'],
    ['純現場', MEMBER, '返回今日任務', '/field'],
    ['兩者皆有', BOTH, '返回我的專案', '/admin/projects'],
    ['兩者皆無', NOBODY, '返回今日任務', '/field'],
    ['只有範本管理員', TEMPLATE_ONLY, '返回範本管理', '/admin/templates'],
  ] as const)('變更密碼頁的返回連結：%s', async (_n, user, name, href) => {
    stubBackend(user)
    renderApp('/change-password')

    expect(await screen.findByRole('link', { name })).toHaveAttribute(
      'href',
      href,
    )
  })

  it('必須先變更臨時密碼時不提供返回連結', async () => {
    stubBackend({ ...MEMBER, must_change_password: true })
    renderApp('/change-password')

    await screen.findByRole('heading', { name: '變更密碼' })
    expect(screen.queryByRole('link', { name: /^返回/ })).toBeNull()
  })

  it('不存在的路徑顯示 404 與回首頁連結', async () => {
    stubBackend(OFFICE)
    renderApp('/no-such-page')

    expect(
      await screen.findByRole('heading', { name: '找不到這個頁面' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '回首頁' })).toHaveAttribute(
      'href',
      '/',
    )
  })

  it('內業帳號只靠點擊：登入、進專案、頂端列回清單、無權限頁有出路', async () => {
    stubBackend(null, OFFICE)
    renderApp('/login')
    await signIn()

    await screen.findByRole('heading', { name: '我的專案' })
    fireEvent.click(await screen.findByRole('link', { name: '進入專案' }))

    // 專案頁有頂端列：帳號名稱、專案、變更密碼、登出。
    const bar = await screen.findByRole('navigation', { name: '管理功能' })
    expect(await screen.findByText('DEMO-A｜示範工程甲')).toBeVisible()
    expect(screen.getByText(/登入者：主管/)).toBeVisible()
    expect(within(bar).getByRole('link', { name: '變更密碼' })).toBeVisible()
    expect(screen.getByRole('button', { name: '登出' })).toBeVisible()
    // 導覽沒有分區與進度的佔位頁，也沒有管理者專屬項目。
    for (const name of [
      '分區',
      '進度',
      '使用者',
      '公司',
      '角色',
      '範本管理',
    ]) {
      expect(screen.queryByRole('link', { name })).toBeNull()
    }

    fireEvent.click(within(bar).getByRole('link', { name: '專案' }))
    expect(
      await screen.findByRole('heading', { name: '我的專案' }),
    ).toBeVisible()

    // 變更密碼頁可以返回我的專案（管理頁每次導覽都重掛，重新取得導覽列）。
    fireEvent.click(
      within(screen.getByRole('navigation', { name: '管理功能' })).getByRole(
        'link',
        { name: '變更密碼' },
      ),
    )
    fireEvent.click(await screen.findByRole('link', { name: '返回我的專案' }))
    expect(
      await screen.findByRole('heading', { name: '我的專案' }),
    ).toBeVisible()
  })

  it('非範本管理員直接開 /admin/templates 看到有出路的無權限頁', async () => {
    stubBackend(OFFICE)
    renderApp('/admin/templates')

    expect(
      await screen.findByRole('heading', { name: '無權限' }),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: /新增/ })).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: '返回我的專案' }))
    expect(
      await screen.findByRole('heading', { name: '我的專案' }),
    ).toBeVisible()
  })
})

describe('收回自己的管理者權限（#284 第 2、3 項）', () => {
  it('先確認；取消時不送出請求', async () => {
    const backend = stubBackend(ADMIN)
    renderApp('/admin/users')
    fireEvent.click(await screen.findByRole('button', { name: '收回管理者' }))

    const confirmation = screen.getByRole('region', { name: '操作確認' })
    expect(confirmation).toHaveTextContent('boss')
    expect(confirmation).toHaveTextContent('無法再進入管理頁')
    fireEvent.click(within(confirmation).getByRole('button', { name: '取消' }))
    expect(
      backend.fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith(`/users/${ADMIN.id}/admin`),
      ),
    ).toBe(false)
    expect(
      screen.getByRole('heading', { name: '使用者管理' }),
    ).toBeInTheDocument()
  })

  it('確認後收回成功：提示並導離管理頁，不顯示權限錯誤', async () => {
    const backend = stubBackend(ADMIN)
    renderApp('/admin/users')
    fireEvent.click(await screen.findByRole('button', { name: '收回管理者' }))
    fireEvent.click(
      within(screen.getByRole('region', { name: '操作確認' })).getByRole(
        'button',
        { name: '確認' },
      ),
    )

    expect(await screen.findByRole('status')).toHaveTextContent(
      '已收回你的管理者權限',
    )
    expect(
      screen.getByRole('heading', { name: '今日任務' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('你沒有權限執行這項操作')).toBeNull()
    expect(screen.queryByRole('heading', { name: '使用者管理' })).toBeNull()

    // 導離後有重新取得目前使用者，且收回後沒有再呼叫列表 API。
    const calls = backend.fetchMock.mock.calls.map(([url]) => String(url))
    const revokeIndex = calls.findIndex((url) =>
      url.endsWith(`/users/${ADMIN.id}/admin`),
    )
    expect(revokeIndex).toBeGreaterThan(-1)
    expect(
      calls.slice(revokeIndex + 1).some((url) => url.endsWith('/users')),
    ).toBe(false)
    expect(
      calls.slice(revokeIndex + 1).some((url) => url.endsWith('/auth/me')),
    ).toBe(true)
  })

  it('收回自己失敗時留在管理頁並顯示錯誤', async () => {
    const backend = stubBackend(ADMIN)
    const original = backend.fetchMock.getMockImplementation()!
    backend.fetchMock.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith(`/users/${ADMIN.id}/admin`)) {
          return Response.json(
            { error: { code: 'permission.denied' } },
            { status: 403 },
          )
        }
        return original(input, init)
      },
    )
    renderApp('/admin/users')
    fireEvent.click(await screen.findByRole('button', { name: '收回管理者' }))
    fireEvent.click(
      within(screen.getByRole('region', { name: '操作確認' })).getByRole(
        'button',
        { name: '確認' },
      ),
    )

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    expect(
      screen.getByRole('heading', { name: '使用者管理' }),
    ).toBeInTheDocument()
  })
})
