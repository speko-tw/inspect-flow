import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import TemplatesPage from './TemplatesPage'
import wireFixture from './fixtures/template-item-payload.json'
import type { TemplateItem } from './api'

const category = { id: 'category-1', name: '土木工程' }
const otherCategory = { id: 'category-2', name: '建築工程' }
const system = {
  id: 'system-1',
  category_id: category.id,
  name: '護欄',
}
const secondSystem = {
  id: 'system-2',
  category_id: category.id,
  name: '排水',
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

function hasValidWireContract(value: unknown): boolean {
  const exactKeys = (row: Record<string, unknown>, keys: string[]) =>
    Object.keys(row).sort().join(',') === [...keys].sort().join(',')
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  if (
    !exactKeys(item, [
      'system_id',
      'sequence',
      'title',
      'instruction',
      'inspection_points',
    ]) ||
    !Array.isArray(item.inspection_points)
  ) {
    return false
  }
  return item.inspection_points.every((rawPoint) => {
    if (!rawPoint || typeof rawPoint !== 'object') return false
    const point = rawPoint as Record<string, unknown>
    if (
      !exactKeys(point, [
        'sequence',
        'title',
        'instruction',
        'measurement_fields',
        'numeric_standard',
        'text_standard',
        'evidence_requirements',
      ]) ||
      !Array.isArray(point.measurement_fields) ||
      !Array.isArray(point.evidence_requirements)
    ) {
      return false
    }
    const standard = point.numeric_standard as Record<string, unknown> | null
    const boundClientId = standard?.measurement_field_client_id
    const fields = point.measurement_fields as Array<Record<string, unknown>>
    const matchingFields = fields.filter(
      (field) => field.client_id === boundClientId,
    )
    if (standard && matchingFields.length !== 1) return false
    return (
      fields.every((field) => {
        if (
          !exactKeys(field, ['client_id', 'name', 'field_type', 'unit']) ||
          typeof field.client_id !== 'string' ||
          typeof field.name !== 'string'
        ) {
          return false
        }
        if (field.field_type === 'text') return field.unit === null
        if (field.field_type !== 'number') return false
        const isBound = field.client_id === boundClientId
        return isBound
          ? field.unit === null
          : typeof field.unit === 'string' && field.unit.trim().length > 0
      }) &&
      (!standard ||
        (exactKeys(standard, [
          'value',
          'condition',
          'unit',
          'tolerance',
          'range_form',
          'lower_bound',
          'upper_bound',
          'measurement_field_client_id',
        ]) &&
          typeof standard.unit === 'string' &&
          standard.unit.trim().length > 0))
    )
  })
}

function templateFetch(
  options: {
    categoryError?: number
    writeError?: number
    writeConflict?: boolean
    deleteSuccess?: boolean
    validateWire?: boolean
    categories?: Array<{ id: string; name: string; system_count?: number }>
    systems?: Array<{
      id: string
      category_id: string
      name: string
      item_count?: number
    }>
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
        if (!options.deleteSuccess) {
          return Response.json(
            { error: { code: 'template.category_not_empty' } },
            { status: 409 },
          )
        }
        const id = path.split('/').at(-1)
        const index = categories.findIndex((row) => row.id === id)
        if (index >= 0) categories.splice(index, 1)
        return new Response(null, { status: 204 })
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
        if (options.deleteSuccess) {
          const id = path.split('/').at(-1)
          const index = systems.findIndex((row) => row.id === id)
          if (index >= 0) systems.splice(index, 1)
          return new Response(null, { status: 204 })
        }
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
        const systemId = path.split('/')[4]
        return Response.json({
          items: items.filter((item) => item.system_id === systemId),
          next_cursor: null,
        })
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
        if (options.validateWire && !hasValidWireContract(body)) {
          return Response.json(
            { error: { code: 'request.validation_failed' } },
            { status: 422 },
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
        if (options.validateWire && !hasValidWireContract(body)) {
          return Response.json(
            { error: { code: 'request.validation_failed' } },
            { status: 422 },
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
  fireEvent.click(screen.getByRole('radio', { name: '數值' }))
}

afterEach(() => vi.unstubAllGlobals())

describe('TemplatesPage', () => {
  it('prefills a first field and follows its title until edited', async () => {
    templateFetch({ items: [] })
    render(<TemplatesPage />)
    await openSystem()
    fireEvent.click(screen.getByRole('button', { name: '新增查核項目' }))
    fireEvent.click(screen.getByRole('radio', { name: '數值' }))
    const name = document.getElementById('field-0-0-name')!
    expect(name).toHaveValue('')
    fireEvent.change(screen.getByLabelText(/項次標題/), {
      target: { value: '厚度' },
    })
    expect(name).toHaveValue('厚度')
    fireEvent.change(screen.getByLabelText(/項次標題/), {
      target: { value: '板厚' },
    })
    expect(name).toHaveValue('板厚')
    fireEvent.change(name, { target: { value: '實測板厚' } })
    fireEvent.change(screen.getByLabelText(/項次標題/), {
      target: { value: '完成厚度' },
    })
    expect(name).toHaveValue('實測板厚')
    fireEvent.change(screen.getByLabelText(/項次標題/), {
      target: { value: '' },
    })
    expect(name).toHaveValue('實測板厚')
  })

  it('prefills only the first manual field', async () => {
    templateFetch({ items: [] })
    render(<TemplatesPage />)
    await openSystem()
    fireEvent.click(screen.getByRole('button', { name: '新增查核項目' }))
    fireEvent.change(screen.getByLabelText(/項次標題/), {
      target: { value: '管線接頭' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增實測欄位' }))
    const first = document.getElementById('field-0-0-name')
    expect(first).toHaveValue('管線接頭')
    fireEvent.click(screen.getByRole('button', { name: '新增實測欄位' }))
    const second = document.getElementById('field-0-1-name')!
    expect(second).toHaveValue('')
    await waitFor(() => expect(second).toHaveFocus())
    fireEvent.change(screen.getByLabelText(/項次標題/), {
      target: { value: '接頭' },
    })
    expect(first).toHaveValue('接頭')
    expect(second).toHaveValue('')
  })

  it('links equal persisted names and preserves different names', async () => {
    const item = structuredClone(sampleItem)
    item.inspection_points[0].measurement_fields[0].name = '高度'
    templateFetch({ items: [item] })
    render(<TemplatesPage />)
    await openSystem()
    fireEvent.click(screen.getByRole('button', { name: '欄杆尺寸' }))
    fireEvent.click(screen.getByRole('button', { name: '編輯查核項目' }))
    fireEvent.change(screen.getByLabelText(/項次標題/), {
      target: { value: '立柱高度' },
    })
    const first = document.getElementById('field-0-0-name')
    const second = document.getElementById('field-0-1-name')
    expect(first).toHaveValue('立柱高度')
    expect(second).toHaveValue('第二次量測')
  })

  it('focuses new and selected point titles', async () => {
    templateFetch({ items: [] })
    render(<TemplatesPage />)
    await openSystem()
    fireEvent.click(screen.getByRole('button', { name: '新增查核項目' }))
    fireEvent.click(screen.getByRole('button', { name: '新增查核項次' }))
    const cards = document.querySelectorAll('.tpl-point-card')
    expect(cards[0]).not.toHaveAttribute('open')
    expect(cards[1]).toHaveAttribute('open')
    await waitFor(() =>
      expect(document.getElementById('point-1-title')).toHaveFocus(),
    )
    fireEvent.click(cards[0].querySelector('summary')!)
    expect(cards[0]).toHaveAttribute('open')
    expect(cards[1]).not.toHaveAttribute('open')
    await waitFor(() =>
      expect(document.getElementById('point-0-title')).toHaveFocus(),
    )
    fireEvent.click(cards[0].querySelector('summary')!)
    expect(cards[0]).not.toHaveAttribute('open')
    expect(cards[1]).not.toHaveAttribute('open')
  })

  it('opens invalid points and preserves focus while typing in the first', async () => {
    templateFetch({ items: [] })
    render(<TemplatesPage />)
    await openSystem()
    fireEvent.click(screen.getByRole('button', { name: '新增查核項目' }))
    fireEvent.change(screen.getByLabelText(/查核項目名稱/), {
      target: { value: '管線查核' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增查核項次' }))
    fireEvent.click(screen.getByRole('button', { name: '新增查核項次' }))
    fireEvent.change(document.getElementById('point-1-title')!, {
      target: { value: '已完成' },
    })
    fireEvent.change(document.getElementById('point-2-title')!, {
      target: { value: '已完成' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存查核項目' }))
    const cards = document.querySelectorAll('.tpl-point-card')
    await waitFor(() => expect(cards[0]).toHaveAttribute('open'))
    expect(cards[0]).toHaveAttribute('open')
    expect(cards[1]).not.toHaveAttribute('open')
    expect(cards[2]).toHaveAttribute('open')
    expect(cards[0].querySelector('summary')).toHaveTextContent('待修正 1')
    expect(cards[1].querySelector('summary')).not.toHaveTextContent('待修正')
    await waitFor(() =>
      expect(document.getElementById('point-0-title')).toHaveFocus(),
    )
    const firstTitle = document.getElementById('point-0-title')!
    fireEvent.change(firstTitle, { target: { value: 'A' } })
    fireEvent.change(firstTitle, { target: { value: 'AB' } })
    expect(firstTitle).toHaveValue('AB')
    expect(cards[0]).toHaveAttribute('open')
    expect(firstTitle).toHaveFocus()
  })

  it('keeps a non-current invalid point open while typing after save', async () => {
    templateFetch({ items: [] })
    render(<TemplatesPage />)
    await openSystem()
    fireEvent.click(screen.getByRole('button', { name: '新增查核項目' }))
    fireEvent.change(screen.getByLabelText(/查核項目名稱/), {
      target: { value: '管線查核' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增查核項次' }))
    fireEvent.click(screen.getByRole('button', { name: '新增查核項次' }))
    fireEvent.change(document.getElementById('point-1-title')!, {
      target: { value: '已完成' },
    })
    fireEvent.click(
      document
        .querySelectorAll('.tpl-point-card')[2]
        .querySelector('summary')!,
    )
    expect(
      [...document.querySelectorAll('.tpl-point-card')].every(
        (card) => !card.hasAttribute('open'),
      ),
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '儲存查核項目' }))

    const cards = document.querySelectorAll('.tpl-point-card')
    await waitFor(() => expect(cards[0]).toHaveAttribute('open'))
    expect(cards[0]).toHaveAttribute('open')
    expect(cards[1]).not.toHaveAttribute('open')
    expect(cards[2]).toHaveAttribute('open')
    await waitFor(() =>
      expect(document.getElementById('point-0-title')).toHaveFocus(),
    )
    const firstTitle = document.getElementById('point-0-title')!
    fireEvent.change(firstTitle, { target: { value: 'A' } })
    fireEvent.change(firstTitle, { target: { value: 'AB' } })
    expect(firstTitle).toHaveValue('AB')
    expect(cards[0]).toHaveAttribute('open')
    expect(firstTitle).toHaveFocus()
  })

  it('keeps the third invalid point open while typing XY', async () => {
    templateFetch({ items: [] })
    render(<TemplatesPage />)
    await openSystem()
    fireEvent.click(screen.getByRole('button', { name: '新增查核項目' }))
    fireEvent.change(screen.getByLabelText(/查核項目名稱/), {
      target: { value: '管線查核' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增查核項次' }))
    fireEvent.click(screen.getByRole('button', { name: '新增查核項次' }))
    fireEvent.change(document.getElementById('point-1-title')!, {
      target: { value: '已完成' },
    })
    fireEvent.change(document.getElementById('point-2-title')!, {
      target: { value: '已完成' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存查核項目' }))

    const cards = document.querySelectorAll('.tpl-point-card')
    await waitFor(() =>
      expect(document.getElementById('point-0-title')).toHaveFocus(),
    )
    const thirdTitle = document.getElementById('point-2-title')!
    thirdTitle.focus()
    fireEvent.change(thirdTitle, { target: { value: 'X' } })
    fireEvent.change(thirdTitle, { target: { value: 'XY' } })
    expect(thirdTitle).toHaveValue('XY')
    expect(cards[2]).toHaveAttribute('open')
    expect(thirdTitle).toHaveFocus()
  })

  it('keeps remaining errors open and closes a corrected point on expansion', async () => {
    templateFetch({ items: [] })
    render(<TemplatesPage />)
    await openSystem()
    fireEvent.click(screen.getByRole('button', { name: '新增查核項目' }))
    fireEvent.change(screen.getByLabelText(/查核項目名稱/), {
      target: { value: '管線查核' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增查核項次' }))
    fireEvent.click(screen.getByRole('button', { name: '新增查核項次' }))
    fireEvent.change(document.getElementById('point-1-title')!, {
      target: { value: '已完成' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存查核項目' }))

    const cards = document.querySelectorAll('.tpl-point-card')
    await waitFor(() => expect(cards[0]).toHaveAttribute('open'))
    expect(cards[0]).toHaveAttribute('open')
    expect(cards[2]).toHaveAttribute('open')
    fireEvent.change(document.getElementById('point-2-title')!, {
      target: { value: '修正完成' },
    })
    fireEvent.click(cards[1].querySelector('summary')!)

    expect(cards[0]).toHaveAttribute('open')
    expect(cards[1]).toHaveAttribute('open')
    expect(cards[2]).not.toHaveAttribute('open')
  })

  it('allows manually collapsing an expanded invalid point', async () => {
    templateFetch({ items: [] })
    render(<TemplatesPage />)
    await openSystem()
    fireEvent.click(screen.getByRole('button', { name: '新增查核項目' }))
    fireEvent.change(screen.getByLabelText(/查核項目名稱/), {
      target: { value: '管線查核' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增查核項次' }))
    fireEvent.click(screen.getByRole('button', { name: '新增查核項次' }))
    fireEvent.click(screen.getByRole('button', { name: '新增查核項次' }))
    fireEvent.change(document.getElementById('point-1-title')!, {
      target: { value: '已完成' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存查核項目' }))

    const cards = document.querySelectorAll('.tpl-point-card')
    await waitFor(() => expect(cards[0]).toHaveAttribute('open'))
    expect(cards[0]).toHaveAttribute('open')
    fireEvent.click(cards[0].querySelector('summary')!)
    expect(cards[0]).not.toHaveAttribute('open')
  })

  it('shows empty state and creates a category', async () => {
    templateFetch({ categories: [], systems: [], items: [] })
    render(<TemplatesPage />)

    expect(
      await screen.findAllByRole('heading', {
        name: '還沒有工程類別',
      }),
    ).toHaveLength(1)
    fireEvent.click(
      screen.getAllByRole('button', {
        name: '新增工程類別',
      })[0],
    )
    fireEvent.change(screen.getByLabelText(/名稱/), {
      target: { value: '橋梁工程' },
    })
    // 表單按鈕固定排成 [取消][儲存]，只有儲存是主要按鈕（#500）。
    const form = screen.getByLabelText(/名稱/).closest('form') as HTMLElement
    const formButtons = within(form).getAllByRole('button')
    expect(formButtons.map((button) => button.textContent)).toEqual([
      '取消',
      '儲存',
    ])
    expect(formButtons[0]).not.toHaveClass('btn-primary')
    expect(formButtons[1]).toHaveClass('btn-primary')
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))

    expect(
      await screen.findByRole('heading', { name: '橋梁工程' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('已新增工程類別')
  })

  it('selects a neighboring category after deleting one', async () => {
    const fetchMock = templateFetch({
      categories: [category, otherCategory],
      items: [],
      deleteSuccess: true,
    })
    render(<TemplatesPage />)
    await screen.findByRole('button', { name: '建築工程' })
    const navigation = await screen.findByRole('complementary', {
      name: '範本庫導覽',
    })
    fireEvent.click(
      await within(navigation).findByRole('button', { name: '建築工程' }),
    )
    // 刪除是觸發鈕（次要）；不可復原的最終確認才用 btn-danger（#500）。
    const trigger = screen.getByRole('button', { name: '刪除' })
    expect(trigger).not.toHaveClass('btn-danger')
    fireEvent.click(trigger)
    const confirmBox = screen.getByRole('group', { name: '刪除確認' })
    expect(
      within(confirmBox)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['取消', '確認刪除'])
    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }))

    expect(
      await screen.findByRole('heading', { name: '土木工程' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('還沒有工程類別')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新命名' }))
    expect(await screen.findByLabelText(/名稱/)).toHaveValue('土木工程')
    fireEvent.change(screen.getByLabelText(/名稱/), {
      target: { value: '保留的工程類別' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await screen.findByRole('status')
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith('/template-categories/category-1') &&
          init?.method === 'PATCH',
      ),
    ).toBe(true)
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith('/template-categories/category-2') &&
          init?.method === 'PATCH',
      ),
    ).toBe(false)
  })

  it('deletes a system without retaining its name as the selected category', async () => {
    const fetchMock = templateFetch({
      systems: [system, secondSystem],
      items: [],
      deleteSuccess: true,
    })
    render(<TemplatesPage />)
    const navigation = await screen.findByRole('complementary', {
      name: '範本庫導覽',
    })
    fireEvent.click(
      await within(navigation).findByRole('button', { name: '排水' }),
    )
    await screen.findByRole('heading', { name: '排水' })
    fireEvent.click(screen.getByRole('button', { name: '刪除' }))
    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }))
    await screen.findByRole('heading', { name: '土木工程' })
    fireEvent.click(within(navigation).getByRole('button', { name: '護欄' }))
    await screen.findByRole('heading', { name: '護欄' })
    fireEvent.click(screen.getByRole('button', { name: '重新命名' }))
    expect(await screen.findByLabelText(/名稱/)).toHaveValue('護欄')
    fireEvent.change(screen.getByLabelText(/名稱/), {
      target: { value: '護欄新版' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await screen.findByRole('status')
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith('/template-systems/system-1') &&
          init?.method === 'PATCH',
      ),
    ).toBe(true)
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith('/template-systems/system-2') &&
          init?.method === 'PATCH',
      ),
    ).toBe(false)
  })

  it('clears stale category and system name drafts when changing selection', async () => {
    const anotherSystem = {
      id: 'system-3',
      category_id: otherCategory.id,
      name: '排水二區',
    }
    templateFetch({
      categories: [category, otherCategory],
      systems: [
        system,
        { ...secondSystem, category_id: otherCategory.id },
        anotherSystem,
      ],
      items: [],
    })
    render(<TemplatesPage />)
    const navigation = await screen.findByRole('complementary', {
      name: '範本庫導覽',
    })
    await within(navigation).findByRole('button', { name: '建築工程' })
    fireEvent.click(screen.getByRole('button', { name: '重新命名' }))
    fireEvent.change(screen.getByLabelText(/名稱/), { target: { value: '' } })
    fireEvent.click(
      within(navigation).getByRole('button', { name: '建築工程' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '捨棄變更' }))
    await screen.findByRole('heading', { name: '建築工程' })
    fireEvent.click(screen.getByRole('button', { name: '重新命名' }))
    expect(await screen.findByLabelText(/名稱/)).toHaveValue('建築工程')
    fireEvent.keyDown(screen.getByLabelText(/名稱/), { key: 'Escape' })

    fireEvent.click(within(navigation).getByRole('button', { name: '排水' }))
    await screen.findByRole('heading', { name: '排水' })
    fireEvent.click(screen.getByRole('button', { name: '重新命名' }))
    fireEvent.change(screen.getByLabelText(/名稱/), { target: { value: '' } })
    fireEvent.click(within(navigation).getByRole('button', { name: '護欄' }))
    fireEvent.click(screen.getByRole('button', { name: '捨棄變更' }))
    await screen.findByRole('heading', { name: '護欄' })
    fireEvent.click(screen.getByRole('button', { name: '重新命名' }))
    expect(await screen.findByLabelText(/名稱/)).toHaveValue('護欄')
  })

  it('keeps cleared category and system names blank until retyped on Enter', async () => {
    const fetchMock = templateFetch()
    render(<TemplatesPage />)
    await screen.findByRole('button', { name: '土木工程' })

    fireEvent.click(screen.getByRole('button', { name: '重新命名' }))
    const categoryInput = await screen.findByLabelText(/名稱/)
    fireEvent.change(categoryInput, { target: { value: '' } })
    expect(categoryInput).toHaveValue('')
    fireEvent.keyDown(categoryInput, { key: 'Enter', code: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveTextContent('請填寫名稱')
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith('/template-categories/category-1') &&
          init?.method === 'PATCH',
      ),
    ).toBe(false)
    fireEvent.change(categoryInput, { target: { value: '土木工程新版' } })
    expect(categoryInput).toHaveValue('土木工程新版')
    fireEvent.keyDown(categoryInput, { key: 'Enter', code: 'Enter' })
    await screen.findByText(/已重新命名為「土木工程新版」/)
    const categoryPatch = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/template-categories/category-1') &&
        init?.method === 'PATCH',
    )
    expect(JSON.parse(String(categoryPatch?.[1]?.body))).toEqual({
      name: '土木工程新版',
    })

    const navigation = screen.getByRole('complementary', {
      name: '範本庫導覽',
    })
    fireEvent.click(
      await within(navigation).findByRole('button', { name: '護欄' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '重新命名' }))
    const systemInput = await screen.findByLabelText(/名稱/)
    fireEvent.change(systemInput, { target: { value: '' } })
    expect(systemInput).toHaveValue('')
    fireEvent.keyDown(systemInput, { key: 'Enter', code: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveTextContent('請填寫名稱')
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith('/template-systems/system-1') &&
          init?.method === 'PATCH',
      ),
    ).toBe(false)
    fireEvent.change(systemInput, { target: { value: '護欄新版' } })
    expect(systemInput).toHaveValue('護欄新版')
    fireEvent.keyDown(systemInput, { key: 'Enter', code: 'Enter' })
    await screen.findByText(/已重新命名為「護欄新版」/)
    const systemPatch = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/template-systems/system-1') &&
        init?.method === 'PATCH',
    )
    expect(JSON.parse(String(systemPatch?.[1]?.body))).toEqual({
      name: '護欄新版',
    })
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
    fireEvent.click(screen.getByRole('radio', { name: '範圍' }))
    fireEvent.change(screen.getByLabelText(/^下限/), {
      target: { value: '1' },
    })
    fireEvent.change(screen.getByLabelText(/^上限/), {
      target: { value: '3' },
    })
    expect(screen.getAllByText(/1～3 %/).length).toBeGreaterThan(0)
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

  it('preserves units when a new numeric field is not bound', async () => {
    const fetchMock = templateFetch({ items: [], validateWire: true })
    render(<TemplatesPage />)
    await openSystem()
    fireEvent.click(screen.getByRole('button', { name: '新增查核項目' }))
    fireEvent.change(screen.getByLabelText(/查核項目名稱/), {
      target: { value: wireFixture.title },
    })
    fireEvent.change(screen.getByLabelText(/項次標題/), {
      target: { value: wireFixture.inspection_points[5].title },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增實測欄位' }))
    fireEvent.change(screen.getByLabelText(/欄位名稱/), {
      target: {
        value: wireFixture.inspection_points[5].measurement_fields[0].name,
      },
    })
    fireEvent.change(document.getElementById('field-0-0-unit')!, {
      target: {
        value: wireFixture.inspection_points[5].measurement_fields[0].unit,
      },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存查核項目' }))

    await screen.findByText('查核項目已儲存')
    const post = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === '/api/v1/templates' && init?.method === 'POST',
    )
    const body = JSON.parse(String(post?.[1]?.body))
    const expectedPoint = structuredClone(wireFixture.inspection_points[5])
    expectedPoint.sequence = body.inspection_points[0].sequence
    expectedPoint.measurement_fields[0].client_id =
      body.inspection_points[0].measurement_fields[0].client_id
    expect(body.inspection_points[0]).toEqual(expectedPoint)
    expect(body.inspection_points[0].measurement_fields[0].unit).toBe('m')
  })

  it('does not bind an earlier new field before a persisted field id', async () => {
    const item = structuredClone(sampleItem) as TemplateItem
    item.inspection_points[0].numeric_standard = {
      ...item.inspection_points[0].numeric_standard!,
      measurement_field_id: '00000000-0000-4000-8000-000000000021',
      measurement_field_client_id: undefined,
      unit: 'cm',
    }
    item.inspection_points[0].measurement_fields = [
      {
        client_id: '00000000-0000-4000-8000-000000000020',
        name: '長',
        field_type: 'number',
        unit: 'm',
      },
      {
        id: '00000000-0000-4000-8000-000000000021',
        name: '寬',
        field_type: 'number',
        unit: 'cm',
      },
    ]
    const fetchMock = templateFetch({
      items: [item as unknown as Record<string, unknown>],
      validateWire: true,
    })
    render(<TemplatesPage />)
    await openSystem()
    const navigation = screen.getByRole('complementary', {
      name: '範本庫導覽',
    })
    fireEvent.click(
      await within(navigation).findByRole('button', { name: '欄杆尺寸' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '編輯查核項目' }))
    fireEvent.click(screen.getByRole('button', { name: '儲存查核項目' }))

    await screen.findByText('查核項目已儲存')
    const put = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === '/api/v1/templates/template-1' &&
        init?.method === 'PUT',
    )
    const body = JSON.parse(String(put?.[1]?.body))
    const point = body.inspection_points[0]
    expect(
      point.measurement_fields.map(
        (field: { unit: string | null }) => field.unit,
      ),
    ).toEqual(['m', null])
    expect(point.numeric_standard.measurement_field_client_id).toBe(
      point.measurement_fields[1].client_id,
    )
    expect(point.numeric_standard.unit).toBe('cm')
  })

  it('binds the second new numeric field and preserves the first unit', async () => {
    const fetchMock = templateFetch({ items: [], validateWire: true })
    render(<TemplatesPage />)
    await startNewItem()
    fireEvent.change(screen.getByLabelText(/項次標題/), {
      target: { value: wireFixture.inspection_points[6].title },
    })
    const firstField = wireFixture.inspection_points[6].measurement_fields[0]
    const secondField = wireFixture.inspection_points[6].measurement_fields[1]
    fireEvent.change(screen.getByLabelText(/欄位名稱/), {
      target: { value: firstField.name },
    })
    fireEvent.change(document.getElementById('field-0-0-unit')!, {
      target: { value: firstField.unit },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增實測欄位' }))
    fireEvent.change(document.getElementById('field-0-1-name')!, {
      target: { value: secondField.name },
    })
    fireEvent.change(document.getElementById('field-0-1-unit')!, {
      target: { value: 'cm' },
    })
    fireEvent.change(screen.getByLabelText(/用來判定的數字欄位/), {
      target: {
        value: screen
          .getByRole('option', { name: 'Width' })
          .getAttribute('value'),
      },
    })
    fireEvent.change(screen.getByLabelText(/^下限/), {
      target: { value: '1' },
    })
    fireEvent.change(screen.getByLabelText(/^上限/), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存查核項目' }))

    await screen.findByText('查核項目已儲存')
    const post = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === '/api/v1/templates' && init?.method === 'POST',
    )
    const body = JSON.parse(String(post?.[1]?.body))
    const point = body.inspection_points[0]
    const expectedPoint = structuredClone(wireFixture.inspection_points[6])
    expectedPoint.sequence = point.sequence
    expectedPoint.measurement_fields.forEach((field, index) => {
      field.client_id = point.measurement_fields[index].client_id
    })
    expectedPoint.numeric_standard!.measurement_field_client_id =
      point.measurement_fields[1].client_id
    expect(point).toEqual(expectedPoint)
    expect(
      point.measurement_fields.map(
        (field: { unit: string | null }) => field.unit,
      ),
    ).toEqual(['m', null])
    expect(point.numeric_standard.measurement_field_client_id).toBe(
      point.measurement_fields[1].client_id,
    )
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
    fireEvent.click(screen.getByRole('radio', { name: '範圍' }))
    fireEvent.change(screen.getByLabelText(/^下限/), {
      target: { value: '3' },
    })
    fireEvent.change(screen.getByLabelText(/^上限/), {
      target: { value: '1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存查核項目' }))

    expect(await screen.findAllByText('下限不能大於上限')).not.toHaveLength(0)
    expect(screen.getByRole('alert')).toHaveTextContent('尚有')
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'POST'),
    ).toBe(false)
    // 焦點在 setTimeout(0) 裡設定，所以要等。
    await waitFor(() =>
      expect(document.getElementById('lower-0')).toHaveFocus(),
    )
    // 先把焦點移到錯誤按鈕（如同使用者點擊），才驗得出點擊後焦點回到欄位。
    const rangeError = screen.getByRole('button', {
      name: '下限不能大於上限',
    })
    rangeError.focus()
    expect(rangeError).toHaveFocus()
    fireEvent.click(rangeError)
    await waitFor(() =>
      expect(document.getElementById('lower-0')).toHaveFocus(),
    )
  })

  it('keeps unresolved errors while revalidating after the first save', async () => {
    const fetchMock = templateFetch({ items: [] })
    render(<TemplatesPage />)
    await startNewItem()
    fireEvent.change(screen.getByLabelText(/欄位名稱/), {
      target: { value: '坡度' },
    })
    fireEvent.change(screen.getByLabelText(/^下限/), {
      target: { value: '3' },
    })
    fireEvent.change(screen.getByLabelText(/^上限/), {
      target: { value: '1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存查核項目' }))

    expect(await screen.findAllByText('請填寫單位')).not.toHaveLength(0)
    expect(screen.getAllByText('下限不能大於上限')).not.toHaveLength(0)
    fireEvent.change(screen.getByLabelText(/單位/), {
      target: { value: '%' },
    })
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('尚有 1 處要修正'),
    )
    expect(screen.getAllByText('下限不能大於上限')).not.toHaveLength(0)
    fireEvent.change(screen.getByLabelText(/^下限/), {
      target: { value: '1' },
    })
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    )
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'POST'),
    ).toBe(false)
  })

  it('blocks empty point lists and blank text standards at their fields', async () => {
    const fetchMock = templateFetch({ items: [] })
    render(<TemplatesPage />)
    await openSystem()
    fireEvent.click(screen.getByRole('button', { name: '新增查核項目' }))
    fireEvent.change(screen.getByLabelText(/查核項目名稱/), {
      target: { value: '空白標準測試' },
    })
    fireEvent.click(screen.getByRole('button', { name: '移除此項次' }))
    fireEvent.click(screen.getByRole('button', { name: '儲存查核項目' }))
    expect(
      await screen.findAllByText('請至少新增一個查核項次'),
    ).not.toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '新增查核項次' }))
    fireEvent.change(screen.getByLabelText(/項次標題/), {
      target: { value: '外觀' },
    })
    fireEvent.click(screen.getByRole('radio', { name: '文字' }))
    fireEvent.click(screen.getByRole('button', { name: '儲存查核項目' }))
    expect(await screen.findAllByText('請填寫標準文字')).not.toHaveLength(0)
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'POST'),
    ).toBe(false)
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
      screen.getByRole('heading', { name: '照片需求' }),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/查核項目名稱/), {
      target: { value: '管線查核' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存查核項目' }))

    expect(await screen.findAllByText('請填寫項次標題')).toHaveLength(2)
    expect(screen.getByRole('alert')).toHaveTextContent('尚有')
    // 焦點在 setTimeout(0) 裡設定，所以要等。
    await waitFor(() =>
      expect(screen.getByLabelText(/項次標題/)).toHaveFocus(),
    )
    expect(screen.getAllByText(/照片 1 張/).length).toBeGreaterThan(0)
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
    ).toEqual(['要記錄什麼', '判定標準', '照片需求'])
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
    fireEvent.click(screen.getByRole('radio', { name: '範圍' }))
    fireEvent.change(screen.getByLabelText(/^下限/), {
      target: { value: '1' },
    })
    fireEvent.change(screen.getByLabelText(/^上限/), {
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
    fireEvent.click(screen.getByRole('radio', { name: '範圍' }))
    fireEvent.change(screen.getByLabelText(/^下限/), {
      target: { value: '1' },
    })
    fireEvent.change(screen.getByLabelText(/^上限/), {
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
    expect(body).not.toHaveProperty('id')
    expect(body.inspection_points[0].numeric_standard).toHaveProperty(
      'tolerance',
      null,
    )
  })

  it('replaces a blocked type-change message with the remove message', async () => {
    templateFetch()
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

    const typeMessage = '這個欄位用於數值標準；請先改綁其他欄位或移除標準。'
    fireEvent.change(screen.getAllByLabelText('欄位型別')[0], {
      target: { value: 'text' },
    })
    expect(screen.getByText(typeMessage)).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: '移除欄位' })[0])
    expect(screen.queryByText(typeMessage)).not.toBeInTheDocument()
    expect(
      screen.getByText('這個欄位仍綁定數值標準，請先解除綁定後再移除。'),
    ).toBeInTheDocument()
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

  it('keeps expanded items visible for two loaded systems', async () => {
    const secondItem = {
      ...sampleItem,
      id: 'template-2',
      system_id: secondSystem.id,
      title: '排水查核',
    }
    templateFetch({
      systems: [system, secondSystem],
      items: [sampleItem, secondItem],
    })
    render(<TemplatesPage />)
    await openSystem()
    const navigation = screen.getByRole('complementary', {
      name: '範本庫導覽',
    })
    fireEvent.click(
      await within(navigation).findByRole('button', { name: '排水' }),
    )
    expect(
      await within(navigation).findByRole('button', { name: '排水查核' }),
    ).toBeInTheDocument()
    expect(
      within(navigation).getByRole('button', { name: '欄杆尺寸' }),
    ).toBeInTheDocument()
    fireEvent.click(
      within(navigation).getByRole('button', { name: '欄杆尺寸' }),
    )
    fireEvent.click(within(navigation).getByRole('button', { name: '護欄' }))
    expect(await screen.findByText('查核項目（1）')).toBeInTheDocument()
  })

  it('shows the count on every node, including ones never opened (#492)', async () => {
    const drainageItem = {
      ...sampleItem,
      id: 'template-2',
      system_id: secondSystem.id,
      title: '排水查核',
    }
    templateFetch({
      categories: [
        { ...category, system_count: 2 },
        { ...otherCategory, system_count: 0 },
      ],
      systems: [
        { ...system, item_count: 1 },
        { ...secondSystem, item_count: 2 },
      ],
      items: [sampleItem, drainageItem],
    })
    render(<TemplatesPage />)
    await openSystem()
    const navigation = screen.getByRole('complementary', {
      name: '範本庫導覽',
    })

    // 「排水」還沒點開過，仍顯示列表回應帶的數量。
    expect(
      await within(navigation).findByText('2 個查核項目'),
    ).toBeInTheDocument()
    expect(within(navigation).getByText('1 個查核項目')).toBeInTheDocument()
    expect(within(navigation).getByText('2 個系統')).toBeInTheDocument()
    expect(within(navigation).getByText('0 個系統')).toBeInTheDocument()

    // 點開「排水」載入實際項目後，數字改以實際資料為準。
    fireEvent.click(within(navigation).getByRole('button', { name: '排水' }))
    expect(
      await within(navigation).findByRole('button', { name: '排水查核' }),
    ).toBeInTheDocument()
    expect(within(navigation).getAllByText('1 個查核項目')).toHaveLength(2)
    expect(
      within(navigation).queryByText('2 個查核項目'),
    ).not.toBeInTheDocument()
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
    const guard = screen.getByRole('alertdialog', {
      name: '尚未儲存的變更',
    })
    // [取消][確認]：保留編輯是次要，捨棄變更才是危險色（#500）。
    const guardButtons = within(guard).getAllByRole('button')
    expect(guardButtons.map((button) => button.textContent)).toEqual([
      '保留編輯',
      '捨棄變更',
    ])
    expect(guardButtons[0]).not.toHaveClass('btn-primary', 'btn-danger')
    expect(guardButtons[1]).toHaveClass('btn-danger')
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
    const back = screen.getByRole('button', { name: '返回清單' })
    expect(back).toHaveClass('back-link')
    fireEvent.click(back)
    expect(document.querySelector('.tpl-layout')).toHaveAttribute(
      'data-pane',
      'list',
    )
  })

  it('shows the unsaved-changes box in the detail pane on mobile', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 360,
    })
    templateFetch()
    render(<TemplatesPage />)
    await openSystem()
    fireEvent.click(screen.getByRole('button', { name: '新增查核項目' }))
    fireEvent.change(screen.getByLabelText(/查核項目名稱/), {
      target: { value: '未儲存項目' },
    })
    fireEvent.click(screen.getByRole('button', { name: '返回清單' }))
    expect(document.querySelector('.tpl-layout')).toHaveAttribute(
      'data-pane',
      'list',
    )
    fireEvent.click(screen.getByRole('button', { name: '土木工程' }))
    expect(
      screen.getByRole('alertdialog', { name: '尚未儲存的變更' }),
    ).toBeInTheDocument()
    expect(document.querySelector('.tpl-layout')).toHaveAttribute(
      'data-pane',
      'detail',
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
    fireEvent.click(screen.getByRole('radio', { name: '標準值 ± 容許誤差' }))
    fireEvent.change(document.getElementById('value-0') as HTMLInputElement, {
      target: { value: '3' },
    })
    fireEvent.change(screen.getByLabelText(/^容許誤差/), {
      target: { value: '-1' },
    })
    expect(screen.getAllByText(/3 ± -1 %/).length).toBeGreaterThan(0)
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
