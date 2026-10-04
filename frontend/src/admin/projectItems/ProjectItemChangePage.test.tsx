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

const inspectionPoint: InspectionPoint = {
  sequence: 1,
  title: '表面完整',
  instruction: '檢查表面',
  text_standard: { text: '不得有裂縫' },
  numeric_standard: null,
  measurement_fields: [],
  evidence_requirements: [{ min_count: 1, max_count: 2 }],
}

const preview: ProjectItemPreview = {
  item: {
    id: 'item-1',
    sequence: 1,
    title: '混凝土表面檢查',
    instruction: '檢查混凝土表面狀況',
    inspection_points: [inspectionPoint],
  },
  affectedTasks: [
    {
      id: 'draft',
      name: '地下室抽查',
      planName: '地下室查核計畫',
      status: 'DRAFT',
      planArchived: false,
      hasResult: false,
    },
    {
      id: 'pending',
      name: '一樓巡檢',
      planName: '樓層巡檢計畫',
      status: 'PENDING',
      planArchived: false,
      hasResult: false,
    },
    {
      id: 'complete',
      name: '二樓巡檢',
      planName: '樓層巡檢計畫',
      status: 'COMPLETED',
      planArchived: false,
      hasResult: true,
    },
    {
      id: 'cancelled',
      name: '屋頂抽查',
      planName: '屋頂查核計畫',
      status: 'CANCELLED',
      planArchived: false,
      hasResult: true,
    },
  ],
  preservedItemTitles: ['鋼筋間距'],
}

const changeResult: ProjectItemChangeResult = {
  invalidatedHistory: ['一樓巡檢：混凝土表面檢查'],
  invalidatedResults: [],
  preservedItems: ['鋼筋間距'],
  updatedDraftTasks: ['地下室抽查'],
  reinspectionSelected: true,
}

async function openConfirmation() {
  const saveButton = await screen.findByRole('button', {
    name: '儲存變更',
  })
  fireEvent.click(saveButton)
}

function chooseReinspection() {
  const choice = screen.getByRole('radio', {
    name: /要，作廢受影響項目/,
  })
  fireEvent.click(choice)
}

function chooseCorrection() {
  const choice = screen.getByRole('radio', {
    name: /不要，只更正文字/,
  })
  fireEvent.click(choice)
}

