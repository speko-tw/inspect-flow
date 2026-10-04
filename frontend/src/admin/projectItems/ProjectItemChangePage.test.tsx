import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import {
  mockProjectItemApi,
  ProjectItemApiError,
  type ProjectItemApi,
  type ProjectItemChangeResult,
  type ProjectItemPreview,
} from './api'
import ProjectItemChangePage from './ProjectItemChangePage'

const preview: ProjectItemPreview = {
  item: {
    id: 'item-1',
    sequence: 1,
    title: '混凝土表面檢查',
    standard: '不得有明顯裂縫',
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
  ],
  preservedItemTitles: ['鋼筋間距'],
}

const changeResult: ProjectItemChangeResult = {
  invalidatedHistory: ['一樓巡檢：混凝土表面檢查', '二樓巡檢：混凝土表面檢查'],
  invalidatedResults: ['二樓巡檢：混凝土表面檢查'],
  preservedItems: ['鋼筋間距'],
  updatedDraftTasks: ['地下室抽查'],
  reinspectionSelected: true,
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
    loadPreview: vi.fn(async () => preview),
    update: vi.fn(async () => changeResult),
    ...overrides,
  }
}

describe('ProjectItemChangePage', () => {
  it('confirms affected tasks and categorizes invalidated, preserved, and DRAFT', async () => {
    const api = apiWith()
    renderPage(api)

    fireEvent.change(await screen.findByLabelText('項目名稱'), {
      target: { value: '新版檢查項目' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('地下室抽查（地下室查核計畫；DRAFT）')
    expect(dialog).toHaveTextContent('一樓巡檢（樓層巡檢計畫；PENDING）')
    expect(dialog).toHaveTextContent('二樓巡檢（樓層巡檢計畫；COMPLETED）')
    expect(dialog).toHaveTextContent(/已\s*核發報告不受影響/)
    expect(api.update).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('radio', { name: /要，作廢受影響項目/ }))
    fireEvent.click(screen.getByRole('button', { name: '確認儲存' }))

    expect(
      await screen.findByRole('heading', { name: '修改結果' }),
    ).toBeInTheDocument()
    expect(api.update).toHaveBeenCalledWith('project-1', 'item-1', {
      title: '新版檢查項目',
      standard: '不得有明顯裂縫',
      reinspect: true,
    })
    expect(screen.getAllByText('二樓巡檢：混凝土表面檢查')).toHaveLength(2)
    expect(screen.getByText('一樓巡檢：混凝土表面檢查')).toBeInTheDocument()
    expect(screen.getByText('鋼筋間距')).toBeInTheDocument()
    expect(screen.getByText('地下室抽查')).toBeInTheDocument()
  })

  it('lets the user correct Snapshot text without reinspection', async () => {
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

    fireEvent.click(await screen.findByRole('button', { name: '儲存變更' }))
    fireEvent.click(screen.getByRole('radio', { name: /不要，只更正文字/ }))
    fireEvent.click(screen.getByRole('button', { name: '確認儲存' }))

    await waitFor(() => expect(api.update).toHaveBeenCalled())
    expect(api.update).toHaveBeenCalledWith(
      'project-1',
      'item-1',
      expect.objectContaining({ reinspect: false }),
    )
    expect(
      await screen.findByText('沒有舊需求或 Snapshot 歷史被作廢。'),
    ).toBeInTheDocument()
  })

  it('shows archived Plans as readonly before allowing an edit', async () => {
    const archived = {
      ...preview,
      affectedTasks: [{ ...preview.affectedTasks[0], planArchived: true }],
    }
    const api = apiWith({ loadPreview: vi.fn(async () => archived) })
    renderPage(api)

    expect(await screen.findByRole('status')).toHaveTextContent('唯讀瀏覽')
    expect(screen.getByRole('alert')).toHaveTextContent('封存計畫')
    expect(screen.getByRole('button', { name: '儲存變更' })).toBeDisabled()
  })

  it('switches to readonly after the save endpoint returns 403', async () => {
    const api = apiWith({
      update: vi.fn(async () => {
        throw new ProjectItemApiError(403)
      }),
    })
    renderPage(api)

    fireEvent.click(await screen.findByRole('button', { name: '儲存變更' }))
    fireEvent.click(screen.getByRole('radio', { name: /不要，只更正文字/ }))
    fireEvent.click(screen.getByRole('button', { name: '確認儲存' }))

    expect(
      await screen.findByText('你沒有權限修改此專案查核項目。'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('項目名稱')).toBeDisabled()
    expect(screen.getByText('唯讀瀏覽')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }))
    expect(api.update).toHaveBeenCalledTimes(1)
  })

  it('confirms even when no Task uses the item', async () => {
    const noTasks = { ...preview, affectedTasks: [] }
    const api = apiWith({ loadPreview: vi.fn(async () => noTasks) })
    renderPage(api)

    fireEvent.click(await screen.findByRole('button', { name: '儲存變更' }))
    expect(screen.getByRole('dialog')).toHaveTextContent(
      '目前沒有任務使用此項目',
    )
    expect(api.update).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '確認儲存' }))
    expect(
      await screen.findByRole('heading', { name: '修改結果' }),
    ).toBeInTheDocument()
    expect(api.update).toHaveBeenCalledWith(
      'project-1',
      'item-1',
      expect.objectContaining({ reinspect: false }),
    )
  })

  it('invalidates history for dispatched tasks without results, across Plans', async () => {
    renderPage(mockProjectItemApi)
    fireEvent.click(await screen.findByRole('button', { name: '儲存變更' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('樓層巡檢計畫；PENDING')
    expect(dialog).toHaveTextContent('三樓巡檢（樓層巡檢計畫；IN_PROGRESS）')
    expect(dialog).toHaveTextContent('屋頂抽查（屋頂查核計畫；CANCELLED）')

    fireEvent.click(screen.getByRole('radio', { name: /要，作廢受影響項目/ }))
    fireEvent.click(screen.getByRole('button', { name: '確認儲存' }))

    const historyHeading = await screen.findByRole('heading', {
      name: '已作廢並保留的舊需求／Snapshot 歷史',
    })
    const history = historyHeading.nextElementSibling
    expect(history).toHaveTextContent('一樓巡檢：混凝土表面檢查')
    expect(history).toHaveTextContent('三樓巡檢：混凝土表面檢查')
    expect(history).toHaveTextContent('二樓巡檢：混凝土表面檢查')
    expect(history).not.toHaveTextContent('地下室抽查：混凝土表面檢查')
    expect(history).not.toHaveTextContent('屋頂抽查：混凝土表面檢查')

    const resultHeading = screen.getByRole('heading', {
      name: '已作廢的結果／照片，並列為待重查',
    })
    expect(resultHeading.nextElementSibling).toHaveTextContent(
      '二樓巡檢：混凝土表面檢查',
    )
    expect(resultHeading.nextElementSibling).not.toHaveTextContent(
      '一樓巡檢：混凝土表面檢查',
    )
    expect(resultHeading.nextElementSibling).not.toHaveTextContent(
      '三樓巡檢：混凝土表面檢查',
    )
  })
})
