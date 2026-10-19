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
import {
  deferred,
  expectImeEnterIgnored,
  type Deferred,
} from '../../testing/submitGuard'
import { CurrentUserProvider } from '../../auth/useCurrentUser'
import AdminPage from '../AdminPage'
import type { User } from '../api'
import type { MemberCandidate, Project, ProjectMember, Role } from './api'
import contract from './fixtures/member-roles-contract.json'
import roleContract from './fixtures/company-role-contract.json'

const officeUser: CurrentUser = {
  id: 'office-id',
  username: 'demo-office',
  email: null,
  name_en: null,
  name_zh: '示範內業',
  is_admin: false,
  must_change_password: false,
  has_office_access: true,
  can_manage_project_planning_or_members: true,
  has_field_access: false,
  can_inspect_tasks: false,
  has_template_access: false,
  module_permissions: [],
  delegated_modules: [],
  can_create_project: false,
  has_project_access: false,
  is_external_collaborator: false,
}

const adminUser: CurrentUser = {
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

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    project_code: 'DEMO-001',
    name: '示範工程',
    client_name: '示範業主',
    site_location: '示範工地',
    company_role: 'contractor',
    planned_start_date: '2026-10-01',
    planned_completion_date: null,
    warnings: [],
    ...overrides,
  }
}

function makeUser(id: string, username: string, nameZh: string): User {
  return {
    id,
    username,
    email: `${username}@demo.example`,
    name_zh: nameZh,
    name_en: null,
    company_id: null,
    department: null,
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
}

const roleA: Role = {
  id: 'role-a',
  name: '查核員',
  permission_codes: ['inspection_task.inspect', 'inspection_task.read'],
  is_external_allowed: true,
}
const roleB: Role = {
  id: 'role-b',
  name: '審核者',
  permission_codes: [
    'inspection_plan.create',
    'inspection_task.create',
    'inspection_task.dispatch',
  ],
  is_external_allowed: true,
}
const roleInternalOnly: Role = {
  id: 'role-internal',
  name: '內部角色',
  permission_codes: ['project.update'],
  is_external_allowed: false,
}

// 與後端相同：成員回應附角色名稱，與 role_ids 同序。
function namesOf(ids: string[]): string[] {
  return ids.map(
    (id) => [roleA, roleB].find((role) => role.id === id)?.name ?? '',
  )
}
const externalCandidate: MemberCandidate = {
  id: 'external-1',
  username: 'partner.user',
  name_zh: '外部協作者',
  company_name: '合作公司',
  is_external_collaborator: true,
  module_status: { project_use: false, inspection_use: false },
}
const anna = makeUser('user-1', 'anna.deng', '鄧安娜')
const bob = makeUser('user-2', 'bob.lin', '林鮑伯')
const inactive = {
  ...makeUser('user-3', 'old.user', '舊人員'),
  is_active: false,
}
const externalUser = {
  ...makeUser('user-4', 'partner.user', '外部人員'),
  is_external_collaborator: true,
}
const systemAdmin = {
  ...makeUser('user-0', 'admin', '系統管理員'),
  is_admin: true,
  is_system: true,
}

function renderAt(
  path: string,
  user: CurrentUser = adminUser,
  history?: { entries: string[]; index: number },
) {
  return render(
    <DataMemoryRouter
      initialEntries={history?.entries ?? [path]}
      initialIndex={history?.index}
    >
      <Routes>
        <Route
          element={
            <CurrentUserProvider value={{ user, clear: vi.fn() }}>
              <AdminPage />
              <MemberTestNavigation />
            </CurrentUserProvider>
          }
          path="/*"
        />
      </Routes>
    </DataMemoryRouter>,
  )
}

function MemberTestNavigation() {
  const navigate = useNavigate()
  return (
    <>
      <Link to="/projects">離開成員頁</Link>
      <button onClick={() => navigate(-1)} type="button">
        成員頁上一頁
      </button>
      <button onClick={() => navigate(1)} type="button">
        成員頁下一頁
      </button>
    </>
  )
}

function jsonBody(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

function projectFetch({
  projects = [makeProject()],
  members = [] as ProjectMember[],
  rolePages = [[roleA, roleB]] as Role[][],
  candidates,
  office = false,
  failWith,
}: {
  projects?: Project[]
  members?: ProjectMember[]
  rolePages?: Role[][]
  candidates?: MemberCandidate[]
  /** 內業（非管理者、有 project_member.manage）：全域 API 一律 403。 */
  office?: boolean
  failWith?: {
    match: RegExp
    method: string
    code: string
    status: number
    fields?: { path: string; code: string }[]
  }
} = {}) {
  const projectRows = projects.map((row) => ({ ...row }))
  const memberRows = members.map((row) => ({ ...row }))
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (failWith && failWith.method === method && failWith.match.test(url)) {
        return Response.json(
          {
            error: {
              code: failWith.code,
              ...(failWith.fields ? { fields: failWith.fields } : {}),
            },
          },
          { status: failWith.status },
        )
      }
      const parsed = new URL(url, 'http://testserver')
      // 與後端相同：內業不能讀全域 /users、/roles、/projects（#481）。
      if (
        office &&
        method === 'GET' &&
        (/^\/api\/v1\/(users|roles|projects)$/.test(parsed.pathname) ||
          /^\/api\/v1\/projects\/[^/]+$/.test(parsed.pathname))
      ) {
        return Response.json(
          { error: { code: 'permission.denied' } },
          { status: 403 },
        )
      }
      if (parsed.pathname === '/api/v1/project-company-roles') {
        // 與後端相同：回應形狀取自共用契約 fixture（RG-M22）。
        return Response.json(roleContract.roles_response)
      }
      if (parsed.pathname === '/api/v1/users' && method === 'GET') {
        return Response.json({
          items: [anna, bob, inactive, externalUser, systemAdmin],
          next_cursor: null,
        })
      }
      if (parsed.pathname.endsWith('/inspection-items') && method === 'GET') {
        return Response.json({ items: [], next_cursor: null })
      }
      if (parsed.pathname.endsWith('/workflow-summary') && method === 'GET') {
        const summaryProject =
          projectRows.find(
            (row) => row.id === parsed.pathname.split('/')[4],
          ) ?? projectRows[0]
        return Response.json({
          project: {
            id: summaryProject?.id ?? 'project-1',
            project_code: summaryProject?.project_code ?? 'DEMO-001',
            name: summaryProject?.name ?? '示範工程',
            company_role: summaryProject?.company_role ?? 'contractor',
          },
          member_count: memberRows.length,
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
          pending_reinspection_task_count: 0,
          next_steps: [],
          primary_step: null,
          task_counts_visible: true,
          draft_tasks_missing_assignee: 0,
          viewer_permission_codes: office
            ? ['project_member.manage', 'inspection_plan.read']
            : ['inspection_plan.read'],
        })
      }
      if (parsed.pathname === '/api/v1/projects' && method === 'GET') {
        const query = parsed.searchParams.get('q')?.toLowerCase() ?? ''
        const filtered = projectRows.filter((project) =>
          `${project.name} ${project.project_code}`
            .toLowerCase()
            .includes(query),
        )
        const start = Number(parsed.searchParams.get('cursor') ?? 0)
        const limit = Number(parsed.searchParams.get('limit') ?? 50)
        const items = filtered.slice(start, start + limit)
        return Response.json({
          items,
          next_cursor:
            start + limit < filtered.length ? String(start + limit) : null,
        })
      }
      if (url.endsWith('/projects') && method === 'POST') {
        const created = makeProject({
          id: `project-${projectRows.length + 1}`,
          ...(jsonBody(init) as Partial<Project>),
          warnings: projectRows.some(
            (row) => row.project_code === jsonBody(init).project_code,
          )
            ? [{ code: 'project_code.duplicate' }]
            : [],
        })
        projectRows.push(created)
        return Response.json(created, { status: 201 })
      }
      const projectMatch = /\/projects\/([^/?]+)$/.exec(url)
      if (projectMatch && method === 'GET') {
        return Response.json(
          projectRows.find((row) => row.id === projectMatch[1]),
        )
      }
      if (projectMatch && method === 'PATCH') {
        const row = projectRows.find((item) => item.id === projectMatch[1])
        // 原因只進稽核，不是專案上保存的欄位（DOM-R76）。
        const fields = jsonBody(init)
        // 與後端相同：改角色的請求只會帶契約規定的兩個欄位。
        if (fields.company_role !== undefined) {
          expect(Object.keys(fields)).toEqual(
            expect.arrayContaining(Object.keys(roleContract.patch_request)),
          )
        }
        delete fields.company_role_change_reason
        Object.assign(row ?? {}, fields)
        return Response.json(row)
      }
      if (url.endsWith('/members') && method === 'GET') {
        return Response.json(memberRows)
      }
      if (url.endsWith('/members') && method === 'POST') {
        const body = jsonBody(init)
        // 與後端相同：請求欄位固定，零角色回 422（ADM-R20）。
        expect(Object.keys(body).sort()).toEqual(contract.add_request_keys)
        if ((body.role_ids as string[]).length === 0) {
          return Response.json(
            { error: { code: contract.zero_role_error.code } },
            { status: contract.zero_role_error.status },
          )
        }
        const user = [anna, bob].find((item) => item.id === body.user_id)
        const added: ProjectMember = {
          id: `member-${memberRows.length + 1}`,
          user_id: String(body.user_id),
          username: user?.username ?? '',
          role_ids: body.role_ids as string[],
          role_names: namesOf(body.role_ids as string[]),
          name_zh: user?.name_zh ?? null,
          email: user?.email ?? null,
          company_id: null,
          company_name: null,
          is_active: true,
          is_external_collaborator: user?.is_external_collaborator ?? false,
          module_status: { project_use: true, inspection_use: true },
        }
        memberRows.push(added)
        const { id, user_id, username, role_ids } = added
        return Response.json(
          { id, user_id, username, role_ids },
          { status: 201 },
        )
      }
      const rolesMatch = /\/members\/([^/]+)\/roles$/.exec(url)
      if (rolesMatch && method === 'PUT') {
        const body = jsonBody(init)
        expect(Object.keys(body).sort()).toEqual(
          contract.set_roles_request_keys,
        )
        if ((body.role_ids as string[]).length === 0) {
          return Response.json(
            { error: { code: contract.zero_role_error.code } },
            { status: contract.zero_role_error.status },
          )
        }
        const row = memberRows.find((item) => item.user_id === rolesMatch[1])
        if (row) {
          row.role_ids = body.role_ids as string[]
          row.role_names = namesOf(row.role_ids)
        }
        return Response.json(row)
      }
      const removeMatch = /\/members\/([^/]+)$/.exec(url)
      if (removeMatch && method === 'DELETE') {
        const index = memberRows.findIndex(
          (item) => item.user_id === removeMatch[1],
        )
        memberRows.splice(index, 1)
        return new Response(null, { status: 204 })
      }
      if (/\/projects\/[^/]+\/member-candidates$/.test(parsed.pathname)) {
        // 與後端相同：啟用、非系統帳號、尚未加入（欄位見契約檔）。
        const joined = new Set(memberRows.map((row) => row.user_id))
        const items =
          candidates ??
          [systemAdmin, anna, bob, inactive]
            .filter(
              (user) =>
                user.is_active && !user.is_system && !joined.has(user.id),
            )
            .map((user) => ({
              id: user.id,
              username: user.username,
              name_zh: user.name_zh,
              company_name: null,
              is_external_collaborator: false,
              module_status: { project_use: true, inspection_use: true },
            }))
        return Response.json({ items, next_cursor: null })
      }
      if (/\/projects\/[^/]+\/assignable-roles$/.test(parsed.pathname)) {
        const cursor = parsed.searchParams.get('cursor')
        const index = cursor ? Number(cursor) : 0
        return Response.json({
          items: rolePages[index].map(
            ({ id, name, permission_codes, is_external_allowed }) => ({
              id,
              name,
              permission_codes,
              is_external_allowed,
            }),
          ),
          next_cursor: index + 1 < rolePages.length ? String(index + 1) : null,
        })
      }
      return Response.json({}, { status: 404 })
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function calls(
  fetchMock: ReturnType<typeof projectFetch>,
  method: string,
  pattern: RegExp,
) {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      (init?.method ?? 'GET') === method && pattern.test(String(url)),
  )
}

function fillProjectForm() {
  if (!screen.queryByLabelText(/專案代號/)) {
    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))
  }
  fireEvent.change(screen.getByLabelText(/專案代號/), {
    target: { value: 'DEMO-002' },
  })
  fireEvent.change(screen.getByLabelText(/工程名稱/), {
    target: { value: '第二示範工程' },
  })
  fireEvent.change(screen.getByLabelText(/業主／委託單位/), {
    target: { value: '示範業主' },
  })
  fireEvent.change(screen.getByLabelText(/整體工程地點/), {
    target: { value: '第二示範工地' },
  })
}

