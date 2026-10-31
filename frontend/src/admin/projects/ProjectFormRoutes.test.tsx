import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CurrentUserProvider } from '../../auth/useCurrentUser'
import { DataMemoryRouter } from '../../testing/DataMemoryRouter'
import { currentUserFixture } from '../../testing/contractFixtures'
import ProjectHomePage from '../projectHome/ProjectHomePage'
import { WorkflowSummaryProvider } from '../projectHome/WorkflowSummaryProvider'
import type { WorkflowSummary } from '../projectHome/api'
import ProjectCreatePage from './ProjectCreatePage'
import type { Project } from './api'

const api = vi.hoisted(() => ({
  createProject: vi.fn(),
  getProject: vi.fn(),
  getWorkflowSummary: vi.fn(),
  listCompanyRoles: vi.fn(),
}))

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  createProject: api.createProject,
  getProject: api.getProject,
  listCompanyRoles: api.listCompanyRoles,
}))

vi.mock('../projectHome/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projectHome/api')>()),
  getWorkflowSummary: api.getWorkflowSummary,
}))

const createdProject: Project = {
  id: 'project-2',
  project_code: 'DEMO-002',
  name: '新建工程',
  client_name: '示範業主',
  site_location: '新建工地',
  company_role: 'contractor',
  planned_start_date: null,
  planned_completion_date: null,
  warnings: [],
}

const workflowSummary: WorkflowSummary = {
  project: {
    id: createdProject.id,
    project_code: createdProject.project_code,
    name: createdProject.name,
    company_role: createdProject.company_role,
  },
  member_count: 0,
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
  viewer_permission_codes: ['project.read', 'project.update'],
  can_apply_templates: false,
}

function RouteStateProbe() {
  const location = useLocation()
  return (
    <output data-testid="route-state">{JSON.stringify(location.state)}</output>
  )
}

describe('dedicated project create route integration', () => {
  afterEach(() => vi.clearAllMocks())

  it('consumes the real create notice and does not replay it after remount', async () => {
    api.createProject.mockResolvedValue(createdProject)
    api.getProject.mockResolvedValue(createdProject)
    api.getWorkflowSummary.mockResolvedValue(workflowSummary)
    api.listCompanyRoles.mockResolvedValue([
      {
        value: 'contractor',
        label: '承攬施工方',
        inspection_level: 'self_inspection',
      },
    ])

    render(
      <DataMemoryRouter initialEntries={['/projects/new']}>
        <CurrentUserProvider
          value={{
            user: currentUserFixture({
              has_office_access: true,
              has_field_access: true,
              can_create_project: true,
            }),
            clear: vi.fn(),
          }}
        >
          <WorkflowSummaryProvider>
            <main>
              <Link aria-label="離開專案首頁" to="/projects">
                離開專案首頁
              </Link>
              <Routes>
                <Route element={<ProjectCreatePage />} path="/projects/new" />
                <Route
                  element={
                    <>
                      <ProjectHomePage />
                      <RouteStateProbe />
                    </>
                  }
                  path="/projects/:projectId"
                />
                <Route
                  element={
                    <Link to="/projects/project-2">重新開啟專案首頁</Link>
                  }
                  path="/projects"
                />
              </Routes>
            </main>
          </WorkflowSummaryProvider>
        </CurrentUserProvider>
      </DataMemoryRouter>,
    )

    fireEvent.change(await screen.findByLabelText(/專案代號/), {
      target: { value: createdProject.project_code },
    })
    fireEvent.change(screen.getByLabelText(/工程名稱/), {
      target: { value: createdProject.name },
    })
    fireEvent.change(screen.getByLabelText(/業主／委託單位/), {
      target: { value: createdProject.client_name },
    })
    fireEvent.change(screen.getByLabelText(/整體工程地點/), {
      target: { value: createdProject.site_location },
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '新增專案' })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: '新增專案' }))

    expect(
      await screen.findByText('已建立專案「新建工程」', {
        selector: 'p.notice-success',
      }),
    ).toBeVisible()
    await waitFor(() =>
      expect(screen.getByTestId('route-state')).toHaveTextContent('null'),
    )
    fireEvent.click(screen.getByRole('link', { name: '離開專案首頁' }))
    fireEvent.click(screen.getByRole('link', { name: '重新開啟專案首頁' }))

    await screen.findByRole('heading', { name: '專案首頁' })
    expect(
      screen.queryByText('已建立專案「新建工程」'),
    ).not.toBeInTheDocument()
    expect(api.createProject).toHaveBeenCalledTimes(1)
  })
})
