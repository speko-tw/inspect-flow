import { readFileSync } from 'node:fs'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { HttpFieldError } from '../../http'
import type { OfficePhoto } from './api'
import { OfficePhotoEditor } from './OfficePhotoEditor'

const photo: OfficePhoto = {
  id: 'photo-1',
  task_id: 'task-1',
  item_id: 'item-1',
  is_overview: false,
  point_ids: [],
  caption: null,
  captured_at: '2026-10-01T02:00:00Z',
  uploaded_at: '2026-10-01T02:00:00Z',
  uploaded_by: { name_zh: '測試者', is_me: true },
  capture_source: 'camera',
  layer: {
    enabled: true,
    corner: 'bottom_left',
    offset_x: 0,
    offset_y: 0,
    size: 'large',
    style: 'dark',
    overrides: {},
  },
  labels: {
    project_name: '專案',
    item_title: '項目',
    location: '位置',
    uploader_name: '測試者',
    uploaded_at: '2026-10-01T02:00:00Z',
  },
  layer_render: { render_state: 'fallback_small', effective_size: 'small' },
  voided_at: null,
  void_reason: null,
  deleted_at: null,
  is_non_realtime_capture: false,
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

function renderEditor(
  onSave = vi.fn(async () => true),
  photoOverrides: Partial<OfficePhoto> = {},
  validation: { code?: string; fields?: HttpFieldError[] } | null = null,
) {
  render(
    <OfficePhotoEditor
      busy={false}
      error=""
      validation={validation}
      leaveGuard={{ pending: false, stay: vi.fn(), leave: vi.fn() }}
      onCancel={vi.fn()}
      onDirtyChange={vi.fn()}
      onErrorClear={vi.fn()}
      onSave={onSave}
      photo={{ ...photo, ...photoOverrides }}
      taskId="task-1"
    />,
  )
  return onSave
}

describe('OfficePhotoEditor', () => {
  it('uses rendered label names and the locked inspection notice', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('tab', { name: '圖層' }))
    for (const name of ['工程名稱', '檢驗項目', '檢驗位置']) {
      expect(screen.getByLabelText(name)).toBeEnabled()
    }
    expect(screen.getByLabelText('檢驗人員')).toBeDisabled()
    expect(screen.getByLabelText('檢驗時間')).toBeDisabled()
    expect(
      screen.getByText('檢驗人員與檢驗時間由系統記錄，不能在此修改。'),
    ).toBeVisible()
  })

  it.each([
    ['2026-11-06T15:43:37.141490Z', '2026/11/06 23:43'],
    ['2026-11-06T18:43:37.141490Z', '2026/11/07 02:43'],
  ])('formats the recorded upload time %s in Taipei', (value, expected) => {
    renderEditor(undefined, {
      captured_at: '2000-01-01T00:00:00Z',
      uploaded_at: '2026-01-01T00:00:00Z',
      labels: { ...photo.labels, uploaded_at: value },
    })
    fireEvent.click(screen.getByRole('tab', { name: '圖層' }))
    expect(screen.getByLabelText('檢驗時間')).toHaveValue(expected)
  })

  it('does not invent a missing recorded inspection time', () => {
    renderEditor(undefined, {
      labels: { ...photo.labels, uploaded_at: undefined },
    })
    fireEvent.click(screen.getByRole('tab', { name: '圖層' }))
    expect(screen.getByLabelText('檢驗時間')).toHaveValue('未記錄')
  })

  it('uses rendered names in override validation errors', () => {
    renderEditor(
      undefined,
      {},
      {
        code: 'request.validation_failed',
        fields: ['project_name', 'item_name', 'inspection_location'].map(
          (key) => ({
            path: `/layer/overrides/${key}`,
            code: 'field.too_long',
          }),
        ),
      },
    )
    fireEvent.click(screen.getByRole('tab', { name: '圖層' }))
    for (const name of ['工程名稱', '檢驗項目', '檢驗位置']) {
      expect(screen.getByText(`${name}：輸入內容太長。`)).toBeVisible()
    }
  })

  it('keeps layer offset sliders at least 44px tall', () => {
    const styles = readFileSync(
      'src/admin/evidence/evidence-office.css',
      'utf8',
    )
    expect(styles).toMatch(
      /\.office-tool-controls input\[type='range'\]\s*\{[^}]*height: 44px;/s,
    )
    const controls = Array.from(
      styles.matchAll(/\.office-tool-controls\s*\{([^}]+)\}/g),
      (match) => match[1],
    )
    expect(controls).toHaveLength(1)
    expect(controls[0]).toMatch(/padding-block:\s*16px/)
    expect(controls[0]).toMatch(/padding-inline:\s*0/)
  })

  it('renders a scaled hidden 5×2 preview table', () => {
    renderEditor()
    const preview = document.querySelector('.office-layer-overlay')
    expect(preview).toHaveAttribute('aria-hidden', 'true')
    expect(preview).toHaveClass(
      'office-layer-table',
      'office-layer-table--dark',
    )
    expect(
      preview?.querySelectorAll('.office-layer-table__text'),
    ).toHaveLength(10)
    expect(
      screen.getByText(/工程標示預覽。工程名稱：專案；檢驗項目：項目/),
    ).toBeInTheDocument()
    expect(
      (preview as HTMLElement).style.getPropertyValue('--office-font-ratio'),
    ).toBe('0.02')
    const styles = readFileSync(
      'src/admin/evidence/evidence-office.css',
      'utf8',
    )
    expect(styles).toMatch(
      new RegExp(
        [
          String.raw`\.office-layer-table__value\s*\{[^}]*`,
          String.raw`padding-inline-end:\s*calc\(\s*2 \* `,
          String.raw`min\(100cqi, 100cqb\) \* `,
          String.raw`var\(--office-inner-ratio\)\s*\);`,
        ].join(''),
        's',
      ),
    )
    expect(styles).toMatch(
      /\.office-layer-table\s*>\s*\.office-layer-table__title/,
    )
    expect(styles).toMatch(/box-shadow:\s*inset\s+calc\([\s\S]*?,\s*inset/s)

    fireEvent.click(screen.getByRole('tab', { name: '圖層' }))
    fireEvent.change(screen.getByLabelText('樣式'), {
      target: { value: 'paper' },
    })
    expect(document.querySelector('.office-layer-overlay')).toHaveClass(
      'office-layer-table--paper',
    )
    fireEvent.change(screen.getByLabelText('樣式'), {
      target: { value: 'outline' },
    })
    expect(document.querySelector('.office-layer-overlay')).toHaveClass(
      'office-layer-table--outline',
    )
  })

  it('uses backend label fallbacks for empty preview fields', () => {
    renderEditor(undefined, {
      uploaded_by: { name_zh: 'snapshot-only-name', is_me: false },
      labels: {
        project_name: '',
        item_title: null,
        location: '',
        uploader_name: null,
        uploaded_at: null,
      },
    })
    expect(
      screen.getByText(
        /工程標示預覽。工程名稱：未記錄；檢驗項目：未記錄；檢驗位置：未填寫；檢驗人員：未記錄/,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/snapshot-only-name/)).not.toBeInTheDocument()
  })

  it('shows the fallback for an empty location override', () => {
    renderEditor(undefined, {
      labels: { ...photo.labels, location: '來源位置' },
      layer: {
        ...photo.layer,
        overrides: { inspection_location: '' },
      },
    })
    expect(screen.getByText(/檢驗位置：未填寫/)).toBeInTheDocument()
  })

  it.each(['medium', 'small'] as const)(
    'shows accurate fit guidance for 227px photos at %s size',
    (size) => {
      renderEditor(undefined, {
        variants: {
          ...photo.variants,
          field: { ...photo.variants.field, width: 227, height: 227 },
        },
        layer: { ...photo.layer, size },
        layer_render: { ...photo.layer_render, effective_size: size },
      })
      fireEvent.click(screen.getByRole('tab', { name: '圖層' }))
      expect(document.querySelector('.office-layer-overlay')).toBeNull()
      const note = screen.getByText('這張照片太小，儲存後不會加上工程標示。')
      expect(note).toHaveClass('office-size-note')
      expect(note).toBeVisible()
      expect(screen.queryByText(/請改選「小」/)).toBeNull()
    },
  )

  it('keeps crop selection through arrows and clears explicitly', async () => {
    const user = userEvent.setup()
    renderEditor()
    const handle = screen.getByRole('button', { name: '移動裁切框' })
    const selectionStatus = document.querySelector('.office-selection-status')
    await user.click(handle)
    expect(selectionStatus).toHaveTextContent('已選取：整個裁切框')
    expect(screen.getByText(/按.*微調/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: '小（0.5%）' }))
    await user.click(screen.getByRole('button', { name: '→ 右' }))
    expect(selectionStatus).toHaveTextContent('已選取：整個裁切框')
    expect(document.querySelector('.office-crop-frame')).toHaveStyle({
      left: '8.5%',
    })
    await user.click(screen.getByRole('tab', { name: '圖層' }))
    expect(selectionStatus).not.toHaveTextContent('已選取')
    expect(selectionStatus).toHaveTextContent('微調對象：工程標示')
    await user.click(screen.getByRole('tab', { name: '裁切' }))
    const right = screen.getByRole('button', {
      name: '裁切框右側中點控制點',
    })
    await user.click(right)
    expect(screen.getByText('這個點只能左右微調。')).toBeVisible()
    expect(screen.getByRole('button', { name: '↑ 上' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(selectionStatus).not.toHaveTextContent('已選取')
    expect(right).not.toHaveFocus()
    expect(selectionStatus).toHaveTextContent('微調對象：整個裁切框')
    await user.click(
      screen.getByRole('group', { name: '照片畫面，可用方向鍵平移' }),
    )
    expect(selectionStatus).not.toHaveTextContent('已選取')
  })

  it('clears crop selection when the photo image is clicked', async () => {
    const user = userEvent.setup()
    renderEditor()
    const status = document.querySelector('.office-selection-status')
    await user.click(screen.getByRole('button', { name: '移動裁切框' }))
    expect(status).toHaveTextContent('已選取：整個裁切框')

    await user.click(screen.getByRole('img', { name: '內業版照片預覽' }))

    expect(status).not.toHaveTextContent('已選取')
    expect(status).toHaveTextContent('微調對象：整個裁切框')
    expect(screen.getByRole('main', { name: '編修內業版' })).toBeVisible()
  })

  it('nudges the right crop edge without moving x', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(
      screen.getByRole('button', { name: '裁切框右側中點控制點' }),
    )

    await user.click(screen.getByRole('button', { name: '→ 右' }))

    expect(document.querySelector('.office-crop-frame')).toHaveStyle({
      left: '8%',
      width: '84.5%',
    })
  })

  it('uses the layer target for crop focus on the layer tab', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('tab', { name: '圖層' }))
    const right = screen.getByRole('button', {
      name: '裁切框右側中點控制點',
    })
    await user.click(right)
    expect(screen.getByRole('status')).toHaveTextContent('微調對象：工程標示')

    await user.click(
      screen.getByRole('group', { name: '圖層位置，方向鍵微調' }),
    )
    expect(screen.getByRole('status')).toHaveTextContent('已選取：工程標示')
    expect(screen.getByRole('status')).toHaveTextContent('微調對象：工程標示')
  })

  it('keeps advanced crop limits, ratio and undo', () => {
    renderEditor()
    fireEvent.change(screen.getByLabelText('比例'), {
      target: { value: '4:3' },
    })
    fireEvent.click(screen.getByText('進階裁切數值（X、Y、寬、高）'))
    const width = screen.getByLabelText('寬（%）')
    const beforeWidth = (width as HTMLInputElement).value
    fireEvent.pointerDown(width)
    fireEvent.change(width, { target: { value: '0' } })
    const frame = document.querySelector('.office-crop-frame') as HTMLElement
    const actualWidth = Number.parseFloat(frame.style.width) / 100
    const actualHeight = Number.parseFloat(frame.style.height) / 100
    expect(actualWidth * 1200).toBeGreaterThanOrEqual(64)
    expect((actualWidth * 1200) / (actualHeight * 800)).toBeCloseTo(4 / 3, 2)
    expect(document.querySelectorAll('output')).toHaveLength(4)
    expect(
      Array.from(document.querySelectorAll('output')).some((output) =>
        /^\d+\.\d%$/.test(output.textContent ?? ''),
      ),
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '復原上一步' }))
    expect(screen.getByLabelText('寬（%）')).toHaveValue(beforeWidth)
  })

  it.each(['ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])(
    'snapshots a %s range gesture once and ignores no-op clicks',
    async (key) => {
      const user = userEvent.setup()
      renderEditor()
      await user.click(screen.getByText('進階裁切數值（X、Y、寬、高）'))
      const width = screen.getByLabelText('寬（%）')
      const initial = (width as HTMLInputElement).value
      const undo = screen.getByRole('button', { name: '復原上一步' })
      expect(undo).toBeDisabled()

      fireEvent.pointerDown(width, { pointerId: 1 })
      fireEvent.pointerUp(width, { pointerId: 1 })
      fireEvent.click(width)
      expect(undo).toBeDisabled()

      width.focus()
      fireEvent.keyDown(width, { key })
      fireEvent.change(width, { target: { value: '84.5' } })
      fireEvent.keyDown(width, { key, repeat: true })
      fireEvent.change(width, { target: { value: '85' } })
      fireEvent.keyUp(width, { key })
      expect(width).toHaveValue('85')
      expect(undo).toBeEnabled()

      await user.click(undo)
      expect(width).toHaveValue(initial)
      expect(undo).toBeDisabled()
    },
  )

  it('locks editor controls while pinned to the previous image', async () => {
    const user = userEvent.setup()
    const save = renderEditor()
    const previousToggle = screen.getByRole('button', {
      name: '顯示修改前',
    })
    await user.click(previousToggle)
    expect(previousToggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('目前顯示修改前')).toBeVisible()
    expect(screen.getByLabelText('比例')).toBeDisabled()
    expect(screen.getByLabelText('比例')).toHaveValue('free')
    expect(screen.getByRole('button', { name: '向右旋轉 90°' })).toBeDisabled()
    const confirm = screen.getByRole('button', { name: '確認' })
    expect(confirm).toBeDisabled()
    await user.click(confirm)
    expect(
      screen.queryByRole('button', { name: '確認套用' }),
    ).not.toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('button', { name: '移動裁切框' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '調整' }))
    expect(previousToggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('目前顯示修改前')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/亮度/)).toBeEnabled()
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    await user.click(await screen.findByRole('button', { name: '確認套用' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  })

  it('applies 0.5 and 2 percent layer nudges without a keyboard', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('tab', { name: '圖層' }))
    const overlay = document.querySelector(
      '.office-layer-overlay',
    ) as HTMLElement
    fireEvent.focus(overlay)
    expect(screen.getByRole('status')).toHaveTextContent('已選取：工程標示')
    fireEvent.click(screen.getByText('進階位置（X、Y）'))
    const xPosition = screen.getByLabelText('X 位置（%）')
    fireEvent.click(screen.getByRole('button', { name: '小（0.5%）' }))
    fireEvent.click(screen.getByRole('button', { name: '圖層右移' }))
    expect(xPosition).toHaveValue('0.5')
    fireEvent.click(screen.getByRole('button', { name: '大（2%）' }))
    fireEvent.click(screen.getByRole('button', { name: '圖層右移' }))
    expect(xPosition).toHaveValue('2.5')
  })

  it('saves image edits without writing the fallback layer', async () => {
    const save = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: '確認' }))
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: '確認套用' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        rotation: 0,
        straighten: 0,
        crop: null,
        brightness: 0,
      }),
    )
  })

  it('preselects effective size and sends after a layer edit', async () => {
    const save = renderEditor()
    fireEvent.click(screen.getByRole('tab', { name: '圖層' }))
    expect(screen.getByLabelText('尺寸')).toHaveValue('small')
    fireEvent.change(screen.getByLabelText('樣式'), {
      target: { value: 'paper' },
    })
    fireEvent.click(screen.getByRole('button', { name: '確認' }))
    fireEvent.click(await screen.findByRole('button', { name: '確認套用' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          layer: expect.objectContaining({ size: 'small', style: 'paper' }),
        }),
      ),
    )
  })

  it('sends once after confirmation and never after cancel', async () => {
    const save = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: '確認' }))
    fireEvent.click(await screen.findByRole('button', { name: '繼續編修' }))
    expect(save).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '確認' }))
    const confirm = await screen.findByRole('button', { name: '確認套用' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(
      screen.getByRole('heading', { name: /確認更新內業版/ }),
    ).not.toHaveTextContent('上傳時間')
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  })

  it('labels upload time when no capture time is available', async () => {
    renderEditor(undefined, { captured_at: null })
    fireEvent.click(screen.getByRole('button', { name: '確認' }))
    expect(
      await screen.findByRole('heading', { name: /確認更新內業版/ }),
    ).toHaveTextContent('上傳時間')
  })

  it('exposes eight handles and keyboard crop controls', () => {
    renderEditor()
    expect(
      screen.getAllByRole('button', { name: /裁切框.*控制點/ }),
    ).toHaveLength(8)
    const move = screen.getByRole('button', { name: '移動裁切框' })
    fireEvent.keyDown(move, { key: 'ArrowRight' })
    expect(document.querySelector('.office-crop-frame')).toHaveStyle({
      left: '8.5%',
    })
  })

  it.each([-15, 15])(
    'fills a cropped 1200×800 preview at %s degrees',
    (degrees) => {
      const crop = { x: 0.12, y: 0.15, width: 0.6, height: 0.7 }
      renderEditor(undefined, {
        variants: {
          ...photo.variants,
          office: {
            ...photo.variants.office,
            edit_params: {
              rotation: 0,
              straighten: 0,
              crop,
              brightness: 0,
            },
          },
        },
      })

      fireEvent.change(screen.getByLabelText(/拉直/), {
        target: { value: String(degrees) },
      })

      const image = screen.getByAltText('內業版照片預覽')
      const scale = Number(
        image.style.transform.match(/scale\(([^)]+)\)$/)?.[1],
      )
      const angle = (Math.abs(degrees) * Math.PI) / 180
      const expected = Math.max(
        Math.cos(angle) + (800 / 1200) * Math.sin(angle),
        Math.cos(angle) + (1200 / 800) * Math.sin(angle),
      )

      expect(scale).toBeGreaterThan(1)
      expect(scale).toBeCloseTo(expected, 5)
      expect(document.querySelector('.office-crop-frame')).toHaveStyle({
        left: '12%',
        top: '15%',
        width: '60%',
        height: '70%',
      })
    },
  )

  it('uses Tab and arrow keys for crop and preview movement', async () => {
    const user = userEvent.setup()
    renderEditor()
    const moveCrop = screen.getByRole('button', { name: '移動裁切框' })

    for (let index = 0; index < 20; index += 1) {
      if (document.activeElement === moveCrop) break
      await user.tab()
    }
    expect(moveCrop).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(document.querySelector('.office-crop-frame')).toHaveStyle({
      left: '8.5%',
    })

    await user.click(screen.getByRole('button', { name: '放大' }))
    const stage = screen.getByRole('group', {
      name: '照片畫面，可用方向鍵平移',
    })
    for (let index = 0; index < 30; index += 1) {
      if (document.activeElement === stage) break
      await user.tab()
    }
    expect(stage).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(stage).toHaveStyle({
      transform: 'translate(24px, 0px) scale(1.25)',
    })
  })

  it('uses Space and arrow keys for layer keyboard alternatives', async () => {
    const user = userEvent.setup()
    renderEditor()
    const layerTab = screen.getByRole('tab', { name: '圖層' })
    await user.click(layerTab)

    const enabled = screen.getByRole('checkbox', { name: '顯示工程標示' })
    for (let index = 0; index < 20; index += 1) {
      if (document.activeElement === enabled) break
      await user.tab()
    }
    expect(enabled).toHaveFocus()
    await user.keyboard(' ')
    expect(enabled).not.toBeChecked()
    await user.keyboard(' ')
    expect(enabled).toBeChecked()

    const overlay = screen.getByRole('group', {
      name: '圖層位置，方向鍵微調',
    })
    for (let index = 0; index < 30; index += 1) {
      if (document.activeElement === overlay) break
      await user.tab({ shift: true })
    }
    expect(overlay).toHaveFocus()
    const offset = screen.getByLabelText('X 位置（%）')
    const previousOffset = Number((offset as HTMLInputElement).value)
    await user.keyboard('{ArrowRight}')
    expect(Number((offset as HTMLInputElement).value)).toBe(
      previousOffset + 0.5,
    )
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}')
    expect(Number((offset as HTMLInputElement).value)).toBe(
      previousOffset + 2.5,
    )

    const moveRight = screen.getByRole('button', { name: '圖層右移' })
    for (let index = 0; index < 30; index += 1) {
      if (document.activeElement === moveRight) break
      await user.tab()
    }
    expect(moveRight).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(Number((offset as HTMLInputElement).value)).toBe(previousOffset + 3)
  })

  it('submits the apply confirmation with Enter', async () => {
    const user = userEvent.setup()
    const save = renderEditor()
    await user.click(screen.getByRole('button', { name: '確認' }))
    const apply = await screen.findByRole('button', { name: '確認套用' })
    for (let index = 0; index < 10; index += 1) {
      if (document.activeElement === apply) break
      await user.tab()
    }
    expect(apply).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  })

  it('uses selectOptions as the native-select interaction model', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.selectOptions(screen.getByLabelText('比例'), '1:1')
    expect(screen.getByLabelText('比例')).toHaveValue('1:1')

    await user.click(screen.getByRole('tab', { name: '圖層' }))
    await user.selectOptions(screen.getByLabelText('位置'), 'top_right')
    await user.selectOptions(screen.getByLabelText('樣式'), 'paper')
    expect(screen.getByLabelText('位置')).toHaveValue('top_right')
    expect(screen.getByLabelText('樣式')).toHaveValue('paper')
  })

  it('locks the source ratio and undo restores crop', () => {
    renderEditor()
    fireEvent.change(screen.getByLabelText('比例'), {
      target: { value: '1:1' },
    })
    const frame = document.querySelector('.office-crop-frame')
    expect(frame).toHaveStyle({ width: '55.99999999999999%', height: '84%' })
    fireEvent.click(screen.getByRole('button', { name: '復原上一步' }))
    expect(
      (document.querySelector('.office-crop-frame') as HTMLElement).style
        .width,
    ).toBe('')
  })

  it('hides and restores the layer during comparison', () => {
    renderEditor()
    const compare = screen.getByRole('button', {
      name: '按住不放可看修改前',
    })
    expect(document.querySelector('.office-layer-overlay')).toBeInTheDocument()

    fireEvent.pointerDown(compare)
    expect(
      document.querySelector('.office-layer-overlay'),
    ).not.toBeInTheDocument()
    fireEvent.pointerUp(compare)
    expect(document.querySelector('.office-layer-overlay')).toBeInTheDocument()

    fireEvent.keyDown(compare, { key: ' ' })
    expect(
      document.querySelector('.office-layer-overlay'),
    ).not.toBeInTheDocument()
    fireEvent.keyUp(compare, { key: ' ' })
    expect(document.querySelector('.office-layer-overlay')).toBeInTheDocument()
  })

  it('moves the image, crop, and layer as one preview scene', async () => {
    const save = renderEditor()
    const stage = screen.getByRole('group', {
      name: '照片畫面，可用方向鍵平移',
    })
    const crop = stage.querySelector('.office-crop-frame')
    const layer = stage.querySelector('.office-layer-overlay')
    expect(crop).toBeInTheDocument()
    expect(layer).toBeInTheDocument()

    fireEvent.pointerDown(stage, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerDown(stage, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 200,
      clientY: 100,
    })
    fireEvent.pointerMove(stage, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 220,
      clientY: 100,
    })
    fireEvent.pointerMove(stage, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 240,
      clientY: 100,
    })
    fireEvent.pointerUp(stage, { pointerId: 2, pointerType: 'touch' })
    fireEvent.pointerMove(stage, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 124,
      clientY: 100,
    })
    fireEvent.pointerUp(stage, { pointerId: 1, pointerType: 'touch' })
    expect(stage.style.transform).toMatch(/translate\(24px, 0px\) scale\(/)
    const zoomedTransform = stage.style.transform
    const compare = screen.getByRole('button', {
      name: '按住不放可看修改前',
    })
    const image = screen.getByAltText('內業版照片預覽')
    fireEvent.pointerDown(compare, { pointerId: 3 })
    expect(stage.style.transform).toBe('none')
    expect(image.style.objectFit).toBe('contain')
    fireEvent.pointerUp(compare, { pointerId: 3 })
    expect(stage.style.transform).toBe(zoomedTransform)

    fireEvent.click(screen.getByRole('button', { name: '確認' }))
    fireEvent.click(await screen.findByRole('button', { name: '確認套用' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        rotation: 0,
        straighten: 0,
        crop: null,
        brightness: 0,
      }),
    )
  })

  it('fits the unedited photo while comparing at 90 degrees', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: '向右旋轉 90°' }))
    const stage = screen.getByRole('group', {
      name: '照片畫面，可用方向鍵平移',
    })
    const image = screen.getByAltText('內業版照片預覽')
    expect(stage).toHaveStyle({ aspectRatio: '800 / 1200' })

    const compare = screen.getByRole('button', {
      name: '按住不放可看修改前',
    })
    fireEvent.pointerDown(compare, { pointerId: 1 })
    expect(stage).toHaveStyle({
      aspectRatio: '1200 / 800',
      transform: 'none',
    })
    expect(image).toHaveStyle({
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      filter: 'brightness(1)',
    })
    expect(image.style.transform).toContain('rotate(0deg)')

    fireEvent.pointerUp(compare, { pointerId: 1 })
    expect(stage).toHaveStyle({ aspectRatio: '800 / 1200' })
    expect(image).toHaveStyle({ objectFit: 'fill' })
  })

  it('nudges offsets with arrow keys and direction buttons', async () => {
    const save = renderEditor()
    fireEvent.click(screen.getByRole('tab', { name: '圖層' }))
    const overlay = screen.getByRole('group', {
      name: '圖層位置，方向鍵微調',
    })
    fireEvent.keyDown(overlay, { key: 'ArrowRight' })
    fireEvent.click(screen.getByRole('button', { name: '圖層下移' }))
    fireEvent.click(screen.getByRole('button', { name: '確認' }))
    fireEvent.click(await screen.findByRole('button', { name: '確認套用' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          layer: expect.objectContaining({
            offset_x: expect.closeTo(0.005, 3),
            offset_y: expect.closeTo(0.005, 3),
          }),
        }),
      ),
    )
  })

  it('drags the overlay in image-relative pixels', async () => {
    const save = renderEditor()
    fireEvent.click(screen.getByRole('tab', { name: '圖層' }))
    const overlay = screen.getByRole('group', {
      name: '圖層位置，方向鍵微調',
    })
    const stage = document.querySelector('.office-image-stage')!
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    })
    Object.defineProperty(overlay, 'setPointerCapture', { value: vi.fn() })
    fireEvent.pointerDown(overlay, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 50,
      clientY: 50,
    })
    fireEvent.pointerMove(overlay, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 66.8,
      clientY: 50,
    })
    fireEvent.pointerUp(overlay, { pointerId: 1 })
    fireEvent.click(screen.getByRole('button', { name: '確認' }))
    fireEvent.click(await screen.findByRole('button', { name: '確認套用' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          layer: expect.objectContaining({
            offset_x: expect.closeTo(0.083333, 2),
          }),
        }),
      ),
    )
  })
})
