import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'

import type { InspectionTask } from '../planning/api'
import type { WorkflowSummary } from '../projectHome/api'
import { ManagementApiError } from '../api'
import { markSignedOut, resetSessionMemory } from '../../auth/sessionMemory'
import { currentUserFixture } from '../../testing/contractFixtures'
import ProgressPage, { resetProgressListMemory } from './ProgressPage'
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
  useCurrentUser: () => ({ user: currentUserFixture({ id: 'viewer' }) }),
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
    name: '表面檢查等 2 項',
    status: 'PENDING',
    inspection_level: 'self_inspection',
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
    project: {
      id: projectId,
      project_code: 'P1',
      name: '示範',
      company_role: 'contractor',
    },
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
    can_apply_templates: false,
    draft_tasks_missing_assignee: 0,
    viewer_permission_codes: ['inspection_task.read'],
  }
}

function page(initial: string) {
  render(
    <MemoryRouter initialEntries={[initial]}>
      <header>
        <h1>DEMO-001｜示範工程</h1>
        <Link to="/outside">離開進度</Link>
      </header>
      <Routes>
        <Route
          path="/outside"
          element={
            <>
              <p>其他頁面</p>
              <BrowserBack />
              <Link to={`/projects/${projectId}/progress?status=PENDING`}>
                返回進度
              </Link>
            </>
          }
        />
        <Route
          path="/projects/:projectId/progress"
          element={
            <ProgressPage viewerPermissions={['inspection_task.read']} />
          }
        />
        <Route
          path="/projects/:projectId/progress/tasks/:taskId"
          element={
            <ProgressPage viewerPermissions={['inspection_task.read']} />
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

function BrowserBack() {
  const navigate = useNavigate()
  return <button onClick={() => navigate(-1)}>瀏覽器上一頁</button>
}

beforeEach(() => {
  resetProgressListMemory()
  resetSessionMemory()
  mocks.list.mockReset()
  mocks.detail.mockReset()
  mocks.summary.mockReset()
  mocks.list.mockResolvedValue({ items: [task()], next_cursor: null })
  mocks.detail.mockResolvedValue(task())
  mocks.summary.mockResolvedValue(summary())
  vi.stubGlobal('scrollTo', vi.fn())
})

it('keeps filter focus and reloads when returning to the list directly', async () => {
  page(`/projects/${projectId}/progress`)
  const pending = await screen.findByRole('link', { name: '待開始 1' })
  pending.focus()
  fireEvent.click(pending)
  await waitFor(() => expect(pending).toHaveAttribute('aria-current', 'true'))
  expect(pending).toHaveFocus()
  expect(mocks.list).toHaveBeenCalledTimes(2)

  fireEvent.click(screen.getByRole('link', { name: '全部 1' }))
  await screen.findByRole('link', { name: /表面檢查等 2 項/ })
  expect(mocks.list).toHaveBeenCalledTimes(3)

  fireEvent.click(screen.getByRole('link', { name: '離開進度' }))
  fireEvent.click(await screen.findByRole('link', { name: '返回進度' }))
  await screen.findByRole('link', { name: '待開始 1' })
  expect(mocks.list).toHaveBeenCalledTimes(4)
})

it('refetches when browser Back revisits a consumed detail return entry', async () => {
  page(`/projects/${projectId}/progress`)
  fireEvent.click(await screen.findByRole('link', { name: /表面檢查等 2 項/ }))
  await screen.findByRole('heading', { name: '任務詳情' })
  fireEvent.click(screen.getByRole('link', { name: '返回進度' }))
  await screen.findByRole('link', { name: /表面檢查等 2 項/ })
  expect(mocks.list).toHaveBeenCalledTimes(1)

  fireEvent.click(screen.getByRole('link', { name: '離開進度' }))
  fireEvent.click(await screen.findByRole('button', { name: '瀏覽器上一頁' }))
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
  expect(
    await screen.findByRole('link', { name: /表面檢查等 2 項/ }),
  ).toBeVisible()
})

it('refetches after leaving detail through the header', async () => {
  page(`/projects/${projectId}/progress?status=PENDING`)
  fireEvent.click(
    await screen.findByRole('link', {
      name: /表面檢查等 2 項/,
    }),
  )
  await screen.findByRole('heading', { name: '任務詳情' })
  fireEvent.click(screen.getByRole('link', { name: '離開進度' }))
  fireEvent.click(await screen.findByRole('link', { name: '返回進度' }))
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
})

it('does not mark a modified card click as a detail return', async () => {
  page(`/projects/${projectId}/progress?status=PENDING`)
  const card = await screen.findByRole('link', {
    name: /表面檢查等 2 項/,
  })
  fireEvent.click(card, { ctrlKey: true })
  expect(screen.queryByRole('heading', { name: '任務詳情' })).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: '離開進度' }))
  fireEvent.click(await screen.findByRole('link', { name: '返回進度' }))
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
})

it('uses the saved task name before the item summary', async () => {
  const renamed = { ...task(), name: '自訂巡檢任務' }
  mocks.list.mockResolvedValueOnce({ items: [renamed], next_cursor: null })
  mocks.detail.mockResolvedValueOnce(renamed)
  page(`/projects/${projectId}/progress`)
  const card = await screen.findByRole('link', { name: /自訂巡檢任務/ })
  expect(card).not.toHaveTextContent('表面檢查等 2 項')
  fireEvent.click(card)
  expect(
    await screen.findByRole('heading', {
      name: '自訂巡檢任務',
    }),
  ).toBeVisible()
})

