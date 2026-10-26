import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { Link, Route, Routes } from 'react-router'
import { DataMemoryRouter } from '../../testing/DataMemoryRouter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CurrentUserProvider } from '../../auth/useCurrentUser'
import { currentUserFixture } from '../../testing/contractFixtures'
import type { Project } from '../projects/api'
import { ManagementApiError } from '../api'
import ProjectHomePage from './ProjectHomePage'
import ProjectSectionPage from './ProjectSectionPage'
import { WorkflowSummaryProvider } from './WorkflowSummaryProvider'
import type { WorkflowSummary } from './api'

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  getWorkflowSummary: vi.fn(),
  listCompanyRoles: vi.fn(),
}))

vi.mock('../projects/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/api')>()),
  getProject: mocks.getProject,
  listCompanyRoles: mocks.listCompanyRoles,
}))

vi.mock('./api', () => ({
  getWorkflowSummary: mocks.getWorkflowSummary,
}))

const project: Project = {
  id: 'project-1',
  project_code: 'DEMO-001',
  name: '示範工程',
  client_name: '示範業主',
  site_location: '示範工地',
  company_role: 'contractor',
  planned_start_date: null,
  planned_completion_date: null,
  warnings: [],
}
const otherProjectLabel = '測試導覽至另一專案'
const projectHomeLabel = '測試返回專案首頁'

function summary(overrides: Partial<WorkflowSummary> = {}): WorkflowSummary {
  return {
    project: {
      id: 'project-1',
      project_code: 'DEMO-001',
      name: '示範工程',
      company_role: 'contractor',
    },
    member_count: 2,
    inspection_item_count: 3,
    zone_count: 1,
    plan_count: 1,
    task_counts: {
      DRAFT: 4,
      PENDING: 2,
      IN_PROGRESS: 1,
      COMPLETED: 5,
      CANCELLED: 0,
    },
    pending_reinspection_task_count: 1,
    next_steps: [
      { code: 'add_members', count: 2, pending: false },
      { code: 'add_inspection_items', count: 3, pending: false },
      { code: 'create_plan', count: 1, pending: false },
      { code: 'dispatch_draft_tasks', count: 4, pending: true },
      { code: 'complete_reinspection', count: 1, pending: true },
    ],
    primary_step: 'dispatch_draft_tasks',
    task_counts_visible: true,
    can_apply_templates: false,
    draft_tasks_missing_assignee: 2,
    viewer_permission_codes: [
      'project_member.manage',
      'project_inspection_item.edit',
      'project_zone.read',
      'inspection_plan.read',
      'inspection_plan.create',
      'inspection_task.read',
      'inspection_task.dispatch',
    ],
    ...overrides,
  }
}

function renderAt(
  path = '/projects/project-1',
  access: {
    has_office_access: boolean
    has_field_access: boolean
    has_project_access?: boolean
    can_manage_project_planning_or_members?: boolean
  } = {
    has_office_access: false,
    has_field_access: true,
  },
) {
  return render(
    <DataMemoryRouter initialEntries={[path]}>
      <CurrentUserProvider
        value={{ user: currentUserFixture(access), clear: vi.fn() }}
      >
        <WorkflowSummaryProvider>
          <main>
            <Link aria-label={otherProjectLabel} to="/projects/project-2">
              切換專案
            </Link>
            <Link
              aria-label="測試導覽至計畫區段"
              to="/projects/project-1/planning"
            >
              開啟計畫區段
            </Link>
            <Link
              aria-label="測試導覽至成員區段"
              to="/projects/project-1/members"
            >
              開啟成員區段
            </Link>
            <Link aria-label="測試離開專案" to="/projects">
              離開專案
            </Link>
            <Link aria-label={projectHomeLabel} to="/projects/project-1">
              返回專案首頁
            </Link>
            <Routes>
              <Route
                element={<ProjectHomePage />}
                path="/projects/:projectId"
              />
              <Route
                element={<ProjectSectionPage section="members" />}
                path="/projects/:projectId/members"
              />
              <Route
                element={<ProjectSectionPage section="inspection-items" />}
                path="/projects/:projectId/inspection-items"
              />
              <Route
                element={<ProjectSectionPage section="zones" />}
                path="/projects/:projectId/zones"
              />
              <Route
                element={<ProjectSectionPage section="planning" />}
                path="/projects/:projectId/planning"
              />
              <Route
                element={<ProjectSectionPage section="progress" />}
                path="/projects/:projectId/progress"
              />
              <Route
                element={
                  <ProjectSectionPage section="inspection-items">
                    <p>查核項目細節</p>
                  </ProjectSectionPage>
                }
                path="/projects/:projectId/inspection-items/:itemId"
              />
              <Route element={<p>Field 工作台</p>} path="/tasks" />
              <Route element={<p>我的專案清單</p>} path="/projects" />
            </Routes>
          </main>
        </WorkflowSummaryProvider>
      </CurrentUserProvider>
    </DataMemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listCompanyRoles.mockResolvedValue([
    {
      value: 'contractor',
      label: '承攬施工方',
      inspection_level: 'self_inspection',
    },
    { value: 'supervisor', label: '監造方', inspection_level: 'spot_check' },
  ])
})

