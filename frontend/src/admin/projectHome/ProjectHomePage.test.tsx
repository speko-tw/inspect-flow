import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
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
}))

vi.mock('../projects/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/api')>()),
  getProject: mocks.getProject,
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
  planned_start_date: null,
  planned_completion_date: null,
  warnings: [],
}

function summary(overrides: Partial<WorkflowSummary> = {}): WorkflowSummary {
  return {
    project: {
      id: 'project-1',
      project_code: 'DEMO-001',
      name: '示範工程',
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
    draft_tasks_missing_assignee: 2,
    viewer_permission_codes: [
      'project_member.manage',
      'project_inspection_item.edit',
      'project_zone.read',
      'inspection_plan.read',
      'inspection_task.read',
    ],
    ...overrides,
  }
}

function renderAt(
  path = '/admin/projects/project-1',
  access: { has_office_access: boolean; has_field_access: boolean } = {
    has_office_access: false,
    has_field_access: true,
  },
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CurrentUserProvider
        value={{ user: currentUserFixture(access), clear: vi.fn() }}
      >
        <WorkflowSummaryProvider>
          <main>
            <Link
              aria-label="測試導覽至另一專案"
              to="/admin/projects/project-2"
            >
              切換專案
            </Link>
            <Link
              aria-label="測試導覽至計畫區段"
              to="/admin/projects/project-1/planning"
            >
              開啟計畫區段
            </Link>
            <Link
              aria-label="測試導覽至成員區段"
              to="/admin/projects/project-1/members"
            >
              開啟成員區段
            </Link>
            <Link aria-label="測試離開專案" to="/admin/projects">
              離開專案
            </Link>
            <Link aria-label="測試返回專案首頁" to="/admin/projects/project-1">
              返回專案首頁
            </Link>
            <Routes>
              <Route
                element={<ProjectHomePage />}
                path="/admin/projects/:projectId"
              />
              <Route
                element={<ProjectSectionPage section="members" />}
                path="/admin/projects/:projectId/members"
              />
              <Route
                element={<ProjectSectionPage section="inspection-items" />}
                path="/admin/projects/:projectId/inspection-items"
              />
              <Route
                element={<ProjectSectionPage section="zones" />}
                path="/admin/projects/:projectId/zones"
              />
              <Route
                element={<ProjectSectionPage section="planning" />}
                path="/admin/projects/:projectId/planning"
              />
              <Route
                element={<ProjectSectionPage section="progress" />}
                path="/admin/projects/:projectId/progress"
              />
              <Route
                element={
                  <ProjectSectionPage section="inspection-items">
                    <p>查核項目細節</p>
                  </ProjectSectionPage>
                }
                path="/admin/projects/:projectId/inspection-items/:itemId"
              />
              <Route element={<p>Field 工作台</p>} path="/field" />
              <Route element={<p>我的專案清單</p>} path="/admin/projects" />
            </Routes>
          </main>
        </WorkflowSummaryProvider>
      </CurrentUserProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('project home', () => {
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

    expect(await screen.findByRole('heading', { name: '成員' })).toBeVisible()
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
    ).toHaveAttribute('href', '/admin/projects/project-1/planning')
    expect(screen.getByText('2 人')).toBeVisible()
    expect(screen.getByText('3 項')).toBeVisible()
    expect(screen.getByText('4 件')).toBeVisible()
    expect(screen.getByText('草稿任務').parentElement).toHaveTextContent(
      '4 件未指派 2 件',
    )
  })

  it.each([
    ['/admin/projects/project-1', '專案首頁'],
    ['/admin/projects/project-1/members', '成員'],
    ['/admin/projects/project-1/inspection-items', '查核項目'],
    ['/admin/projects/project-1/planning', '計畫與任務'],
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

  it('shows permitted zones and keeps the placeholder progress hidden', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(summary())

    renderAt()

    await screen.findByRole('heading', { name: 'DEMO-001｜示範工程' })
    expect(screen.getByRole('link', { name: '分區' })).toBeVisible()
    expect(
      screen.queryByRole('link', { name: '進度' }),
    ).not.toBeInTheDocument()
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
    mocks.getWorkflowSummary.mockResolvedValue(summary({ primary_step: code }))

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

  it('sends all-complete projects to planning, never to a placeholder', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(summary({ primary_step: null }))

    renderAt()

    expect(await screen.findByText('目前沒有待處理的下一步。')).toBeVisible()
    expect(
      screen.getByRole('link', { name: '查看計畫與任務' }),
    ).toHaveAttribute('href', '/admin/projects/project-1/planning')
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

  it('complete_reinspection step points at planning, not progress', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({ primary_step: 'complete_reinspection' }),
    )

    renderAt()

    expect(
      await screen.findByRole('link', { name: '前往追蹤任務進度' }),
    ).toHaveAttribute('href', '/admin/projects/project-1/planning')
  })

  it('sends an office user with field-only rights in this project to the project list', async () => {
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({ viewer_permission_codes: ['inspection_task.inspect'] }),
    )

    renderAt('/admin/projects/project-1', {
      has_office_access: true,
      has_field_access: true,
    })

    expect(await screen.findByText('我的專案清單')).toBeVisible()
  })

  it('opens the mobile section menu with keyboard-accessible links', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(summary())

    renderAt()
    const button = await screen.findByRole('button', { name: '區段選單' })
    fireEvent.click(button)

    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen
        .getAllByRole('link', { name: '計畫與任務' })
        .some(
          (link) =>
            link.getAttribute('href') === '/admin/projects/project-1/planning',
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

    renderAt('/admin/projects/project-1/members')

    expect(await screen.findByText('Field 工作台')).toBeVisible()
    expect(mocks.getProject).not.toHaveBeenCalled()
  })

  it('redirects field-only users from the deep-linked zones section', async () => {
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({ viewer_permission_codes: ['inspection_task.inspect'] }),
    )

    renderAt('/admin/projects/project-1/zones')

    expect(await screen.findByText('Field 工作台')).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: '分區' }),
    ).not.toBeInTheDocument()
  })

  it('redirects field-only users from an item detail deep link', async () => {
    mocks.getWorkflowSummary.mockResolvedValue(
      summary({ viewer_permission_codes: ['inspection_task.inspect'] }),
    )

    renderAt('/admin/projects/project-1/inspection-items/item-1')

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
    expect(screen.getByRole('alert')).toHaveTextContent(
      '你沒有權限執行這項操作。',
    )
    // 有出路：依權限回到落點，不再固定回 /field（#480）。
    expect(screen.getByRole('link', { name: '返回今日任務' })).toHaveAttribute(
      'href',
      '/field',
    )
  })
})
