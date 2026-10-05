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
import { CurrentUserProvider } from '../../auth/useCurrentUser'
import AdminPage from '../AdminPage'
import type { User } from '../api'
import type { Project, ProjectMember, Role } from './api'

const adminUser: CurrentUser = {
  id: 'admin-id',
  username: 'admin',
  email: null,
  name_en: null,
  name_zh: null,
  is_admin: true,
  must_change_password: false,
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    project_code: 'DEMO-001',
    name: '示範工程',
    client_name: '示範業主',
    site_location: '示範工地',
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

const roleA: Role = { id: 'role-a', name: '查核員', permission_codes: [] }
const roleB: Role = { id: 'role-b', name: '審核者', permission_codes: [] }
const anna = makeUser('user-1', 'anna.deng', '鄧安娜')
const bob = makeUser('user-2', 'bob.lin', '林鮑伯')
const inactive = {
  ...makeUser('user-3', 'old.user', '舊人員'),
  is_active: false,
}
const systemAdmin = {
  ...makeUser('user-0', 'admin', '系統管理員'),
  is_admin: true,
  is_system: true,
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          element={
            <CurrentUserProvider value={{ user: adminUser, clear: vi.fn() }}>
              <AdminPage />
            </CurrentUserProvider>
          }
          path="/admin/*"
        />
      </Routes>
    </MemoryRouter>,
  )
}

