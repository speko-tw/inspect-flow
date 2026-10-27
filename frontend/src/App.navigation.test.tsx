// 登入、變更密碼、收回自己的管理者權限後的導向（#284 第 1～3 項）。
// 用完整的 `App` 與路由驗證，後端以 fetch 替身模擬。

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { useNavigate } from 'react-router'
import { DataMemoryRouter } from './testing/DataMemoryRouter'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest'

import App from './App'
import type { CurrentUser } from './auth/api'
import type { FieldTask } from './field/api'
import { deferred } from './testing/submitGuard'
import { rememberUser, resetSessionMemory } from './auth/sessionMemory'
import { request } from './http'
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
  can_inspect_tasks: true,
  has_template_access: true,
})

const NON_ADMIN = {
  ...ADMIN,
  id: 'member-1',
  is_admin: false,
  can_browse_templates: false,
  can_manage_template_library: false,
}
// 五種身分的存取摘要（#480）；欄位與形狀由 current-user-contract.json 守住。
const MEMBER = {
  ...NON_ADMIN,
  has_office_access: false,
  has_field_access: true,
  can_inspect_tasks: true,
  has_template_access: false,
  can_browse_templates: false,
  can_manage_template_library: false,
}
const FIELD_PROJECT_READ = {
  ...MEMBER,
  has_project_access: true,
}
const OFFICE = {
  ...NON_ADMIN,
  has_office_access: true,
  has_project_access: true,
  has_field_access: false,
  can_inspect_tasks: false,
  has_template_access: false,
  can_browse_templates: false,
  can_manage_template_library: false,
}
const BOTH = {
  ...NON_ADMIN,
  has_office_access: true,
  has_project_access: true,
  can_manage_project_planning_or_members: true,
  has_field_access: true,
  can_inspect_tasks: true,
  has_template_access: false,
  can_browse_templates: false,
  can_manage_template_library: false,
}
const TEMPLATE_ONLY = {
  ...NON_ADMIN,
  has_office_access: false,
  has_field_access: false,
  can_inspect_tasks: false,
  has_template_access: true,
  can_browse_templates: true,
  can_manage_template_library: true,
  module_permissions: ['template.manage'],
}
const TEMPLATE_FIELD = {
  ...TEMPLATE_ONLY,
  has_field_access: true,
  can_inspect_tasks: true,
}
const TEMPLATE_ONLY_LANDING_CASE = [
  '只有範本管理員',
  TEMPLATE_ONLY,
  '返回查核範本',
  '/templates',
] as const
const NOBODY = {
  ...NON_ADMIN,
  has_office_access: false,
  has_field_access: false,
  can_inspect_tasks: false,
  has_template_access: false,
  can_browse_templates: false,
  can_manage_template_library: false,
}

const MY_PROJECTS = [
  myProjectFixture({
    id: 'project-a',
    project_code: 'DEMO-A',
    name: '示範工程甲',
    role_names: ['內業'],
  }),
]

// 要停在「我的任務」的案例（含 #489 的「不沿用全部」）都要有指派資料，
// 才能依 FUI-R02 維持我的任務；沒有指派時預設會改成「全部」。
const ASSIGNED_FIELD_TASK: FieldTask = {
  id: 'assigned-task',
  name: '新帳號已指派的外牆查核',
  project_id: 'project-a',
  project_name: '示範工程甲',
  status: 'PENDING',
  dispatched_at: '2026-10-05T08:00:00Z',
  location: { zone_name: '一樓', location_text: '東側' },
  suggested_assignee: { name_zh: MEMBER.name_zh },
  item_summary: { first_title: '外牆鋼筋查核', item_count: 1 },
}

