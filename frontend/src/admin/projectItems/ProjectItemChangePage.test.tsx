import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { ManagementApiError } from '../api'
import type { InspectionPoint } from '../templates/api'
import {
  type ProjectItemApi,
  type ProjectItemChangeResult,
  type ProjectItemPreview,
} from './api'
import ProjectItemChangePage from './ProjectItemChangePage'

const point: InspectionPoint = {
  sequence: 1,
  title: '表面完整',
  instruction: '檢查表面',
  text_standard: { text: '不得有裂縫' },
  numeric_standard: null,
  measurement_fields: [],
  evidence_requirements: [{ min_count: 1 }],
}

const preview: ProjectItemPreview = {
  item: {
    id: 'item-1',
    sequence: 1,
    title: '混凝土表面檢查',
    instruction: '檢查混凝土表面狀況',
    source_template_name: '混凝土施工',
    applied_at: '2026-10-05T01:00:00Z',
    inspection_points: [point],
  },
  affectedTasks: [
    {
      id: 'draft',
      name: '地下室抽查',
      planName: '地下室查核計畫',
      zoneName: '地下室北區',
      locationText: 'B1 柱旁',
      status: 'DRAFT',
      planArchived: false,
      hasResult: false,
      preservedItemTitles: [],
    },
    {
      id: 'complete',
      name: '二樓巡檢',
      planName: '樓層巡檢計畫',
      zoneName: '二樓東側',
      locationText: null,
      status: 'COMPLETED',
      planArchived: false,
      hasResult: false,
      preservedItemTitles: ['鋼筋間距'],
    },
    {
      id: 'cancelled',
      name: '屋頂抽查',
      planName: '屋頂查核計畫',
      zoneName: null,
      locationText: '水塔旁',
      status: 'CANCELLED',
      planArchived: false,
      hasResult: false,
      preservedItemTitles: [],
    },
  ],
}

const changed: ProjectItemChangeResult = {
  ...preview.item,
  title: '新版檢查項目',
  reinspection_selected: true,
  affected_tasks: [
    {
      task_id: 'draft',
      prior_status: 'DRAFT',
      status: 'DRAFT',
      action: 'draft_updated',
      needs_reinspection: false,
    },
    {
      task_id: 'complete',
      prior_status: 'COMPLETED',
      status: 'IN_PROGRESS',
      action: 'returned_to_in_progress',
      needs_reinspection: false,
    },
    {
      task_id: 'cancelled',
      prior_status: 'CANCELLED',
      status: 'CANCELLED',
      action: 'apply_current_standard_on_restore',
      needs_reinspection: false,
    },
  ],
}

const reinspectChoice = /要，作廢受影響項目/
const noReinspectChoice = /不要，只更正文字/

function choiceName(choice: 'yes' | 'no') {
  if (choice === 'yes') return reinspectChoice
  return noReinspectChoice
}

function apiWith(overrides: Partial<ProjectItemApi> = {}): ProjectItemApi {
  return {
    loadPreview: vi.fn(async () => structuredClone(preview)),
    update: vi.fn(async () => changed),
    ...overrides,
  }
}

function renderPage(api: ProjectItemApi) {
  return render(
    <MemoryRouter initialEntries={['/admin/projects/p/items/item-1']}>
      <Routes>
        <Route
          element={<ProjectItemChangePage api={api} />}
          path="/admin/projects/:projectId/items/:itemId"
        />
      </Routes>
    </MemoryRouter>,
  )
}

async function confirm(choice?: 'yes' | 'no') {
  fireEvent.click(
    await screen.findByRole('button', {
      name: '儲存變更',
    }),
  )
  if (choice) {
    const name = choiceName(choice)
    fireEvent.click(screen.getByRole('radio', { name }))
  }
  fireEvent.click(screen.getByRole('button', { name: '確認儲存' }))
}

