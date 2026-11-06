import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DataMemoryRouter } from '../../testing/DataMemoryRouter'
import { ManagementApiError } from '../api'
import {
  deletePhoto,
  editOfficePhoto,
  getOfficePhoto,
  listOfficePhotos,
} from './api'
import type { OfficePhoto } from './api'
import { OfficeEvidencePage } from './OfficeEvidencePage'

vi.mock('./api', () => ({
  deletePhoto: vi.fn(),
  editOfficePhoto: vi.fn(),
  getOfficePhoto: vi.fn(),
  listOfficePhotos: vi.fn(),
  officeImageUrl: (task: string, photo: string, version: string) =>
    `/api/v1/inspection-tasks/${task}/photos/${photo}` +
    `/image?variant=${version}`,
}))

const photo: OfficePhoto = {
  id: 'photo-1',
  task_id: 'task-1',
  item_id: 'item-1',
  is_overview: false,
  point_ids: [],
  caption: null,
  captured_at: null,
  uploaded_at: '2026-10-01T02:00:00Z',
  uploaded_by: { name_zh: '林檢查員', is_me: false },
  capture_source: 'library',
  layer: {
    enabled: true,
    corner: 'bottom_left',
    offset_x: 0,
    offset_y: 0,
    size: 'small',
    style: 'dark',
    overrides: {},
  },
  labels: {
    project_name: '工程',
    item_title: '表面',
    location: '一樓',
    uploader_name: '林檢查員',
    uploaded_at: '2026-10-01T02:00:00Z',
  },
  layer_render: { render_state: null, effective_size: 'small' },
  voided_at: null,
  void_reason: null,
  deleted_at: null,
  is_non_realtime_capture: true,
  has_layer_overrides: false,
  variants: {
    field: { sha256: 'field', width: 1200, height: 800, byte_size: 1000 },
    office: {
      sha256: 'office',
      width: 1200,
      height: 800,
      byte_size: 1000,
      edit_params: {},
      edited_by: null,
      edited_at: null,
    },
  },
}

const items = [
  {
    id: 'item-1',
    current_snapshot: { title: '表面檢查', inspection_points: [] },
  },
]
const voidedPhoto = {
  ...photo,
  id: 'photo-voided',
  voided_at: '2026-10-03T02:00:00Z',
}
const deletedPhoto = {
  ...photo,
  id: 'photo-deleted',
  deleted_at: '2026-10-04T02:00:00Z',
  capture_source: null,
}

function renderPage(canEdit: boolean, canDelete = canEdit) {
  render(
    <DataMemoryRouter
      initialEntries={[
        '/projects/project-1/planning/plan-1/tasks/task-1?tab=photos',
      ]}
    >
      <OfficeEvidencePage
        canDelete={canDelete}
        canEdit={canEdit}
        items={items}
        planId="plan-1"
        projectId="project-1"
        taskId="task-1"
        taskName="現場檢查"
      />
    </DataMemoryRouter>,
  )
}