async function waitForNewProjectSubmit() {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '新增專案' })).toBeEnabled(),
  )
}

const restoreScrollMocks: Array<() => void> = []

afterEach(() => {
  restoreScrollMocks.splice(0).forEach((restore) => restore())
  vi.unstubAllGlobals()
})

function mockScrollIntoView() {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollIntoView',
  )
  const scrollIntoView = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  })
  let restored = false
  const restore = () => {
    if (restored) return
    restored = true
    if (descriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        'scrollIntoView',
        descriptor,
      )
    } else {
      delete (HTMLElement.prototype as { scrollIntoView?: () => void })
        .scrollIntoView
    }
  }
  restoreScrollMocks.push(restore)
  return {
    restore,
    scrollIntoView,
  }
}

const sharedProjectFormCases = [
  {
    name: '專案管理搜尋',
    method: 'GET',
    match: /\/projects\?/,
    button: '搜尋',
    field: '搜尋專案',
    prepare: () => {},
  },
  {
    name: '專案管理新增或編輯',
    method: 'POST',
    match: /\/projects$/,
    button: '新增專案',
    field: '專案代號',
    prepare: fillProjectForm,
  },
] as const

describe.each(sharedProjectFormCases)('$name 共用表單', (formCase) => {
  async function setup() {
    const fetchMock = projectFetch()
    renderAt('/projects')
    await screen.findAllByText('示範工程')
    formCase.prepare()
    const button = screen.getByRole('button', { name: formCase.button })
    if (formCase.method === 'POST') {
      await waitForNewProjectSubmit()
    }
    const form = formOf(button)
    const field = within(form).getByLabelText(new RegExp(formCase.field))
    let failing = false
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      if (
        failing &&
        (init?.method ?? 'GET') === formCase.method &&
        formCase.match.test(String(input))
      ) {
        return Response.json(
          { error: { code: 'server.error' } },
          { status: 500 },
        )
      }
      return original(input, init)
    })
    return {
      fetchMock,
      button,
      field,
      form,
      setFailing: (value: boolean) => {
        failing = value
      },
    }
  }

  it('pending 期間只送一次並停用按鈕', async () => {
    const test = await setup()
    const before = calls(
      test.fetchMock,
      formCase.method,
      formCase.match,
    ).length
    const gate = holdRequests(test.fetchMock, formCase.method, formCase.match)

    fireEvent.click(test.button)
    fireEvent.submit(test.form)

    expect(test.button).toBeDisabled()
    expect(
      calls(test.fetchMock, formCase.method, formCase.match),
    ).toHaveLength(before + 1)
    gate.resolve()
    if (formCase.method === 'GET') {
      await waitFor(() => expect(test.button).toBeEnabled())
    } else {
      await screen.findByRole('heading', {
        name: 'DEMO-002｜第二示範工程',
      })
    }
  })

  it('IME Enter 不送出真實 API', async () => {
    const test = await setup()
    const before = calls(
      test.fetchMock,
      formCase.method,
      formCase.match,
    ).length
    expectImeEnterIgnored(test.field)
    expect(
      calls(test.fetchMock, formCase.method, formCase.match),
    ).toHaveLength(before)
  })

  it('API 失敗後可以再次送出', async () => {
    const test = await setup()
    const before = calls(
      test.fetchMock,
      formCase.method,
      formCase.match,
    ).length
    test.setFailing(true)
    fireEvent.click(test.button)
    await screen.findByRole('alert')
    expect(
      calls(test.fetchMock, formCase.method, formCase.match),
    ).toHaveLength(before + 1)
    test.setFailing(false)
    fireEvent.click(test.button)
    if (formCase.method === 'GET') {
      await waitFor(() =>
        expect(
          calls(test.fetchMock, formCase.method, formCase.match),
        ).toHaveLength(before + 2),
      )
    } else {
      await screen.findByRole('heading', {
        name: 'DEMO-002｜第二示範工程',
      })
      expect(
        calls(test.fetchMock, formCase.method, formCase.match),
      ).toHaveLength(before + 2)
    }
  })
})

// 確認與取消固定排成 [取消][確認]；只有最終確認用 btn-danger（#500）。
function expectCancelThenDanger(scope: HTMLElement, labels: [string, string]) {
  const buttons = within(scope).getAllByRole('button')
  expect(buttons.map((button) => button.textContent)).toEqual(labels)
  expect(buttons[0]).not.toHaveClass('btn-danger')
  expect(buttons[1]).toHaveClass('btn-danger')
}