const WORKFLOW_SUMMARY = {
  project: {
    id: 'project-a',
    project_code: 'DEMO-A',
    name: '示範工程甲',
    company_role: 'contractor',
  },
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
type FetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

interface Backend {
  /** 目前登入的人；`null` 代表未登入。測試中可隨時改。 */
  me: CurrentUserBody
  /** 登入成功時回傳的人。 */
  loginAs: CurrentUser
  /** 目前登入者的指派資料；本替身沒有額外的他人任務。 */
  assignedTasks: FieldTask[]
  fetchMock: Mock<FetchHandler>
}

function stubBackend(
  me: CurrentUserBody,
  loginAs: CurrentUser = ADMIN,
): Backend {
  const backend: Backend = {
    me,
    loginAs,
    assignedTasks: [],
    fetchMock: vi.fn<FetchHandler>(),
  }
  backend.fetchMock.mockImplementation(
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
      if (/\/users\/[^/]+\/participating-projects$/.test(url)) {
        return Response.json({ items: [] })
      }
      if (/\/users\/[^/]+\/module-permissions$/.test(url)) {
        return Response.json({ permission_codes: [], delegated_modules: [] })
      }
      if (url.endsWith('/module-permissions')) {
        return Response.json({ items: [] })
      }
      if (url.endsWith(`/users/${ADMIN.id}`) && method === 'GET') {
        return Response.json({
          ...ADMIN,
          name_en: null,
          company_id: null,
          department: null,
          location: null,
          employee_no: null,
          auth_source: 'local',
          is_active: true,
          is_admin: backend.me?.is_admin ?? false,
          is_system: false,
        })
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
        return Response.json({
          items: backend.assignedTasks,
          next_cursor: null,
        })
      }
      if (url.endsWith('/workflow-summary')) {
        return Response.json(WORKFLOW_SUMMARY)
      }
      if (url.endsWith('/me/projects')) {
        const projects =
          backend.me?.has_project_access && !backend.me.has_office_access
            ? MY_PROJECTS.map((project) => ({
                ...project,
                has_office_access: false,
              }))
            : MY_PROJECTS
        return Response.json(projects)
      }
      if (url.endsWith('/project-company-roles')) {
        return Response.json({
          items: [
            {
              value: 'contractor',
              label: '承攬施工方',
              inspection_level: 'self_inspection',
            },
          ],
        })
      }
      if (url.includes('/overview/projects?')) {
        return Response.json({ items: [], next_cursor: null })
      }
      if (url.includes('/overview/engineers?')) {
        return Response.json({ items: [], next_cursor: null })
      }
      if (url.includes('/overview/summary')) {
        return Response.json({
          pending_count: 0,
          in_progress_count: 0,
          completed_count: 0,
          completion_rate: 0,
        })
      }
      return Response.json([])
    },
  )
  vi.stubGlobal('fetch', backend.fetchMock)
  return backend
}

function renderApp(path: string, state?: unknown) {
  return render(
    <DataMemoryRouter initialEntries={[{ pathname: path, state }]}>
      <App />
    </DataMemoryRouter>,
  )
}

function BackButton() {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate(-1)}>
      測試用上一頁
    </button>
  )
}

