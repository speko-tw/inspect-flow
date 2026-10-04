import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import TemplatesPage from './TemplatesPage'

const category = { id: 'category-1', name: '土木工程' }
const otherCategory = { id: 'category-2', name: '建築工程' }
const system = {
  id: 'system-1',
  category_id: category.id,
  name: '護欄',
}
const sampleItem = {
  id: 'template-1',
  system_id: system.id,
  sequence: 1,
  title: '欄杆尺寸',
  instruction: '確認尺寸符合圖說',
  inspection_points: [
    {
      id: 'point-1',
      sequence: 1,
      title: '高度',
      instruction: '量測欄杆高度',
      text_standard: null,
      numeric_standard: {
        value: '110',
        condition: '>=',
        unit: 'cm',
        tolerance: null,
        measurement_field_id: 'field-1',
      },
      measurement_fields: [
        {
          id: 'field-1',
          name: '實際高度',
          field_type: 'number',
          unit: null,
        },
        {
          id: 'field-2',
          name: '第二次量測',
          field_type: 'number',
          unit: 'mm',
        },
      ],
      evidence_requirements: [{ min_count: 2 }],
    },
  ],
}

function templateFetch(
  options: {
    categoryError?: number
    writeError?: number
    writeConflict?: boolean
    categories?: Array<{ id: string; name: string }>
    systems?: Array<{ id: string; category_id: string; name: string }>
    items?: Array<Record<string, unknown>>
  } = {},
) {
  const categories = options.categories ?? [category]
  const systems = options.systems ?? [system]
  const items = [...(options.items ?? [sampleItem])]
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined

      if (path === '/api/v1/template-categories' && method === 'GET') {
        if (options.categoryError) {
          return Response.json(
            { error: { code: 'permission.denied' } },
            { status: options.categoryError },
          )
        }
        return Response.json({ items: categories, next_cursor: null })
      }
      if (path === '/api/v1/template-categories' && method === 'POST') {
        const row = { id: `category-${categories.length + 1}`, ...body }
        categories.push(row)
        return Response.json(row, { status: 201 })
      }
      if (
        path.includes('/template-categories/') &&
        path.endsWith('/systems')
      ) {
        const id = path.split('/')[4]
        if (method === 'GET') {
          return Response.json({
            items: systems.filter((row) => row.category_id === id),
            next_cursor: null,
          })
        }
        if (method === 'POST') {
          const row = {
            id: `system-${systems.length + 1}`,
            category_id: id,
            ...body,
          }
          systems.push(row)
          return Response.json(row, { status: 201 })
        }
      }
      if (
        path.startsWith('/api/v1/template-categories/category-') &&
        method === 'PATCH'
      ) {
        if (options.writeConflict) {
          return Response.json(
            { error: { code: 'template.name_conflict' } },
            { status: 409 },
          )
        }
        return Response.json({ id: category.id, ...body })
      }
      if (
        path.startsWith('/api/v1/template-categories/category-') &&
        method === 'DELETE'
      ) {
        return Response.json(
          { error: { code: 'template.category_not_empty' } },
          { status: 409 },
        )
      }
      if (
        path.startsWith('/api/v1/template-systems/system-') &&
        method === 'PATCH'
      ) {
        if (options.writeConflict) {
          return Response.json(
            { error: { code: 'template.name_conflict' } },
            { status: 409 },
          )
        }
        return Response.json({
          id: system.id,
          category_id: category.id,
          ...body,
        })
      }
      if (
        path.startsWith('/api/v1/template-systems/system-') &&
        method === 'DELETE'
      ) {
        return Response.json(
          { error: { code: 'template.system_not_empty' } },
          { status: 409 },
        )
      }
      if (
        path.includes('/template-systems/') &&
        path.endsWith('/templates') &&
        method === 'GET'
      ) {
        return Response.json({ items, next_cursor: null })
      }
      if (path === '/api/v1/templates' && method === 'POST') {
        if (options.writeError) {
          return Response.json(
            {
              error: {
                code:
                  options.writeError === 403
                    ? 'permission.denied'
                    : 'request.validation_failed',
              },
            },
            { status: options.writeError },
          )
        }
        if (options.writeConflict) {
          return Response.json(
            { error: { code: 'template.name_conflict' } },
            { status: 409 },
          )
        }
        const created = { id: 'template-created', ...body }
        items.push(created)
        return Response.json(created, { status: 201 })
      }
      if (path.startsWith('/api/v1/templates/template-') && method === 'PUT') {
        if (options.writeError) {
          return Response.json(
            {
              error: {
                code:
                  options.writeError === 403
                    ? 'permission.denied'
                    : 'request.validation_failed',
              },
            },
            { status: options.writeError },
          )
        }
        return Response.json({ ...body, id: path.split('/').at(-1) })
      }
      if (
        path.startsWith('/api/v1/templates/template-') &&
        method === 'DELETE'
      ) {
        return new Response(null, { status: 204 })
      }
      return Response.json({ items: [], next_cursor: null })
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function openSystem(): Promise<void> {
  const navigation = await screen.findByRole('complementary', {
    name: '範本庫導覽',
  })
  fireEvent.click(
    await within(navigation).findByRole('button', {
      name: '護欄',
    }),
  )
  await screen.findByRole('heading', { name: '護欄' })
}

async function startNewItem(): Promise<void> {
  await openSystem()
  fireEvent.click(screen.getByRole('button', { name: '新增查核項目' }))
  fireEvent.change(screen.getByLabelText(/查核項目名稱/), {
    target: { value: '管線查核' },
  })
  fireEvent.change(screen.getByLabelText(/項次標題/), {
    target: { value: '坡度' },
  })
  fireEvent.change(screen.getByLabelText('標準類型'), {
    target: { value: 'numeric' },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('TemplatesPage', () => {
  it('shows empty state and creates a category', async () => {
    templateFetch({ categories: [], systems: [], items: [] })
    render(<TemplatesPage />)

    expect(
      await screen.findAllByRole('heading', {
        name: '還沒有工程類別',
      }),
    ).toHaveLength(2)
    fireEvent.click(
      screen.getAllByRole('button', {
        name: '新增工程類別',
      })[0],
    )
    fireEvent.change(screen.getByLabelText(/名稱/), {
      target: { value: '橋梁工程' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))

    expect(
      await screen.findByRole('heading', { name: '橋梁工程' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('已新增工程類別')
  })

  it('separates add and rename and preserves draft on duplicate', async () => {
    templateFetch({ categories: [category, otherCategory] })
    render(<TemplatesPage />)
    await screen.findByRole('button', { name: '建築工程' })
    fireEvent.click(screen.getByRole('button', { name: '新增工程類別' }))
    expect(
      screen.getByRole('heading', { name: '新增工程類別' }),
    ).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/名稱/), {
      target: { value: '土木工程' },
    })
    expect(screen.getByText('已有同名項目，請換個名稱')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '儲存' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/名稱/), { target: { value: '' } })
    expect(screen.getByLabelText(/名稱/)).toHaveValue('')
    fireEvent.keyDown(screen.getByLabelText(/名稱/), { key: 'Escape' })
    expect(
      screen.queryByRole('heading', { name: '新增工程類別' }),
    ).not.toBeInTheDocument()
  })

  it('creates numeric items with editable units and posts null', async () => {
    const fetchMock = templateFetch({ items: [] })
    render(<TemplatesPage />)
    await startNewItem()

    await waitFor(() =>
      expect(screen.getByLabelText(/欄位名稱/)).toHaveFocus(),
    )
    fireEvent.change(screen.getByLabelText(/欄位名稱/), {
      target: { value: '坡度' },
    })
    fireEvent.change(screen.getByLabelText(/單位/), {
      target: { value: '%' },
    })
    fireEvent.change(screen.getByLabelText('條件'), {
      target: { value: 'range' },
    })
    fireEvent.change(screen.getByLabelText(/下限/), {
      target: { value: '1' },
    })
    fireEvent.change(screen.getByLabelText(/上限/), {
      target: { value: '3' },
    })
    expect(screen.getByText(/1～3 %/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '儲存查核項目' }))

    await screen.findByRole('status')
    const post = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === '/api/v1/templates' && init?.method === 'POST',
    )
    const body = JSON.parse(String(post?.[1]?.body)) as {
      inspection_points: Array<{
        measurement_fields: Array<{ unit: string | null }>
        numeric_standard: { unit: string }
      }>
    }
    expect(body.inspection_points[0].measurement_fields[0].unit).toBeNull()
    expect(body.inspection_points[0].numeric_standard.unit).toBe('%')
  })

  it('validates units and reversed interval before any request', async () => {
    const fetchMock = templateFetch({ items: [] })
    render(<TemplatesPage />)
    await startNewItem()
    fireEvent.change(screen.getByLabelText(/欄位名稱/), {
      target: { value: '坡度' },
    })
    fireEvent.change(screen.getByLabelText(/單位/), {
      target: { value: '%' },
    })
    fireEvent.change(screen.getByLabelText('條件'), {
      target: { value: 'range' },
    })
    fireEvent.change(screen.getByLabelText(/下限/), {
      target: { value: '3' },
    })
    fireEvent.change(screen.getByLabelText(/上限/), {
      target: { value: '1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存查核項目' }))

    expect(await screen.findAllByText('下限不能大於上限')).not.toHaveLength(0)
    expect(screen.getByRole('alert')).toHaveTextContent('尚有')
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'POST'),
    ).toBe(false)
    expect(document.getElementById('lower-0')).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '下限不能大於上限' }))
    expect(document.getElementById('lower-0')).toHaveFocus()
  })

  it('shows all editor sections and inline validation errors', async () => {
    templateFetch({ items: [] })
    render(<TemplatesPage />)
    await openSystem()
    fireEvent.click(screen.getByRole('button', { name: '新增查核項目' }))

    expect(
      screen.getByRole('heading', { name: '基本資料' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '查核項次' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '要記錄什麼' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '判定標準' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '照片需求與即時預覽' }),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/查核項目名稱/), {
      target: { value: '管線查核' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存查核項目' }))

    expect(await screen.findAllByText('請填寫項次標題')).toHaveLength(2)
    expect(screen.getByRole('alert')).toHaveTextContent('尚有')
    expect(screen.getByLabelText(/項次標題/)).toHaveFocus()
    expect(screen.getByText(/照片 1 張/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/項次標題/), {
      target: { value: '橋面坡度' },
    })
    const pointSummary = document.querySelector(
      '.tpl-point-card > summary',
    ) as HTMLElement
    const pointCard = pointSummary.closest('details') as HTMLDetailsElement
    const pointSections = Array.from(
      pointCard.querySelectorAll('.tpl-point-section'),
    )
    expect(
      pointSections.map((section) => section.getAttribute('aria-label')),
    ).toEqual(['要記錄什麼', '判定標準', '照片與預覽'])
    expect(pointCard).toHaveAttribute('open')
    fireEvent.click(pointSummary as HTMLElement)
    expect(pointCard).not.toHaveAttribute('open')
    expect(pointSummary).toHaveTextContent('橋面坡度')
    fireEvent.click(pointSummary as HTMLElement)
    expect(screen.getByLabelText(/項次標題/)).toHaveValue('橋面坡度')
  })

  it('keeps draft after 403 and switches to read-only', async () => {
    templateFetch({ items: [], writeError: 403 })
    render(<TemplatesPage />)
    await startNewItem()
    fireEvent.change(screen.getByLabelText(/欄位名稱/), {
      target: { value: '坡度' },
    })
    fireEvent.change(screen.getByLabelText(/單位/), {
      target: { value: '%' },
    })
    fireEvent.change(screen.getByLabelText('條件'), {
      target: { value: 'range' },
    })
    fireEvent.change(screen.getByLabelText(/下限/), {
      target: { value: '1' },
    })
    fireEvent.change(screen.getByLabelText(/上限/), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存查核項目' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '已切換為唯讀模式',
    )
    expect(screen.getByLabelText(/查核項目名稱/)).toHaveValue('管線查核')
    expect(screen.getByLabelText(/查核項目名稱/)).toBeDisabled()
  })

  it('keeps the draft after a generic 422 without field paths', async () => {
    const fetchMock = templateFetch({ items: [], writeError: 422 })
    render(<TemplatesPage />)
    await startNewItem()
    fireEvent.change(screen.getByLabelText(/欄位名稱/), {
      target: { value: '坡度' },
    })
    fireEvent.change(screen.getByLabelText(/單位/), {
      target: { value: '%' },
    })
    fireEvent.change(screen.getByLabelText('條件'), {
      target: { value: 'range' },
    })
    fireEvent.change(screen.getByLabelText(/下限/), {
      target: { value: '1' },
    })
    fireEvent.change(screen.getByLabelText(/上限/), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存查核項目' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '範本未儲存，輸入內容已保留',
    )
    expect(screen.getByLabelText(/單位/)).toHaveValue('%')
    expect(screen.getByLabelText(/單位/)).not.toBeDisabled()
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'POST'),
    ).toBe(true)
    expect(screen.queryByText(/欄位路徑/)).not.toBeInTheDocument()
  })

  it('rebinds numeric standard without disabling the unit input', async () => {
    const fetchMock = templateFetch()
    render(<TemplatesPage />)
    await openSystem()
    const navigation = screen.getByRole('complementary', {
      name: '範本庫導覽',
    })
    fireEvent.click(
      await within(navigation).findByRole('button', {
        name: '欄杆尺寸',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: '編輯查核項目' }))

    const unit = screen.getAllByLabelText(/單位/)[0]
    expect(unit).toHaveValue('cm')
    expect(unit).not.toBeDisabled()
    fireEvent.change(unit, { target: { value: 'm' } })
    expect(screen.getByText(/標準單位：m/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/用來判定的數字欄位/), {
      target: { value: 'field-2' },
    })
    const reboundUnit = document.getElementById(
      'field-0-1-unit',
    ) as HTMLInputElement
    expect(reboundUnit).not.toBeDisabled()
    fireEvent.change(reboundUnit, { target: { value: 'cm' } })
    expect(screen.getByText(/標準單位：cm/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '儲存查核項目' }))

    await screen.findByRole('status')
    const put = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === '/api/v1/templates/template-1' &&
        init?.method === 'PUT',
    )
    const body = JSON.parse(String(put?.[1]?.body)) as {
      inspection_points: Array<{
        measurement_fields: Array<{ unit: string | null }>
        numeric_standard: { unit: string }
      }>
    }
    expect(body.inspection_points[0].measurement_fields[1].unit).toBeNull()
    expect(body.inspection_points[0].numeric_standard.unit).toBe('cm')
  })

  it('blocks deletion while a system has children', async () => {
    templateFetch()
    render(<TemplatesPage />)
    await openSystem()
    fireEvent.click(screen.getByRole('button', { name: '刪除' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      '此系統還有查核項目，請先處理項目。',
    )
    expect(
      screen.getAllByRole('button', { name: '欄杆尺寸' }).length,
    ).toBeGreaterThan(0)
  })

  it('guards a dirty draft when switching selection', async () => {
    templateFetch({ categories: [category, otherCategory] })
    render(<TemplatesPage />)
    await openSystem()
    fireEvent.click(screen.getByRole('button', { name: '新增查核項目' }))
    fireEvent.change(screen.getByLabelText(/查核項目名稱/), {
      target: { value: '未儲存項目' },
    })
    fireEvent.click(screen.getByRole('button', { name: '建築工程' }))
    expect(
      screen.getByRole('alertdialog', {
        name: '尚未儲存的變更',
      }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保留編輯' }))
    expect(screen.getByLabelText(/查核項目名稱/)).toHaveValue('未儲存項目')
  })

  it('switches between mobile list and detail panes', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 360,
    })
    templateFetch()
    render(<TemplatesPage />)
    await openSystem()
    expect(document.querySelector('.tpl-layout')).toHaveAttribute(
      'data-pane',
      'detail',
    )
    fireEvent.click(screen.getByRole('button', { name: '‹ 返回清單' }))
    expect(document.querySelector('.tpl-layout')).toHaveAttribute(
      'data-pane',
      'list',
    )
  })

  it('keeps tolerance validation and previews the selected unit', async () => {
    const fetchMock = templateFetch({ items: [] })
    render(<TemplatesPage />)
    await startNewItem()
    fireEvent.change(screen.getByLabelText(/欄位名稱/), {
      target: { value: '坡度' },
    })
    fireEvent.change(screen.getByLabelText(/單位/), {
      target: { value: '%' },
    })
    fireEvent.change(screen.getByLabelText('範圍形式'), {
      target: { value: 'tolerance' },
    })
    fireEvent.change(screen.getByLabelText(/標準值/), {
      target: { value: '3' },
    })
    fireEvent.change(screen.getByLabelText(/容許誤差/), {
      target: { value: '-1' },
    })
    expect(screen.getByText(/3 ± -1 %/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '儲存查核項目' }))
    expect(await screen.findAllByText('容許誤差不能小於 0')).not.toHaveLength(
      0,
    )
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'POST'),
    ).toBe(false)
  })

  it('shows a read-only library after the read API returns 403', async () => {
    templateFetch({ categoryError: 403 })
    render(<TemplatesPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '你沒有權限瀏覽範本庫。',
    )
    expect(
      screen.queryByRole('button', { name: '新增工程類別' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('唯讀瀏覽')).toBeInTheDocument()
  })
})