it('shows seven server filtered links and a single keyboard reachable card', async () => {
  page(`/projects/${projectId}/progress?status=reinspection`)
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
  expect(card.querySelectorAll('a')).toHaveLength(0)
  expect(card.querySelector('.badge')).toBeVisible()
  expect(card.querySelector('.badge')?.parentElement).toBe(card)
  expect(card).toHaveAttribute(
    'href',
    `/projects/${projectId}/progress/tasks/${taskId}` + '?status=reinspection',
  )
  expect(card).toHaveTextContent('未填地點')
  expect(card).toHaveTextContent('未指派')
  expect(card).toHaveTextContent('待重查')
})

it('treats an unknown URL filter as all without hiding the list', async () => {
  page(`/projects/${projectId}/progress?status=BOGUS`)
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
  page(`/projects/${projectId}/progress?status=CANCELLED`)
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
  page(`/projects/${projectId}/progress?status=IN_PROGRESS`)
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
  page(`/projects/${projectId}/progress/tasks/${taskId}`)
  expect(
    await screen.findByRole('heading', {
      name: '找不到這筆任務',
    }),
  ).toBeVisible()
  expect(screen.getByRole('link', { name: '回首頁' })).toBeVisible()
})

it.each([404, 422])(
  'renders a missing task as a page-level 404 (%s)',
  async (status) => {
    mocks.detail.mockRejectedValueOnce(
      new ManagementApiError(status, 'resource.not_found'),
    )
    page(`/projects/${projectId}/progress/tasks/${taskId}`)
    expect(
      await screen.findByRole('heading', { name: '找不到這筆任務' }),
    ).toHaveProperty('tagName', 'H2')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  },
)

it('renders a forbidden task with a section heading', async () => {
  mocks.detail.mockRejectedValueOnce(
    new ManagementApiError(403, 'permission.denied'),
  )
  page(`/projects/${projectId}/progress/tasks/${taskId}`)
  expect(
    await screen.findByRole('heading', { name: '無權限' }),
  ).toHaveProperty('tagName', 'H2')
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
})

it('shows an empty-state message when the selected filter has no tasks', async () => {
  mocks.list.mockResolvedValueOnce({ items: [], next_cursor: null })
  page(`/projects/${projectId}/progress?status=CANCELLED`)
  expect(await screen.findByText('這個狀態目前沒有任務。')).toBeVisible()
})

it('restores multiple loaded pages and the scroll position after task detail', async () => {
  const second = {
    ...task(),
    id: '44444444-4444-7444-8444-444444444444',
    name: '鋼筋檢查',
    item_summary: { first_title: '鋼筋檢查', count: 1 },
  }
  mocks.list
    .mockResolvedValueOnce({ items: [task()], next_cursor: 'next-page' })
    .mockResolvedValueOnce({ items: [second], next_cursor: null })
  page(`/projects/${projectId}/progress?status=PENDING`)
  fireEvent.click(await screen.findByRole('button', { name: '載入更多' }))
  expect(await screen.findByRole('link', { name: /鋼筋檢查/ })).toBeVisible()

  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    value: 720,
  })
  fireEvent.click(screen.getByRole('link', { name: /表面檢查等 2 項/ }))
  await screen.findByRole('heading', { name: '任務詳情' })
  fireEvent.click(screen.getByRole('link', { name: '返回進度' }))

  expect(await screen.findByRole('link', { name: /鋼筋檢查/ })).toBeVisible()
  expect(mocks.list).toHaveBeenCalledTimes(2)
  await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith(0, 720))
})

it('clears saved progress pages when the user signs out', async () => {
  page(`/projects/${projectId}/progress`)
  fireEvent.click(await screen.findByRole('link', { name: /表面檢查等 2 項/ }))
  await screen.findByRole('heading', { name: '任務詳情' })
  markSignedOut()
  fireEvent.click(screen.getByRole('link', { name: '返回進度' }))
  await screen.findByRole('link', { name: '全部 1' })
  expect(mocks.list).toHaveBeenCalledTimes(2)
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
  page(`/projects/${projectId}/progress?status=COMPLETED`)
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
  page(`/projects/${projectId}/progress?status=PENDING`)
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

it.each([
  ['COMPLETED', false],
  ['CANCELLED', false],
  ['PENDING', true],
  ['PENDING', false],
] as const)('進度頁停用提醒依 %s、封存 %s 判斷', async (status, archived) => {
  const value = task()
  value.status = status
  value.plan.archived = archived
  value.assignee = {
    id: 'inactive',
    username: 'demo-inactive',
    name_zh: '示範同事',
    is_active: false,
  }
  mocks.list.mockResolvedValue({ items: [value], next_cursor: null })
  mocks.detail.mockResolvedValue(value)
  page(`/projects/${projectId}/progress/tasks/${taskId}?status=${status}`)
  const warning = !archived && status === 'PENDING'
  expect(
    (await screen.findAllByText(warning ? '（已停用，請改派）' : '（已停用）'))
      .length,
  ).toBeGreaterThan(0)
  if (!warning) expect(screen.queryByText(/請改派/)).toBeNull()
})
