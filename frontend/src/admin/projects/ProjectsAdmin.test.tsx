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
import contract from './fixtures/member-roles-contract.json'

const officeUser: CurrentUser = {
  id: 'office-id',
  username: 'demo-office',
  email: null,
  name_en: null,
  name_zh: '示範內業',
  is_admin: false,
  must_change_password: false,
  has_office_access: true,
  has_field_access: false,
  has_template_access: false,
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
  has_field_access: true,
  has_template_access: true,
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

const roleA: Role = {
  id: 'role-a',
  name: '查核員',
  permission_codes: ['inspection_task.inspect', 'inspection_task.read'],
}
const roleB: Role = {
  id: 'role-b',
  name: '審核者',
  permission_codes: [
    'inspection_plan.create',
    'inspection_task.create',
    'inspection_task.dispatch',
  ],
}
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

function renderAt(path: string, user: CurrentUser = adminUser) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          element={
            <CurrentUserProvider value={{ user, clear: vi.fn() }}>
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
  office = false,
  failWith,
}: {
  projects?: Project[]
  members?: ProjectMember[]
  rolePages?: Role[][]
  /** 內業（非管理者、有 project_member.manage）：全域 API 一律 403。 */
  office?: boolean
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
        Object.assign(row ?? {}, jsonBody(init))
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
          name_zh: user?.name_zh ?? null,
          email: user?.email ?? null,
          company_id: null,
          company_name: null,
          is_active: true,
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
        const items = [systemAdmin, anna, bob, inactive]
          .filter(
            (user) =>
              user.is_active && !user.is_system && !joined.has(user.id),
          )
          .map(({ id, username, name_zh }) => ({ id, username, name_zh }))
        return Response.json({ items, next_cursor: null })
      }
      if (/\/projects\/[^/]+\/assignable-roles$/.test(parsed.pathname)) {
        const cursor = parsed.searchParams.get('cursor')
        const index = cursor ? Number(cursor) : 0
        return Response.json({
          items: rolePages[index].map(({ id, name, permission_codes }) => ({
            id,
            name,
            permission_codes,
          })),
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
    expect(
      screen.getByRole('heading', {
        name: '專案工作台',
      }),
    ).toBeVisible()
    expect(document.querySelector('.projects-admin-table')).toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: '套用範本' })[0],
    ).toHaveAttribute('href', '/admin/projects/project-1/templates')
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

  it('opens the project home with section navigation', async () => {
    projectFetch()
    renderAt('/admin/projects/project-1')

    expect(
      await screen.findByRole('heading', { name: '專案首頁' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'DEMO-001｜示範工程' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '計畫與任務' })).toHaveAttribute(
      'href',
      '/admin/projects/project-1/planning',
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

    await screen.findAllByText('示範工程0')
    const table = within(
      document.querySelector('.projects-admin-table') as HTMLElement,
    )
    expect(table.getByText('示範工程0')).toBeInTheDocument()
    expect(screen.queryByText('目標工程')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '載入更多' }))
    await screen.findAllByText('目標工程')
    expect(
      within(
        document.querySelector('.projects-admin-table') as HTMLElement,
      ).getByText('目標工程'),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('搜尋專案'), {
      target: { value: 'demo-050' },
    })
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }))
    await screen.findAllByText('目標工程')
    expect(
      within(
        document.querySelector('.projects-admin-table') as HTMLElement,
      ).getByText('目標工程'),
    ).toBeInTheDocument()
    expect(screen.queryByText('示範工程0')).not.toBeInTheDocument()
  })

  it('reloads projects when searching the same query repeatedly', async () => {
    projectFetch()
    renderAt('/admin/projects')

    await screen.findAllByText('示範工程')
    const table = within(
      document.querySelector('.projects-admin-table') as HTMLElement,
    )
    expect(table.getByText('示範工程')).toBeInTheDocument()
    const search = screen.getByRole('button', { name: '搜尋' })
    fireEvent.click(search)
    await waitFor(() => expect(search).toBeEnabled())
    expect(
      within(
        document.querySelector('.projects-admin-table') as HTMLElement,
      ).getByText('示範工程'),
    ).toBeInTheDocument()

    fireEvent.click(search)
    await waitFor(() => expect(search).toBeEnabled())
    expect(
      within(
        document.querySelector('.projects-admin-table') as HTMLElement,
      ).getByText('示範工程'),
    ).toBeInTheDocument()
  })

  it('creates a project with optional dates left empty', async () => {
    const fetchMock = projectFetch()
    renderAt('/admin/projects')
    await screen.findAllByText('示範工程')

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
    await screen.findAllByText('示範工程')

    fillProjectForm()
    fireEvent.change(screen.getByLabelText(/專案代號/), {
      target: { value: 'DEMO-001' },
    })
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
    renderAt('/admin/projects')
    await screen.findAllByText('示範工程')

    fireEvent.click(screen.getByRole('button', { name: '編輯' }))
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
      await within(
        document.querySelector('.projects-admin-table') as HTMLElement,
      ).findByText('改名後的工程'),
    ).toBeInTheDocument()
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
    await screen.findAllByText('示範工程')

    fireEvent.click(screen.getByRole('button', { name: '編輯' }))
    fireEvent.click(screen.getByRole('button', { name: '儲存專案' }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '新增專案' })).toBeVisible(),
    )
    expect(calls(fetchMock, 'PATCH', /projects/)).toHaveLength(0)
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
    renderAt('/admin/projects')
    await screen.findAllByText('示範工程')
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '未儲存的新工程' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: '編輯' })[0])

    const prompt = screen.getByRole('region', { name: '未儲存變更' })
    fireEvent.click(within(prompt).getByRole('button', { name: '保留編輯' }))
    expect(screen.getByLabelText(/工程名稱/)).toHaveValue('未儲存的新工程')

    fireEvent.click(screen.getAllByRole('button', { name: '編輯' })[0])
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
    renderAt('/admin/projects')
    await screen.findAllByText('第二示範工程')
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '未儲存的新工程' },
    })
    fireEvent.click(screen.getAllByRole('link', { name: '成員' })[1])
    let prompt = screen.getByRole('region', { name: '未儲存變更' })
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
    renderAt('/admin/projects')
    await screen.findAllByText('示範工程')
    fireEvent.click(screen.getByRole('button', { name: '編輯' }))
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '未儲存的修改' },
    })

    fireEvent.click(screen.getAllByRole('button', { name: '新增專案' })[0])
    let prompt = screen.getByRole('region', { name: '未儲存變更' })
    fireEvent.click(within(prompt).getByRole('button', { name: '保留編輯' }))
    expect(screen.getByLabelText(/工程名稱/)).toHaveValue('未儲存的修改')

    fireEvent.click(screen.getAllByRole('button', { name: '新增專案' })[0])
    prompt = screen.getByRole('region', { name: '未儲存變更' })
    fireEvent.click(within(prompt).getByRole('button', { name: '捨棄' }))
    expect(screen.getByRole('heading', { name: '新增專案' })).toBeVisible()
    expect(screen.getByLabelText(/工程名稱/)).toHaveValue('')
  })

  it('keeps or discards dirty edits before opening another project', async () => {
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
    renderAt('/admin/projects')
    await screen.findAllByText('第二示範工程')
    fireEvent.click(screen.getAllByRole('button', { name: '編輯' })[0])
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: '未儲存的修改' },
    })

    fireEvent.click(screen.getAllByRole('link', { name: '成員' })[1])
    let prompt = screen.getByRole('region', { name: '未儲存變更' })
    fireEvent.click(within(prompt).getByRole('button', { name: '保留編輯' }))
    expect(screen.getByLabelText(/工程名稱/)).toHaveValue('未儲存的修改')

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
    await screen.findAllByText('示範工程')

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