/** 有多筆歷史的畫面，可用「測試用上一頁」模擬瀏覽器的上一頁。 */
function renderAppWithHistory(entries: string[]) {
  return render(
    <DataMemoryRouter
      initialEntries={entries}
      initialIndex={entries.length - 1}
    >
      <BackButton />
      <App />
    </DataMemoryRouter>,
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

/**
 * 斷言落在今日任務頁的「我的任務」；呼叫端的替身須有 ASSIGNED_FIELD_TASK。
 *
 * 標題在查詢指派前就會以「我的任務」掛上，FUI-R02 再依查詢結果決定預設
 * 範圍：沒有指派時改成「全部」並重掛清單，先抓到的標題節點會被換掉，
 * CI 較慢時才偶發 not in the document。等指派資料出現代表範圍已定，
 * 此時的標題才是穩定狀態。
 */
async function expectMyTasksLanding() {
  await screen.findByText(ASSIGNED_FIELD_TASK.name)
  expect(
    screen.getByRole('heading', { level: 1, name: '我的任務' }),
  ).toBeVisible()
}

// 拆包模組的首次載入成本放在 hook，不佔各測試斷言的 1 秒（#295）。
beforeAll(preloadLazyRoutes)

beforeEach(resetSessionMemory)

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
      await screen.findByRole('heading', { name: '專案進度總覽', level: 1 }),
    ).toBeInTheDocument()
  })

  it('一般使用者登入後進現場頁', async () => {
    const backend = stubBackend(null, MEMBER)
    backend.assignedTasks = [ASSIGNED_FIELD_TASK]
    renderApp('/login')
    await signIn()

    await expectMyTasksLanding()
  })

  it('安全的 from 優先於身分預設落點', async () => {
    const backend = stubBackend(null, ADMIN)
    backend.assignedTasks = [ASSIGNED_FIELD_TASK]
    renderApp('/login', { from: '/tasks' })
    await signIn()

    await expectMyTasksLanding()
  })

  it('不安全的 from 被忽略，仍依身分導向', async () => {
    stubBackend(null, ADMIN)
    renderApp('/login', { from: '//evil.example' })
    await signIn()

    expect(
      await screen.findByRole('heading', { name: '專案進度總覽', level: 1 }),
    ).toBeInTheDocument()
  })

  it('變更密碼完成後（沒有 from）依身分導向：admin 進管理頁', async () => {
    stubBackend(ADMIN)
    renderApp('/settings')
    await screen.findByRole('heading', { name: '個人設定' })

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
      await screen.findByRole('heading', { name: '專案進度總覽', level: 1 }),
    ).toBeInTheDocument()
  })

  it('變更密碼完成後（沒有 from）依身分導向：一般使用者進現場頁', async () => {
    const backend = stubBackend(MEMBER)
    backend.assignedTasks = [ASSIGNED_FIELD_TASK]
    renderApp('/settings')
    await screen.findByRole('heading', { name: '個人設定' })

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

    await expectMyTasksLanding()
  })

  it('已登入者開 / 直接導向：admin 進管理頁', async () => {
    stubBackend(ADMIN)
    renderApp('/')

    expect(
      await screen.findByRole('heading', { name: '專案進度總覽', level: 1 }),
    ).toBeInTheDocument()
  })

  it('已登入者開 / 直接導向：一般使用者進現場頁', async () => {
    const backend = stubBackend(MEMBER)
    backend.assignedTasks = [ASSIGNED_FIELD_TASK]
    renderApp('/')

    await expectMyTasksLanding()
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
    ['系統管理者', ADMIN, '專案進度總覽'],
    ['純內業', OFFICE, '我的專案'],
    ['純現場', MEMBER, '我的任務'],
    ['具專案管理與現場權限', BOTH, '我的專案'],
    ['兩者皆無', NOBODY, '個人設定'],
    ['只有範本管理員', TEMPLATE_ONLY, '查核範本'],
    ['範本管理員兼現場', TEMPLATE_FIELD, '我的任務'],
  ] as const

  async function changePassword() {
    await screen.findByRole('heading', { name: '個人設定' })
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
    renderApp('/settings')
    await changePassword()

    expect(await screen.findByRole('heading', { name: heading })).toBeVisible()
  })

  it.each(identities)('開 /：%s', async (_name, user, heading) => {
    stubBackend(user)
    renderApp('/')

    expect(await screen.findByRole('heading', { name: heading })).toBeVisible()
  })

  it('純內業的專案清單只顯示 API 回傳的專案，沒有新增專案', async () => {
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
              can_apply_templates: false,
            },
          ])
        : original(input, init),
    )
    renderApp('/')

    await screen.findByRole('heading', { name: '我的專案' })
    expect(await screen.findByText('示範工程甲')).toBeVisible()
    expect(screen.getByText('示範工程乙')).toBeVisible()
    expect(screen.getByText('只有現場的工程')).toBeVisible()
    expect(screen.queryByText('新增專案')).toBeNull()
    const links = screen.getAllByRole('link', { name: '開啟專案' })
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/projects/project-a',
      '/projects/project-b',
      '/projects/project-c',
    ])
  })

  it('範本管理員兼現場：任務頁可開範本', async () => {
    stubBackend(TEMPLATE_FIELD)
    renderApp('/')

    await screen.findByRole('heading', { name: '我的任務' })
    expect(screen.queryByRole('link', { name: '專案' })).toBeNull()
    expect(screen.getByRole('link', { name: '範本' })).toHaveAttribute(
      'href',
      '/templates',
    )
  })

  it('只有範本管理員可從任務頁返回範本', async () => {
    stubBackend(TEMPLATE_ONLY)
    renderApp('/tasks')

    expect(
      await screen.findByRole('heading', { name: '無權限' }),
    ).toBeVisible()
    expect(
      await screen.findByText('你沒有使用這個頁面的權限', {
        selector: 'p[role="status"]',
      }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '回到我的首頁' })).toHaveAttribute(
      'href',
      '/templates',
    )
    expect(screen.getByRole('link', { name: '範本' })).toBeVisible()
    const projectsLink = screen.queryByRole('link', {
      name: '前往我的專案',
    })
    expect(projectsLink).toBeNull()
  })

  it('全無權限開任務頁顯示說明並可前往設定', async () => {
    stubBackend(NOBODY)
    renderApp('/tasks')

    expect(
      await screen.findByRole('heading', { name: '無權限' }),
    ).toBeVisible()
    expect(
      await screen.findByText('你沒有使用這個頁面的權限', {
        selector: 'p[role="status"]',
      }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '回到我的首頁' })).toHaveAttribute(
      'href',
      '/settings',
    )
  })
})