function renderPage(api: ProjectItemApi) {
  return render(
    <MemoryRouter initialEntries={['/admin/projects/project-1/items/item-1']}>
      <Routes>
        <Route
          path="/admin/projects/:projectId/items/:itemId"
          element={<ProjectItemChangePage api={api} />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

function apiWith(overrides: Partial<ProjectItemApi> = {}): ProjectItemApi {
  return {
    loadPreview: vi.fn(async () => structuredClone(preview)),
    update: vi.fn(async () => changeResult),
    ...overrides,
  }
}

describe('ProjectItemChangePage', () => {
  it('shows consequences and sends the full PATCH body', async () => {
    const api = apiWith()
    renderPage(api)

    fireEvent.change(await screen.findByLabelText('項目名稱'), {
      target: { value: '新版檢查項目' },
    })
    fireEvent.change(screen.getByLabelText('文字標準'), {
      target: { value: '不得有裂縫或剝落' },
    })
    const editButton = screen.getByRole('button', { name: '儲存變更' })
    fireEvent.click(editButton)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveTextContent('草稿')
    expect(dialog).toHaveTextContent('在原任務內更新')
    expect(dialog).toHaveTextContent('已完成')
    expect(dialog).toHaveTextContent('退回進行中')
    expect(dialog).toHaveTextContent('已取消')
    expect(dialog).toHaveTextContent('恢復時套用新標準')
    expect(dialog).toHaveTextContent(/Task 完成補查前不得完成/)
    expect(dialog).toHaveTextContent(/已s*核發報告不受影響/)
    expect(api.update).not.toHaveBeenCalled()
    expect(
      screen.getByRole('heading', { name: '儲存前確認重新查核' }),
    ).toHaveFocus()

    chooseReinspection()
    fireEvent.click(screen.getByRole('button', { name: '確認儲存' }))

    expect(
      await screen.findByRole('heading', { name: '修改結果' }),
    ).toBeInTheDocument()
    expect(api.update).toHaveBeenCalledWith('project-1', 'item-1', {
      title: '新版檢查項目',
      instruction: '檢查混凝土表面狀況',
      inspection_points: [
        {
          ...inspectionPoint,
          text_standard: { text: '不得有裂縫或剝落' },
        },
      ],
      reinspect: true,
    })
    expect(api.loadPreview).toHaveBeenCalledTimes(2)
    const itemName = screen.getByLabelText('項目名稱')
    expect(itemName).toHaveValue('新版檢查項目')
    expect(screen.getByText('鋼筋間距')).toBeInTheDocument()
    expect(screen.getByText('地下室抽查')).toBeInTheDocument()
  })

  it('returns focus when the confirmation dialog closes', async () => {
    renderPage(apiWith())
    const editButton = await screen.findByRole('button', {
      name: '儲存變更',
    })
    fireEvent.click(editButton)
    fireEvent.click(screen.getByRole('button', { name: '返回編輯' }))
    await waitFor(() => expect(editButton).toHaveFocus())
  })

  it('corrects item text without reinspection', async () => {
    const api = apiWith({
      update: vi.fn(async () => ({
        invalidatedHistory: [],
        invalidatedResults: [],
        preservedItems: ['鋼筋間距'],
        updatedDraftTasks: ['地下室抽查'],
        reinspectionSelected: false,
      })),
    })
    renderPage(api)

    await openConfirmation()
    chooseCorrection()
    fireEvent.click(screen.getByRole('button', { name: '確認儲存' }))

    const noInvalidatedHistory = await screen.findByText(
      '沒有舊需求或 Snapshot 歷史被作廢。',
    )
    expect(noInvalidatedHistory).toBeInTheDocument()
    expect(api.update).toHaveBeenCalledWith(
      'project-1',
      'item-1',
      expect.objectContaining({ reinspect: false }),
    )
  })

  it('shows archived Plans as readonly before allowing an edit', async () => {
    const archived = {
      ...preview,
      affectedTasks: [{ ...preview.affectedTasks[0], planArchived: true }],
    }
    renderPage(apiWith({ loadPreview: vi.fn(async () => archived) }))

    expect(await screen.findByRole('status')).toHaveTextContent('唯讀瀏覽')
    expect(screen.getByRole('alert')).toHaveTextContent('封存計畫')
    expect(screen.getByRole('button', { name: '儲存變更' })).toBeDisabled()
  })

  it('switches to readonly when the save endpoint returns 403', async () => {
    const api = apiWith({
      update: vi.fn(async () => {
        throw new ManagementApiError(403)
      }),
    })
    renderPage(api)

    await openConfirmation()
    chooseCorrection()
    fireEvent.click(screen.getByRole('button', { name: '確認儲存' }))

    expect(
      await screen.findByText('你沒有權限修改此專案查核項目。'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('項目名稱')).toBeDisabled()
    expect(screen.getByText('唯讀瀏覽')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.update).toHaveBeenCalledTimes(1)
  })

  it('reloads affected Tasks when a choice is required', async () => {
    const changedPreview = {
      ...preview,
      affectedTasks: [
        ...preview.affectedTasks,
        {
          id: 'new-task',
          name: '新增任務',
          planName: '新計畫',
          status: 'PENDING' as const,
          planArchived: false,
          hasResult: false,
        },
      ],
    }
    const newTaskLabel = '新增任務（新計畫；待開始）'
    const api = apiWith({
      loadPreview: vi
        .fn()
        .mockResolvedValueOnce(preview)
        .mockResolvedValueOnce(changedPreview),
      update: vi.fn(async () => {
        throw new ManagementApiError(
          422,
          'project_inspection_item.reinspection_choice_required',
        )
      }),
    })
    renderPage(api)

    await openConfirmation()
    chooseCorrection()
    fireEvent.click(screen.getByRole('button', { name: '確認儲存' }))

    expect(
      await screen.findByText(
        (_, element) =>
          element?.tagName === 'LI' &&
          element.textContent?.includes(newTaskLabel) === true,
      ),
    ).toBeInTheDocument()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('任務使用狀況已更新')
    expect(
      screen.getByRole('radio', { name: /要，作廢受影響項目/ }),
    ).not.toBeChecked()
    expect(screen.getByRole('button', { name: '確認儲存' })).toBeDisabled()
  })

  it('omits reinspect when no Task uses the item', async () => {
    const noTasks = { ...preview, affectedTasks: [] }
    const api = apiWith({ loadPreview: vi.fn(async () => noTasks) })
    renderPage(api)

    await openConfirmation()
    expect(screen.getByRole('dialog')).toHaveTextContent(
      '目前沒有任務使用此項目',
    )
    fireEvent.click(screen.getByRole('button', { name: '確認儲存' }))

    expect(
      await screen.findByRole('heading', { name: '修改結果' }),
    ).toBeInTheDocument()
    expect(api.update).toHaveBeenCalledWith('project-1', 'item-1', {
      title: '混凝土表面檢查',
      instruction: '檢查混凝土表面狀況',
      inspection_points: [inspectionPoint],
    })
  })

  it('renders categories returned by the injected API', async () => {
    const api = apiWith({
      update: vi.fn(async () => changeResult),
    })
    renderPage(api)

    await openConfirmation()
    chooseReinspection()
    fireEvent.click(screen.getByRole('button', { name: '確認儲存' }))

    const historyHeading = await screen.findByRole('heading', {
      name: '已作廢並保留的舊需求／Snapshot 歷史',
    })
    expect(historyHeading.nextElementSibling).toHaveTextContent(
      '一樓巡檢：混凝土表面檢查',
    )
    expect(historyHeading.nextElementSibling).not.toHaveTextContent(
      '屋頂抽查：混凝土表面檢查',
    )
    expect(
      screen.getByRole('heading', {
        name: '維持有效的其他項目',
      }).nextElementSibling,
    ).toHaveTextContent('鋼筋間距')
  })
})