afterEach(() => {
  vi.useRealTimers()
})

/** 沒有可執行的下一步時，整張「下一步」卡（含標題與說明）都不存在。 */
function expectNoNextStepCard() {
  expect(
    screen.queryByRole('heading', { name: '下一步' }),
  ).not.toBeInTheDocument()
  expect(screen.queryByText(/下一步/)).not.toBeInTheDocument()
  expect(screen.queryByText('追蹤進度')).not.toBeInTheDocument()
}

describe('project home', () => {
  // ADM-AC40：首頁顯示本公司角色標籤，資料取自流程摘要，不另呼叫專案詳情。
  it.each([
    ['contractor', '承攬施工方'],
    ['supervisor', '監造方'],
  ])('shows the company role label for %s', async (value, label) => {
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({
        project: {
          id: 'project-1',
          project_code: 'DEMO-001',
          name: '示範工程',
          company_role: value,
        },
      }),
    )

    renderAt()

    expect(await screen.findByText(label)).toBeVisible()
    expect(screen.getByText(/本公司角色/)).toBeVisible()
    expect(mocks.getProject).not.toHaveBeenCalled()
  })

  it('唯讀成員不會看到新增查核項目的誤導文案或入口', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({
        primary_step: 'add_inspection_items',
        viewer_permission_codes: [
          'project.read',
          'project_inspection_item.read',
        ],
      }),
    )

    renderAt('/projects/project-1', {
      has_office_access: true,
      has_field_access: true,
    })

    await screen.findByRole('heading', { name: 'DEMO-001｜示範工程' })
    expectNoNextStepCard()
    expect(screen.queryByText('新增查核項目')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: '前往新增查核項目' }),
    ).not.toBeInTheDocument()
  })

  // #713：外部協作（專案查閱人員）只有唯讀權限，不論下一步是哪一項，
  // 都不能出現會被後端擋下的寫入入口。
  it.each([
    ['add_members', '加入專案成員'],
    ['add_inspection_items', '新增查核項目'],
    ['create_plan', '建立第一個計畫'],
    ['dispatch_draft_tasks', '完成草稿任務並派出'],
  ] as const)('外部協作看不到「%s」的寫入入口', async (step, label) => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({
        primary_step: step,
        viewer_permission_codes: [
          'project.read',
          'project_inspection_item.read',
          'project_zone.read',
          'inspection_plan.read',
          'inspection_task.read',
        ],
      }),
    )

    renderAt('/projects/project-1', {
      has_office_access: true,
      has_field_access: false,
    })

    await screen.findByRole('heading', { name: 'DEMO-001｜示範工程' })
    expectNoNextStepCard()
    expect(screen.queryByText(label)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: `前往${label}` }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: '成員' }),
    ).not.toBeInTheDocument()
  })

  it.each([
    ['add_members', 'project_member.manage', '/members'],
    ['create_plan', 'inspection_plan.create', '/planning'],
    ['dispatch_draft_tasks', 'inspection_task.dispatch', '/planning'],
  ] as const)('「%s」只在有 %s 時顯示入口', async (step, code, suffix) => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({
        primary_step: step,
        viewer_permission_codes: [
          'project.read',
          'inspection_plan.read',
          code,
        ],
      }),
    )

    renderAt('/projects/project-1', {
      has_office_access: true,
      has_field_access: false,
    })

    const link = await screen.findByRole('link', { name: /^前往/ })
    expect(link).toHaveAttribute('href', `/projects/project-1${suffix}`)
  })

  it('可編輯查核項目的成員會看到新增文案與入口', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({
        primary_step: 'add_inspection_items',
        can_apply_templates: true,
      }),
    )

    renderAt('/projects/project-1', {
      has_office_access: true,
      has_field_access: true,
    })

    expect(await screen.findByText('新增查核項目')).toBeVisible()
    expect(
      screen.getByRole('link', { name: '前往新增查核項目' }),
    ).toHaveAttribute('href', '/projects/project-1/inspection-items')
  })

  // 查核項目頁只有「從範本新增」；有專案編輯權但不能套用範本
  // （缺範本或查核模組）的人點進去沒有可用入口，所以不顯示。
  it('有專案編輯權但不能套用範本時不顯示新增查核項目入口', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({
        primary_step: 'add_inspection_items',
        can_apply_templates: false,
      }),
    )

    renderAt('/projects/project-1', {
      has_office_access: true,
      has_field_access: true,
    })

    await screen.findByRole('heading', { name: 'DEMO-001｜示範工程' })
    expectNoNextStepCard()
    expect(
      screen.queryByRole('link', { name: '前往新增查核項目' }),
    ).not.toBeInTheDocument()
  })

  it('leaves the role blank while the label list is loading', async () => {
    let resolveRoles: (roles: unknown[]) => void = () => {}
    mocks.listCompanyRoles.mockReturnValue(
      new Promise((resolve) => {
        resolveRoles = resolve
      }),
    )
    mocks.getWorkflowSummary.mockResolvedValue(summary())

    renderAt()

    expect(await screen.findByText(/本公司角色/)).toBeVisible()
    // 登記表還沒回來：不顯示英文值，也沒有中文標籤。
    expect(screen.queryByText('contractor')).toBeNull()
    expect(screen.queryByText('承攬施工方')).toBeNull()

    resolveRoles([
      {
        value: 'contractor',
        label: '承攬施工方',
        inspection_level: 'self_inspection',
      },
    ])
    expect(await screen.findByText('承攬施工方')).toBeVisible()
    expect(screen.queryByText('contractor')).toBeNull()
  })

  it('falls back to the role value when the label list cannot load', async () => {
    mocks.listCompanyRoles.mockRejectedValue(new Error('offline'))
    mocks.getWorkflowSummary.mockResolvedValue(summary())

    renderAt()

    expect(await screen.findByText('contractor')).toBeVisible()
  })

  it('reuses the home summary when navigating into a section', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(summary())

    renderAt()

    await screen.findByRole('heading', { name: 'DEMO-001｜示範工程' })
    fireEvent.click(screen.getByRole('link', { name: '測試導覽至計畫區段' }))

    expect(
      await screen.findByRole('heading', { name: '計畫與任務' }),
    ).toBeVisible()
    expect(mocks.getWorkflowSummary).toHaveBeenCalledTimes(1)
  })

  it('loads a fresh summary when navigating from one section to another', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(summary())

    renderAt()

    await screen.findByRole('heading', { name: 'DEMO-001｜示範工程' })
    fireEvent.click(screen.getByRole('link', { name: '計畫與任務' }))
    await screen.findByRole('heading', { name: '計畫與任務' })
    fireEvent.click(screen.getByRole('link', { name: '成員' }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '成員' })).toBeVisible(),
    )
    expect(mocks.getWorkflowSummary).toHaveBeenCalledTimes(2)
  })

  it('clears the summary after leaving and returning to a project route', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(summary())

    renderAt()

    await screen.findByRole('heading', { name: 'DEMO-001｜示範工程' })
    fireEvent.click(screen.getByRole('link', { name: '測試離開專案' }))
    expect(await screen.findByText('我的專案清單')).toBeVisible()
    fireEvent.click(screen.getByRole('link', { name: '測試返回專案首頁' }))

    expect(
      await screen.findByRole('heading', { name: 'DEMO-001｜示範工程' }),
    ).toBeVisible()
    expect(mocks.getWorkflowSummary).toHaveBeenCalledTimes(2)
  })

  it('shares a pending home summary with the first section request', async () => {
    let resolveSummary!: (value: WorkflowSummary) => void
    const pendingSummary = new Promise<WorkflowSummary>((resolve) => {
      resolveSummary = resolve
    })
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockReturnValue(pendingSummary)

    renderAt()

    await waitFor(() =>
      expect(mocks.getWorkflowSummary).toHaveBeenCalledTimes(1),
    )
    fireEvent.click(screen.getByRole('link', { name: '測試導覽至計畫區段' }))
    expect(mocks.getWorkflowSummary).toHaveBeenCalledTimes(1)
    resolveSummary(summary())

    expect(
      await screen.findByRole('heading', { name: '計畫與任務' }),
    ).toBeVisible()
    expect(mocks.getWorkflowSummary).toHaveBeenCalledTimes(1)
  })

  it('does not reuse a completed summary for a later home visit', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(summary())

    renderAt()

    await screen.findByRole('heading', { name: 'DEMO-001｜示範工程' })
    fireEvent.click(screen.getByRole('link', { name: '測試離開專案' }))
    expect(await screen.findByText('我的專案清單')).toBeVisible()
    fireEvent.click(screen.getByRole('link', { name: '測試返回專案首頁' }))

    expect(
      await screen.findByRole('heading', { name: 'DEMO-001｜示範工程' }),
    ).toBeVisible()
    expect(mocks.getWorkflowSummary).toHaveBeenCalledTimes(2)
  })

  it('does not share a summary between different project routes', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockImplementation(async (projectId: string) =>
      summary({
        project: {
          id: projectId,
          project_code: projectId === 'project-1' ? 'DEMO-001' : 'DEMO-002',
          name: projectId === 'project-1' ? '示範工程' : '另一個工程',
          company_role: 'contractor',
        },
      }),
    )

    renderAt()

    await screen.findByRole('heading', { name: 'DEMO-001｜示範工程' })
    fireEvent.click(screen.getByRole('link', { name: '測試導覽至另一專案' }))

    expect(
      await screen.findByRole('heading', { name: 'DEMO-002｜另一個工程' }),
    ).toBeVisible()
    expect(mocks.getWorkflowSummary).toHaveBeenNthCalledWith(1, 'project-1')
    expect(mocks.getWorkflowSummary).toHaveBeenNthCalledWith(2, 'project-2')
  })

  it('refreshes permissions after the short summary cache expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(0))
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(summary())

    renderAt()

    await screen.findByRole('heading', { name: 'DEMO-001｜示範工程' })
    vi.setSystemTime(new Date(30_001))
    fireEvent.click(screen.getByRole('link', { name: '計畫與任務' }))

    expect(
      await screen.findByRole('heading', { name: '計畫與任務' }),
    ).toBeVisible()
    expect(mocks.getWorkflowSummary).toHaveBeenCalledTimes(2)
  })

  it('retries after a failed home summary instead of reusing the failure', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(summary())

    renderAt()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法連線到伺服器，請稍後再試。',
    )
    fireEvent.click(screen.getByRole('link', { name: '測試導覽至計畫區段' }))

    expect(
      await screen.findByRole('heading', { name: '計畫與任務' }),
    ).toBeVisible()
    expect(mocks.getWorkflowSummary).toHaveBeenCalledTimes(2)
  })

  it('shows the project identity, primary draft action and key numbers', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(summary())

    renderAt()

    expect(
      await screen.findByRole('heading', { name: 'DEMO-001｜示範工程' }),
    ).toBeVisible()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByText('完成草稿任務並派出')).toBeVisible()
    expect(
      screen.getByRole('link', {
        name: '前往完成草稿任務並派出',
      }),
    ).toHaveAttribute('href', '/projects/project-1/planning')
    expect(screen.getByText('啟用成員', { selector: 'dt' })).toBeVisible()
    expect(screen.getByText('2 人')).toBeVisible()
    expect(screen.getByText('3 項')).toBeVisible()
    expect(screen.getByText('4 件')).toBeVisible()
    expect(screen.getByText('草稿任務').parentElement).toHaveTextContent(
      '4 件未指派 2 件',
    )
  })

  it.each([
    ['/projects/project-1', '專案首頁'],
    ['/projects/project-1/members', '成員'],
    ['/projects/project-1/inspection-items', '查核項目'],
    ['/projects/project-1/planning', '計畫與任務'],
  ])('marks only %s as the current project section', async (path, label) => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(summary())

    renderAt(path)

    await screen.findByRole('heading', { name: /DEMO-001｜示範工程/ })
    const currentLinks = screen.getAllByRole('link', { current: 'page' })
    expect(currentLinks).toHaveLength(1)
    expect(currentLinks[0]).toHaveAccessibleName(label)
  })

  it('keeps the item list visible without edit permission', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({
        viewer_permission_codes: ['project_zone.read', 'inspection_plan.read'],
      }),
    )

    renderAt()

    await screen.findByRole('heading', { name: 'DEMO-001｜示範工程' })
    expect(
      screen.queryByRole('link', { name: '成員' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查核項目' })).toBeVisible()
    expect(screen.getByRole('link', { name: '計畫與任務' })).toBeVisible()
    expect(
      screen.queryByRole('link', { name: '進度' }),
    ).not.toBeInTheDocument()
  })

  it('shows progress only with task read permission', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(summary())

    renderAt()

    await screen.findByRole('heading', { name: 'DEMO-001｜示範工程' })
    expect(screen.getByRole('link', { name: '分區' })).toBeVisible()
    expect(screen.getByRole('link', { name: '進度' })).toHaveAttribute(
      'href',
      '/projects/project-1/progress',
    )
    expect(screen.getByRole('link', { name: '計畫與任務' })).toBeVisible()
  })

  it('hides the zones section without zone read or manage permission', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({
        viewer_permission_codes: ['inspection_plan.read'],
      }),
    )

    renderAt()

    await screen.findByRole('heading', { name: 'DEMO-001｜示範工程' })
    expect(
      screen.queryByRole('link', { name: '分區' }),
    ).not.toBeInTheDocument()
  })

  it.each([
    ['add_members', '加入專案成員', '前往加入專案成員'],
    ['add_inspection_items', '新增查核項目', '前往新增查核項目'],
    ['create_plan', '建立第一個計畫', '前往建立第一個計畫'],
    ['dispatch_draft_tasks', '完成草稿任務並派出', '前往完成草稿任務並派出'],
    ['complete_reinspection', '追蹤任務進度', '前往追蹤任務進度'],
  ] as const)('uses primary step %s', async (code, label, action) => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({ primary_step: code, can_apply_templates: true }),
    )

    renderAt()

    expect(await screen.findByText(label)).toBeVisible()
    expect(screen.getByRole('link', { name: action })).toBeVisible()
  })

  it('shows no task access instead of presenting hidden task counts as zero', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({ task_counts_visible: false }),
    )

    renderAt()

    expect(await screen.findByText('無權查看任務')).toBeVisible()
    expect(screen.queryByText('草稿任務')).not.toBeInTheDocument()
    expect(screen.queryByText('待重查')).not.toBeInTheDocument()
  })

  it('shows visible task counts without progress links when read access is absent', async () => {
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({
        viewer_permission_codes: [
          'project_member.manage',
          'inspection_task.inspect',
          'inspection_task.dispatch',
        ],
      }),
    )

    renderAt('/projects/project-1', {
      has_office_access: true,
      has_field_access: false,
    })

    expect(await screen.findByText('待重查')).toBeVisible()
    expect(screen.getByText('4 件')).toBeVisible()
    const dispatchedCount = screen.getByText('已派出未完成').parentElement
    expect(dispatchedCount).toHaveTextContent('待開始 2')
    expect(dispatchedCount).toHaveTextContent('進行中 1')
    expect(
      within(screen.getByLabelText('專案關鍵數字')).queryByRole('link'),
    ).not.toBeInTheDocument()
  })

  it('links each homepage task count to its matching progress filter', async () => {
    mocks.getWorkflowSummary.mockResolvedValue(summary())
    renderAt()

    expect(
      await screen.findByRole('link', { name: '待開始 2' }),
    ).toHaveAttribute('href', '/projects/project-1/progress?status=PENDING')
    expect(screen.getByRole('link', { name: '進行中 1' })).toHaveAttribute(
      'href',
      '/projects/project-1/progress?status=IN_PROGRESS',
    )
    expect(screen.getByRole('link', { name: '4 件' })).toHaveAttribute(
      'href',
      '/projects/project-1/progress?status=DRAFT',
    )
    expect(screen.getByRole('link', { name: '1 件' })).toHaveAttribute(
      'href',
      '/projects/project-1/progress?status=reinspection',
    )
  })

  it('uses planning when a reinspection step lacks task read', async () => {
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({
        primary_step: 'complete_reinspection',
        viewer_permission_codes: ['inspection_plan.read'],
      }),
    )
    renderAt()
    expect(
      await screen.findByRole('link', {
        name: '前往追蹤任務進度',
      }),
    ).toHaveAttribute('href', '/projects/project-1/planning')
  })

  it('sends all-complete projects to progress', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(summary({ primary_step: null }))

    renderAt()

    expect(await screen.findByText('目前沒有待處理的下一步。')).toBeVisible()
    expect(screen.getByRole('link', { name: '追蹤進度' })).toHaveAttribute(
      'href',
      '/projects/project-1/progress',
    )
  })

  // ADM-R16：全部完成但沒有任何進度相關讀取權限時，不放空卡。
  it('全部完成且沒有進度或計畫讀取權限時不顯示下一步卡', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({
        primary_step: null,
        viewer_permission_codes: ['project.read'],
      }),
    )

    renderAt('/projects/project-1', {
      has_office_access: true,
      has_field_access: false,
    })

    await screen.findByRole('heading', { name: 'DEMO-001｜示範工程' })
    expectNoNextStepCard()
  })

  it('全部完成但只有計畫讀取權限時追蹤進度改連計畫與任務', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({
        primary_step: null,
        viewer_permission_codes: ['project.read', 'inspection_plan.read'],
      }),
    )

    renderAt('/projects/project-1', {
      has_office_access: true,
      has_field_access: false,
    })

    expect(
      await screen.findByRole('link', { name: '追蹤進度' }),
    ).toHaveAttribute('href', '/projects/project-1/planning')
  })

  it('routes field-only permission sets to Field and skips project detail reads', async () => {
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({
        viewer_permission_codes: [
          'inspection_task.inspect',
          'inspection_task.read',
        ],
      }),
    )

    renderAt()

    expect(await screen.findByText('Field 工作台')).toBeVisible()
    expect(mocks.getProject).not.toHaveBeenCalled()
  })

  it('uses the filtered summary after project module access is revoked', async () => {
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({
        viewer_permission_codes: ['project.read'],
        task_counts_visible: false,
        primary_step: null,
      }),
    )

    renderAt('/projects/project-1', {
      has_office_access: false,
      has_field_access: true,
    })

    expect(
      await screen.findByRole('heading', { name: '專案首頁' }),
    ).toBeVisible()
    expect(screen.getByText('無權查看任務')).toBeVisible()
    expect(screen.queryByText('Field 工作台')).not.toBeInTheDocument()
  })

  // ADM-R16、ADM-R49：外部協作的專案查閱人員看得到草稿、未指派、
  // 待重查的數字（後端以 inspection_task.read 決定），但沒有任何
  // 寫入入口（沒有下一步卡、也沒有前往規劃頁的連結）。
  it('外部協作看得到任務數字但沒有可點的寫入入口', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({
        primary_step: 'dispatch_draft_tasks',
        viewer_permission_codes: [
          'project.read',
          'project_inspection_item.read',
          'project_zone.read',
          'inspection_plan.read',
          'inspection_task.read',
        ],
      }),
    )

    renderAt('/projects/project-1', {
      has_office_access: true,
      has_field_access: false,
    })

    await screen.findByRole('heading', { name: 'DEMO-001｜示範工程' })
    expectNoNextStepCard()
    const numbers = within(screen.getByLabelText('專案關鍵數字'))
    expect(numbers.getByText('已派出未完成')).toBeVisible()
    expect(numbers.getByText('草稿任務')).toBeVisible()
    expect(numbers.getByText(/未指派/)).toBeVisible()
    expect(numbers.getByText('待重查')).toBeVisible()
    for (const link of numbers.queryAllByRole('link')) {
      expect(link.getAttribute('href')).not.toMatch(/planning|members/)
    }
    expect(
      screen.queryByRole('link', { name: /^前往/ }),
    ).not.toBeInTheDocument()
  })

  it('有 inspection_task.read 的人看得到草稿任務與待重查', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({
        viewer_permission_codes: [
          'project.read',
          'inspection_plan.read',
          'inspection_task.read',
        ],
      }),
    )

    renderAt('/projects/project-1', {
      has_office_access: true,
      has_field_access: false,
    })

    expect(await screen.findByText('草稿任務')).toBeVisible()
    expect(screen.getByText('待重查')).toBeVisible()
  })

  it('complete_reinspection step opens the reinspection filter', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({ primary_step: 'complete_reinspection' }),
    )

    renderAt()

    expect(
      await screen.findByRole('link', { name: '前往追蹤任務進度' }),
    ).toHaveAttribute(
      'href',
      '/projects/project-1/progress?status=reinspection',
    )
  })

  it('office access alone keeps field users on task home', async () => {
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({ viewer_permission_codes: ['inspection_task.inspect'] }),
    )

    renderAt('/projects/project-1', {
      has_office_access: true,
      has_field_access: true,
      has_project_access: true,
      can_manage_project_planning_or_members: false,
    })

    expect(await screen.findByText('Field 工作台')).toBeVisible()
  })

  it('opens the mobile section menu with keyboard-accessible links', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(summary())

    renderAt()
    const button = await screen.findByRole('button', {
      name: '切換專案頁面，目前在專案首頁',
    })
    expect(button).toHaveTextContent('專案首頁 ▾')
    fireEvent.click(button)

    expect(button).toHaveTextContent('專案首頁 ▴')
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen
        .getAllByRole('link', { name: '計畫與任務' })
        .some(
          (link) =>
            link.getAttribute('href') === '/projects/project-1/planning',
        ),
    ).toBe(true)
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() =>
      expect(button).toHaveAttribute('aria-expanded', 'false'),
    )
  })

  it('redirects field-only users from deep-linked indoor sections', async () => {
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({ viewer_permission_codes: ['inspection_task.inspect'] }),
    )

    renderAt('/projects/project-1/members')

    expect(await screen.findByText('Field 工作台')).toBeVisible()
    expect(mocks.getProject).not.toHaveBeenCalled()
  })

  it('redirects field-only users from the deep-linked zones section', async () => {
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({ viewer_permission_codes: ['inspection_task.inspect'] }),
    )

    renderAt('/projects/project-1/zones')

    expect(await screen.findByText('Field 工作台')).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: '分區' }),
    ).not.toBeInTheDocument()
  })

  it('redirects field-only users from an item detail deep link', async () => {
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({ viewer_permission_codes: ['inspection_task.inspect'] }),
    )

    renderAt('/projects/project-1/inspection-items/item-1')

    expect(await screen.findByText('Field 工作台')).toBeVisible()
    expect(screen.queryByText('查核項目細節')).not.toBeInTheDocument()
  })

  it('shows the project access denied page for a forbidden summary', async () => {
    mocks.getWorkflowSummary.mockRejectedValue(
      new ManagementApiError(403, 'permission.denied'),
    )

    renderAt()

    expect(
      await screen.findByRole('heading', { name: '無權限' }),
    ).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent(
      '你沒有使用這個頁面的權限',
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('link', { name: '回到我的首頁' })).toHaveAttribute(
      'href',
      '/tasks',
    )
  })

  it('does not invent project permissions when a section summary fails', async () => {
    mocks.getWorkflowSummary
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(summary())

    renderAt('/projects/project-1/progress')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('無法連線到伺服器')
    expect(screen.getByRole('button', { name: '重新載入' })).toBeVisible()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: '進度' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新載入' }))
    expect(
      await screen.findByRole('heading', { name: 'DEMO-001｜示範工程' }),
    ).toBeVisible()
  })
})