describe('出路與 404（#480）', () => {
  it.each([
    ['系統管理者', ADMIN, '返回總覽', '/overview'],
    ['純內業', OFFICE, '返回專案', '/projects'],
    ['純現場', MEMBER, '返回我的任務', '/tasks'],
    ['具專案管理與現場權限', BOTH, '返回專案', '/projects'],
    TEMPLATE_ONLY_LANDING_CASE,
  ] as const)('變更密碼頁的返回連結：%s', async (_n, user, name, href) => {
    stubBackend(user)
    renderApp('/settings')

    expect(await screen.findByRole('link', { name })).toHaveAttribute(
      'href',
      href,
    )
  })

  it('全無權限帳號在設定頁看到開通說明，沒有未授權頁面的返回連結', async () => {
    stubBackend(NOBODY)
    renderApp('/settings')

    await screen.findByRole('heading', { name: '個人設定' })
    expect(screen.getByText('尚未開通任何功能，請洽系統管理者')).toBeVisible()
    expect(screen.queryByRole('link', { name: /^返回/ })).toBeNull()
  })

  it('必須先變更臨時密碼時不提供返回連結', async () => {
    stubBackend({ ...MEMBER, must_change_password: true })
    renderApp('/settings')

    await screen.findByRole('heading', { name: '請先設定新密碼' })
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
      '/projects',
    )
  })

  it.each([
    '/field',
    '/field/projects/project-a',
    '/admin/projects/project-a/templates',
    '/change-password',
  ])('舊 UI 路徑 %s 回 404', async (path) => {
    stubBackend(OFFICE)
    renderApp(path)

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
    fireEvent.click(await screen.findByRole('link', { name: '開啟專案' }))

    // 專案頁有頂端列：帳號名稱、專案；個人選單提供密碼與登出。
    const bar = await screen.findByRole('navigation', { name: '管理功能' })
    // 標題拆成代號與名稱兩個區塊，改用標題的可及名稱比對整句。
    expect(
      await screen.findByRole('heading', { name: 'DEMO-A｜示範工程甲' }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: '主管 ▾' })).toBeVisible()
    expect(within(bar).queryByRole('link', { name: '設定' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '主管 ▾' }))
    expect(screen.getByRole('link', { name: '設定' })).toBeVisible()
    expect(screen.getByRole('button', { name: '登出' })).toBeVisible()
    // 導覽沒有分區與進度的佔位頁，也沒有管理者專屬項目。
    for (const name of ['分區', '進度', '管理', '公司', '角色', '範本']) {
      expect(screen.queryByRole('link', { name })).toBeNull()
    }

    fireEvent.click(within(bar).getByRole('link', { name: '專案' }))
    expect(
      await screen.findByRole('heading', { name: '我的專案' }),
    ).toBeVisible()

    // 變更密碼頁可以返回我的專案。
    fireEvent.click(screen.getByRole('button', { name: '主管 ▾' }))
    fireEvent.click(screen.getByRole('link', { name: '設定' }))
    fireEvent.click(await screen.findByRole('link', { name: '返回專案' }))
    expect(
      await screen.findByRole('heading', { name: '我的專案' }),
    ).toBeVisible()
  })

  it('非範本管理員直接開 /admin/templates 看到有出路的無權限頁', async () => {
    stubBackend(OFFICE)
    renderApp('/templates')

    expect(
      await screen.findByRole('heading', { name: '無權限' }),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: /新增/ })).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: '回到我的首頁' }))
    expect(
      await screen.findByRole('heading', { name: '我的專案' }),
    ).toBeVisible()
  })
})

