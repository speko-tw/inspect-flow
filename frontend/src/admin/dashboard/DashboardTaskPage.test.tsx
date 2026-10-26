import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HttpError } from '../../http'
import { currentUserFixture } from '../../testing/contractFixtures'
import { CurrentUserProvider } from '../../auth/useCurrentUser'
import DashboardTaskPage from './DashboardTaskPage'

const api = vi.hoisted(() => ({
  getDashboardTask: vi.fn(),
  listDashboardProjects: vi.fn(),
  listDashboardTasks: vi.fn(),
}))

vi.mock('./api', () => api)

const project = {
  project_id: 'project-1',
  name: '新竹廠一期',
  pending_count: 1,
  in_progress_count: 1,
  completed_count: 0,
  completion_denominator_count: 2,
  completion_rate: 0,
}

const task = {
  task_id: 'task-2048',
  status: 'IN_PROGRESS',
  location: { zone_name: 'A 棟', location_text: '二樓機房' },
  suggested_assignee: { user_id: 'user-1', name_zh: '陳建宏' },
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          element={
            <CurrentUserProvider
              value={{
                user: currentUserFixture({
                  is_admin: true,
                  has_office_access: true,
                }),
                clear: vi.fn(),
              }}
            >
              <DashboardTaskPage />
            </CurrentUserProvider>
          }
          path="/overview/projects/:projectId/tasks"
        />
        <Route
          element={
            <CurrentUserProvider
              value={{
                user: currentUserFixture({
                  is_admin: true,
                  has_office_access: true,
                }),
                clear: vi.fn(),
              }}
            >
              <DashboardTaskPage />
            </CurrentUserProvider>
          }
          path="/overview/projects/:projectId/tasks/:taskId"
        />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  api.listDashboardProjects.mockResolvedValue({ items: [project] })
  api.listDashboardTasks.mockResolvedValue({
    items: [task],
    next_cursor: null,
  })
  api.getDashboardTask.mockResolvedValue(task)
})

