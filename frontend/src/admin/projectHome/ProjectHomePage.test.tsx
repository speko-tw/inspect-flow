import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Project } from '../projects/api'
import { ManagementApiError } from '../api'
import ProjectHomePage from './ProjectHomePage'
import ProjectSectionPage from './ProjectSectionPage'
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
    viewer_permission_codes: ['inspection_plan.read', 'inspection_task.read'],
    ...overrides,
  }
}

function renderAt(path = '/admin/projects/project-1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <main>
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
            element={
              <ProjectSectionPage section="inspection-items">
                <p>查核項目細節</p>
              </ProjectSectionPage>
            }
            path="/admin/projects/:projectId/inspection-items/:itemId"
          />
          <Route element={<p>Field 工作台</p>} path="/field" />
        </Routes>
      </main>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('project home', () => {
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
    expect(
      screen
        .getAllByRole('link', { name: '專案首頁' })
        .some((link) => link.getAttribute('aria-current') === 'page'),
    ).toBe(true)
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

  it('shows progress as the next action when all steps are complete', async () => {
    mocks.getProject.mockResolvedValue(project)
    mocks.getWorkflowSummary.mockResolvedValue(summary({ primary_step: null }))

    renderAt()

    expect(await screen.findByText('目前沒有待處理的下一步。')).toBeVisible()
    expect(screen.getByRole('link', { name: '追蹤進度' })).toHaveAttribute(
      'href',
      '/admin/projects/project-1/progress',
    )
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
  })
})