describe('收回自己的管理者權限（#284 第 2、3 項）', () => {
  async function openOwnAdminAction() {
    const accountLink = await screen.findByRole('link', { name: '主管' })
    expect(accountLink).toHaveAttribute('href', '/accounts/admin-1')
    fireEvent.click(accountLink)
    await screen.findByRole('heading', { name: '主管', level: 1 })
    fireEvent.click(await screen.findByRole('button', { name: '收回管理者' }))
  }

  it('先確認；取消時不送出請求', async () => {
    const backend = stubBackend(ADMIN)
    renderApp('/accounts')
    await openOwnAdminAction()

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
      screen.getByRole('heading', { name: '主管', level: 1 }),
    ).toBeInTheDocument()
  })

  it('確認後收回成功：提示並導離管理頁，不顯示權限錯誤', async () => {
    const backend = stubBackend(ADMIN)
    backend.assignedTasks = [ASSIGNED_FIELD_TASK]
    renderApp('/accounts')
    await openOwnAdminAction()
    fireEvent.click(
      within(screen.getByRole('region', { name: '操作確認' })).getByRole(
        'button',
        { name: '確認' },
      ),
    )

    expect(await screen.findByText('已收回你的管理者權限。')).toBeVisible()
    await expectMyTasksLanding()
    expect(screen.queryByText('你沒有權限執行這項操作')).toBeNull()
    expect(
      screen.queryByRole('heading', { name: '帳號', level: 1 }),
    ).toBeNull()

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

  it('收回後沒有現場權限：落點依存取摘要選，不固定到 /field', async () => {
    const backend = stubBackend(ADMIN)
    const original = backend.fetchMock.getMockImplementation()!
    backend.fetchMock.mockImplementation(async (input, init) => {
      const response = await original(input, init)
      // 收回後這個帳號只剩內業權限，落點應是我的專案（F-O04）。
      if (String(input).endsWith(`/users/${ADMIN.id}/admin`)) {
        backend.me = { ...OFFICE }
      }
      return response
    })
    renderApp('/accounts')
    await openOwnAdminAction()
    fireEvent.click(
      within(screen.getByRole('region', { name: '操作確認' })).getByRole(
        'button',
        { name: '確認' },
      ),
    )

    expect(
      await screen.findByRole('heading', { name: '我的專案' }),
    ).toBeVisible()
    expect(screen.getByText('已收回你的管理者權限。')).toBeVisible()
    expect(screen.queryByRole('heading', { name: '我的任務' })).toBeNull()
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
    renderApp('/accounts')
    await openOwnAdminAction()
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
      screen.getByRole('heading', { name: '主管', level: 1 }),
    ).toBeInTheDocument()
  })
})

