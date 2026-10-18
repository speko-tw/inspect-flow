import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HttpError } from '../../http'
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
          element={<DashboardTaskPage />}
          path="/admin/dashboard/projects/:projectId/tasks"
        />
        <Route
          element={<DashboardTaskPage />}
          path="/admin/dashboard/projects/:projectId/tasks/:taskId"
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
  it('依 API 顯示任務清單與四項白名單明細', async () => {
    renderAt('/admin/dashboard/projects/project-1/tasks/task-2048')

    expect(
      await screen.findByRole('heading', { name: 'task-2048' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: '新竹廠一期' }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('進行中').length).toBeGreaterThan(0)
    expect(screen.getByText('A 棟・二樓機房')).toBeInTheDocument()
    expect(screen.getAllByText('陳建宏').length).toBeGreaterThan(0)
    expect(screen.getAllByText('唯讀').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/照片與查核結果/)).toHaveLength(2)
    expect(api.listDashboardTasks).toHaveBeenCalledWith('project-1', {
      limit: 50,
    })
    expect(api.getDashboardTask).toHaveBeenCalledWith('project-1', 'task-2048')
  })

  it('提供手機逐層詳情與返回清單操作', async () => {
    const { container } = renderAt(
      '/admin/dashboard/projects/project-1/tasks/task-2048',
    )

    await screen.findByRole('heading', { name: 'task-2048' })
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
    renderAt('/admin/dashboard/projects/project-1/tasks')

    expect(
      await screen.findByText('此專案目前沒有可查看的任務。'),
    ).toBeInTheDocument()
    expect(api.getDashboardTask).not.toHaveBeenCalled()
  })

  it('失敗時可重試清單載入', async () => {
    api.listDashboardTasks
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [task], next_cursor: null })
    renderAt('/admin/dashboard/projects/project-1/tasks')

    const retryOptions = { name: '重新載入' }
    const retryButton = await screen.findByRole('button', retryOptions)
    fireEvent.click(retryButton)
    expect(await screen.findByText('task-2048')).toBeInTheDocument()
    expect(api.listDashboardTasks).toHaveBeenCalledTimes(2)
  })

  it('權限撤回後直接開啟明細會顯示無權限', async () => {
    api.getDashboardTask.mockRejectedValue(new HttpError(403))
    renderAt('/admin/dashboard/projects/project-1/tasks/task-2048')

    const deniedHeading = await screen.findByRole('heading', {
      name: '目前無法查看專案進度',
    })
    expect(deniedHeading).toBeInTheDocument()
    expect(screen.queryByText('陳建宏')).not.toBeInTheDocument()
  })
})