describe('ProjectItemChangePage', () => {
  it('confirms reinspection and renders backend Task actions', async () => {
    const api = apiWith()
    renderPage(api)
    fireEvent.change(await screen.findByLabelText('項目名稱 *'), {
      target: { value: '新版檢查項目' },
    })
    fireEvent.change(screen.getByLabelText('文字標準 *'), {
      target: { value: '不得有裂縫或剝落' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }))
    const intro = screen.getByText(
      /選擇「要」重新查核時，各任務會有以下狀態變化/,
    )
    const taskHeading = screen.getByRole('heading', {
      name: '使用此項目的任務',
    })
    expect(
      intro.compareDocumentPosition(taskHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(intro).toHaveTextContent(/選擇「不要」時/)
    expect(intro).toHaveTextContent(/各任務狀態維持不變/)
    expect(screen.getByText(/地下室北區・B1 柱旁/)).toBeInTheDocument()
    expect(screen.getByText(/二樓東側/)).toBeInTheDocument()
    expect(screen.getByText(/水塔旁/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: reinspectChoice }))
    fireEvent.click(screen.getByRole('button', { name: '確認儲存' }))
    expect(api.update).toHaveBeenCalledWith('p', 'item-1', {
      title: '新版檢查項目',
      instruction: '檢查混凝土表面狀況',
      inspection_points: [
        {
          ...point,
          text_standard: { text: '不得有裂縫或剝落' },
        },
      ],
      reinspect: true,
    })
    expect(
      await screen.findByText(/二樓東側.*已完成任務退回進行中/),
    ).toHaveTextContent('鋼筋間距')
    expect(
      screen.getByText(/二樓東側.*已完成任務退回進行中/),
    ).toHaveTextContent('舊需求與 Snapshot 已作廢')
    expect(screen.getByText(/草稿任務原位更新/)).toBeInTheDocument()
    expect(screen.getByText(/恢復時套用目前標準/)).toBeInTheDocument()
    expect(api.loadPreview).toHaveBeenCalledTimes(2)
  })

  it('corrects text without reinspection', async () => {
    const api = apiWith({
      update: vi.fn(async () => ({
        ...changed,
        reinspection_selected: false,
        affected_tasks: changed.affected_tasks.map((task) => ({
          ...task,
          status: task.prior_status,
          action: 'updated' as const,
        })),
      })),
    })
    renderPage(api)
    await confirm('no')
    expect(
      await screen.findByText('已更正文字，沒有重新查核。'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/地下室北區・B1 柱旁.*任務狀態維持/),
    ).toBeInTheDocument()
    expect(api.update).toHaveBeenCalledWith(
      'p',
      'item-1',
      expect.objectContaining({ reinspect: false }),
    )
  })

  it('blocks editing when an affected Plan is archived', async () => {
    const archived = structuredClone(preview)
    archived.affectedTasks[0].planArchived = true
    renderPage(apiWith({ loadPreview: vi.fn(async () => archived) }))
    expect(await screen.findByText('唯讀瀏覽')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('封存計畫')
    expect(screen.getByRole('button', { name: '儲存變更' })).toBeDisabled()
  })

  it('switches to readonly after a write 403', async () => {
    const api = apiWith({
      update: vi.fn(async () => {
        throw new ManagementApiError(403, 'permission.denied')
      }),
    })
    renderPage(api)
    await confirm('no')
    expect(await screen.findByText('唯讀瀏覽')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows archived error beside the action after a write race', async () => {
    const api = apiWith({
      update: vi.fn(async () => {
        throw new ManagementApiError(409, 'inspection_plan.archived')
      }),
    })
    renderPage(api)
    await confirm('yes')
    expect(await screen.findByText('唯讀瀏覽')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('封存計畫')
  })

  it('refreshes the impact list when a choice becomes required', async () => {
    const initial = { ...preview, affectedTasks: [] }
    const api = apiWith({
      loadPreview: vi
        .fn()
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(preview),
      update: vi.fn(async () => {
        throw new ManagementApiError(
          422,
          'project_inspection_item.reinspection_choice_required',
        )
      }),
    })
    renderPage(api)
    await confirm()
    expect(
      await screen.findByRole('radio', {
        name: /要，作廢受影響項目/,
      }),
    ).not.toBeChecked()
    expect(screen.getByRole('button', { name: '確認儲存' })).toBeDisabled()
  })

  it('omits reinspect when no Task uses the item', async () => {
    const noTasks = { ...preview, affectedTasks: [] }
    const api = apiWith({ loadPreview: vi.fn(async () => noTasks) })
    renderPage(api)
    await confirm()
    await waitFor(() => expect(api.update).toHaveBeenCalled())
    const body = vi.mocked(api.update).mock.calls[0][2]
    expect(body).not.toHaveProperty('reinspect')
  })
})