describe('登入逾時與未儲存頁面（#623）', () => {
  it('確認捨棄後登入，回到原專案頁', async () => {
    const backend = stubBackend(ADMIN, ADMIN)
    const original = backend.fetchMock.getMockImplementation()!
    backend.fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input), 'http://testserver')
      if (url.pathname === '/api/v1/projects' && init?.method !== 'POST') {
        return Response.json({ items: [], next_cursor: null })
      }
      return original(input, init)
    })
    renderApp('/projects')
    await screen.findByRole('heading', { name: '專案' })
    const createProjectLink = await screen.findByRole('link', {
      name: '新增專案',
    })
    fireEvent.click(createProjectLink)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Admin' }),
    ).toBeVisible()
    const projectName = await screen.findByLabelText(/工程名稱/)
    fireEvent.change(projectName, {
      target: { value: '逾時前的草稿' },
    })
    const adminNav = screen.getByRole('navigation', { name: '管理功能' })
    fireEvent.click(within(adminNav).getByRole('link', { name: '專案' }))
    const selfLinkPrompt = await screen.findByRole('group', {
      name: '有尚未儲存的變更',
    })
    fireEvent.click(
      within(selfLinkPrompt).getByRole('button', { name: '保留編輯' }),
    )
    expect(projectName).toHaveValue('逾時前的草稿')

    const currentFetch = backend.fetchMock.getMockImplementation()!
    backend.fetchMock.mockImplementationOnce(async (input, init) => {
      if (String(input).endsWith('/session-expired-probe')) {
        backend.me = null
        return Response.json(
          { error: { code: 'auth.not_authenticated' } },
          { status: 401 },
        )
      }
      return currentFetch(input, init)
    })
    await expect(request('/session-expired-probe')).rejects.toMatchObject({
      status: 401,
    })

    const loginLink = await screen.findByRole('link', { name: '重新登入' })
    fireEvent.click(loginLink)
    const prompt = await screen.findByRole('group', {
      name: '有尚未儲存的變更',
    })
    expect(projectName).toHaveValue('逾時前的草稿')
    const keepEditingButton = within(prompt).getByRole('button', {
      name: '保留編輯',
    })
    fireEvent.click(keepEditingButton)
    expect(projectName).toHaveValue('逾時前的草稿')

    fireEvent.click(screen.getByRole('link', { name: '重新登入' }))
    fireEvent.click(
      within(
        await screen.findByRole('group', { name: '有尚未儲存的變更' }),
      ).getByRole('button', { name: '捨棄變更' }),
    )
    await screen.findByRole('heading', { name: '登入' })
    await signIn()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Admin' }),
    ).toBeVisible()
    const resetProjectName = await screen.findByLabelText(/工程名稱/)
    expect(resetProjectName).toHaveValue('')
    expect(screen.getByRole('button', { name: '新增專案' })).toBeVisible()
  })
})