describe('OfficeEvidencePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listOfficePhotos).mockResolvedValue({
      items: [photo, voidedPhoto, deletedPhoto],
      next_cursor: null,
    })
    vi.mocked(getOfficePhoto).mockResolvedValue({
      ...photo,
      layer_history: {
        items: [
          {
            id: 'event-1',
            actor: { id: null, snapshot: { name_zh: '林檢查員' } },
            occurred_at: '2026-10-02T03:00:00Z',
            before: { layer: photo.layer, labels: photo.labels },
            after: {
              layer: { ...photo.layer, size: 'medium' },
              labels: photo.labels,
            },
          },
        ],
        next_cursor: null,
      },
    })
    vi.mocked(deletePhoto).mockResolvedValue(undefined)
  })

  it('compares variants and shows badges to read-only staff', async () => {
    renderPage(false)
    const viewerButtons = await screen.findAllByRole('button', {
      name: /查看大圖，林檢查員，上傳時間/,
    })
    expect(viewerButtons).toHaveLength(3)
    expect(
      (await screen.findAllByAltText(/現場版，林檢查員/))[0],
    ).toHaveAttribute('src', expect.stringContaining('variant=field'))
    expect(screen.getAllByAltText(/內業版，林檢查員/)[0]).toHaveAttribute(
      'src',
      expect.stringContaining('variant=office'),
    )
    expect(screen.getAllByText('相簿匯入')).toHaveLength(2)
    expect(screen.getByText('非即時拍攝')).toBeInTheDocument()
    expect(screen.getAllByText('標準變更作廢').length).toBeGreaterThan(1)
    expect(screen.getAllByText('已刪除').length).toBeGreaterThan(1)
    expect(
      screen.queryByRole('button', { name: '刪除照片' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '編修內業版' }),
    ).not.toBeInTheDocument()
  })

  it.each([
    ['cancelled or archived', false, false],
    ['completed', true, false],
  ])(
    '%s task exposes only permitted photo actions',
    async (_, canEdit, canDelete) => {
      vi.mocked(listOfficePhotos).mockResolvedValue({
        items: [photo],
        next_cursor: null,
      })
      renderPage(canEdit, canDelete)
      const card = await screen.findByRole('article')

      if (canEdit) {
        expect(
          within(card).getByRole('button', { name: /^編修內業版，/ }),
        ).toBeVisible()
      } else {
        expect(
          within(card).queryByRole('button', { name: /^編修內業版，/ }),
        ).toBeNull()
      }
      if (canDelete) {
        expect(
          within(card).getByRole('button', { name: /^刪除照片，/ }),
        ).toBeVisible()
      } else {
        expect(
          within(card).queryByRole('button', { name: /^刪除照片，/ }),
        ).toBeNull()
      }
    },
  )

  it('opens saved variants for deleted photos without mutations', async () => {
    vi.mocked(listOfficePhotos).mockResolvedValue({
      items: [deletedPhoto],
      next_cursor: null,
    })
    renderPage(false)
    const card = await screen.findByRole('article')
    fireEvent.click(
      within(card).getByRole('button', {
        name: /^查看大圖，林檢查員/,
      }),
    )
    const viewer = await screen.findByRole('dialog', {
      name: /大圖檢視｜林檢查員，上傳時間/,
    })
    expect(within(viewer).getByAltText(/現場版原尺寸/)).toHaveAttribute(
      'src',
      expect.stringContaining('variant=field'),
    )
    expect(within(viewer).getByAltText(/內業版原尺寸/)).toHaveAttribute(
      'src',
      expect.stringContaining('variant=office'),
    )
    expect(
      within(viewer).getByRole('link', { name: '下載現場版原尺寸' }),
    ).toHaveAttribute('download')
    expect(
      within(viewer).getByRole('link', { name: '下載內業版原尺寸' }),
    ).toHaveAttribute('download')
    expect(
      within(viewer).queryByRole('button', { name: /編修|刪除/ }),
    ).not.toBeInTheDocument()
    expect(editOfficePhoto).not.toHaveBeenCalled()
    expect(deletePhoto).not.toHaveBeenCalled()
  })

  it('keeps captured timestamps free of the upload-time prefix', async () => {
    vi.mocked(listOfficePhotos).mockResolvedValue({
      items: [{ ...photo, captured_at: '2026-10-04T02:00:00Z' }],
      next_cursor: null,
    })
    renderPage(false)
    expect(
      await screen.findByRole('button', {
        name: /^查看大圖，林檢查員，(?!上傳時間)/,
      }),
    ).toBeInTheDocument()
  })

  it('uses the saved item label when ids differ', async () => {
    vi.mocked(listOfficePhotos).mockResolvedValue({
      items: [
        {
          ...photo,
          item_id: 'task-item-association-id',
          labels: { ...photo.labels, item_title: '表面檢查' },
        },
        {
          ...photo,
          id: 'overview-first',
          item_id: 'task-item-association-id',
          is_overview: true,
          labels: { ...photo.labels, item_title: '表面檢查' },
        },
      ],
      next_cursor: null,
    })
    renderPage(false)
    expect(
      await screen.findByRole('region', { name: '表面檢查' }),
    ).toBeInTheDocument()
    const cards = await screen.findAllByRole('article')
    expect(cards[0]).toHaveAccessibleName(/林檢查員/)
    expect(cards[0].querySelector('h4')).toHaveTextContent('總覽照片')
    expect(cards[1]).toHaveAccessibleName(/林檢查員/)
    expect(cards[1].querySelector('h4')).toBeNull()
  })

  it('loads per-photo history using the normal detail API', async () => {
    renderPage(false)
    const card = (await screen.findAllByRole('article'))[0]
    fireEvent.click(within(card).getByRole('button', { name: /^查看歷程，/ }))
    expect(
      await screen.findByRole('region', { name: '圖層修改歷程' }),
    ).toBeInTheDocument()
    expect(getOfficePhoto).toHaveBeenCalledWith('task-1', 'photo-1')
    expect(
      screen.getByText('林檢查員・2026年10月2日 上午11:00'),
    ).toBeInTheDocument()
  })

  it('shows label override states across history', async () => {
    const inherited = { ...photo.layer, overrides: {} }
    const explicit = {
      ...photo.layer,
      overrides: {
        project_name: '',
        item_name: '自訂項目',
        inspection_location: '北側',
      },
    }
    const afterRemoval = {
      ...photo.layer,
      overrides: { item_name: '自訂項目', inspection_location: '' },
    }
    vi.mocked(getOfficePhoto).mockResolvedValue({
      ...photo,
      layer_history: {
        items: [
          {
            id: 'added',
            actor: { id: null, snapshot: { name_zh: '林檢查員' } },
            occurred_at: '2026-10-02T03:00:00Z',
            before: { layer: inherited, labels: photo.labels },
            after: { layer: explicit, labels: photo.labels },
          },
          {
            id: 'removed',
            actor: { id: null, snapshot: { name_zh: '林檢查員' } },
            occurred_at: '2026-10-03T03:00:00Z',
            before: { layer: explicit, labels: photo.labels },
            after: { layer: afterRemoval, labels: photo.labels },
          },
        ],
        next_cursor: null,
      },
    })
    renderPage(false)
    const card = (await screen.findAllByRole('article'))[0]
    fireEvent.click(within(card).getByRole('button', { name: /^查看歷程，/ }))
    const history = await screen.findByRole('region', {
      name: '圖層修改歷程',
    })
    const records = within(history).getAllByRole('listitem')
    expect(records).toHaveLength(2)

    const expectRecord = (record: HTMLElement, date: string) => {
      expect(within(record).getByText(`林檢查員・${date}`)).toBeInTheDocument()
      fireEvent.click(within(record).getByText('查看修改前後'))
    }
    const valuesIn = (record: HTMLElement, title: string) => {
      const heading = within(record).getByRole('heading', { name: title })
      const values = heading.closest('.office-history-values')
      expect(values).not.toBeNull()
      return within(values as HTMLElement)
    }

    expectRecord(records[0], '2026年10月2日 上午11:00')
    const addedBefore = valuesIn(records[0], '修改前')
    const addedAfter = valuesIn(records[0], '修改後')
    expect(addedBefore.getByText('沿用來源：工程')).toBeVisible()
    expect(addedBefore.getByText('沿用來源：表面')).toBeVisible()
    expect(addedBefore.getByText('沿用來源：一樓')).toBeVisible()
    expect(addedAfter.getByText('明示空字串')).toBeVisible()
    expect(addedAfter.getByText('覆寫：自訂項目')).toBeVisible()
    expect(addedAfter.getByText('覆寫：北側')).toBeVisible()

    expectRecord(records[1], '2026年10月3日 上午11:00')
    const removedBefore = valuesIn(records[1], '修改前')
    const removedAfter = valuesIn(records[1], '修改後')
    expect(removedBefore.getByText('明示空字串')).toBeVisible()
    expect(removedBefore.getByText('覆寫：自訂項目')).toBeVisible()
    expect(removedBefore.getByText('覆寫：北側')).toBeVisible()
    expect(removedAfter.getByText('沿用來源：工程')).toBeVisible()
    expect(removedAfter.getByText('覆寫：自訂項目')).toBeVisible()
    expect(removedAfter.getByText('明示空字串')).toBeVisible()
  })

  it('reloads with explicit voided filters', async () => {
    renderPage(false)
    await screen.findAllByRole('article')
    fireEvent.change(screen.getByLabelText('照片狀態'), {
      target: { value: 'voided' },
    })
    await waitFor(() =>
      expect(listOfficePhotos).toHaveBeenLastCalledWith(
        'task-1',
        { voided: true, deleted: false },
        undefined,
      ),
    )
  })

  it('confirms one soft-delete and reloads the list', async () => {
    vi.mocked(listOfficePhotos).mockResolvedValue({
      items: [photo],
      next_cursor: null,
    })
    renderPage(true)
    const card = await screen.findByRole('article')
    fireEvent.click(within(card).getByRole('button', { name: /^刪除照片，/ }))
    fireEvent.click(await screen.findByRole('button', { name: '確認刪除' }))
    await waitFor(() => expect(deletePhoto).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(listOfficePhotos).toHaveBeenCalledTimes(2))
  })

  it('reloads after malformed OFFICE success without retrying', async () => {
    vi.mocked(listOfficePhotos).mockResolvedValue({
      items: [photo],
      next_cursor: null,
    })
    vi.mocked(editOfficePhoto).mockResolvedValue({
      id: photo.id,
    } as OfficePhoto)
    renderPage(true)
    const card = await screen.findByRole('article')
    fireEvent.click(
      within(card).getByRole('button', { name: /^編修內業版，/ }),
    )
    await screen.findByRole('heading', { name: '編修內業版' })
    fireEvent.click(screen.getByRole('button', { name: '確認' }))
    fireEvent.click(await screen.findByRole('button', { name: '確認套用' }))
    const alerts = await within(
      screen.getByRole('main', { name: '編修內業版' }),
    ).findAllByRole('alert')
    expect(alerts.map((alert) => alert.textContent)).toContain(
      '照片操作失敗，請重新載入後再試。',
    )
    expect(editOfficePhoto).toHaveBeenCalledTimes(1)
    expect(listOfficePhotos).toHaveBeenCalledTimes(2)
  })

  it('maps crop validation errors to its field and focuses it', async () => {
    const error = new ManagementApiError(422, 'evidence.invalid_edit')
    error.fields = [{ path: '/crop/width', code: 'field.too_short' }]
    vi.mocked(editOfficePhoto).mockRejectedValueOnce(error)
    renderPage(true)
    const card = (await screen.findAllByRole('article'))[0]
    fireEvent.click(within(card).getByRole('button', { name: /編修內業版/ }))
    fireEvent.click(await screen.findByRole('button', { name: '確認' }))
    fireEvent.click(await screen.findByRole('button', { name: '確認套用' }))

    const editTab = await screen.findByRole('tab', { name: '裁切' })
    await waitFor(() =>
      expect(editTab).toHaveAttribute('aria-selected', 'true'),
    )
    const panel = screen.getByRole('tabpanel')
    const alert = await within(panel).findByRole('alert')
    expect(alert.textContent).toBe('裁切寬度：輸入內容太短。')
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '裁切框e控制點' }),
      ).toHaveFocus(),
    )
  })

  it('maps layer validation errors and focuses a layer control', async () => {
    const error = new ManagementApiError(422, 'request.validation_failed')
    error.fields = [{ path: '/layer/offset_x', code: 'field.out_of_range' }]
    vi.mocked(editOfficePhoto).mockRejectedValueOnce(error)
    renderPage(true)
    const card = (await screen.findAllByRole('article'))[0]
    fireEvent.click(within(card).getByRole('button', { name: /編修內業版/ }))
    fireEvent.click(await screen.findByRole('tab', { name: '圖層' }))
    fireEvent.change(screen.getByLabelText('樣式'), {
      target: { value: 'paper' },
    })
    fireEvent.click(screen.getByRole('button', { name: '確認' }))
    fireEvent.click(await screen.findByRole('button', { name: '確認套用' }))

    const layerTab = await screen.findByRole('tab', { name: '圖層' })
    await waitFor(() =>
      expect(layerTab).toHaveAttribute('aria-selected', 'true'),
    )
    const panel = screen.getByRole('tabpanel')
    const alert = await within(panel).findByRole('alert')
    expect(alert.textContent).toBe('工程標示水平位移：數值超出允許範圍。')
    await waitFor(() =>
      expect(screen.getByLabelText('水平位移')).toHaveFocus(),
    )
    expect(screen.getByLabelText('水平位移')).toHaveAccessibleDescription(
      '工程標示水平位移：數值超出允許範圍。',
    )
  })

  it('keeps brightness errors on its pane after correction', async () => {
    const error = new ManagementApiError(422, 'request.validation_failed')
    error.fields = [{ path: '/brightness', code: 'field.out_of_range' }]
    vi.mocked(editOfficePhoto).mockRejectedValueOnce(error)
    renderPage(true)
    const card = (await screen.findAllByRole('article'))[0]
    fireEvent.click(within(card).getByRole('button', { name: /編修內業版/ }))
    fireEvent.click(await screen.findByRole('button', { name: '確認' }))
    fireEvent.click(await screen.findByRole('button', { name: '確認套用' }))

    const adjustTab = await screen.findByRole('tab', { name: '調整' })
    await waitFor(() =>
      expect(adjustTab).toHaveAttribute('aria-selected', 'true'),
    )
    const panel = screen.getByRole('tabpanel')
    const alert = await within(panel).findByRole('alert')
    const brightness = screen.getByRole('slider', { name: /亮度/ })
    expect(alert.textContent).toBe('亮度：數值超出允許範圍。')
    await waitFor(() => expect(brightness).toHaveFocus())
    expect(brightness).toHaveAccessibleDescription('亮度：數值超出允許範圍。')

    fireEvent.change(brightness, { target: { value: '12' } })
    expect(screen.getByRole('tab', { name: '調整' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(brightness).toHaveFocus()
    expect(
      within(screen.getByRole('tabpanel')).queryByRole('alert'),
    ).toBeNull()
  })

  it.each([
    ['evidence.invalid_edit', '裁切', '比例'],
    ['evidence.invalid_layer', '圖層', '位置'],
  ])(
    'uses a pane fallback for %s without field details',
    async (code, tabName, controlName) => {
      vi.mocked(editOfficePhoto).mockRejectedValueOnce(
        new ManagementApiError(422, code),
      )
      renderPage(true)
      const card = (await screen.findAllByRole('article'))[0]
      fireEvent.click(within(card).getByRole('button', { name: /編修內業版/ }))
      fireEvent.click(await screen.findByRole('button', { name: '確認' }))
      fireEvent.click(await screen.findByRole('button', { name: '確認套用' }))

      expect(
        await screen.findByRole('tab', { name: tabName }),
      ).toHaveAttribute('aria-selected', 'true')
      await waitFor(() =>
        expect(screen.getByLabelText(controlName)).toHaveFocus(),
      )
      const panel = screen.getByRole('tabpanel')
      const alert = await within(panel).findByRole('alert')
      expect(alert.textContent).toBe(
        code === 'evidence.invalid_edit'
          ? '影像編修範圍不符合限制，請檢查裁切或亮度設定。'
          : '圖層設定無法放入這張照片，請調整工程標示。',
      )
    },
  )

  it('keeps an unsaved editor open when the user stays', async () => {
    vi.mocked(listOfficePhotos).mockResolvedValue({
      items: [photo],
      next_cursor: null,
    })
    renderPage(true)
    fireEvent.click(
      await screen.findByRole('button', { name: /^編修內業版，/ }),
    )
    await screen.findByRole('heading', { name: '編修內業版' })
    fireEvent.click(screen.getByRole('tab', { name: '調整' }))
    fireEvent.change(await screen.findByRole('slider', { name: /亮度/ }), {
      target: { value: '10' },
    })
    const cancelButton = screen.getByRole('button', { name: '取消' })
    cancelButton.focus()
    fireEvent.click(cancelButton)
    fireEvent.click(await screen.findByRole('button', { name: '繼續編修' }))
    expect(
      screen.getByRole('heading', { name: '編修內業版' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(cancelButton).toHaveFocus())
  })
})
