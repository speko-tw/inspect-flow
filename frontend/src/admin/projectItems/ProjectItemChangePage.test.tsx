import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { deferred, expectImeEnterIgnored } from '../../testing/submitGuard'
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

const numericPoint: InspectionPoint = {
  id: 'numeric-point',
  sequence: 1,
  title: '厚度',
  instruction: '',
  text_standard: null,
  numeric_standard: {
    value: '1.5',
    condition: '=',
    unit: 'mm',
    tolerance: null,
    range_form: null,
    lower_bound: null,
    upper_bound: null,
    measurement_field_id: 'numeric-field',
  },
  measurement_fields: [
    {
      id: 'numeric-field',
      name: '厚度',
      field_type: 'number',
      unit: 'mm',
    },
    {
      id: 'width-field',
      name: '寬度',
      field_type: 'number',
      unit: 'cm',
    },
  ],
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

const reinspectChoice = /要，用新標準重新查核/
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
  if (choice) {
    fireEvent.click(await screen.findByRole('radio', { name: choiceName(choice) }))
  }
  fireEvent.click(
    await screen.findByRole('button', {
      name: '儲存變更',
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: '確認儲存' }))
}

describe('ProjectItemChangePage', () => {
  it('confirms reinspection and renders backend Task actions', async () => {
    const api = apiWith()
    renderPage(api)
    fireEvent.change(await screen.findByLabelText('查核項目名稱 *'), {
      target: { value: '新版檢查項目' },
    })
    fireEvent.change(screen.getByLabelText('標準文字'), {
      target: { value: '不得有裂縫或剝落' },
    })
    fireEvent.click(await screen.findByRole('radio', { name: reinspectChoice }))
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
    ).toHaveTextContent('尚未填寫結果，直接改用新標準')
    expect(
      screen.getByText('任務尚未填寫結果，直接改用新標準。'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/已標記作廢/)).toBeNull()
    expect(screen.getByText(/草稿任務已更新為新內容/)).toBeInTheDocument()
    expect(screen.getByText(/恢復時套用目前標準/)).toBeInTheDocument()
    expect(api.loadPreview).toHaveBeenCalledTimes(2)
  })

  it('explains kept old results when a Task already has one (#491)', async () => {
    const withResult = structuredClone(preview)
    withResult.affectedTasks[1].hasResult = true
    const api = apiWith({ loadPreview: vi.fn(async () => withResult) })
    renderPage(api)
    await confirm('yes')
    expect(
      await screen.findByText(
        '已填的舊結果與照片會保留供查詢，但不再算數，任務需要重新查核。',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/二樓東側.*舊結果與照片保留供查詢，但不再算數/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/已標記作廢/)).toBeNull()
  })

  it('names both kinds when Tasks with and without results mix (#491)', async () => {
    const mixed = structuredClone(preview)
    mixed.affectedTasks[1].hasResult = true
    mixed.affectedTasks.push({
      ...mixed.affectedTasks[1],
      id: 'pending',
      name: '三樓巡檢',
      zoneName: '三樓西側',
      status: 'PENDING',
      hasResult: false,
      preservedItemTitles: [],
    })
    const api = apiWith({ loadPreview: vi.fn(async () => mixed) })
    renderPage(api)
    await confirm('yes')
    expect(
      await screen.findByText(
        [
          '已有結果的任務：已填的舊結果與照片會保留供查詢，',
          '但不再算數，任務需要重新查核；',
          '尚未填寫結果的任務：直接改用新標準。',
        ].join(''),
      ),
    ).toBeInTheDocument()
  })

  it('ignores draft and cancelled Tasks in the result text (#491)', async () => {
    const filtered = structuredClone(preview)
    filtered.affectedTasks[0].hasResult = true
    filtered.affectedTasks[2].hasResult = true
    const api = apiWith({ loadPreview: vi.fn(async () => filtered) })
    renderPage(api)
    await confirm('yes')
    expect(
      await screen.findByText('任務尚未填寫結果，直接改用新標準。'),
    ).toBeInTheDocument()
    const resultSection = screen
      .getByRole('heading', { name: '修改結果' })
      .closest('section') as HTMLElement
    expect(within(resultSection).queryByText(/保留供查詢/)).toBeNull()
  })

  it('describes the reinspect option in plain words (#491)', async () => {
    renderPage(apiWith())
    await screen.findByRole('radio', { name: reinspectChoice })
    expect(screen.getByText(/若已填過結果，舊結果與照片會保留供查詢/))
      .toBeInTheDocument()
    expect(screen.queryByText(/要，作廢/)).toBeNull()
  })

  it('asks no question when only draft Tasks use the item (#487)', async () => {
    const drafts = structuredClone(preview)
    drafts.affectedTasks = [drafts.affectedTasks[0]]
    const api = apiWith({
      loadPreview: vi.fn(async () => structuredClone(drafts)),
      update: vi.fn(async () => ({
        ...changed,
        reinspection_selected: false,
        affected_tasks: [changed.affected_tasks[0]],
      })),
    })
    renderPage(api)
    fireEvent.click(await screen.findByRole('button', { name: '儲存變更' }))
    const dialog = screen.getByRole('dialog')
    // 儲存前確認是原地展開的確認框，不是蓋住整頁的 modal（#501）。
    expect(dialog).toHaveClass('confirm-box', 'confirm-box-neutral')
    expect(dialog).not.toHaveClass('confirm-box-modal')
    expect(
      within(dialog).getByText(/草稿任務會直接更新為新內容/),
    ).toBeInTheDocument()
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/是否重新查核/)).not.toBeInTheDocument()
    expect(dialog.textContent).not.toMatch(/Snapshot|Task/)
    fireEvent.click(within(dialog).getByRole('button', { name: '確認儲存' }))
    expect(api.update).toHaveBeenCalledWith(
      'p',
      'item-1',
      expect.objectContaining({ reinspect: false }),
    )
    expect(
      await screen.findByText('草稿任務已直接更新為新內容，沒有重新查核。'),
    ).toBeInTheDocument()
  })

  it('allows draft-only structure edits while retaining persisted identities', async () => {
    const drafts = structuredClone(preview)
    drafts.affectedTasks = [drafts.affectedTasks[0]]
    drafts.item.inspection_points = [structuredClone(numericPoint)]
    const api = apiWith({
      loadPreview: vi.fn(async () => structuredClone(drafts)),
    })
    renderPage(api)
    await screen.findByLabelText('查核項目名稱 *')
    expect(screen.queryByRole('radio', { name: reinspectChoice })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '新增查核項次' }))
    const pointTitles = await screen.findAllByLabelText('項次標題 *')
    expect(pointTitles[1]).toHaveFocus()
    fireEvent.change(pointTitles[1], {
      target: { value: '新增點位' },
    })
    const addFieldButtons = screen.getAllByRole('button', {
      name: '新增實測欄位',
    })
    fireEvent.click(addFieldButtons[addFieldButtons.length - 1])
    const fieldNames = await screen.findAllByLabelText('欄位名稱 *')
    const addedFieldName = fieldNames[fieldNames.length - 1]
    fireEvent.change(addedFieldName, { target: { value: '新量測' } })
    const units = screen.getAllByLabelText('單位 *')
    fireEvent.change(units[units.length - 1], {
      target: { value: 'cm' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).not.toHaveClass('confirm-box-danger')
    fireEvent.click(within(dialog).getByRole('button', { name: '確認儲存' }))
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1))
    const change = vi.mocked(api.update).mock.calls[0][2]
    expect(change.reinspect).toBe(false)
    expect(change.inspection_points[0].id).toBe('numeric-point')
    const newPoint = change.inspection_points[1]
    expect(newPoint.id).toBeUndefined()
    expect(newPoint.measurement_fields[0].client_id).toMatch(
      /^[0-9a-f-]{36}$/i,
    )
    expect(newPoint.numeric_standard).toBeNull()
  })

  it('locks structure but leaves standard values editable for dispatched Tasks', async () => {
    const assigned = structuredClone(preview)
    assigned.affectedTasks = [
      { ...assigned.affectedTasks[1], status: 'PENDING' },
    ]
    assigned.item.inspection_points = [structuredClone(numericPoint)]
    const api = apiWith({ loadPreview: vi.fn(async () => assigned) })
    renderPage(api)
    fireEvent.click(await screen.findByRole('radio', { name: noReinspectChoice }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      '不能增減項次或欄位',
    )
    expect(screen.getByRole('button', { name: '新增查核項次' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '移除此項次' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '新增實測欄位' })).toBeDisabled()
    const fieldName = screen.getAllByLabelText('欄位名稱 *')[0]
    expect(fieldName).toBeEnabled()
    expect(
      screen
        .getAllByLabelText('欄位型別')
        .every((field) => (field as HTMLSelectElement).disabled),
    ).toBe(true)
    expect(
      screen
        .getAllByLabelText('單位 *')
        .every((field) => (field as HTMLInputElement).disabled),
    ).toBe(true)
    expect(
      screen.getAllByRole('button', { name: '移除欄位' }).every(
        (button) => (button as HTMLButtonElement).disabled,
      ),
    ).toBe(true)
    expect(screen.getByLabelText(/用來判定的數字欄位/)).toBeDisabled()
    expect(screen.getByLabelText('標準值 *')).toBeEnabled()
    expect(screen.getByRole('radio', { name: '數值' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: '範圍' })).toBeEnabled()
    expect(screen.getByText(/只能修改文字與標準值、容許誤差、區間/))
      .toBeInTheDocument()
    fireEvent.change(fieldName, { target: { value: '修正欄位名稱' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }))
    const saveDialog = screen.getByRole('dialog')
    fireEvent.click(
      within(saveDialog).getByRole('button', { name: '確認儲存' }),
    )
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1))
    const change = vi.mocked(api.update).mock.calls[0][2]
    expect(change.reinspect).toBe(false)
    expect(change.inspection_points[0].id).toBe('numeric-point')
    expect(change.inspection_points[0].measurement_fields[0].name).toBe(
      '修正欄位名稱',
    )
  })

  it('blocks structural edits made before choosing no reinspection', async () => {
    const assigned = structuredClone(preview)
    assigned.affectedTasks = [
      { ...assigned.affectedTasks[1], status: 'PENDING' },
    ]
    assigned.item.inspection_points = [structuredClone(numericPoint)]
    const api = apiWith({ loadPreview: vi.fn(async () => assigned) })
    renderPage(api)
    fireEvent.click(await screen.findByRole('radio', { name: reinspectChoice }))
    fireEvent.click(screen.getByRole('radio', { name: '文字' }))
    fireEvent.change(screen.getByLabelText('標準文字'), {
      target: { value: '新文字標準' },
    })
    fireEvent.click(screen.getByRole('radio', { name: noReinspectChoice }))
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '不能增減項次或實測欄位',
    )
    expect(api.update).not.toHaveBeenCalled()
  })

  it('focuses the first field error and supports keyboard save and discard', async () => {
    const api = apiWith()
    renderPage(api)
    const firstPointTitle = await screen.findByLabelText('項次標題 *')
    fireEvent.change(firstPointTitle, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }))
    await waitFor(() => expect(firstPointTitle).toHaveFocus())
    expect(firstPointTitle).toHaveAttribute('aria-invalid', 'true')
    expect(firstPointTitle.parentElement).toHaveTextContent('請填寫項次標題')

    fireEvent.change(firstPointTitle, { target: { value: '表面外觀' } })
    fireEvent.keyDown(screen.getByLabelText('查核項目名稱 *'), {
      key: 'Escape',
    })
    const leaveDialog = await screen.findByRole('alertdialog')
    expect(leaveDialog).toHaveClass('confirm-box-danger')
    expect(within(leaveDialog).getByRole('button', { name: '保留編輯' }))
      .toBeInTheDocument()
    expect(within(leaveDialog).getByRole('button', { name: '捨棄變更' }))
      .toBeInTheDocument()
    fireEvent.click(within(leaveDialog).getByRole('button', { name: '保留編輯' }))

    fireEvent.click(await screen.findByRole('radio', { name: reinspectChoice }))
    const form = screen.getByRole('form', { name: '查核項目編輯器' })
    fireEvent.submit(form)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog.querySelector('h2')).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(api.update).not.toHaveBeenCalled()
  })

  it('shows separate danger confirmations for discarding and deleting structure', async () => {
    const twoPoints = structuredClone(preview)
    twoPoints.item.inspection_points[0].id = 'persisted-point-1'
    twoPoints.item.inspection_points.push({
      ...structuredClone(point),
      id: 'persisted-point-2',
      sequence: 2,
      title: '第二項次',
    })
    renderPage(apiWith({ loadPreview: vi.fn(async () => twoPoints) }))
    fireEvent.change(await screen.findByLabelText('查核項目名稱 *'), {
      target: { value: '已修改名稱' },
    })
    fireEvent.click(screen.getByRole('button', { name: '返回專案查核項目' }))
    const leaveDialog = screen.getByRole('alertdialog')
    expect(leaveDialog).toHaveClass('confirm-box-danger')
    expect(within(leaveDialog).getByRole('button', { name: '保留編輯' }))
      .toBeInTheDocument()
    fireEvent.click(within(leaveDialog).getByRole('button', { name: '保留編輯' }))
    expect(screen.getByLabelText('查核項目名稱 *')).toHaveValue('已修改名稱')

    fireEvent.click(screen.getAllByRole('button', { name: '移除此項次' })[0])
    fireEvent.click(screen.getByRole('radio', { name: reinspectChoice }))
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }))
    const saveDialog = screen.getByRole('dialog')
    expect(saveDialog).toHaveClass('confirm-box-danger')
    fireEvent.click(within(saveDialog).getByRole('button', { name: '取消' }))
    expect(screen.getAllByRole('button', { name: '移除此項次' })).toHaveLength(1)
  })

  it('explains each choice in plain words when dispatched Tasks exist (#487)', async () => {
    renderPage(apiWith())
    fireEvent.click(await screen.findByRole('radio', { name: reinspectChoice }))
    fireEvent.click(await screen.findByRole('button', { name: '儲存變更' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).not.toMatch(/Snapshot|Task/)
    expect(screen.getByText(/已完成的任務會退回進行中/)).toBeInTheDocument()
    expect(screen.getByText(/任務狀態、已填的結果與照片都不變/)).toBeInTheDocument()
    expect(
      within(dialog).getByText(/二樓東側.*退回進行中，受影響項目改列待重查/),
    ).toBeInTheDocument()
  })

  it('mentions drafts only when a draft Task is affected (#487)', async () => {
    const pendingOnly = structuredClone(preview)
    pendingOnly.affectedTasks = [
      { ...pendingOnly.affectedTasks[0], id: 'pending', status: 'PENDING' },
    ]
    const first = renderPage(
      apiWith({
        loadPreview: vi.fn(async () => structuredClone(pendingOnly)),
      }),
    )
    fireEvent.click(await screen.findByRole('radio', { name: reinspectChoice }))
    fireEvent.click(await screen.findByRole('button', { name: '儲存變更' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('使用此項目的任務')
    expect(screen.getByRole('dialog')).not.toHaveTextContent(
      '草稿任務不受選擇影響',
    )
    first.unmount()

    const mixed = structuredClone(preview)
    mixed.affectedTasks = [
      mixed.affectedTasks[0],
      { ...mixed.affectedTasks[0], id: 'pending', status: 'PENDING' },
    ]
    renderPage(
      apiWith({ loadPreview: vi.fn(async () => structuredClone(mixed)) }),
    )
    fireEvent.click(await screen.findByRole('radio', { name: reinspectChoice }))
    fireEvent.click(await screen.findByRole('button', { name: '儲存變更' }))
    expect(screen.getByRole('dialog')).toHaveTextContent(
      '草稿任務不受選擇影響',
    )
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

  it('explains that structural changes require choosing reinspection', async () => {
    const api = apiWith({
      update: vi.fn(async () => {
        throw new ManagementApiError(
          422,
          'project_inspection_item.structure_locked',
        )
      }),
    })
    renderPage(api)
    await confirm('yes')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '請選擇「要」重新查核',
    )
  })

  it('shows the points_required message in plain words', async () => {
    const api = apiWith({
      update: vi.fn(async () => {
        throw new ManagementApiError(
          422,
          'project_inspection_item.points_required',
        )
      }),
    })
    renderPage(api)
    await confirm('yes')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '至少要保留一項查核項次。',
    )
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
        name: reinspectChoice,
      }),
    ).not.toBeChecked()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '請重新確認受影響任務',
    )
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

describe('ProjectItemChangePage numeric standard display (#482)', () => {
  function numericPoint(
    standard: Partial<NonNullable<InspectionPoint['numeric_standard']>>,
  ): InspectionPoint {
    // Read shape of a project item: ids are persisted ids and the
    // standard is bound to one number field (TPL-R11).
    return {
      id: 'point-1',
      sequence: 1,
      title: '坡度',
      instruction: '',
      text_standard: null,
      numeric_standard: {
        value: null,
        condition: 'range',
        unit: '%',
        tolerance: null,
        range_form: 'interval',
        lower_bound: '1.0',
        upper_bound: '2.0',
        measurement_field_id: 'field-1',
        ...standard,
      },
      measurement_fields: [
        {
          id: 'field-1',
          name: '坡度',
          field_type: 'number',
          unit: '%',
        },
      ],
      evidence_requirements: [{ min_count: 1 }],
    }
  }

  async function showStandard(standardPoint: InspectionPoint) {
    const api = apiWith({
      loadPreview: vi.fn(async () => ({
        ...structuredClone(preview),
        item: { ...preview.item, inspection_points: [standardPoint] },
      })),
    })
    renderPage(api)
    await waitFor(() => {
      expect(
        document.querySelector('.tpl-point-summary'),
      ).toHaveTextContent(/坡度｜量測/)
    })
    return document.querySelector('.tpl-point-summary') as HTMLElement
  }

  it('shows an interval standard as lower～upper with its unit', async () => {
    const line = await showStandard(numericPoint({}))
    expect(line).toHaveTextContent('1.0～2.0 %')
    expect(line).not.toHaveTextContent('未指定')
  })

  it('shows a tolerance standard as value ± tolerance', async () => {
    const line = await showStandard(
      numericPoint({
        range_form: 'tolerance',
        value: '10',
        tolerance: '0.5',
        lower_bound: null,
        upper_bound: null,
      }),
    )
    expect(line).toHaveTextContent('10 ± 0.5 %')
  })

  it('shows single-sided standards with their operator', async () => {
    const line = await showStandard(
      numericPoint({
        condition: '>=',
        value: '5',
        range_form: null,
        lower_bound: null,
        upper_bound: null,
      }),
    )
    expect(line).toHaveTextContent('≥ 5 %')
  })

  it('shows a clear label when no standard is set', async () => {
    const api = apiWith({
      loadPreview: vi.fn(async () => ({
        ...structuredClone(preview),
        item: {
          ...preview.item,
          inspection_points: [
            { ...point, text_standard: null, numeric_standard: null },
          ],
        },
      })),
    })
    renderPage(api)
    await waitFor(() => {
      expect(document.querySelector('.tpl-point-summary')).toHaveTextContent(
        /表面完整｜量測.*標準未設定/,
      )
    })
  })
})

describe('ProjectItemChangePage double submit and IME Enter (#507)', () => {
  it('saves once when the confirm button is clicked twice', async () => {
    const gate = deferred<ProjectItemChangeResult>()
    const api = apiWith({ update: vi.fn(() => gate.promise) })
    renderPage(api)
    fireEvent.change(await screen.findByLabelText('查核項目名稱 *'), {
      target: { value: '新版檢查項目' },
    })
    fireEvent.click(await screen.findByRole('radio', { name: reinspectChoice }))
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }))
    const confirmButton = screen.getByRole('button', { name: '確認儲存' })

    fireEvent.click(confirmButton)
    fireEvent.click(confirmButton)
    gate.resolve(changed)

    await screen.findByText(/二樓東側.*已完成任務退回進行中/)
    expect(api.update).toHaveBeenCalledTimes(1)
  })

  it('accepts another save after a failed one', async () => {
    const api = apiWith({
      update: vi.fn(async () => {
        throw new ManagementApiError(500, 'server.error')
      }),
    })
    renderPage(api)
    fireEvent.change(await screen.findByLabelText('查核項目名稱 *'), {
      target: { value: '新版檢查項目' },
    })
    fireEvent.click(await screen.findByRole('radio', { name: reinspectChoice }))
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }))
    const confirmButton = screen.getByRole('button', { name: '確認儲存' })

    fireEvent.click(confirmButton)
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1))
    await screen.findAllByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '確認儲存' }))

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2))
  })

  it('ignores IME Enter in the item form', async () => {
    const api = apiWith()
    renderPage(api)
    const title = await screen.findByLabelText('查核項目名稱 *')
    fireEvent.change(title, { target: { value: '新版檢查項目' } })

    expectImeEnterIgnored(title)

    expect(screen.queryByRole('button', { name: '確認儲存' })).toBeNull()
    expect(api.update).not.toHaveBeenCalled()
  })

  it('a repeated submit opens one confirmation (n/a)', async () => {
    const api = apiWith()
    renderPage(api)
    const title = await screen.findByLabelText('查核項目名稱 *')
    fireEvent.click(await screen.findByRole('radio', { name: reinspectChoice }))
    const form = title.closest('form') as HTMLFormElement

    fireEvent.submit(form)
    fireEvent.submit(form)

    expect(screen.getAllByRole('button', { name: '確認儲存' })).toHaveLength(1)
    expect(api.update).not.toHaveBeenCalled()
  })
})