describe('換帳號登入一律落在新帳號的首頁（#489）', () => {
  /** 登出時後端清掉登入狀態；其餘沿用共用替身。 */
  function stubWithLogout(me: CurrentUser, loginAs: CurrentUser) {
    const backend = stubBackend(me, loginAs)
    const original = backend.fetchMock.getMockImplementation()!
    backend.fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/auth/logout')) {
        backend.me = null
        return new Response(null, { status: 204 })
      }
      return original(input, init)
    })
    return backend
  }

  async function logOut() {
    if (!screen.queryByRole('button', { name: '登出' })) {
      const trigger = screen
        .getByRole('banner')
        .querySelector<HTMLButtonElement>(
          'button[aria-controls="app-header-personal-menu"]',
        )
      expect(trigger).not.toBeNull()
      fireEvent.click(trigger!)
    }
    fireEvent.click(await screen.findByRole('button', { name: '登出' }))
    await screen.findByRole('heading', { name: '登入' })
  }

  it('現場帳號登出後換內業帳號登入，落在我的專案', async () => {
    stubWithLogout(MEMBER, OFFICE)
    renderApp('/tasks')
    await screen.findByRole('heading', { name: '我的任務' })

    await logOut()
    await signIn()

    expect(
      await screen.findByRole('heading', { name: '我的專案' }),
    ).toBeVisible()
    expect(screen.queryByRole('heading', { name: '我的任務' })).toBeNull()
  })

  it('內業帳號登出後換現場帳號登入，落在今日任務', async () => {
    const backend = stubWithLogout(OFFICE, MEMBER)
    backend.assignedTasks = [ASSIGNED_FIELD_TASK]
    renderApp('/projects')
    await screen.findByRole('heading', { name: '我的專案' })

    await logOut()
    await signIn()

    await expectMyTasksLanding()
    expect(screen.queryByRole('heading', { name: '我的專案' })).toBeNull()
  })

  const OTHER_FIELD = { ...MEMBER, id: 'member-2' }
  const scopeAll = () => screen.getByRole('button', { name: '全部' })

  function fieldScopes(backend: Backend, after = 0) {
    return backend.fetchMock.mock.calls
      .slice(after)
      .map(([input]) => new URL(String(input), 'http://testserver'))
      .filter((url) => url.pathname === '/api/v1/field/inspection-tasks')
      .map((url) => url.searchParams.get('assigned_to_me'))
  }

  async function switchFieldAccount(tasks: FieldTask[], delayed: boolean) {
    rememberUser(OTHER_FIELD.id)
    const backend = stubBackend(null, MEMBER)
    backend.assignedTasks = tasks
    const gate = deferred()
    const requestedUsers: Array<string | null> = []
    const original = backend.fetchMock.getMockImplementation()!
    backend.fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input), 'http://testserver')
      if (url.pathname === '/api/v1/field/inspection-tasks') {
        requestedUsers.push(backend.me?.id ?? null)
        if (delayed && url.searchParams.get('assigned_to_me') === 'true') {
          await gate.promise
        }
      }
      return original(input, init)
    })
    renderApp('/login', { from: '/tasks?scope=all' })
    await signIn()
    await screen.findByRole('heading', { name: '我的任務' })
    await waitFor(() => expect(fieldScopes(backend)[0]).toBe('true'))
    if (delayed) {
      expect(fieldScopes(backend)).toEqual(['true'])
      expect(scopeAll()).toHaveAttribute('aria-pressed', 'false')
      expect(screen.queryByRole('region', { name: '我的任務提醒' })).toBeNull()
    }
    gate.resolve()
    return { backend, requestedUsers }
  }

  it.each(['立即', '延後'])(
    '逾時後換了另一個人登入，即使原頁面看得到也不帶過去（有指派，%s回應）',
    async (timing) => {
      // 等待任務資料完成；標題只代表外殼已掛載，不代表預設範圍已決定。
      const { backend, requestedUsers } = await switchFieldAccount(
        [ASSIGNED_FIELD_TASK],
        timing === '延後',
      )
      await screen.findByText(ASSIGNED_FIELD_TASK.name)
      expect(scopeAll()).toHaveAttribute('aria-pressed', 'false')
      expect(fieldScopes(backend)).toEqual(['true'])
      expect(requestedUsers).toEqual([MEMBER.id])
      expect(screen.queryByRole('region', { name: '我的任務提醒' })).toBeNull()
    },
  )

  it.each(['立即', '延後'])(
    '逾時換人且新帳號無指派時，依新查詢切全部而非沿用前人篩選（%s回應）',
    async (timing) => {
      const { backend, requestedUsers } = await switchFieldAccount(
        [],
        timing === '延後',
      )
      await screen.findByRole('heading', { name: '目前沒有符合的任務' })
      expect(scopeAll()).toHaveAttribute('aria-pressed', 'true')
      expect(fieldScopes(backend)).toEqual(['true', 'false'])
      expect(requestedUsers).toEqual([MEMBER.id, MEMBER.id])
      expect(screen.queryByRole('region', { name: '我的任務提醒' })).toBeNull()
      expect(screen.getByRole('heading', { name: '全部任務' })).toBeVisible()
    },
  )

  it('沒有任何記錄時（直接開深層連結），登入後回到原頁面', async () => {
    stubBackend(null, MEMBER)
    renderAppWithHistory(['/tasks?scope=all'])
    await signIn()

    await screen.findByRole('heading', { name: '目前沒有符合的任務' })
    expect(scopeAll()).toHaveAttribute('aria-pressed', 'true')
  })

  it.each([
    ['另一個現場帳號', OTHER_FIELD],
    ['同一個帳號', MEMBER],
  ])('登出後按上一頁，再由%s登入，落在落點', async (_name, next) => {
    // 歷史：「全部」任務 → 今日任務（登出時被取代成 /login）。
    const backend = stubWithLogout(MEMBER, next)
    backend.assignedTasks = [ASSIGNED_FIELD_TASK]
    renderAppWithHistory(['/tasks?scope=all', '/tasks'])
    await screen.findByRole('heading', { name: '我的任務' })

    await logOut()
    fireEvent.click(screen.getByRole('button', { name: '測試用上一頁' }))
    // 回到登出前的深層頁，被導去登入並帶著 from。
    await screen.findByRole('heading', { name: '登入' })
    const beforeLogin = backend.fetchMock.mock.calls.length
    await signIn()

    await screen.findByText(ASSIGNED_FIELD_TASK.name)
    expect(scopeAll()).toHaveAttribute('aria-pressed', 'false')
    expect(fieldScopes(backend, beforeLogin)).toEqual(['true'])
  })

  it('逾時後同一個人重新登入，回到原本的頁面', async () => {
    rememberUser(BOTH.id)
    stubBackend(null, BOTH)
    renderApp('/login', { from: '/tasks?scope=all' })
    await signIn()

    expect(
      await screen.findByRole('heading', { name: '全部任務' }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('同一個人但原頁面已無權限時，改去落點', async () => {
    rememberUser(MEMBER.id)
    const backend = stubBackend(null, MEMBER)
    backend.assignedTasks = [ASSIGNED_FIELD_TASK]
    renderApp('/login', { from: '/projects' })
    await signIn()

    await expectMyTasksLanding()
  })
})

describe('我的專案入口依專案存取權限顯示（ADM-R23、ADM-R24）', () => {
  it('現場帳號從登入開始只靠點擊：現場頁頂端沒有我的專案', async () => {
    stubBackend(null, MEMBER)
    renderApp('/login')
    await signIn()

    await screen.findByRole('heading', { name: '我的任務' })
    const bar = screen.getByRole('navigation', { name: '我的功能' })
    expect(within(bar).queryByRole('link', { name: '專案' })).toBeNull()
    expect(within(bar).queryByRole('link', { name: '設定' })).toBeNull()
    const trigger = screen
      .getByRole('banner')
      .querySelector<HTMLButtonElement>(
        'button[aria-controls="app-header-personal-menu"]',
      )
    expect(trigger).not.toBeNull()
    fireEvent.click(trigger!)
    expect(screen.getByRole('link', { name: '設定' })).toBeVisible()
  })

  it('現場開專案清單導回任務，不顯示我的專案', async () => {
    const backend = stubBackend(MEMBER)
    backend.assignedTasks = [ASSIGNED_FIELD_TASK]
    renderApp('/projects')

    await expectMyTasksLanding()
    const projectsHeading = screen.queryByRole('heading', {
      name: '我的專案',
    })
    expect(projectsHeading).toBeNull()
    expect(screen.queryByRole('link', { name: '專案' })).toBeNull()
  })

  it('現場唯讀專案仍落任務，且可手動開啟專案清單', async () => {
    const backend = stubBackend(FIELD_PROJECT_READ)
    backend.assignedTasks = [ASSIGNED_FIELD_TASK]
    renderApp('/')

    await expectMyTasksLanding()
    const nav = screen.getByRole('navigation', { name: '我的功能' })
    fireEvent.click(within(nav).getByRole('link', { name: '專案' }))

    expect(
      await screen.findByRole('heading', { name: '我的專案' }),
    ).toBeVisible()

    expect(
      await screen.findByRole('heading', { name: '示範工程甲' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '開啟專案' })).toHaveAttribute(
      'href',
      '/projects/project-a',
    )
    fireEvent.click(screen.getByRole('link', { name: '開啟專案' }))
    expect(
      await screen.findByRole('heading', { name: /DEMO-A｜示範工程甲/ }),
    ).toBeVisible()
    expect(screen.queryByRole('link', { name: '套用範本' })).toBeNull()
  })

  it('範本管理員直接開專案清單：導回範本管理', async () => {
    stubBackend(TEMPLATE_ONLY)
    renderApp('/projects')

    expect(
      await screen.findByRole('heading', { name: '查核範本' }),
    ).toBeVisible()
    expect(screen.queryByRole('link', { name: '專案' })).toBeNull()
  })

  it('範本管理員兼現場進管理頁：頂端沒有我的專案', async () => {
    stubBackend(TEMPLATE_FIELD)
    renderApp('/templates')

    await screen.findByRole('heading', { name: '查核範本' })
    const bar = screen.getByRole('navigation', { name: '管理功能' })
    expect(within(bar).queryByRole('link', { name: '專案' })).toBeNull()
    expect(within(bar).getByRole('link', { name: '任務' })).toBeVisible()
  })

  it('有內業權限的人仍看得到入口', async () => {
    stubBackend(BOTH)
    renderApp('/templates')

    await screen.findByRole('heading', { name: '無權限' })
    const bar = screen.getByRole('navigation', { name: '管理功能' })
    expect(within(bar).getByRole('link', { name: '專案' })).toBeVisible()
  })
})