describe('admin projects page', () => {
  it('opens create and edit as separate form modes', async () => {
    projectFetch()
    renderAt('/projects')
    await screen.findAllByText('示範工程')
    expect(await screen.findByText('本公司角色：承攬施工方')).toBeVisible()
    const card = screen
      .getByRole('heading', { name: '示範工程' })
      .closest('article') as HTMLElement
    expect(card.querySelector('.card-actions')).not.toBeNull()
    expect(
      within(card).getAllByRole('button', { name: /編輯專案/ }),
    ).toHaveLength(1)
    expect(within(card).getAllByRole('link')).toHaveLength(3)

    expect(screen.queryByLabelText(/專案代號/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))
    expect(screen.getByRole('heading', { name: '新增專案' })).toBeVisible()
    expect(screen.getByLabelText(/專案代號/)).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: /編輯專案/ }))
    expect(
      screen.getByRole('heading', { name: '編輯專案「示範工程」' }),
    ).toBeVisible()
    expect(screen.getByLabelText(/專案代號/)).toHaveValue('DEMO-001')
    expect(screen.queryByRole('heading', { name: '新增專案' })).toBeNull()
    expect(screen.queryByLabelText('搜尋專案')).toBeNull()
    expect(screen.queryByRole('button', { name: '新增專案' })).toBeNull()
    expect(screen.queryByRole('region', { name: '專案工作台' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByLabelText(/專案代號/)).not.toBeInTheDocument()
  })

  it('cancels a new project form through the list transition', async () => {
    projectFetch()
    renderAt('/projects')
    await screen.findAllByText('示範工程')
    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))

    expect(screen.getByRole('heading', { name: '新增專案' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.queryByRole('heading', { name: '新增專案' })).toBeNull()
    expect(screen.queryByRole('region', { name: '未儲存變更' })).toBeNull()
  })

  it('keeps or discards a dirty edit when cancelling to the list', async () => {
    projectFetch()
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    fireEvent.click(screen.getByRole('button', { name: /編輯專案/ }))
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '未儲存的名稱' },
    })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    let prompt = screen.getByRole('region', { name: '未儲存變更' })
    fireEvent.click(within(prompt).getByRole('button', { name: '保留編輯' }))
    expect(screen.getByLabelText(/工程名稱/)).toHaveValue('未儲存的名稱')

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    prompt = screen.getByRole('region', { name: '未儲存變更' })
    fireEvent.click(within(prompt).getByRole('button', { name: '捨棄' }))
    expect(screen.queryByLabelText(/工程名稱/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /編輯專案/ }))
    expect(screen.getByLabelText(/工程名稱/)).toHaveValue('示範工程')
  })

  it('shows refreshed project data after cancelling an unchanged edit', async () => {
    const fetchMock = projectFetch()
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    fireEvent.click(screen.getByRole('button', { name: /編輯專案/ }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByLabelText(/工程名稱/)).not.toBeInTheDocument()

    await fetchMock('/api/v1/projects/project-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: '伺服器更新後的名稱' }),
    })
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }))
    await screen.findAllByText('伺服器更新後的名稱')

    fireEvent.click(screen.getByRole('button', { name: /編輯專案/ }))
    expect(screen.getByLabelText(/工程名稱/)).toHaveValue('伺服器更新後的名稱')
  })

  it('lists projects and links from the admin navigation', async () => {
    projectFetch({
      projects: [
        makeProject(),
        makeProject({
          id: 'project-2',
          warnings: [{ code: 'project_code.duplicate' }],
        }),
      ],
    })
    renderAt('/accounts')
    fireEvent.click(await screen.findByRole('link', { name: '專案' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: '專案' }),
    ).toBeVisible()
    expect(await screen.findAllByText('示範工程')).toHaveLength(2)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    // 業主與預定開工日在卡片上；沒有預定完工日就不顯示該行。
    expect(screen.getAllByText('業主：示範業主')).toHaveLength(2)
    expect(screen.getAllByText('預定開工：2026-10-01')).toHaveLength(2)
    expect(screen.queryByText(/預定完工/)).not.toBeInTheDocument()
    expect(screen.getByText('（代號重複）')).toBeVisible()
    expect(
      screen.getByRole('heading', {
        name: '專案工作台',
      }),
    ).toBeVisible()
    expect(
      screen.getAllByRole('link', { name: '套用範本' })[0],
    ).toHaveAttribute('href', '/projects/project-1/inspection-items/templates')
    expect(screen.getAllByRole('link', { name: '成員' })[0]).toHaveAttribute(
      'href',
      '/projects/project-1/members',
    )
    expect(
      screen.getAllByRole('link', { name: '開啟專案' })[0],
    ).toHaveAttribute('href', '/projects/project-1')
    expect(screen.getAllByRole('link', { name: '成員' })[0]).toHaveClass('btn')
    expect(screen.getAllByRole('link', { name: '成員' })[0]).not.toHaveClass(
      'btn-sm',
    )
    // 每張卡片各提供一次開啟與套用範本連結；搜尋 submit 是次要按鈕。
    expect(screen.queryByText('查看專案')).toBeNull()
    expect(screen.queryByText('進入專案')).toBeNull()
    expect(screen.getAllByRole('link', { name: '開啟專案' })).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: '套用範本' })[0]).toHaveClass(
      'btn-primary',
    )
    expect(
      screen.getAllByRole('link', { name: '開啟專案' })[0],
    ).not.toHaveClass('btn-primary')
    expect(screen.getByRole('button', { name: '搜尋' })).not.toHaveClass(
      'btn-primary',
    )
    expect(screen.getByRole('button', { name: '新增專案' })).toHaveClass(
      'btn-primary',
    )
  })

  it('opens the project home with section navigation', async () => {
    projectFetch()
    renderAt('/projects/project-1')

    expect(
      await screen.findByRole('heading', { name: '專案首頁' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'DEMO-001｜示範工程' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '計畫與任務' })).toHaveAttribute(
      'href',
      '/projects/project-1/planning',
    )
  })

  it('searches projects and loads the next cursor page', async () => {
    const projects = Array.from({ length: 51 }, (_, index) =>
      makeProject({
        id: `project-${index}`,
        project_code: `DEMO-${String(index).padStart(3, '0')}`,
        name: index === 50 ? '目標工程' : `示範工程${index}`,
      }),
    )
    projectFetch({ projects })
    renderAt('/projects')

    await screen.findAllByText('示範工程0')
    expect(
      screen.getByRole('heading', { name: /示範工程0/ }),
    ).toBeInTheDocument()
    expect(screen.queryByText('目標工程')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '載入更多' }))
    await screen.findAllByText('目標工程')
    expect(
      screen.getByRole('heading', { name: /目標工程/ }),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('搜尋專案'), {
      target: { value: 'demo-050' },
    })
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }))
    await screen.findAllByText('目標工程')
    expect(
      screen.getByRole('heading', { name: /目標工程/ }),
    ).toBeInTheDocument()
    expect(screen.queryByText('示範工程0')).not.toBeInTheDocument()
  })

  it('shows planned completion on the card and hides empty lines', async () => {
    projectFetch({
      projects: [
        makeProject({
          planned_start_date: null,
          planned_completion_date: '2027-04-01',
        }),
        makeProject({
          id: 'project-2',
          name: '無日期工程',
          client_name: '',
          planned_start_date: null,
          planned_completion_date: null,
        }),
      ],
    })
    renderAt('/projects')
    await screen.findByRole('heading', { name: '無日期工程' })

    const cards = document.querySelectorAll('.project-workspace-card')
    const withDates = within(cards[0] as HTMLElement)
    expect(withDates.getByText('預定完工：2027-04-01')).toBeVisible()
    expect(withDates.queryByText(/預定開工/)).not.toBeInTheDocument()
    const bare = within(cards[1] as HTMLElement)
    expect(bare.queryByText(/業主：/)).not.toBeInTheDocument()
    expect(bare.queryByText(/預定/)).not.toBeInTheDocument()
  })

  it('keeps the empty state hidden while searching and clearing', async () => {
    const fetchMock = projectFetch()
    const originalFetch = fetchMock.getMockImplementation()
    const searchGate = deferred<Response>()
    const clearGate = deferred<Response>()
    let holdClear = false
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input), 'http://testserver')
      if (
        url.pathname === '/api/v1/projects' &&
        url.searchParams.get('q') === 'missing'
      ) {
        return searchGate.promise
      }
      if (
        holdClear &&
        url.pathname === '/api/v1/projects' &&
        url.searchParams.get('q') === '' &&
        url.searchParams.get('limit') === '50'
      ) {
        return clearGate.promise
      }
      return originalFetch!(input, init)
    })
    renderAt('/projects')
    await screen.findByRole('heading', { name: '示範工程' })

    fireEvent.change(screen.getByLabelText('搜尋專案'), {
      target: { value: 'missing' },
    })
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }))
    expect(screen.queryByText('目前沒有專案。')).not.toBeInTheDocument()
    holdClear = true
    searchGate.resolve(Response.json({ items: [], next_cursor: null }))
    await screen.findByRole('button', { name: '清除搜尋' })

    fireEvent.click(screen.getByRole('button', { name: '清除搜尋' }))
    expect(screen.queryByText('目前沒有專案。')).not.toBeInTheDocument()
    clearGate.resolve(
      Response.json({ items: [makeProject()], next_cursor: null }),
    )
    expect(
      await screen.findByRole('heading', { name: '示範工程' }),
    ).toBeVisible()
  })

  it('creates a project with optional dates left empty', async () => {
    const fetchMock = projectFetch()
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    fillProjectForm()
    fireEvent.change(screen.getByLabelText('預定完工日'), {
      target: { value: '2027-04-01' },
    })
    await waitForNewProjectSubmit()
    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))

    expect(
      await screen.findByRole('heading', { name: 'DEMO-002｜第二示範工程' }),
    ).toBeVisible()
    const [, init] = calls(fetchMock, 'POST', /\/projects$/)[0]
    expect(JSON.parse(String(init?.body))).toEqual({
      company_role: 'contractor',
      project_code: 'DEMO-002',
      name: '第二示範工程',
      client_name: '示範業主',
      site_location: '第二示範工地',
      planned_start_date: null,
      planned_completion_date: '2027-04-01',
    })
  })

  it('associates project field errors with labels and summary links', async () => {
    projectFetch({
      failWith: {
        match: /\/projects$/,
        method: 'POST',
        code: 'request.invalid',
        status: 422,
        fields: [{ path: '/project_code', code: 'field.required' }],
      },
    })
    renderAt('/projects')
    await screen.findAllByText('示範工程')
    fillProjectForm()
    await waitForNewProjectSubmit()
    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))

    const codeField = await screen.findByLabelText(/專案代號/)
    expect(codeField).toHaveAttribute('aria-invalid', 'true')
    expect(codeField).toHaveAttribute('aria-describedby', 'project-code-error')
    expect(screen.getByText('請填寫此欄位。', { selector: 'p' })).toBeVisible()
    expect(
      screen.getByRole('link', { name: /專案代號：請填寫此欄位/ }),
    ).toHaveAttribute('href', '#project-code')
  })

  it('lets Admin choose an eligible project creator', async () => {
    const fetchMock = projectFetch()
    renderAt('/projects')
    await screen.findAllByText('示範工程')
    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))

    const creator = await screen.findByLabelText(/建立者角色人選/)
    await within(creator).findByRole('option', {
      name: '林鮑伯（bob.lin）',
    })
    const options = within(creator).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      '不指定',
      '鄧安娜（anna.deng）',
      '林鮑伯（bob.lin）',
    ])
    fireEvent.change(creator, { target: { value: bob.id } })
    fillProjectForm()
    await waitForNewProjectSubmit()
    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))

    await screen.findByRole('heading', {
      name: 'DEMO-002｜第二示範工程',
    })
    const [, init] = calls(fetchMock, 'POST', /\/projects$/)[0]
    expect(JSON.parse(String(init?.body))).toMatchObject({
      creator_role_user_id: bob.id,
      company_role: 'contractor',
    })
  })

  it('warns about a duplicate project code but still saves', async () => {
    projectFetch()
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    fillProjectForm()
    fireEvent.change(screen.getByLabelText(/專案代號/), {
      target: { value: 'DEMO-001' },
    })
    await waitForNewProjectSubmit()
    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))

    expect(
      await screen.findByRole('heading', { name: 'DEMO-001｜第二示範工程' }),
    ).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(
      '專案代號「DEMO-001」與其他專案重複，仍已儲存。',
    )
    fireEvent.click(screen.getByRole('button', { name: '關閉警告' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('edits a project by sending only changed fields', async () => {
    const fetchMock = projectFetch()
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    fireEvent.click(screen.getByRole('button', { name: /編輯專案/ }))
    expect(screen.getByLabelText(/專案代號/)).toHaveValue('DEMO-001')
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '改名後的工程' },
    })
    fireEvent.change(screen.getByLabelText('預定開工日'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存專案' }))

    await screen.findAllByText('改名後的工程')
    expect(
      await screen.findByRole('heading', { name: /改名後的工程/ }),
    ).toBeInTheDocument()
    const [, init] = calls(fetchMock, 'PATCH', /\/projects\/project-1$/)[0]
    expect(JSON.parse(String(init?.body))).toEqual({
      name: '改名後的工程',
      planned_start_date: null,
    })
    expect(screen.getByRole('button', { name: '新增專案' })).toBeVisible()
  })

  // ADM-AC39：角色欄在最上面、預設承攬施工方、選項取自後端登記表，
  // 兩次送出的請求本體都明確帶 company_role。
  it('puts the company role first and always sends the chosen value', async () => {
    const fetchMock = projectFetch()
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))
    const form = screen
      .getByRole('heading', { name: '新增專案', level: 2 })
      .closest('form') as HTMLFormElement
    const role = await within(form).findByLabelText(/本公司在這個案子的角色/)
    await waitFor(() => expect(role).toBeEnabled())
    expect((form.querySelector('label') as HTMLElement).textContent).toContain(
      '本公司在這個案子的角色',
    )
    expect(role).toHaveValue('contractor')
    expect(
      within(role as HTMLElement)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['承攬施工方', '監造方'])
    expect(within(form).getByText(/會決定報表種類/)).toBeVisible()
    expect(
      within(form).getByText(/同工地的另一種角色請另開專案/),
    ).toBeVisible()

    fillProjectForm()
    await waitForNewProjectSubmit()
    fireEvent.click(within(form).getByRole('button', { name: '新增專案' }))
    await screen.findByRole('heading', { name: 'DEMO-002｜第二示範工程' })
    const first = calls(fetchMock, 'POST', /\/projects$/)[0][1]
    expect(JSON.parse(String(first?.body)).company_role).toBe('contractor')
  })

  it('sends supervisor when the second role is chosen', async () => {
    const fetchMock = projectFetch()
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))
    const role = await screen.findByLabelText(/本公司在這個案子的角色/)
    await waitFor(() => expect(role).toBeEnabled())
    fireEvent.change(role, { target: { value: 'supervisor' } })
    fillProjectForm()
    await waitForNewProjectSubmit()
    fireEvent.click(
      within(
        screen
          .getByRole('heading', { name: '新增專案', level: 2 })
          .closest('form') as HTMLFormElement,
      ).getByRole('button', { name: '新增專案' }),
    )

    await screen.findByRole('heading', { name: 'DEMO-002｜第二示範工程' })
    const body = JSON.parse(
      String(calls(fetchMock, 'POST', /\/projects$/)[0][1]?.body),
    )
    expect(body.company_role).toBe('supervisor')
  })

  it('blocks creating a project when the role options cannot load', async () => {
    const fetchMock = projectFetch({
      failWith: {
        match: /\/project-company-roles$/,
        method: 'GET',
        code: 'server.error',
        status: 500,
      },
    })
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))

    expect(await screen.findByText(/無法載入選項/)).toBeVisible()
    const form = screen
      .getByRole('heading', { name: '新增專案', level: 2 })
      .closest('form') as HTMLFormElement
    expect(
      within(form).getByRole('button', { name: '新增專案' }),
    ).toBeDisabled()
    expect(calls(fetchMock, 'POST', /\/projects$/)).toHaveLength(0)
  })

  // ADM-AC41：改角色先跳一般主色的確認框並要求原因；取消不送請求，
  // 缺原因在欄旁顯示錯誤並擋下。
  it('confirms a company role change with a required reason', async () => {
    const fetchMock = projectFetch()
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    fireEvent.click(screen.getByRole('button', { name: /編輯專案/ }))
    const role = await screen.findByLabelText(/本公司在這個案子的角色/)
    await waitFor(() => expect(role).toBeEnabled())
    expect(role).toHaveValue('contractor')
    fireEvent.change(role, { target: { value: 'supervisor' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存專案' }))

    const box = await screen.findByRole('group', { name: '修改本公司角色' })
    expect(box).toHaveTextContent('已建立的任務與已產生的報表維持原樣')
    expect(box).toHaveTextContent('由「承攬施工方」改為「監造方」')
    expect(within(box).getByRole('button', { name: '確認' })).toHaveClass(
      'btn-primary',
    )
    expect(
      within(box)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['取消', '確認'])
    expect(within(box).getByRole('button', { name: '取消' })).toHaveFocus()

    // 取消：不送請求，焦點回到角色欄。
    fireEvent.click(within(box).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('group', { name: '修改本公司角色' })).toBeNull()
    expect(calls(fetchMock, 'PATCH', /\/projects\//)).toHaveLength(0)
    expect(role).toHaveFocus()

    // 再開一次，不填原因：錯誤在欄旁、焦點在原因欄、不送請求。
    fireEvent.click(screen.getByRole('button', { name: '儲存專案' }))
    const again = await screen.findByRole('group', { name: '修改本公司角色' })
    const reason = within(again).getByLabelText(/變更原因/)
    // 空字串：不能被瀏覽器原生必填提示攔下，自訂錯誤與焦點仍要出現。
    expect(reason).toHaveValue('')
    fireEvent.click(within(again).getByRole('button', { name: '確認' }))
    expect(await within(again).findByText('請填寫變更原因。')).toBeVisible()
    await waitFor(() => expect(reason).toHaveFocus())
    expect(reason).toHaveAttribute('aria-invalid', 'true')
    expect(calls(fetchMock, 'PATCH', /\/projects\//)).toHaveLength(0)

    // 全空白：同樣擋下。
    fireEvent.change(reason, { target: { value: '   ' } })
    expect(reason).not.toHaveAttribute('aria-invalid')
    fireEvent.click(within(again).getByRole('button', { name: '確認' }))
    expect(await within(again).findByText('請填寫變更原因。')).toBeVisible()
    await waitFor(() => expect(reason).toHaveFocus())
    expect(reason).toHaveAttribute('aria-invalid', 'true')
    expect(calls(fetchMock, 'PATCH', /\/projects\//)).toHaveLength(0)

    // 填原因後送出 company_role 與 company_role_change_reason。
    fireEvent.change(reason, { target: { value: '  合約改為監造  ' } })
    fireEvent.click(within(again).getByRole('button', { name: '確認' }))
    expect(await screen.findByText('專案「示範工程」已儲存。')).toBeVisible()
    const [, init] = calls(fetchMock, 'PATCH', /\/projects\/project-1$/)[0]
    expect(JSON.parse(String(init?.body))).toEqual({
      company_role: 'supervisor',
      company_role_change_reason: '合約改為監造',
    })
  })

  it('rejects a reason longer than 256 characters before sending', async () => {
    const fetchMock = projectFetch()
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    fireEvent.click(screen.getByRole('button', { name: /編輯專案/ }))
    const role = await screen.findByLabelText(/本公司在這個案子的角色/)
    await waitFor(() => expect(role).toBeEnabled())
    fireEvent.change(role, { target: { value: 'supervisor' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存專案' }))
    const box = await screen.findByRole('group', { name: '修改本公司角色' })
    fireEvent.change(within(box).getByLabelText(/變更原因/), {
      target: { value: '字'.repeat(257) },
    })
    fireEvent.click(within(box).getByRole('button', { name: '確認' }))

    expect(
      await within(box).findByText('變更原因最多 256 個字元。'),
    ).toBeVisible()
    expect(calls(fetchMock, 'PATCH', /\/projects\//)).toHaveLength(0)
  })

  it('shows the dedicated reason error beside the reason field', async () => {
    projectFetch({
      failWith: {
        match: /\/projects\/project-1$/,
        method: 'PATCH',
        code: roleContract.reason_required_error.code,
        status: roleContract.reason_required_error.status,
      },
    })
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    fireEvent.click(screen.getByRole('button', { name: /編輯專案/ }))
    const role = await screen.findByLabelText(/本公司在這個案子的角色/)
    await waitFor(() => expect(role).toBeEnabled())
    fireEvent.change(role, { target: { value: 'supervisor' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存專案' }))
    const box = await screen.findByRole('group', { name: '修改本公司角色' })
    const reason = within(box).getByLabelText(/變更原因/)
    fireEvent.change(reason, { target: { value: '合約改為監造' } })
    fireEvent.click(within(box).getByRole('button', { name: '確認' }))

    expect(
      await within(box).findByText('改本公司角色必須填寫變更原因。'),
    ).toBeVisible()
    await waitFor(() => expect(reason).toHaveFocus())
  })

  // ADM-R28：後端對過長原因回帶欄位指標的 422，訊息顯示在原因欄旁。
  it('shows a server field error on the reason field', async () => {
    projectFetch({
      failWith: {
        match: /\/projects\/project-1$/,
        method: 'PATCH',
        code: roleContract.reason_too_long_error.code,
        status: roleContract.reason_too_long_error.status,
        fields: roleContract.reason_too_long_error.fields,
      },
    })
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    fireEvent.click(screen.getByRole('button', { name: /編輯專案/ }))
    const role = await screen.findByLabelText(/本公司在這個案子的角色/)
    await waitFor(() => expect(role).toBeEnabled())
    fireEvent.change(role, { target: { value: 'supervisor' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存專案' }))
    const box = await screen.findByRole('group', { name: '修改本公司角色' })
    const reason = within(box).getByLabelText(/變更原因/)
    fireEvent.change(reason, { target: { value: '合約改為監造' } })
    fireEvent.click(within(box).getByRole('button', { name: '確認' }))

    expect(
      await within(box).findByText('變更原因最多 256 個字元。'),
    ).toBeVisible()
    await waitFor(() => expect(reason).toHaveFocus())
    expect(reason).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows a server field error on the role field and closes the box', async () => {
    projectFetch({
      failWith: {
        match: /\/projects\/project-1$/,
        method: 'PATCH',
        code: roleContract.invalid_role_error.code,
        status: roleContract.invalid_role_error.status,
        fields: roleContract.invalid_role_error.fields,
      },
    })
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    fireEvent.click(screen.getByRole('button', { name: /編輯專案/ }))
    const role = await screen.findByLabelText(/本公司在這個案子的角色/)
    await waitFor(() => expect(role).toBeEnabled())
    fireEvent.change(role, { target: { value: 'supervisor' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存專案' }))
    const box = await screen.findByRole('group', { name: '修改本公司角色' })
    fireEvent.change(within(box).getByLabelText(/變更原因/), {
      target: { value: '合約改為監造' },
    })
    fireEvent.click(within(box).getByRole('button', { name: '確認' }))

    expect(
      await screen.findByText('這個角色不能使用，請重新選擇。'),
    ).toBeVisible()
    await waitFor(() => expect(role).toHaveFocus())
    expect(role).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('group', { name: '修改本公司角色' })).toBeNull()
  })

  // 改回原值時確認框要關掉；再改成別的值時不能帶著舊的開啟狀態直接跳出。
  it('closes the confirm box when the role is changed back', async () => {
    const fetchMock = projectFetch()
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    fireEvent.click(screen.getByRole('button', { name: /編輯專案/ }))
    const role = await screen.findByLabelText(/本公司在這個案子的角色/)
    await waitFor(() => expect(role).toBeEnabled())
    fireEvent.change(role, { target: { value: 'supervisor' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存專案' }))
    await screen.findByRole('group', { name: '修改本公司角色' })

    fireEvent.change(role, { target: { value: 'contractor' } })
    expect(screen.queryByRole('group', { name: '修改本公司角色' })).toBeNull()

    fireEvent.change(role, { target: { value: 'supervisor' } })
    expect(screen.queryByRole('group', { name: '修改本公司角色' })).toBeNull()
    expect(calls(fetchMock, 'PATCH', /\/projects\//)).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: '儲存專案' }))
    expect(
      await screen.findByRole('group', { name: '修改本公司角色' }),
    ).toBeVisible()
  })

  it('does not ask for a reason when the role is unchanged', async () => {
    const fetchMock = projectFetch()
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    fireEvent.click(screen.getByRole('button', { name: /編輯專案/ }))
    await waitFor(() =>
      expect(screen.getByLabelText(/本公司在這個案子的角色/)).toBeEnabled(),
    )
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '只改名稱' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存專案' }))

    await screen.findAllByText('只改名稱')
    expect(screen.queryByRole('group', { name: '修改本公司角色' })).toBeNull()
    const [, init] = calls(fetchMock, 'PATCH', /\/projects\/project-1$/)[0]
    expect(JSON.parse(String(init?.body))).toEqual({ name: '只改名稱' })
  })

  // ADM-R15：A 的慢回應不能關閉後來開啟的 B，否則 B 草稿會殘留。
  it('keeps the next form open while an earlier save resolves', async () => {
    const fetchMock = projectFetch({
      projects: [
        makeProject(),
        makeProject({
          id: 'project-2',
          project_code: 'DEMO-002',
          name: '第二示範工程',
        }),
      ],
    })
    const gate = holdRequests(fetchMock, 'PATCH', /\/projects\/project-1$/)
    renderAt('/projects')
    await screen.findAllByText('第二示範工程')

    fireEvent.click(
      screen.getByRole('button', { name: '編輯專案「示範工程」' }),
    )
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '已儲存的工程' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存專案' }))
    expect(calls(fetchMock, 'PATCH', /\/projects\/project-1$/)).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(
      within(screen.getByRole('region', { name: '未儲存變更' })).getByRole(
        'button',
        { name: '捨棄' },
      ),
    )
    fireEvent.click(
      screen.getByRole('button', { name: '編輯專案「第二示範工程」' }),
    )
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: 'B 的未儲存草稿' },
    })

    gate.resolve()
    await screen.findByText('專案「已儲存的工程」已儲存。')
    expect(
      screen.getByRole('heading', { name: '編輯專案「第二示範工程」' }),
    ).toBeVisible()
    expect(screen.getByLabelText(/工程名稱/)).toHaveValue('B 的未儲存草稿')
  })

  it('does not show or focus an old save error in the next form', async () => {
    const fetchMock = projectFetch({
      projects: [
        makeProject(),
        makeProject({
          id: 'project-2',
          project_code: 'DEMO-002',
          name: '第二示範工程',
        }),
      ],
      failWith: {
        match: /\/projects\/project-1$/,
        method: 'PATCH',
        code: 'request.validation_failed',
        status: 422,
      },
    })
    const gate = holdRequests(fetchMock, 'PATCH', /\/projects\/project-1$/)
    renderAt('/projects')
    await screen.findAllByText('第二示範工程')

    fireEvent.click(
      screen.getByRole('button', { name: '編輯專案「示範工程」' }),
    )
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '無效的 A 修改' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存專案' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(
      within(screen.getByRole('region', { name: '未儲存變更' })).getByRole(
        'button',
        { name: '捨棄' },
      ),
    )
    fireEvent.click(
      screen.getByRole('button', { name: '編輯專案「第二示範工程」' }),
    )
    const nextName = screen.getByLabelText(/工程名稱/)
    nextName.focus()
    fireEvent.change(nextName, { target: { value: 'B 的草稿' } })

    gate.resolve()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '儲存專案' })).toBeEnabled(),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(nextName).toHaveFocus()
    expect(nextName).toHaveValue('B 的草稿')
  })

  it('keeps a reopened draft after an older save resolves', async () => {
    const fetchMock = projectFetch({
      projects: [
        makeProject(),
        makeProject({
          id: 'project-2',
          project_code: 'DEMO-002',
          name: '第二示範工程',
        }),
      ],
    })
    const gate = holdRequests(fetchMock, 'PATCH', /\/projects\/project-1$/)
    renderAt('/projects')
    await screen.findAllByText('第二示範工程')

    fireEvent.click(
      screen.getByRole('button', { name: '編輯專案「示範工程」' }),
    )
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '舊 session 的名稱' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存專案' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(
      within(screen.getByRole('region', { name: '未儲存變更' })).getByRole(
        'button',
        { name: '捨棄' },
      ),
    )
    fireEvent.click(
      screen.getByRole('button', { name: '編輯專案「第二示範工程」' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(
      screen.getByRole('button', { name: '編輯專案「示範工程」' }),
    )
    const reopenedName = screen.getByLabelText(/工程名稱/)
    fireEvent.change(reopenedName, {
      target: { value: '新 session 的草稿' },
    })

    gate.resolve()
    await screen.findByText('專案「舊 session 的名稱」已儲存。')
    expect(
      screen.getByRole('heading', { name: '編輯專案「示範工程」' }),
    ).toBeVisible()
    expect(reopenedName).toHaveValue('新 session 的草稿')
  })

  it('links to a created project without replacing a newer form', async () => {
    const fetchMock = projectFetch({
      projects: [
        makeProject(),
        makeProject({
          id: 'project-2',
          project_code: 'DEMO-002',
          name: '第二示範工程',
        }),
      ],
    })
    const gate = holdRequests(fetchMock, 'POST', /\/projects$/)
    renderAt('/projects')
    await screen.findAllByText('第二示範工程')

    fillProjectForm()
    await waitForNewProjectSubmit()
    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(
      within(screen.getByRole('region', { name: '未儲存變更' })).getByRole(
        'button',
        { name: '捨棄' },
      ),
    )
    fireEvent.click(
      screen.getByRole('button', { name: '編輯專案「第二示範工程」' }),
    )
    const nextName = screen.getByLabelText(/工程名稱/)
    fireEvent.change(nextName, { target: { value: 'B 的未儲存草稿' } })

    gate.resolve()
    expect(await screen.findByText('已建立專案「第二示範工程」')).toBeVisible()
    expect(screen.getByRole('link', { name: '開啟專案' })).toHaveAttribute(
      'href',
      '/projects/project-3',
    )
    expect(
      screen.getByRole('heading', { name: '編輯專案「第二示範工程」' }),
    ).toBeVisible()
    expect(nextName).toHaveValue('B 的未儲存草稿')

    fireEvent.click(screen.getByRole('link', { name: '開啟專案' }))
    const leavePrompt = screen.getByRole('region', {
      name: '未儲存變更',
    })
    fireEvent.click(
      within(leavePrompt).getByRole('button', { name: '保留編輯' }),
    )
    expect(
      screen.getByRole('heading', {
        name: '編輯專案「第二示範工程」',
      }),
    ).toBeVisible()
    expect(nextName).toHaveValue('B 的未儲存草稿')

    fireEvent.click(screen.getByRole('link', { name: '開啟專案' }))
    fireEvent.click(
      within(screen.getByRole('region', { name: '未儲存變更' })).getByRole(
        'button',
        { name: '捨棄' },
      ),
    )
    expect(
      await screen.findByRole('heading', { name: '專案首頁' }),
    ).toBeVisible()
    expect(
      screen.getByRole('heading', {
        name: 'DEMO-002｜第二示範工程',
      }),
    ).toBeVisible()
  })

  // ADM-R38：表單內按鈕卸載後，鍵盤焦點須回到可見清單入口。
  it('restores focus after cancel, discard, and save', async () => {
    projectFetch()
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    // 表單開啟時原按鈕會卸載，須檢查關閉後重新掛載的入口。
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '新增專案' })).toHaveFocus(),
    )

    fireEvent.click(
      within(document.getElementById('project-card-project-1')!).getByRole(
        'button',
        { name: '編輯專案「示範工程」' },
      ),
    )
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '捨棄的名稱' },
    })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(
      within(screen.getByRole('region', { name: '未儲存變更' })).getByRole(
        'button',
        { name: '捨棄' },
      ),
    )
    await waitFor(() =>
      expect(document.getElementById('project-card-project-1')).toHaveFocus(),
    )

    fireEvent.click(
      within(document.getElementById('project-card-project-1')!).getByRole(
        'button',
        { name: '編輯專案「示範工程」' },
      ),
    )
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '改名後的工程' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存專案' }))
    await waitFor(() =>
      expect(document.getElementById('project-card-project-1')).toHaveFocus(),
    )
  })

  // ADM-R38：保留搜尋條件會濾掉卡片；
  // 焦點需回到新增按鈕。
  it('restores focus when saving filters the edited card out', async () => {
    projectFetch({
      projects: [
        makeProject(),
        makeProject({
          id: 'project-2',
          project_code: 'DEMO-002',
          name: '第二示範工程',
        }),
      ],
    })
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    fireEvent.change(screen.getByLabelText('搜尋專案'), {
      target: { value: 'DEMO-001' },
    })
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }))
    await screen.findByRole('button', {
      name: '編輯專案「示範工程」',
    })
    expect(screen.queryByText('第二示範工程')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /編輯專案/ }))
    expect(screen.queryByLabelText('搜尋專案')).toBeNull()
    fireEvent.change(screen.getByLabelText('專案代號'), {
      target: { value: 'DEMO-003' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存專案' }))

    await waitFor(() =>
      expect(document.getElementById('project-card-project-1')).toBeNull(),
    )
    const addProjectButton = screen.getByRole('button', {
      name: '新增專案',
    })
    await waitFor(() => expect(addProjectButton).toHaveFocus())
  })

  it('opens the card edit entry with the existing unsaved guard and saves', async () => {
    const scroll = mockScrollIntoView()
    const fetchMock = projectFetch()
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    const card = document.querySelector('.project-workspace-card')!
    const edit = within(card as HTMLElement).getByRole('button', {
      name: '編輯專案「示範工程」',
    })
    expect(edit).toHaveAttribute('type', 'button')
    fireEvent.click(edit)
    const heading = screen.getByRole('heading', {
      name: '編輯專案「示範工程」',
    })
    expect(heading).toBeVisible()
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(heading).toHaveAttribute('tabindex', '-1')
    expect(scroll.scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
    expect(scroll.scrollIntoView).toHaveBeenCalledTimes(1)
    const projectName = screen.getByLabelText(/工程名稱/)
    fireEvent.focus(projectName)
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '尚未儲存的名稱' },
    })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    let prompt = screen.getByRole('region', { name: '未儲存變更' })
    fireEvent.click(within(prompt).getByRole('button', { name: '保留編輯' }))
    expect(screen.getByLabelText(/工程名稱/)).toHaveValue('尚未儲存的名稱')
    // 確認框關閉後由 effect 還焦點，等待 effect 完成。
    await waitFor(() => expect(projectName).toHaveFocus())

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    prompt = screen.getByRole('region', { name: '未儲存變更' })
    fireEvent.click(within(prompt).getByRole('button', { name: '捨棄' }))
    expect(screen.queryByLabelText(/工程名稱/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /編輯專案/ }))
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '手機更新工程' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存專案' }))
    await screen.findAllByText('手機更新工程')
    expect(await screen.findByRole('status')).toHaveTextContent('已儲存')
    const [, init] = calls(fetchMock, 'PATCH', /\/projects\/project-1$/)[0]
    expect(JSON.parse(String(init?.body))).toEqual({
      name: '手機更新工程',
    })
    expect(scroll.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    scroll.restore()
  })

  it('shows only the form while editing a project', async () => {
    projectFetch()
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    fireEvent.click(
      screen.getByRole('button', { name: '編輯專案「示範工程」' }),
    )
    expect(screen.queryByRole('link', { name: '開啟專案' })).toBeNull()
    expect(screen.queryByRole('link', { name: '套用範本' })).toBeNull()
    expect(screen.queryByRole('button', { name: '新增專案' })).toBeNull()
    expect(screen.queryByLabelText('搜尋專案')).toBeNull()
    expect(screen.getByRole('button', { name: '儲存專案' })).toBeVisible()
  })

  it('does not call the API when nothing was edited', async () => {
    const fetchMock = projectFetch()
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    fireEvent.click(screen.getByRole('button', { name: /編輯專案/ }))
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: ' 示範工程 ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存專案' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '新增專案' })).toBeVisible(),
    )
    expect(calls(fetchMock, 'PATCH', /projects/)).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: /編輯專案/ }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('region', { name: '未儲存變更' })).toBeNull()
    expect(screen.queryByLabelText(/專案代號/)).not.toBeInTheDocument()
  })

  it('keeps a dirty create form when edit is requested, then discards on choice', async () => {
    projectFetch({
      projects: [
        makeProject(),
        makeProject({
          id: 'project-2',
          project_code: 'DEMO-002',
          name: '第二示範工程',
        }),
      ],
    })
    renderAt('/projects')
    await screen.findAllByText('示範工程')
    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '未儲存的新工程' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: /編輯專案/ })[0])

    const prompt = screen.getByRole('region', { name: '未儲存變更' })
    expectCancelThenDanger(prompt, ['保留編輯', '捨棄'])
    fireEvent.click(within(prompt).getByRole('button', { name: '保留編輯' }))
    expect(screen.getByLabelText(/工程名稱/)).toHaveValue('未儲存的新工程')

    fireEvent.click(screen.getAllByRole('button', { name: /編輯專案/ })[0])
    fireEvent.click(
      within(screen.getByRole('region', { name: '未儲存變更' })).getByRole(
        'button',
        { name: '捨棄' },
      ),
    )
    expect(screen.getByLabelText(/工程名稱/)).toHaveValue('示範工程')
  })

  it('asks before switching to another project and preserves or discards edits', async () => {
    projectFetch({
      projects: [
        makeProject(),
        makeProject({
          id: 'project-2',
          project_code: 'DEMO-002',
          name: '第二示範工程',
        }),
      ],
    })
    renderAt('/projects')
    await screen.findAllByText('第二示範工程')
    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '未儲存的新工程' },
    })
    fireEvent.click(screen.getAllByRole('link', { name: '成員' })[1])
    expect(
      screen.getByRole('region', { name: '未儲存變更' }),
    ).toBeInTheDocument()
    // 被另一個轉換覆蓋時確認框重新掛載，焦點回到保留編輯（#501 審查）。
    ;(document.activeElement as HTMLElement).blur()
    fireEvent.click(screen.getAllByRole('link', { name: '成員' })[0])
    let prompt = screen.getByRole('region', { name: '未儲存變更' })
    await waitFor(() =>
      expect(
        within(prompt).getByRole('button', { name: '保留編輯' }),
      ).toHaveFocus(),
    )
    fireEvent.click(within(prompt).getByRole('button', { name: '保留編輯' }))
    expect(screen.getByLabelText(/工程名稱/)).toHaveValue('未儲存的新工程')

    fireEvent.click(screen.getAllByRole('link', { name: '成員' })[1])
    prompt = screen.getByRole('region', { name: '未儲存變更' })
    fireEvent.click(within(prompt).getByRole('button', { name: '捨棄' }))
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'DEMO-002｜第二示範工程',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '成員' })).toBeInTheDocument()
  })

  it('keeps or discards dirty edits when switching to a new project form', async () => {
    projectFetch()
    renderAt('/projects')
    await screen.findAllByText('示範工程')
    fireEvent.click(screen.getByRole('button', { name: /編輯專案/ }))
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '未儲存的修改' },
    })

    expect(screen.queryByRole('button', { name: '新增專案' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    let prompt = screen.getByRole('region', { name: '未儲存變更' })
    fireEvent.click(within(prompt).getByRole('button', { name: '保留編輯' }))
    expect(screen.getByLabelText(/工程名稱/)).toHaveValue('未儲存的修改')

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    prompt = screen.getByRole('region', { name: '未儲存變更' })
    fireEvent.click(within(prompt).getByRole('button', { name: '捨棄' }))
    expect(screen.queryByRole('heading', { name: '新增專案' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))
    expect(screen.getByRole('heading', { name: '新增專案' })).toBeVisible()
    expect(screen.getByLabelText(/工程名稱/)).toHaveValue('')
  })

  it('hides navigation during edits and restores after discard', async () => {
    projectFetch({
      projects: [
        makeProject(),
        makeProject({
          id: 'project-2',
          project_code: 'DEMO-002',
          name: '第二示範工程',
        }),
      ],
    })
    renderAt('/projects')
    await screen.findAllByText('第二示範工程')
    fireEvent.click(screen.getAllByRole('button', { name: /編輯專案/ })[0])
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '未儲存的修改' },
    })

    expect(screen.queryByRole('link', { name: '成員' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    let prompt = screen.getByRole('region', { name: '未儲存變更' })
    fireEvent.click(within(prompt).getByRole('button', { name: '保留編輯' }))
    expect(screen.getByLabelText(/工程名稱/)).toHaveValue('未儲存的修改')

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    prompt = screen.getByRole('region', { name: '未儲存變更' })
    fireEvent.click(within(prompt).getByRole('button', { name: '捨棄' }))
    expect(await screen.findAllByRole('link', { name: '成員' })).toHaveLength(
      2,
    )
  })

  it('shows a clear message when saving fails', async () => {
    projectFetch({
      failWith: {
        match: /\/projects$/,
        method: 'POST',
        code: 'request.validation_failed',
        status: 422,
      },
    })
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    fillProjectForm()
    await waitForNewProjectSubmit()
    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '資料格式不正確',
    )
  })

  it('shows a project edit save error beside the form', async () => {
    const scroll = mockScrollIntoView()
    projectFetch({
      failWith: {
        match: /\/projects\/project-1$/,
        method: 'PATCH',
        code: 'request.validation_failed',
        status: 422,
      },
    })
    renderAt('/projects')
    await screen.findAllByText('示範工程')

    fireEvent.click(screen.getByRole('button', { name: /編輯專案/ }))
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '無效的變更' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存專案' }))

    const form = screen
      .getByRole('heading', { name: '編輯專案「示範工程」' })
      .closest('form') as HTMLFormElement
    const alert = await within(form).findByRole('alert')
    expect(alert).toHaveTextContent('資料格式不正確')
    expect(alert).toHaveAttribute('tabindex', '-1')
    const saveButton = within(form).getByRole('button', {
      name: '儲存專案',
    })
    expect(
      saveButton.compareDocumentPosition(alert) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(alert))
    expect(scroll.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(screen.getByLabelText(/工程名稱/)).toHaveValue('無效的變更')
  })
})