function jsonBody(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

function projectFetch({
  projects = [makeProject()],
  members = [] as ProjectMember[],
  rolePages = [[roleA, roleB]] as Role[][],
  failWith,
}: {
  projects?: Project[]
  members?: ProjectMember[]
  rolePages?: Role[][]
  failWith?: { match: RegExp; method: string; code: string; status: number }
} = {}) {
  const projectRows = projects.map((row) => ({ ...row }))
  const memberRows = members.map((row) => ({ ...row }))
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (failWith && failWith.method === method && failWith.match.test(url)) {
        return Response.json(
          { error: { code: failWith.code } },
          { status: failWith.status },
        )
      }
      const parsed = new URL(url, 'http://testserver')
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
          viewer_permission_codes: ['inspection_plan.read'],
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
        Object.assign(row ?? {}, jsonBody(init))
        return Response.json(row)
      }
      if (url.endsWith('/members') && method === 'GET') {
        return Response.json(memberRows)
      }
      if (url.endsWith('/members') && method === 'POST') {
        const body = jsonBody(init)
        const user = [anna, bob].find((item) => item.id === body.user_id)
        const added: ProjectMember = {
          id: `member-${memberRows.length + 1}`,
          user_id: String(body.user_id),
          username: user?.username ?? '',
          role_ids: body.role_ids as string[],
          name_zh: user?.name_zh ?? null,
          email: user?.email ?? null,
          company_id: null,
          company_name: null,
          is_active: true,
        }
        memberRows.push(added)
        return Response.json(added, { status: 201 })
      }
      const rolesMatch = /\/members\/([^/]+)\/roles$/.exec(url)
      if (rolesMatch && method === 'PUT') {
        const row = memberRows.find((item) => item.user_id === rolesMatch[1])
        if (row) {
          row.role_ids = jsonBody(init).role_ids as string[]
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
      if (parsed.pathname === '/api/v1/users') {
        return Response.json({
          items: [systemAdmin, anna, bob, inactive],
          next_cursor: null,
        })
      }
      if (url.includes('/roles')) {
        const cursor = new URL(url, 'http://x').searchParams.get('cursor')
        const index = cursor ? Number(cursor) : 0
        return Response.json({
          items: rolePages[index],
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
  fireEvent.change(screen.getByLabelText('專案代號'), {
    target: { value: 'DEMO-002' },
  })
  fireEvent.change(screen.getByLabelText('工程名稱'), {
    target: { value: '第二示範工程' },
  })
  fireEvent.change(screen.getByLabelText('業主／委託單位'), {
    target: { value: '示範業主' },
  })
  fireEvent.change(screen.getByLabelText('整體工程地點'), {
    target: { value: '第二示範工地' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('admin projects page', () => {
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
    renderAt('/admin')
    fireEvent.click(await screen.findByRole('link', { name: '專案' }))

    expect(await screen.findAllByText('示範業主')).toHaveLength(2)
    expect(screen.getAllByText('2026-10-01', { selector: 'td' })).toHaveLength(
      2,
    )
    expect(screen.getByText('（代號重複）')).toBeVisible()
    expect(screen.getAllByRole('link', { name: '成員' })[0]).toHaveAttribute(
      'href',
      '/admin/projects/project-1/members',
    )
    expect(
      screen.getAllByRole('link', { name: '開啟專案' })[0],
    ).toHaveAttribute('href', '/admin/projects/project-1')
    expect(screen.getAllByRole('link', { name: '成員' })[0]).toHaveClass(
      'button-link',
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
    renderAt('/admin/projects')

    expect(await screen.findByText('示範工程0')).toBeInTheDocument()
    expect(screen.queryByText('目標工程')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '載入更多' }))
    expect(await screen.findByText('目標工程')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('搜尋專案'), {
      target: { value: 'demo-050' },
    })
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }))
    expect(await screen.findByText('目標工程')).toBeInTheDocument()
    expect(screen.queryByText('示範工程0')).not.toBeInTheDocument()
  })

  it('reloads projects when searching the same query repeatedly', async () => {
    projectFetch()
    renderAt('/admin/projects')

    expect(await screen.findByText('示範工程')).toBeInTheDocument()
    const search = screen.getByRole('button', { name: '搜尋' })
    fireEvent.click(search)
    expect(await screen.findByText('示範工程')).toBeInTheDocument()
    expect(search).toBeEnabled()

    fireEvent.click(search)
    expect(await screen.findByText('示範工程')).toBeInTheDocument()
    expect(search).toBeEnabled()
  })

  it('creates a project with optional dates left empty', async () => {
    const fetchMock = projectFetch()
    renderAt('/admin/projects')
    await screen.findByText('示範工程')

    fillProjectForm()
    fireEvent.change(screen.getByLabelText('預定完工日'), {
      target: { value: '2027-04-01' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))

    expect(
      await screen.findByRole('heading', { name: 'DEMO-002｜第二示範工程' }),
    ).toBeVisible()
    const [, init] = calls(fetchMock, 'POST', /\/projects$/)[0]
    expect(JSON.parse(String(init?.body))).toEqual({
      project_code: 'DEMO-002',
      name: '第二示範工程',
      client_name: '示範業主',
      site_location: '第二示範工地',
      planned_start_date: null,
      planned_completion_date: '2027-04-01',
    })
  })

  it('warns about a duplicate project code but still saves', async () => {
    projectFetch()
    renderAt('/admin/projects')
    await screen.findByText('示範工程')

    fillProjectForm()
    fireEvent.change(screen.getByLabelText('專案代號'), {
      target: { value: 'DEMO-001' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))

    expect(
      await screen.findByRole('heading', { name: 'DEMO-001｜第二示範工程' }),
    ).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('edits a project by sending only changed fields', async () => {
    const fetchMock = projectFetch()
    renderAt('/admin/projects')
    await screen.findByText('示範工程')

    fireEvent.click(screen.getByRole('button', { name: '編輯' }))
    expect(screen.getByLabelText('專案代號')).toHaveValue('DEMO-001')
    fireEvent.change(screen.getByLabelText('工程名稱'), {
      target: { value: '改名後的工程' },
    })
    fireEvent.change(screen.getByLabelText('預定開工日'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存專案' }))

    expect(await screen.findByText('改名後的工程')).toBeVisible()
    const [, init] = calls(fetchMock, 'PATCH', /\/projects\/project-1$/)[0]
    expect(JSON.parse(String(init?.body))).toEqual({
      name: '改名後的工程',
      planned_start_date: null,
    })
    expect(screen.getByRole('heading', { name: '新增專案' })).toBeVisible()
  })

  it('does not call the API when nothing was edited', async () => {
    const fetchMock = projectFetch()
    renderAt('/admin/projects')
    await screen.findByText('示範工程')

    fireEvent.click(screen.getByRole('button', { name: '編輯' }))
    fireEvent.click(screen.getByRole('button', { name: '儲存專案' }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '新增專案' })).toBeVisible(),
    )
    expect(calls(fetchMock, 'PATCH', /projects/)).toHaveLength(0)
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
    renderAt('/admin/projects')
    await screen.findByText('示範工程')

    fillProjectForm()
    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '資料格式不正確',
    )
  })
})

const memberAnna: ProjectMember = {
  id: 'member-1',
  user_id: anna.id,
  username: anna.username,
  role_ids: [roleA.id],
  name_zh: anna.name_zh,
  email: anna.email,
  company_id: 'company-1',
  company_name: '示範公司',
  is_active: true,
}

describe('admin project members', () => {
  it('shows members with company, roles, and handles no company', async () => {
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
        },
      ],
    })
    renderAt('/admin/projects/project-1/members')

    const annaRow = (await screen.findByText('anna.deng')).closest('tr')
    expect(annaRow).not.toBeNull()
    expect(within(annaRow as HTMLElement).getByText('示範公司')).toBeVisible()
    expect(within(annaRow as HTMLElement).getByText('查核員')).toBeVisible()
    const bobRow = screen.getByText('bob.lin').closest('tr') as HTMLElement
    expect(within(bobRow).getByText('無角色')).toBeVisible()
    expect(within(bobRow).getByText('—', { selector: 'td' })).toBeVisible()
  })

  it('adds a member; hides existing, inactive, system users', async () => {
    const fetchMock = projectFetch({ members: [memberAnna] })
    renderAt('/admin/projects/project-1/members')
    await screen.findByText('anna.deng')

    const select = screen.getByLabelText('使用者')
    const optionNames = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(optionNames).toEqual(['請選擇使用者', '林鮑伯（bob.lin）'])

    fireEvent.change(select, { target: { value: bob.id } })
    const addForm = screen.getByRole('heading', { name: '加入成員' })
      .parentElement as HTMLElement
    fireEvent.click(within(addForm).getByLabelText('查核員'))
    fireEvent.click(within(addForm).getByLabelText('審核者'))
    fireEvent.click(within(addForm).getByRole('button', { name: '加入成員' }))

    expect(
      await screen.findByText('bob.lin', { selector: 'th' }),
    ).toBeVisible()
    const [, init] = calls(fetchMock, 'POST', /\/members$/)[0]
    expect(JSON.parse(String(init?.body))).toEqual({
      user_id: bob.id,
      role_ids: [roleA.id, roleB.id],
    })
    expect(screen.getByText('沒有可加入的使用者。')).toBeVisible()
  })

  it('adds a member without any role', async () => {
    const fetchMock = projectFetch()
    renderAt('/admin/projects/project-1/members')
    await screen.findByText('目前沒有成員。')

    fireEvent.change(screen.getByLabelText('使用者'), {
      target: { value: anna.id },
    })
    const addForm = screen.getByRole('heading', { name: '加入成員' })
      .parentElement as HTMLElement
    fireEvent.click(within(addForm).getByRole('button', { name: '加入成員' }))

    expect(await screen.findByText('無角色')).toBeVisible()
    const [, init] = calls(fetchMock, 'POST', /\/members$/)[0]
    expect(JSON.parse(String(init?.body))).toEqual({
      user_id: anna.id,
      role_ids: [],
    })
  })

  it('replaces a member role set, including clearing every role', async () => {
    const fetchMock = projectFetch({ members: [memberAnna] })
    renderAt('/admin/projects/project-1/members')
    await screen.findByText('anna.deng')

    fireEvent.click(screen.getByRole('button', { name: '調整角色' }))
    const panel = screen.getByRole('heading', { name: /調整「/ })
      .parentElement as HTMLElement
    expect(within(panel).getByLabelText('查核員')).toBeChecked()
    fireEvent.click(within(panel).getByLabelText('審核者'))
    fireEvent.click(within(panel).getByRole('button', { name: '儲存角色' }))
    expect(await screen.findByText('查核員、審核者')).toBeVisible()
    expect(
      JSON.parse(String(calls(fetchMock, 'PUT', /\/roles$/)[0][1]?.body)),
    ).toEqual({ role_ids: [roleA.id, roleB.id] })

    fireEvent.click(screen.getByRole('button', { name: '調整角色' }))
    const again = screen.getByRole('heading', { name: /調整「/ })
      .parentElement as HTMLElement
    fireEvent.click(within(again).getByLabelText('查核員'))
    fireEvent.click(within(again).getByLabelText('審核者'))
    fireEvent.click(within(again).getByRole('button', { name: '儲存角色' }))
    expect(await screen.findByText('無角色')).toBeVisible()
    expect(
      JSON.parse(String(calls(fetchMock, 'PUT', /\/roles$/)[1][1]?.body)),
    ).toEqual({ role_ids: [] })
  })

  it('asks for confirmation before removing a member', async () => {
    const fetchMock = projectFetch({ members: [memberAnna] })
    renderAt('/admin/projects/project-1/members')
    await screen.findByText('anna.deng')

    fireEvent.click(screen.getByRole('button', { name: '移出專案' }))
    expect(calls(fetchMock, 'DELETE', /members/)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('button', { name: '確認移出' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '移出專案' }))
    fireEvent.click(screen.getByRole('button', { name: '確認移出' }))
    expect(await screen.findByText('目前沒有成員。')).toBeVisible()
    expect(calls(fetchMock, 'DELETE', /\/members\/user-1$/)).toHaveLength(1)
  })

  it('maps a duplicate member error to a clear message', async () => {
    projectFetch({
      failWith: {
        match: /\/members$/,
        method: 'POST',
        code: 'project.member_conflict',
        status: 409,
      },
    })
    renderAt('/admin/projects/project-1/members')
    await screen.findByText('目前沒有成員。')

    fireEvent.change(screen.getByLabelText('使用者'), {
      target: { value: anna.id },
    })
    const addForm = screen.getByRole('heading', { name: '加入成員' })
      .parentElement as HTMLElement
    fireEvent.click(within(addForm).getByRole('button', { name: '加入成員' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '這位使用者已經是此專案的成員。',
    )
  })

  it('follows role pagination until every role is loaded', async () => {
    const fetchMock = projectFetch({ rolePages: [[roleA], [roleB]] })
    renderAt('/admin/projects/project-1/members')
    await screen.findByText('目前沒有成員。')

    expect(screen.getByLabelText('審核者')).toBeVisible()
    expect(calls(fetchMock, 'GET', /\/roles/)).toHaveLength(2)
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
    renderAt('/admin/projects/missing/members')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '找不到這筆資料',
    )
  })
})