describe('Dashboard 任務唯讀頁', () => {
  it('主管可從任務清單點進唯讀明細', async () => {
    renderAt('/overview/projects/project-1/tasks')

    fireEvent.click(await screen.findByRole('link', { name: /二樓機房/ }))

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'A 棟・二樓機房',
      }),
    ).toBeInTheDocument()
    expect(api.getDashboardTask).toHaveBeenCalledWith('project-1', 'task-2048')
  })

  it('依 API 顯示任務清單與四項白名單明細', async () => {
    renderAt('/overview/projects/project-1/tasks/task-2048')

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'A 棟・二樓機房',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText('管理後台')).not.toBeInTheDocument()
    // #713：任務編號是內部識別，清單與明細都不顯示。
    expect(screen.queryByText(/任務編號/)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('task-2048')
    expect(
      screen.queryByRole('heading', { name: 'task-2048' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: '新竹廠一期' }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('進行中').length).toBeGreaterThan(0)
    expect(
      within(screen.getByRole('region', { name: '任務清單' })).getByText(
        'A 棟・二樓機房',
      ),
    ).toBeInTheDocument()
    expect(screen.getAllByText('陳建宏').length).toBeGreaterThan(0)
    expect(screen.getByText('全部進度・唯讀')).toBeInTheDocument()
    expect(screen.getAllByText('唯讀')).toHaveLength(1)
    expect(screen.getAllByText(/照片與查核結果/)).toHaveLength(2)
    expect(api.listDashboardTasks).toHaveBeenCalledWith('project-1', {
      limit: 50,
    })
    expect(api.getDashboardTask).toHaveBeenCalledWith('project-1', 'task-2048')
  })

  // #713：指派人姓名為空時不得退回顯示 user_id；專案名稱取不到時
  // 不得顯示專案 UUID。
  it('指派人沒有姓名時顯示未指派，專案名稱取不到時顯示通用文字', async () => {
    const projectUuid = '3f2b8a9e-1c4d-4e6f-9a7b-0d5c2e1f8a63'
    const userUuid = '7c1d9e2a-5b3f-4a8c-8d6e-1f0a2b3c4d5e'
    const unnamed = {
      ...task,
      suggested_assignee: { user_id: userUuid, name_zh: null },
    }
    api.listDashboardProjects.mockResolvedValue({ items: [] })
    api.listDashboardTasks.mockResolvedValue({
      items: [unnamed],
      next_cursor: null,
    })
    api.getDashboardTask.mockResolvedValue(unnamed)
    renderAt(`/overview/projects/${projectUuid}/tasks/task-2048`)

    expect(
      await screen.findByRole('heading', { level: 2, name: 'A 棟・二樓機房' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(api.listDashboardProjects).toHaveBeenCalled())
    expect(screen.getAllByText('未指派').length).toBeGreaterThan(0)
    expect(
      screen.getByRole('heading', { level: 1, name: '這個專案' }),
    ).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(projectUuid)
    expect(document.body.textContent).not.toContain(userUuid)
    expect(document.body.textContent).not.toContain('task-2048')
  })

  it('提供手機逐層詳情與返回清單操作', async () => {
    const { container } = renderAt(
      '/overview/projects/project-1/tasks/task-2048',
    )

    await screen.findByRole('heading', { name: 'A 棟・二樓機房' })
    expect(
      container.querySelector('[data-active-pane="detail"]'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '返回任務清單' }))
    await waitFor(() =>
      expect(
        container.querySelector('[data-active-pane="list"]'),
      ).toBeInTheDocument(),
    )
  })

  it('呈現空清單狀態', async () => {
    api.listDashboardTasks.mockResolvedValue({ items: [], next_cursor: null })
    renderAt('/overview/projects/project-1/tasks')

    expect(
      await screen.findByText('此專案目前沒有可查看的任務。'),
    ).toBeInTheDocument()
    expect(api.getDashboardTask).not.toHaveBeenCalled()
  })

  it('失敗時可重試清單載入', async () => {
    api.listDashboardTasks
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [task], next_cursor: null })
    renderAt('/overview/projects/project-1/tasks')

    const retryOptions = { name: '重新載入' }
    const retryButton = await screen.findByRole('button', retryOptions)
    fireEvent.click(retryButton)
    expect(await screen.findByText('A 棟・二樓機房')).toBeInTheDocument()
    expect(screen.queryByText(/任務編號/)).not.toBeInTheDocument()
    expect(api.listDashboardTasks).toHaveBeenCalledTimes(2)
  })

  it('權限撤回後直接開啟明細會顯示無權限', async () => {
    api.getDashboardTask.mockRejectedValue(new HttpError(403))
    renderAt('/overview/projects/project-1/tasks/task-2048')

    expect(
      await screen.findByText('你沒有使用這個頁面的權限'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '回到我的首頁' })).toHaveAttribute(
      'href',
      '/overview',
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('陳建宏')).not.toBeInTheDocument()
  })
})

it.each([
  ['COMPLETED', false],
  ['CANCELLED', false],
  ['PENDING', true],
  ['PENDING', false],
])('主管總覽停用提醒依 %s、封存 %s 判斷', async (status, plan_archived) => {
  api.listDashboardTasks.mockResolvedValue({
    items: [
      {
        ...task,
        status,
        plan_archived,
        suggested_assignee: {
          ...task.suggested_assignee,
          is_active: false,
        },
      },
    ],
    next_cursor: null,
  })
  renderAt('/overview/projects/project-1/tasks')
  const warning = !plan_archived && status === 'PENDING'
  expect(
    await screen.findByText(warning ? '（已停用，請改派）' : '（已停用）'),
  ).toBeVisible()
  if (!warning) expect(screen.queryByText(/請改派/)).toBeNull()
})