function addForm(): HTMLElement {
  return screen.getByRole('heading', { name: '加入成員' })
    .parentElement as HTMLElement
}

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
        },
      ],
    })
    renderAt('/admin/projects/project-1/members')

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

  it('explains each role in plain language without showing codes', async () => {
    projectFetch()
    renderAt('/admin/projects/project-1/members')
    await screen.findByText('目前沒有成員。')

    expect(screen.getByLabelText('查核員')).toHaveAccessibleDescription(
      '可查看任務、到現場查核',
    )
    expect(screen.getByLabelText('審核者')).toHaveAccessibleDescription(
      '可建立計畫、建立任務、派出任務',
    )
    expect(document.body.textContent).not.toMatch(/inspection_|project_/)
  })

  it('adds a member; hides existing, inactive, system users', async () => {
    const fetchMock = projectFetch({ members: [memberAnna] })
    renderAt('/admin/projects/project-1/members')
    await screen.findByText('鄧安娜')

    const select = screen.getByLabelText(/使用者/)
    const optionNames = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(optionNames).toEqual(['請選擇使用者', '林鮑伯（bob.lin）'])

    fireEvent.change(select, { target: { value: bob.id } })
    fireEvent.click(within(addForm()).getByLabelText('查核員'))
    fireEvent.click(within(addForm()).getByLabelText('審核者'))
    fireEvent.click(
      within(addForm()).getByRole('button', { name: '加入成員' }),
    )

    expect(await screen.findByText('林鮑伯', { selector: 'p' })).toBeVisible()
    const [, init] = calls(fetchMock, 'POST', /\/members$/)[0]
    expect(JSON.parse(String(init?.body))).toEqual({
      user_id: bob.id,
      role_ids: [roleA.id, roleB.id],
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      '已加入「林鮑伯（bob.lin）」。',
    )
    expect(screen.getByText('沒有可加入的使用者。')).toBeVisible()
    // 全部都加完後，角色勾選與加入按鈕一起隱藏，只剩說明（#487）。
    expect(within(addForm()).queryByRole('checkbox')).toBeNull()
    expect(
      within(addForm()).queryByRole('button', { name: '加入成員' }),
    ).toBeNull()
  })

  it('blocks a member without roles, shows the error by the field, and keeps the chosen person', async () => {
    const fetchMock = projectFetch()
    renderAt('/admin/projects/project-1/members')
    await screen.findByText('目前沒有成員。')

    fireEvent.change(screen.getByLabelText(/使用者/), {
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
    expect(screen.getByLabelText(/使用者/)).toHaveValue(anna.id)
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
    renderAt('/admin/projects/project-1/members')
    await screen.findByText('目前沒有成員。')

    fireEvent.click(
      within(addForm()).getByRole('button', { name: '加入成員' }),
    )

    expect(screen.getByText('請選擇要加入的使用者。')).toBeVisible()
    expect(screen.getByText('請至少選一個角色。')).toBeVisible()
    expect(screen.getByLabelText(/使用者/)).toHaveFocus()
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
    renderAt('/admin/projects/project-1/members')
    await screen.findByText('目前沒有成員。')

    fireEvent.change(screen.getByLabelText(/使用者/), {
      target: { value: anna.id },
    })
    fireEvent.click(within(addForm()).getByLabelText('查核員'))
    fireEvent.click(
      within(addForm()).getByRole('button', { name: '加入成員' }),
    )

    expect(await screen.findByText('請至少選一個角色。')).toBeVisible()
    expect(screen.getByLabelText('查核員')).toHaveFocus()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText(/使用者/)).toHaveValue(anna.id)
  })

  it('maps the server company mismatch 422 to the user field', async () => {
    // 前端候選清單已限制同公司；伺服器仍會再檢查一次（例如對方剛換公司）。
    projectFetch({
      office: true,
      failWith: {
        match: /\/members$/,
        method: 'POST',
        code: contract.company_mismatch_error.code,
        status: contract.company_mismatch_error.status,
      },
    })
    renderAt('/admin/projects/project-1/members', officeUser)
    await screen.findByText('目前沒有成員。')

    fireEvent.change(screen.getByLabelText(/使用者/), {
      target: { value: anna.id },
    })
    fireEvent.click(within(addForm()).getByLabelText('查核員'))
    fireEvent.click(
      within(addForm()).getByRole('button', { name: '加入成員' }),
    )

    expect(
      await screen.findByText('只能加入和你同公司的使用者，請重新選擇。'),
    ).toBeVisible()
    expect(screen.getByLabelText(/使用者/)).toHaveFocus()
    expect(screen.getByLabelText('查核員')).toBeChecked()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('edits roles on a separate screen and requires at least one role', async () => {
    const fetchMock = projectFetch({ members: [memberAnna] })
    renderAt('/admin/projects/project-1/members')
    await screen.findByText('鄧安娜')

    fireEvent.click(screen.getByRole('button', { name: /修改「.*」的角色/ }))
    // 獨立畫面：清單與加入表單不在同一畫面。
    expect(screen.getByRole('heading', { name: /修改「/ })).toHaveFocus()
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
    const card = (
      await screen.findByText('鄧安娜', { selector: 'p' })
    ).closest('li') as HTMLElement
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
    renderAt('/admin/projects/project-1/members')
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
    renderAt('/admin/projects/project-1/members')
    await screen.findByText('鄧安娜')

    fireEvent.click(screen.getByRole('button', { name: /修改「.*」的角色/ }))
    // 沒改動就取消：直接回清單。
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole('heading', { name: '成員列表' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /修改「.*」的角色/ }))
    fireEvent.click(screen.getByLabelText('審核者'))
    fireEvent.keyDown(screen.getByLabelText('審核者'), { key: 'Escape' })
    const prompt = screen.getByRole('group', { name: '捨棄確認' })
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
    renderAt('/admin/projects/project-1/members')
    await screen.findByText('鄧安娜')

    fireEvent.click(screen.getByRole('button', { name: /移出專案/ }))
    expect(calls(fetchMock, 'DELETE', /members/)).toHaveLength(0)
    const confirm = screen.getByRole('group', { name: '移出確認' })
    expect(within(confirm).getByRole('button', { name: '取消' })).toHaveFocus()
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
    renderAt('/admin/projects/project-1/members')
    await screen.findByText('目前沒有成員。')

    fireEvent.change(screen.getByLabelText(/使用者/), {
      target: { value: anna.id },
    })
    fireEvent.click(within(addForm()).getByLabelText('查核員'))
    fireEvent.click(
      within(addForm()).getByRole('button', { name: '加入成員' }),
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('這位使用者已經是此專案的成員。')
    expect(addForm().contains(alert)).toBe(true)
  })

  it('does not keep an old message after the next action', async () => {
    projectFetch({ members: [memberAnna] })
    renderAt('/admin/projects/project-1/members')
    await screen.findByText('鄧安娜')

    fireEvent.change(screen.getByLabelText(/使用者/), {
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
    renderAt('/admin/projects/project-1/members')
    await screen.findByText('鄧安娜')

    fireEvent.change(screen.getByLabelText(/使用者/), {
      target: { value: bob.id },
    })
    fireEvent.click(within(addForm()).getByLabelText('審核者'))
    fireEvent.click(screen.getByRole('button', { name: /修改「.*」的角色/ }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.getByLabelText(/使用者/)).toHaveValue(bob.id)
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
    renderAt('/admin/projects/project-1/members')
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
    renderAt('/admin/projects/missing/members')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '找不到這筆資料',
    )
  })
})

describe('project members for an office user (not admin, #481)', () => {
  const path = '/admin/projects/project-1/members'
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
      '可查看任務、到現場查核',
    )
  })

  it('adds a member by clicking, with a required role', async () => {
    const fetchMock = projectFetch({ office: true, members: [memberAnna] })
    renderAt(path, officeUser)
    await screen.findByText('鄧安娜')

    const select = screen.getByLabelText(/使用者/)
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['請選擇使用者', '林鮑伯（bob.lin）'])
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
    expect(await screen.findByText('沒有可加入的使用者。')).toBeVisible()
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
    expect(await screen.findByText(/無法載入可加入的使用者/)).toBeVisible()
    expect(
      within(addForm()).getByRole('button', { name: '加入成員' }),
    ).toBeDisabled()
    // 角色區塊與成員操作不受影響。
    expect(within(addForm()).getByLabelText('查核員')).toBeVisible()
    expect(
      screen.getByRole('button', { name: /修改「.*」的角色/ }),
    ).toBeEnabled()
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
    expect(screen.getByText('（角色名稱無法顯示）')).toBeVisible()
    expect(
      screen.getByRole('button', { name: /修改「.*」的角色/ }),
    ).toBeDisabled()
    expect(screen.getByLabelText(/使用者/)).toBeVisible()
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
    await screen.findByText(/無法載入可加入的使用者/)

    failing = false
    fireEvent.click(screen.getByRole('button', { name: '重新載入' }))
    expect(await screen.findByLabelText(/使用者/)).toBeVisible()
    expect(screen.queryByText(/無法載入可加入的使用者/)).toBeNull()
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

    expect(await screen.findByText('沒有可加入的使用者。')).toBeVisible()
    expect(screen.getByText(/同公司/)).toBeVisible()
    // 內業沒有系統管理頁，不放連結。
    expect(screen.queryByRole('link', { name: '使用者' })).toBeNull()
  })
})
