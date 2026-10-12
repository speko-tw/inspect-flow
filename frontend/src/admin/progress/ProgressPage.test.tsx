import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'

import type { InspectionTask } from '../planning/api'
import type { WorkflowSummary } from '../projectHome/api'
import ProgressPage from './ProgressPage'
import progressContract from './fixtures/project-progress-contract.json'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  summary: vi.fn(),
}))

vi.mock('./api', () => ({ listProgressTasks: mocks.list }))
vi.mock('../planning/api', () => ({
  planningClient: { getTask: mocks.detail },
}))
vi.mock('../projectHome/api', () => ({
  getWorkflowSummary: mocks.summary,
}))
vi.mock('../../auth/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'viewer' } }),
}))

const projectId = '11111111-1111-7111-8111-111111111111'
const taskId = '22222222-2222-7222-8222-222222222222'

function task(): InspectionTask {
  return {
    id: taskId,
    project_id: projectId,
    plan_id: '33333333-3333-7333-8333-333333333333',
    plan: {
      id: '33333333-3333-7333-8333-333333333333',
      name: '北區計畫',
      archived: false,
    },
    item_summary: progressContract.item_summary,
    status: 'PENDING',
    items: [
      {
        id: 'item-1',
        status: 'PENDING',
        needs_reinspection: true,
        snapshots: [],
        current_snapshot: {
          revision: 1,
          source_standard_revision: 1,
          title: '表面檢查',
          instruction: '',
          source_template_name: '',
          is_current: true,
          inspection_points: [],
        },
      },
    ],
    assignee_id: null,
    assignee: null,
    zone_id: null,
    zone: null,
    location_text: null,
    cancellation_reason: null,
    cancelled_from: null,
    started_by: null,
    completed_by: null,
    started_by_user: null,
    completed_by_user: null,
    dispatched_at: '2026-10-01T00:00:00Z',
    created_at: '2026-09-30T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  }
}

function summary(): WorkflowSummary {
  return {
    project: { id: projectId, project_code: 'P1', name: '示範' },
    member_count: 1,
    inspection_item_count: 2,
    zone_count: 0,
    plan_count: 1,
    task_counts: {
      DRAFT: 0,
      PENDING: 1,
      IN_PROGRESS: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    },
    pending_reinspection_task_count: 1,
    next_steps: [],
    primary_step: null,
    task_counts_visible: true,
    draft_tasks_missing_assignee: 0,
    viewer_permission_codes: ['inspection_task.read'],
  }
}

function page(initial: string) {
  render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route
          path="/admin/projects/:projectId/progress"
          element={
            <ProgressPage viewerPermissions={['inspection_task.read']} />
          }
        />
        <Route
          path="/admin/projects/:projectId/progress/tasks/:taskId"
          element={
            <ProgressPage viewerPermissions={['inspection_task.read']} />
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mocks.list.mockReset()
  mocks.detail.mockReset()
  mocks.summary.mockReset()
  mocks.list.mockResolvedValue({ items: [task()], next_cursor: null })
  mocks.detail.mockResolvedValue(task())
  mocks.summary.mockResolvedValue(summary())
  vi.stubGlobal('scrollTo', vi.fn())
})

it('shows seven server filtered links and a single keyboard reachable card', async () => {
  page(`/admin/projects/${projectId}/progress?status=reinspection`)
  const current = await screen.findByRole('link', {
    name: '待重查 1',
  })
  expect(current).toHaveAttribute('aria-current', 'true')
  expect(
    screen.getByRole('navigation', { name: '任務狀態' }).querySelectorAll('a'),
  ).toHaveLength(7)
  expect(mocks.list).toHaveBeenCalledWith(projectId, 'reinspection')
  const card = await screen.findByRole('link', {
    name: /表面檢查等 2 項/,
  })
  expect(card).toHaveAttribute(
    'href',
    `/admin/projects/${projectId}/progress/tasks/${taskId}` +
      '?status=reinspection',
  )
  expect(card).toHaveTextContent('未填地點')
  expect(card).toHaveTextContent('未指派')
  expect(card).toHaveTextContent('待重查')
})

it('treats an unknown URL filter as all without hiding the list', async () => {
  page(`/admin/projects/${projectId}/progress?status=BOGUS`)
  expect(await screen.findByRole('link', { name: '全部 1' })).toHaveAttribute(
    'aria-current',
    'true',
  )
  expect(mocks.list).toHaveBeenCalledWith(projectId, 'all')
  expect(
    await screen.findByRole('link', {
      name: /表面檢查等 2 項/,
    }),
  ).toBeVisible()
})

it('keeps cards visible when summary counts fail', async () => {
  mocks.summary.mockRejectedValueOnce(new Error('network'))
  page(`/admin/projects/${projectId}/progress?status=CANCELLED`)
  expect(
    await screen.findByRole('link', {
      name: /表面檢查等 2 項/,
    }),
  ).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent('無法載入任務數字')
  expect(screen.getByRole('button', { name: '重新載入數字' })).toBeVisible()
})

it('marks archived plans without presenting an archived recheck as pending', async () => {
  const archived = task()
  archived.plan = { ...archived.plan, archived: true }
  mocks.list.mockResolvedValueOnce({
    items: [archived],
    next_cursor: null,
  })
  page(`/admin/projects/${projectId}/progress?status=IN_PROGRESS`)
  const card = await screen.findByRole('link', {
    name: /表面檢查等 2 項/,
  })
  expect(card).toHaveTextContent('計畫已封存')
  expect(card).not.toHaveTextContent('待重查')
})

it('does not render a task from a different project', async () => {
  mocks.detail.mockResolvedValueOnce({
    ...task(),
    project_id: 'another-project',
  })
  page(`/admin/projects/${projectId}/progress/tasks/${taskId}`)
  expect(
    await screen.findByRole('heading', {
      name: '找不到這筆任務',
    }),
  ).toBeVisible()
  expect(screen.getByRole('link', { name: '回首頁' })).toBeVisible()
})

it('preserves loaded cards after a load more error and retries the cursor', async () => {
  mocks.list.mockReset()
  mocks.list
    .mockResolvedValueOnce({
      items: [task()],
      next_cursor: 'next-page',
    })
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({ items: [], next_cursor: null })
  page(`/admin/projects/${projectId}/progress?status=COMPLETED`)
  fireEvent.click(
    await screen.findByRole('button', {
      name: '載入更多',
    }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('無法載入任務')
  expect(
    screen.getByRole('link', {
      name: /表面檢查等 2 項/,
    }),
  ).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '重新載入' }))
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(3))
  expect(mocks.list).toHaveBeenLastCalledWith(
    projectId,
    'COMPLETED',
    'next-page',
  )
})

it('returns to the saved filter and cards after opening read only detail', async () => {
  page(`/admin/projects/${projectId}/progress?status=PENDING`)
  fireEvent.click(
    await screen.findByRole('link', {
      name: /表面檢查等 2 項/,
    }),
  )
  expect(
    await screen.findByRole('heading', {
      name: '任務詳情',
    }),
  ).toBeInTheDocument()
  expect(screen.getByText('尚未開始')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /修改|派出|取消/ }),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: '返回進度' }))
  await waitFor(() =>
    expect(
      screen.getByRole('link', {
        name: '待開始 1',
      }),
    ).toHaveAttribute('aria-current', 'true'),
  )
  expect(mocks.list).toHaveBeenCalledTimes(1)
})