const memberAnna: ProjectMember = {
  id: 'member-1',
  user_id: anna.id,
  username: anna.username,
  role_ids: [roleA.id],
  role_names: [roleA.name],
  name_zh: anna.name_zh,
  email: anna.email,
  company_id: 'company-1',
  company_name: '示範公司',
  is_active: true,
  is_external_collaborator: false,
  module_status: { project_use: true, inspection_use: true },
}

function addForm(): HTMLElement {
  return screen.getByRole('heading', { name: '加入成員' })
    .parentElement as HTMLElement
}

describe('專案成員表單未儲存導覽防護', () => {
  function selectMember() {
    fireEvent.change(screen.getByRole('combobox', { name: '成員' }), {
      target: { value: bob.id },
    })
  }

  it('實際選擇成員後攔截站內導覽與 Back/Forward', async () => {
    projectFetch()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderAt('/projects/project-1/members', adminUser, {
      entries: ['/projects', '/projects/project-1/members', '/projects'],
      index: 1,
    })
    await screen.findByText('目前沒有成員。')
    selectMember()

    fireEvent.click(screen.getByRole('link', { name: '離開成員頁' }))
    expect(
      await screen.findByRole('heading', { name: '有尚未儲存的變更' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保留編輯' }))

    fireEvent.click(screen.getByRole('button', { name: '成員頁上一頁' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(
      screen.getByRole('heading', { name: '加入成員' }),
    ).toBeInTheDocument()

    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '成員頁下一頁' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2))
    expect(
      await screen.findByRole('heading', { name: '專案' }),
    ).toBeInTheDocument()
  })

  it('實際選擇成員後攔截 beforeunload', async () => {
    projectFetch()
    renderAt('/projects/project-1/members')
    await screen.findByText('目前沒有成員。')
    selectMember()
    const event = new Event('beforeunload', { cancelable: true })

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })
})

describe('admin project members', () => {
  it('shows member cards with company and role summary, not a table', async () => {
    projectFetch({
      members: [
        memberAnna,
        {
          ...memberAnna,
          id: 'member-2',
          user_id: bob.id,
          username: bob.username,
          name_zh: bob.name_zh,
          company_id: null,
          company_name: null,
          role_ids: [],
          role_names: [],
        },
      ],
    })
    renderAt('/projects/project-1/members')

    await screen.findByText('鄧安娜')
    expect(screen.queryByRole('table')).toBeNull()
    const cards = screen.getAllByRole('listitem')
    const annaCard = cards.find((card) => card.textContent?.includes('鄧安娜'))
    expect(within(annaCard as HTMLElement).getByText(/示範公司/)).toBeVisible()
    expect(within(annaCard as HTMLElement).getByText('查核員')).toBeVisible()
    const bobCard = cards.find((card) =>
      card.textContent?.includes('林鮑伯'),
    ) as HTMLElement
    expect(within(bobCard).getByText(/未連結公司/)).toBeVisible()
    // 舊資料沒有角色：明確提示要補，而不是顯示空白。
    expect(within(bobCard).getByText(/尚未指派角色/)).toBeVisible()
  })

  it('labels an inactive project member', async () => {
    projectFetch({ members: [{ ...memberAnna, is_active: false }] })
    renderAt('/projects/project-1/members')

    const card = await screen.findByRole('listitem')
    expect(within(card).getByText('（已停用）')).toBeVisible()
  })

  it('links an Admin from project members to that person detail', async () => {
    projectFetch({ members: [memberAnna] })
    renderAt('/projects/project-1/members')

    expect(
      await screen.findByRole('link', { name: '鄧安娜' }),
    ).toHaveAttribute('href', '/accounts/user-1')
  })

  it('explains each role in plain language without showing codes', async () => {
    projectFetch()
    renderAt('/projects/project-1/members')
    await screen.findByText('目前沒有成員。')

    expect(screen.getByLabelText('查核員')).toHaveAccessibleDescription(
      '可執行現場查核、讀取查核任務',
    )
    expect(screen.getByLabelText('審核者')).toHaveAccessibleDescription(
      '可建立查核計畫、建立查核任務、派出查核任務',
    )
    expect(document.body.textContent).not.toMatch(/inspection_|project_/)
  })

  it('adds a member; hides existing, inactive, system users', async () => {
    const fetchMock = projectFetch({ members: [memberAnna] })
    renderAt('/projects/project-1/members')
    await screen.findByText('鄧安娜')

    const select = screen.getByRole('combobox', { name: '成員' })
    const optionNames = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(optionNames).toEqual([
      '請選擇成員',
      '林鮑伯（bob.lin） · 未連結公司',
    ])

    fireEvent.change(select, { target: { value: bob.id } })
    fireEvent.click(within(addForm()).getByLabelText('查核員'))
    fireEvent.click(within(addForm()).getByLabelText('審核者'))
    fireEvent.click(
      within(addForm()).getByRole('button', { name: '加入成員' }),
    )

    expect(await screen.findByRole('link', { name: '林鮑伯' })).toBeVisible()
    const [, init] = calls(fetchMock, 'POST', /\/members$/)[0]
    expect(JSON.parse(String(init?.body))).toEqual({
      user_id: bob.id,
      role_ids: [roleA.id, roleB.id],
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      '已加入「林鮑伯（bob.lin）」。',
    )
    expect(screen.getByRole('status')).toHaveClass('notice-success')
    expect(screen.getByText('沒有可加入的成員。')).toBeVisible()
    // 全部都加完後，角色勾選與加入按鈕一起隱藏，只剩說明（#487）。
    expect(within(addForm()).queryByRole('checkbox')).toBeNull()
    expect(
      within(addForm()).queryByRole('button', { name: '加入成員' }),
    ).toBeNull()
  })

  it('filters assignable roles for external candidates', async () => {
    projectFetch({
      office: true,
      candidates: [externalCandidate],
      rolePages: [[roleA, roleInternalOnly]],
    })
    renderAt('/projects/project-1/members', officeUser)
    await screen.findByText('目前沒有成員。')

    const select = screen.getByRole('combobox', { name: '成員' })
    fireEvent.change(select, { target: { value: externalCandidate.id } })
    expect(
      within(select).getByRole('option', {
        name: /合作公司 · 外部協作人員/,
      }),
    ).toBeVisible()
    expect(await screen.findByText(/尚未開通專案權限/)).toBeVisible()
    expect(screen.getByLabelText('查核員')).toBeVisible()
    expect(screen.queryByLabelText('內部角色')).toBeNull()
  })

  it('filters edit roles for existing external members', async () => {
    const externalMember = {
      ...memberAnna,
      user_id: externalCandidate.id,
      username: externalCandidate.username,
      name_zh: externalCandidate.name_zh,
      company_name: externalCandidate.company_name,
      is_external_collaborator: true,
    }
    projectFetch({
      members: [externalMember],
      rolePages: [[roleA, roleInternalOnly]],
    })
    renderAt('/projects/project-1/members')
    await screen.findByText('外部協作者')

    fireEvent.click(screen.getByRole('button', { name: /修改「.*」的角色/ }))

    expect(screen.getByLabelText('查核員')).toBeVisible()
    expect(screen.queryByLabelText('內部角色')).toBeNull()
  })

  it('shows the not-assignable error by role choices', async () => {
    const fetchMock = projectFetch({
      failWith: {
        match: /\/members$/,
        method: 'POST',
        code: 'project.role_not_assignable',
        status: 422,
      },
    })
    renderAt('/projects/project-1/members')
    await screen.findByText('目前沒有成員。')
    fireEvent.change(screen.getByRole('combobox', { name: '成員' }), {
      target: { value: bob.id },
    })
    fireEvent.click(screen.getByLabelText('查核員'))
    fireEvent.click(
      within(addForm()).getByRole('button', { name: '加入成員' }),
    )

    const error = await screen.findByText(
      '你不能指派這個角色，請選擇可指派的角色。',
    )
    expect(addForm().contains(error)).toBe(true)
    expect(screen.getByRole('combobox', { name: '成員' })).toHaveValue(bob.id)
    expect(calls(fetchMock, 'POST', /\/members$/)).toHaveLength(1)
  })

  it('shows the external-role error by role choices', async () => {
    const fetchMock = projectFetch({
      candidates: [externalCandidate],
      failWith: {
        match: /\/members$/,
        method: 'POST',
        code: 'project.external_role_not_allowed',
        status: 422,
      },
    })
    renderAt('/projects/project-1/members')
    await screen.findByText('目前沒有成員。')
    fireEvent.change(screen.getByRole('combobox', { name: '成員' }), {
      target: { value: externalCandidate.id },
    })
    fireEvent.click(screen.getByLabelText('查核員'))
    fireEvent.click(
      within(addForm()).getByRole('button', { name: '加入成員' }),
    )

    const error = await screen.findByText(
      '外部協作人員只能指派外部可用的角色。',
    )
    expect(addForm().contains(error)).toBe(true)
    expect(screen.getByRole('combobox', { name: '成員' })).toHaveValue(
      externalCandidate.id,
    )
    expect(calls(fetchMock, 'POST', /\/members$/)).toHaveLength(1)
  })

  it('blocks a member without roles, shows the error by the field, and keeps the chosen person', async () => {
    const fetchMock = projectFetch()
    renderAt('/projects/project-1/members')
    await screen.findByText('目前沒有成員。')

    fireEvent.change(screen.getByRole('combobox', { name: '成員' }), {
      target: { value: anna.id },
    })
    fireEvent.click(
      within(addForm()).getByRole('button', { name: '加入成員' }),
    )

    const error = screen.getByText('請至少選一個角色。')
    expect(error).toBeVisible()
    expect(addForm().contains(error)).toBe(true)
    expect(
      screen.getByRole('group', { name: /專案角色/ }),
    ).toHaveAccessibleDescription('請至少選一個角色。')
    expect(screen.getByLabelText('查核員')).toHaveFocus()
    expect(screen.getByRole('combobox', { name: '成員' })).toHaveValue(anna.id)
    expect(calls(fetchMock, 'POST', /\/members$/)).toHaveLength(0)

    // 選了角色，欄旁錯誤立即消失；送出成功。
    fireEvent.click(screen.getByLabelText('查核員'))
    expect(screen.queryByText('請至少選一個角色。')).toBeNull()
    fireEvent.click(
      within(addForm()).getByRole('button', { name: '加入成員' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('已加入')
    expect(calls(fetchMock, 'POST', /\/members$/)).toHaveLength(1)
  })

  it('asks for a person before roles and focuses the person field', async () => {
    const fetchMock = projectFetch()
    renderAt('/projects/project-1/members')
    await screen.findByText('目前沒有成員。')

    fireEvent.click(
      within(addForm()).getByRole('button', { name: '加入成員' }),
    )

    expect(screen.getByText('請選擇要加入的成員。')).toBeVisible()
    expect(screen.getByText('請至少選一個角色。')).toBeVisible()
    expect(screen.getByRole('combobox', { name: '成員' })).toHaveFocus()
    expect(calls(fetchMock, 'POST', /\/members$/)).toHaveLength(0)
  })

  it('maps the server zero-role 422 to the roles field', async () => {
    // 前端擋下之後，後端仍是最後一道：模擬另一個分頁讓角色集合失效的情況，
    // 直接讓 POST 回 422 project.member_roles_required。
    projectFetch({
      failWith: {
        match: /\/members$/,
        method: 'POST',
        code: contract.zero_role_error.code,
        status: contract.zero_role_error.status,
      },
    })
    renderAt('/projects/project-1/members')
    await screen.findByText('目前沒有成員。')

    fireEvent.change(screen.getByRole('combobox', { name: '成員' }), {
      target: { value: anna.id },
    })
    fireEvent.click(within(addForm()).getByLabelText('查核員'))
    fireEvent.click(
      within(addForm()).getByRole('button', { name: '加入成員' }),
    )

    expect(await screen.findByText('請至少選一個角色。')).toBeVisible()
    expect(screen.getByLabelText('查核員')).toHaveFocus()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('combobox', { name: '成員' })).toHaveValue(anna.id)
  })

  it('edits roles on a separate screen and requires at least one role', async () => {
    const fetchMock = projectFetch({ members: [memberAnna] })
    renderAt('/projects/project-1/members')
    await screen.findByText('鄧安娜')

    fireEvent.click(screen.getByRole('button', { name: /修改「.*」的角色/ }))
    // 獨立畫面：清單與加入表單不在同一畫面。
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /修改「/ })).toHaveFocus(),
    )
    expect(screen.queryByRole('heading', { name: '加入成員' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '成員列表' })).toBeNull()
    expect(screen.getByLabelText('查核員')).toBeChecked()
    expect(screen.getByLabelText('審核者')).not.toBeChecked()

    // 全部取消後送出：擋下、錯誤在角色欄旁、聚焦、不送出。
    fireEvent.click(screen.getByLabelText('查核員'))
    fireEvent.click(screen.getByRole('button', { name: '儲存角色' }))
    expect(screen.getByText('請至少選一個角色。')).toBeVisible()
    expect(screen.getByLabelText('查核員')).toHaveFocus()
    expect(calls(fetchMock, 'PUT', /\/roles$/)).toHaveLength(0)

    fireEvent.click(screen.getByLabelText('審核者'))
    expect(screen.queryByText('請至少選一個角色。')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '儲存角色' }))

    expect(await screen.findByRole('status')).toHaveTextContent('已更新')
    const card = (await screen.findByRole('link', { name: '鄧安娜' })).closest(
      'li',
    ) as HTMLElement
    await waitFor(() => expect(card).toHaveTextContent('審核者'))
    expect(card).not.toHaveTextContent('查核員')
    expect(
      JSON.parse(String(calls(fetchMock, 'PUT', /\/roles$/)[0][1]?.body)),
    ).toEqual({ role_ids: [roleB.id] })
  })

  it('maps the server zero-role 422 on edit to the roles field', async () => {
    projectFetch({
      members: [memberAnna],
      failWith: {
        match: /\/roles$/,
        method: 'PUT',
        code: contract.zero_role_error.code,
        status: contract.zero_role_error.status,
      },
    })
    renderAt('/projects/project-1/members')
    await screen.findByText('鄧安娜')

    fireEvent.click(screen.getByRole('button', { name: /修改「.*」的角色/ }))
    fireEvent.click(screen.getByLabelText('審核者'))
    fireEvent.click(screen.getByRole('button', { name: '儲存角色' }))

    expect(await screen.findByText('請至少選一個角色。')).toBeVisible()
    expect(screen.getByLabelText('查核員')).toHaveFocus()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('asks before discarding unsaved role changes; Escape cancels', async () => {
    const fetchMock = projectFetch({ members: [memberAnna] })
    renderAt('/projects/project-1/members')
    await screen.findByText('鄧安娜')

    fireEvent.click(screen.getByRole('button', { name: /修改「.*」的角色/ }))
    // 沒改動就取消：直接回清單。
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole('heading', { name: '成員列表' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /修改「.*」的角色/ }))
    fireEvent.click(screen.getByLabelText('審核者'))
    fireEvent.keyDown(screen.getByLabelText('審核者'), { key: 'Escape' })
    const prompt = screen.getByRole('group', { name: '捨棄確認' })
    expectCancelThenDanger(prompt, ['繼續編輯', '捨棄修改'])
    fireEvent.click(within(prompt).getByRole('button', { name: '繼續編輯' }))
    expect(screen.getByLabelText('審核者')).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(
      within(screen.getByRole('group', { name: '捨棄確認' })).getByRole(
        'button',
        { name: '捨棄修改' },
      ),
    )
    expect(screen.getByRole('heading', { name: '成員列表' })).toBeVisible()
    expect(calls(fetchMock, 'PUT', /\/roles$/)).toHaveLength(0)
  })

  it('asks for confirmation before removing a member', async () => {
    const fetchMock = projectFetch({ members: [memberAnna] })
    renderAt('/projects/project-1/members')
    await screen.findByText('鄧安娜')

    fireEvent.click(screen.getByRole('button', { name: /移出專案/ }))
    expect(calls(fetchMock, 'DELETE', /members/)).toHaveLength(0)
    const confirm = screen.getByRole('group', { name: '移出確認' })
    expectCancelThenDanger(confirm, ['取消', '確認移出'])
    // ConfirmBox 的初始焦點由 effect 設定，等待它完成後再檢查。
    await waitFor(() =>
      expect(
        within(confirm).getByRole('button', { name: '取消' }),
      ).toHaveFocus(),
    )
    fireEvent.click(within(confirm).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('button', { name: '確認移出' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /移出專案/ }))
    fireEvent.keyDown(screen.getByRole('group', { name: '移出確認' }), {
      key: 'Escape',
    })
    expect(screen.queryByRole('button', { name: '確認移出' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /移出專案/ }))
    fireEvent.click(screen.getByRole('button', { name: '確認移出' }))
    expect(await screen.findByText('目前沒有成員。')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('已將')
    expect(calls(fetchMock, 'DELETE', /\/members\/user-1$/)).toHaveLength(1)
  })

  it('shows a duplicate member error next to the add form', async () => {
    projectFetch({
      failWith: {
        match: /\/members$/,
        method: 'POST',
        code: 'project.member_conflict',
        status: 409,
      },
    })
    renderAt('/projects/project-1/members')
    await screen.findByText('目前沒有成員。')

    fireEvent.change(screen.getByRole('combobox', { name: '成員' }), {
      target: { value: anna.id },
    })
    fireEvent.click(within(addForm()).getByLabelText('查核員'))
    fireEvent.click(
      within(addForm()).getByRole('button', { name: '加入成員' }),
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('這個帳號已經是此專案的成員。')
    expect(addForm().contains(alert)).toBe(true)
  })

  it('does not keep an old message after the next action', async () => {
    projectFetch({ members: [memberAnna] })
    renderAt('/projects/project-1/members')
    await screen.findByText('鄧安娜')

    fireEvent.change(screen.getByRole('combobox', { name: '成員' }), {
      target: { value: bob.id },
    })
    fireEvent.click(within(addForm()).getByLabelText('查核員'))
    fireEvent.click(
      within(addForm()).getByRole('button', { name: '加入成員' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('已加入')

    fireEvent.click(screen.getAllByRole('button', { name: /移出專案/ })[0])
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps the draft add form while editing another member', async () => {
    projectFetch({ members: [memberAnna] })
    renderAt('/projects/project-1/members')
    await screen.findByText('鄧安娜')

    fireEvent.change(screen.getByRole('combobox', { name: '成員' }), {
      target: { value: bob.id },
    })
    fireEvent.click(within(addForm()).getByLabelText('審核者'))
    fireEvent.click(screen.getByRole('button', { name: /修改「.*」的角色/ }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.getByRole('combobox', { name: '成員' })).toHaveValue(bob.id)
    expect(within(addForm()).getByLabelText('審核者')).toBeChecked()
  })

  it('uses mock shapes that match the backend member schema', async () => {
    projectFetch({ members: [memberAnna] })
    // 清單列的欄位必須等於後端 ProjectMemberDetailResponse 的欄位。
    expect(Object.keys(memberAnna).sort()).toEqual(
      contract.member_list_item_keys,
    )
  })

  it('uses candidate and role mocks that match the backend schema', async () => {
    projectFetch({ members: [memberAnna] })
    const base = '/api/v1/projects/project-1'
    const candidates = (await (
      await fetch(`${base}/member-candidates`)
    ).json()) as { items: Record<string, unknown>[] }
    expect(Object.keys(candidates).sort()).toEqual(
      contract.candidate_page_keys,
    )
    expect(candidates.items.length).toBeGreaterThan(0)
    for (const row of candidates.items) {
      expect(Object.keys(row).sort()).toEqual(
        contract.member_candidate_item_keys,
      )
    }
    const roles = (await (await fetch(`${base}/assignable-roles`)).json()) as {
      items: Record<string, unknown>[]
    }
    expect(Object.keys(roles).sort()).toEqual(contract.candidate_page_keys)
    for (const row of roles.items) {
      expect(Object.keys(row).sort()).toEqual(
        contract.assignable_role_item_keys,
      )
    }
  })

  it('follows role pagination until every role is loaded', async () => {
    const fetchMock = projectFetch({ rolePages: [[roleA], [roleB]] })
    renderAt('/projects/project-1/members')
    await screen.findByText('目前沒有成員。')

    expect(screen.getByLabelText('審核者')).toBeVisible()
    expect(calls(fetchMock, 'GET', /\/assignable-roles/)).toHaveLength(2)
  })

  it('shows the not-found message when the project is missing', async () => {
    projectFetch({
      failWith: {
        match: /\/projects\/missing$/,
        method: 'GET',
        code: 'resource.not_found',
        status: 404,
      },
    })
    renderAt('/projects/missing/members')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '找不到這筆資料',
    )
  })
})

describe('project members for an office user (not admin, #481)', () => {
  const path = '/projects/project-1/members'
  const globalReads = /\/api\/v1\/(users|roles)(\?|$)/

  it('shows the member list without any global admin API call', async () => {
    const fetchMock = projectFetch({ office: true, members: [memberAnna] })
    renderAt(path, officeUser)

    expect(await screen.findByText('鄧安娜')).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(calls(fetchMock, 'GET', globalReads)).toHaveLength(0)
    expect(calls(fetchMock, 'GET', /\/projects\/project-1$/)).toHaveLength(0)
    expect(calls(fetchMock, 'GET', /\/member-candidates/)).toHaveLength(1)
    expect(calls(fetchMock, 'GET', /\/assignable-roles/)).toHaveLength(1)
    // 角色說明仍依權限碼產生，不顯示代碼（#449）。
    expect(screen.getByLabelText('查核員')).toHaveAccessibleDescription(
      '可執行現場查核、讀取查核任務',
    )
  })

  it('expands and collapses role permissions without changing selection', async () => {
    projectFetch({ office: true, members: [memberAnna] })
    renderAt(path, officeUser)
    await screen.findByText('鄧安娜')

    const checkbox = screen.getByLabelText('查核員')
    const button = screen.getByRole('button', {
      name: '「查核員」完整權限',
    })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    const checked = (checkbox as HTMLInputElement).checked
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('執行現場查核')).toBeVisible()
    expect((checkbox as HTMLInputElement).checked).toBe(checked)
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('adds a member by clicking, with a required role', async () => {
    const fetchMock = projectFetch({ office: true, members: [memberAnna] })
    renderAt(path, officeUser)
    await screen.findByText('鄧安娜')

    const select = screen.getByRole('combobox', { name: '成員' })
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['請選擇成員', '林鮑伯（bob.lin） · 未連結公司'])
    fireEvent.change(select, { target: { value: bob.id } })
    fireEvent.click(
      within(addForm()).getByRole('button', { name: '加入成員' }),
    )
    // 沒選角色：擋下，錯誤在角色欄（沿用 #449）。
    expect(await screen.findByText('請至少選一個角色。')).toBeVisible()
    expect(calls(fetchMock, 'POST', /\/members$/)).toHaveLength(0)

    fireEvent.click(within(addForm()).getByLabelText('查核員'))
    fireEvent.click(
      within(addForm()).getByRole('button', { name: '加入成員' }),
    )
    expect(await screen.findByText('林鮑伯', { selector: 'p' })).toBeVisible()
    expect(
      JSON.parse(String(calls(fetchMock, 'POST', /\/members$/)[0][1]?.body)),
    ).toEqual({ user_id: bob.id, role_ids: [roleA.id] })
    expect(screen.getByRole('status')).toHaveTextContent(
      '已加入「林鮑伯（bob.lin）」。',
    )
    // 加入後這個人不再是候選；沒有人可加時改顯示說明。
    expect(await screen.findByText('沒有可加入的成員。')).toBeVisible()
  })

  it('changes roles on the separate screen by clicking', async () => {
    const fetchMock = projectFetch({ office: true, members: [memberAnna] })
    renderAt(path, officeUser)
    await screen.findByText('鄧安娜')

    fireEvent.click(screen.getByRole('button', { name: /修改「.*」的角色/ }))
    expect(
      await screen.findByRole('heading', { name: /修改「.*」的角色/ }),
    ).toBeVisible()
    fireEvent.click(screen.getByLabelText('審核者'))
    fireEvent.click(screen.getByRole('button', { name: '儲存角色' }))

    expect(await screen.findByText(/已更新「.*」的角色/)).toBeVisible()
    expect(
      JSON.parse(
        String(calls(fetchMock, 'PUT', /\/members\/.*\/roles$/)[0][1]?.body),
      ),
    ).toEqual({ role_ids: [roleA.id, roleB.id] })
  })

  it('removes a member after confirming', async () => {
    const fetchMock = projectFetch({ office: true, members: [memberAnna] })
    renderAt(path, officeUser)
    await screen.findByText('鄧安娜')

    fireEvent.click(screen.getByRole('button', { name: /移出專案/ }))
    expect(calls(fetchMock, 'DELETE', /\/members\//)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '確認移出' }))

    expect(await screen.findByText(/已將「.*」移出專案/)).toBeVisible()
    expect(calls(fetchMock, 'DELETE', /\/members\/user-1$/)).toHaveLength(1)
    expect(await screen.findByText('目前沒有成員。')).toBeVisible()
  })

  it('keeps the member list when the candidate list fails', async () => {
    projectFetch({
      office: true,
      members: [memberAnna],
      failWith: {
        match: /\/member-candidates/,
        method: 'GET',
        code: 'internal.error',
        status: 500,
      },
    })
    renderAt(path, officeUser)

    expect(await screen.findByText('鄧安娜')).toBeVisible()
    expect(await screen.findByText(/無法載入可加入的成員/)).toBeVisible()
    expect(
      within(addForm()).getByRole('button', { name: '加入成員' }),
    ).toBeDisabled()
    // 角色區塊與成員操作不受影響。
    expect(within(addForm()).getByLabelText('查核員')).toBeVisible()
    expect(
      screen.getByRole('button', { name: /修改「.*」的角色/ }),
    ).toBeEnabled()
  })

  // #713：專案建立者角色不可指派，不在可指派清單，名稱仍要正確。
  it('shows the creator role name instead of an unknown role', async () => {
    projectFetch({
      office: true,
      members: [
        {
          ...memberAnna,
          role_ids: ['role-creator'],
          role_names: ['專案建立者'],
        },
      ],
    })
    renderAt(path, officeUser)

    expect(await screen.findByText('專案建立者')).toBeVisible()
    expect(screen.queryByText('（未知角色）')).toBeNull()
  })

  it('keeps the member list when the role list fails', async () => {
    projectFetch({
      office: true,
      members: [memberAnna],
      failWith: {
        match: /\/assignable-roles/,
        method: 'GET',
        code: 'permission.denied',
        status: 403,
      },
    })
    renderAt(path, officeUser)

    expect(await screen.findByText('鄧安娜')).toBeVisible()
    expect(await screen.findByText(/無法載入角色/)).toBeVisible()
    // 名稱由成員清單直接帶來，角色清單失敗也不影響顯示。
    expect(screen.getByText('查核員')).toBeVisible()
    expect(screen.queryByText('（角色名稱無法顯示）')).toBeNull()
    expect(
      screen.getByRole('button', { name: /修改「.*」的角色/ }),
    ).toBeDisabled()
    expect(screen.getByRole('combobox', { name: '成員' })).toBeVisible()
  })

  it('retries every failed block with the reload button', async () => {
    let failing = true
    const base = projectFetch({ office: true, members: [memberAnna] })
    const inner = base.getMockImplementation()
    base.mockImplementation(async (input, init) => {
      if (failing && /\/member-candidates/.test(String(input))) {
        return Response.json({ error: { code: 'x' } }, { status: 500 })
      }
      return (inner as NonNullable<typeof inner>)(input, init)
    })
    renderAt(path, officeUser)
    await screen.findByText(/無法載入可加入的成員/)

    failing = false
    fireEvent.click(screen.getByRole('button', { name: '重新載入' }))
    expect(await screen.findByRole('combobox', { name: '成員' })).toBeVisible()
    expect(screen.queryByText(/無法載入可加入的成員/)).toBeNull()
  })

  it('shows no member actions without the manage permission', async () => {
    projectFetch({
      office: true,
      members: [memberAnna],
      failWith: {
        match: /\/projects\/project-1\/members$/,
        method: 'GET',
        code: 'permission.denied',
        status: 403,
      },
    })
    renderAt(path, officeUser)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '你沒有權限管理這個專案的成員',
    )
    expect(screen.queryByRole('button', { name: '加入成員' })).toBeNull()
    expect(screen.queryByRole('button', { name: /修改「/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /移出專案/ })).toBeNull()
    expect(screen.queryByText('鄧安娜')).toBeNull()
  })

  it('tells an office user without candidates who to ask', async () => {
    projectFetch({
      office: true,
      members: [
        memberAnna,
        { ...memberAnna, id: 'member-2', user_id: bob.id },
      ],
    })
    renderAt(path, officeUser)

    expect(await screen.findByText('沒有可加入的成員。')).toBeVisible()
    expect(screen.getByText(/需要新增帳號請洽系統管理者/)).toBeVisible()
    expect(screen.getByText(/可加入尚未參與這個專案的成員/)).toBeVisible()
    expect(screen.queryByText(/只能加入和你同公司/)).toBeNull()
    // 內業沒有系統管理頁，不放連結。
    expect(screen.queryByRole('link', { name: '帳號' })).toBeNull()
  })
})

// 防連點與輸入法選字的 Enter（#507）。
// 請求還沒回來時再送出只會送一次；選字的 Enter 不送出。
function holdRequests(
  fetchMock: ReturnType<typeof projectFetch>,
  method: string,
  pattern: RegExp,
): Deferred<void> {
  const gate = deferred()
  const original = fetchMock.getMockImplementation()
  fetchMock.mockImplementation(async (input, init) => {
    if ((init?.method ?? 'GET') === method && pattern.test(String(input))) {
      await gate.promise
    }
    return (original as NonNullable<typeof original>)(input, init)
  })
  return gate
}

function formOf(element: HTMLElement): HTMLFormElement {
  return element.closest('form') as HTMLFormElement
}

describe('project members forms guard (#507)', () => {
  async function fillAdd() {
    fireEvent.change(screen.getByRole('combobox', { name: '成員' }), {
      target: { value: bob.id },
    })
    fireEvent.click(within(addForm()).getByLabelText('查核員'))
  }

  it('adds one member when Enter is pressed twice quickly', async () => {
    const fetchMock = projectFetch({ members: [memberAnna] })
    renderAt('/projects/project-1/members')
    await screen.findByText('鄧安娜')
    await fillAdd()
    const gate = holdRequests(fetchMock, 'POST', /\/members$/)
    const form = formOf(addForm())

    fireEvent.submit(form)
    fireEvent.submit(form)
    gate.resolve()

    expect(await screen.findByRole('status')).toHaveTextContent('已加入')
    expect(calls(fetchMock, 'POST', /\/members$/)).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('accepts another add after a failed one', async () => {
    const fetchMock = projectFetch({
      members: [memberAnna],
      failWith: {
        match: /\/members$/,
        method: 'POST',
        code: 'server.error',
        status: 500,
      },
    })
    renderAt('/projects/project-1/members')
    await screen.findByText('鄧安娜')
    await fillAdd()
    const form = formOf(addForm())

    fireEvent.submit(form)
    await screen.findByRole('alert')
    fireEvent.submit(form)

    await waitFor(() =>
      expect(calls(fetchMock, 'POST', /\/members$/)).toHaveLength(2),
    )
  })

  it('does not add when Enter only confirms an IME choice', async () => {
    const fetchMock = projectFetch({ members: [memberAnna] })
    renderAt('/projects/project-1/members')
    await screen.findByText('鄧安娜')
    await fillAdd()

    expectImeEnterIgnored(screen.getByRole('combobox', { name: '成員' }))

    expect(calls(fetchMock, 'POST', /\/members$/)).toHaveLength(0)
  })

  it('saves roles once when Enter is pressed twice quickly', async () => {
    const fetchMock = projectFetch({ members: [memberAnna] })
    renderAt('/projects/project-1/members')
    await screen.findByText('鄧安娜')
    fireEvent.click(screen.getByRole('button', { name: /修改「.*」的角色/ }))
    fireEvent.click(screen.getByLabelText('審核者'))
    const gate = holdRequests(fetchMock, 'PUT', /\/roles$/)
    const form = formOf(screen.getByRole('button', { name: '儲存角色' }))

    fireEvent.submit(form)
    fireEvent.submit(form)
    gate.resolve()

    expect(await screen.findByRole('status')).toHaveTextContent('已更新')
    expect(calls(fetchMock, 'PUT', /\/roles$/)).toHaveLength(1)
  })

  it('ignores IME Enter when saving roles', async () => {
    const fetchMock = projectFetch({ members: [memberAnna] })
    renderAt('/projects/project-1/members')
    await screen.findByText('鄧安娜')
    fireEvent.click(screen.getByRole('button', { name: /修改「.*」的角色/ }))
    fireEvent.click(screen.getByLabelText('審核者'))

    expectImeEnterIgnored(screen.getByLabelText('審核者'))

    expect(calls(fetchMock, 'PUT', /\/roles$/)).toHaveLength(0)
  })

  it('removes once when the confirm button is clicked twice', async () => {
    const fetchMock = projectFetch({ members: [memberAnna] })
    renderAt('/projects/project-1/members')
    await screen.findByText('鄧安娜')
    fireEvent.click(screen.getByRole('button', { name: /移出專案/ }))
    const gate = holdRequests(fetchMock, 'DELETE', /\/members\//)
    const confirm = screen.getByRole('button', { name: '確認移出' })

    fireEvent.click(confirm)
    fireEvent.click(confirm)
    gate.resolve()

    expect(await screen.findByText('目前沒有成員。')).toBeVisible()
    expect(calls(fetchMock, 'DELETE', /\/members\//)).toHaveLength(1)
  })
})
