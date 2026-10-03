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
const system = {
  id: 'system-1',
  category_id: category.id,
  name: '護欄',
}
const templates = [
  {
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
            unit: 'cm',
          },
          {
            id: 'field-2',
            name: '第二次量測',
            field_type: 'number',
            unit: 'mm',
          },
        ],
        evidence_requirements: [
          {
            id: 'evidence-1',
            evidence_type: 'photo',
            required: true,
            min_count: 2,
            max_count: null,
          },
        ],
      },
    ],
  },
]

const secondTemplate = {
  ...templates[0],
  id: 'template-2',
  sequence: 2,
  title: '底座尺寸',
  inspection_points: templates[0].inspection_points.map((point) => ({
    ...point,
    id: 'point-2',
    title: '底座寬度',
    numeric_standard: {
      ...point.numeric_standard!,
      measurement_field_id: 'field-3',
    },
    measurement_fields: point.measurement_fields.map((field, index) => ({
      ...field,
      id: `field-${index + 3}`,
    })),
    evidence_requirements: point.evidence_requirements.map((entry) => ({
      ...entry,
      id: 'evidence-2',
    })),
  })),
}

function templateFetch({
  categoryError,
  writeError,
  writeConflict = false,
  writeSuccess = false,
  categoryItems = [category],
  systemItems = [system],
  templateItems = templates,
}: {
  categoryError?: number
  writeError?: number
  writeConflict?: boolean
  writeSuccess?: boolean
  categoryItems?: Array<{ id: string; name: string }>
  systemItems?: Array<{
    id: string
    category_id: string
    name: string
  }>
  templateItems?: typeof templates
} = {}) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const path = new URL(url, 'http://localhost').pathname
      const method = init?.method ?? 'GET'
      if (path.endsWith('/template-categories') && method === 'GET') {
        if (categoryError) {
          return Response.json(
            { error: { code: 'permission.denied' } },
            { status: categoryError },
          )
        }
        return Response.json({ items: categoryItems, next_cursor: null })
      }
      if (
        path.endsWith('/systems') &&
        path.includes('/template-categories/')
      ) {
        return Response.json({ items: systemItems, next_cursor: null })
      }
      if (path.endsWith('/templates') && path.includes('/template-systems/')) {
        if (method === 'GET') {
          return Response.json({ items: templateItems, next_cursor: null })
        }
        if (writeSuccess) {
          const body = JSON.parse(String(init?.body)) as {
            items: Array<Record<string, unknown>>
          }
          return Response.json({
            items: body.items.map((item, index) => ({
              ...item,
              id: item.id ?? `created-${index}`,
            })),
          })
        }
        if (writeConflict) {
          return Response.json(
            { error: { code: 'template.name_conflict' } },
            { status: 409 },
          )
        }
        const status = writeError ?? 403
        return Response.json(
          {
            error: {
              code:
                status === 403
                  ? 'permission.denied'
                  : 'request.validation_failed',
            },
          },
          { status },
        )
      }
      if (
        path.endsWith('/template-categories/category-1') &&
        method === 'PATCH'
      ) {
        return Response.json(
          { error: { code: 'template.name_conflict' } },
          { status: 409 },
        )
      }
      if (path.endsWith('/template-systems/system-1') && method === 'PATCH') {
        return Response.json(
          { error: { code: 'template.name_conflict' } },
          { status: 409 },
        )
      }
      if (
        path.endsWith('/template-categories/category-1') &&
        method === 'DELETE'
      ) {
        return Response.json(
          { error: { code: 'template.category_not_empty' } },
          { status: 409 },
        )
      }
      if (path.endsWith('/template-systems/system-1') && method === 'DELETE') {
        return Response.json(
          { error: { code: 'template.system_not_empty' } },
          { status: 409 },
        )
      }
      return Response.json({ items: [category], next_cursor: null })
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('TemplatesPage', () => {
  it('creates a category, system, and item template through the screen', async () => {
    const categories: Array<{ id: string; name: string }> = []
    const systems: Array<{
      id: string
      category_id: string
      name: string
    }> = []
    const items: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), 'http://localhost').pathname
        const method = init?.method ?? 'GET'
        if (path === '/api/v1/template-categories' && method === 'GET') {
          return Response.json({ items: categories, next_cursor: null })
        }
        if (path === '/api/v1/template-categories' && method === 'POST') {
          const body = JSON.parse(String(init?.body)) as { name: string }
          const row = { id: 'category-new', name: body.name }
          categories.push(row)
          return Response.json(row, { status: 201 })
        }
        if (
          path === '/api/v1/template-categories/category-new/systems' &&
          method === 'GET'
        ) {
          return Response.json({ items: systems, next_cursor: null })
        }
        if (
          path === '/api/v1/template-categories/category-new/systems' &&
          method === 'POST'
        ) {
          const body = JSON.parse(String(init?.body)) as { name: string }
          const row = {
            id: 'system-new',
            category_id: 'category-new',
            name: body.name,
          }
          systems.push(row)
          return Response.json(row, { status: 201 })
        }
        if (
          path === '/api/v1/template-systems/system-new/templates' &&
          method === 'GET'
        ) {
          return Response.json({ items, next_cursor: null })
        }
        if (
          path === '/api/v1/template-systems/system-new/templates' &&
          method === 'PUT'
        ) {
          const body = JSON.parse(String(init?.body)) as {
            items: Array<Record<string, unknown>>
          }
          items.splice(
            0,
            items.length,
            ...body.items.map((item, index) => ({
              ...item,
              id: item.id ?? `template-${index + 1}`,
            })),
          )
          return Response.json({ items })
        }
        return Response.json({ items: [], next_cursor: null })
      },
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<TemplatesPage />)

    fireEvent.click(
      await screen.findByRole('button', { name: '新增工程類別' }),
    )
    fireEvent.change(screen.getByLabelText('工程類別名稱'), {
      target: { value: '橋梁工程' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增類別' }))
    await screen.findByRole('option', { name: '橋梁工程' })

    fireEvent.click(screen.getByRole('button', { name: '新增系統…' }))
    fireEvent.change(screen.getByLabelText('系統名稱'), {
      target: { value: '伸縮縫' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增系統' }))
    await screen.findByRole('option', { name: '伸縮縫' })

    fireEvent.click(
      await screen.findByRole('button', { name: '新增查核項目' }),
    )
    fireEvent.change(screen.getByLabelText('項目名稱'), {
      target: { value: '伸縮縫外觀' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存範本' }))
    expect(await screen.findByText(/伸縮縫外觀/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      '查核項目範本已儲存。',
    )

    fireEvent.click(screen.getByRole('button', { name: '編輯：伸縮縫外觀' }))
    fireEvent.click(screen.getByRole('button', { name: '新增查核項次' }))
    fireEvent.change(screen.getByLabelText('項次標題'), {
      target: { value: '伸縮縫外觀確認' },
    })
    fireEvent.change(screen.getByLabelText('標準類型'), {
      target: { value: 'text' },
    })
    fireEvent.change(screen.getByLabelText('標準文字'), {
      target: { value: '表面無裂縫' },
    })
    fireEvent.change(screen.getByLabelText('每項次最少照片數'), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存範本' }))

    await waitFor(() => {
      expect(items[0].inspection_points).toEqual([
        expect.objectContaining({
          sequence: 1,
          title: '伸縮縫外觀確認',
          text_standard: { text: '表面無裂縫' },
          evidence_requirements: [{ min_count: 3 }],
        }),
      ])
    })
  })

  it('shows the library denial when the read API returns 403', async () => {
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

  it('previews an item and all points in the selected system', async () => {
    templateFetch()
    render(<TemplatesPage />)

    fireEvent.click(
      await screen.findByRole('button', { name: '預覽：欄杆尺寸' }),
    )
    const preview = screen.getByRole('dialog', { name: '範本預覽' })
    expect(within(preview).getByText('數值標準：≥ 110 cm')).toBeInTheDocument()
    expect(within(preview).getByText('至少照片數：2')).toBeInTheDocument()
    fireEvent.click(within(preview).getByRole('button', { name: '關閉預覽' }))

    fireEvent.click(screen.getByRole('button', { name: '預覽整個系統' }))
    expect(screen.getByRole('dialog', { name: '範本預覽' })).toHaveTextContent(
      '高度',
    )
  })

  it('previews system items in separate named groups', async () => {
    templateFetch({ templateItems: [...templates, secondTemplate] })
    render(<TemplatesPage />)
    fireEvent.click(
      await screen.findByRole('button', { name: '預覽整個系統' }),
    )

    const preview = screen.getByRole('dialog', { name: '範本預覽' })
    expect(
      within(preview).getByRole('heading', { name: '1. 欄杆尺寸' }),
    ).toBeInTheDocument()
    expect(
      within(preview).getByRole('heading', { name: '2. 底座尺寸' }),
    ).toBeInTheDocument()
    expect(within(preview).getByText('項次 1. 高度')).toBeInTheDocument()
    expect(within(preview).getByText('項次 1. 底座寬度')).toBeInTheDocument()
  })

  it('shows localized 409 errors for a duplicate name and occupied system', async () => {
    templateFetch({ writeConflict: true })
    render(<TemplatesPage />)
    await screen.findByRole('option', { name: '土木工程' })

    fireEvent.change(screen.getByLabelText('工程類別名稱'), {
      target: { value: '重複名稱' },
    })
    fireEvent.click(screen.getByRole('button', { name: '更新類別' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '名稱已存在，請改用其他名稱。',
    )

    fireEvent.change(screen.getByLabelText('系統名稱'), {
      target: { value: '重複系統' },
    })
    fireEvent.click(screen.getByRole('button', { name: '更新系統' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '名稱已存在，請改用其他名稱。',
    )

    fireEvent.click(screen.getByRole('button', { name: '刪除工程類別' }))
    expect(
      screen.getByRole('group', { name: '確認刪除工程類別' }),
    ).toHaveTextContent('土木工程')
    fireEvent.click(screen.getByRole('button', { name: '確認刪除工程類別' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '此工程類別仍有系統，無法刪除。',
    )

    fireEvent.click(screen.getByRole('button', { name: '刪除系統' }))
    expect(
      screen.getByRole('group', { name: '確認刪除系統' }),
    ).toHaveTextContent('護欄')
    fireEvent.click(screen.getByRole('button', { name: '確認刪除系統' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '此系統仍有查核項目，無法刪除。',
    )

    fireEvent.click(
      await screen.findByRole('button', { name: '編輯：欄杆尺寸' }),
    )
    fireEvent.change(screen.getByLabelText('項目名稱'), {
      target: { value: '重複項目' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存範本' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '名稱已存在，請改用其他名稱。',
    )
  })

  it('shows numeric unit as bound and switches to read-only after write 403', async () => {
    const fetchMock = templateFetch()
    render(<TemplatesPage />)
    fireEvent.click(
      await screen.findByRole('button', { name: '編輯：欄杆尺寸' }),
    )

    const editor = screen.getByRole('form', { name: '查核項目編輯器' })
    expect(
      within(editor).getByLabelText('單位（由綁定欄位帶入）'),
    ).toBeDisabled()
    expect(within(editor).getAllByLabelText('單位')[0]).toBeDisabled()

    fireEvent.change(within(editor).getByLabelText('項目名稱'), {
      target: { value: '保留中的範本草稿' },
    })
    fireEvent.click(within(editor).getByRole('button', { name: '儲存範本' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '目前帳號只有瀏覽權限，已切換為唯讀模式。',
    )
    expect(screen.getByText('唯讀瀏覽')).toBeInTheDocument()
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: '新增查核項目' }),
      ).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('項目名稱')).toHaveValue('保留中的範本草稿')
    expect(screen.getByLabelText('項目名稱')).toBeDisabled()
    expect(
      screen.getByText('以下內容是尚未儲存的草稿，僅供唯讀檢視。'),
    ).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith('/template-systems/system-1/templates') &&
          init?.method === 'PUT',
      ),
    ).toBe(true)
    const putCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/template-systems/system-1/templates') &&
        init?.method === 'PUT',
    )
    const body = JSON.parse(String(putCall?.[1]?.body)) as {
      items: Array<{
        inspection_points: Array<{
          measurement_fields: Array<{ client_id: string; unit: string }>
          numeric_standard: {
            measurement_field_client_id: string
            unit: string
          }
        }>
      }>
    }
    const savedPoint = body.items[0].inspection_points[0]
    expect(savedPoint.numeric_standard.unit).toBe('cm')
    expect(savedPoint.numeric_standard.measurement_field_client_id).toBe(
      savedPoint.measurement_fields[0].client_id,
    )
    expect(screen.queryByText('查核項目範本已儲存。')).not.toBeInTheDocument()
  })

  it('rebinds a loaded numeric standard by selected field id and uses its unit', async () => {
    const fetchMock = templateFetch()
    render(<TemplatesPage />)
    fireEvent.click(
      await screen.findByRole('button', { name: '編輯：欄杆尺寸' }),
    )

    const editor = screen.getByRole('form', { name: '查核項目編輯器' })
    const binding = within(editor).getByLabelText('綁定數字實測欄位')
    expect(binding).toHaveValue('field-1')
    fireEvent.change(binding, { target: { value: 'field-2' } })

    expect(
      within(editor).getByLabelText('單位（由綁定欄位帶入）'),
    ).toHaveValue('mm')
    const fieldUnits = within(editor).getAllByLabelText('單位')
    expect(fieldUnits[0]).not.toBeDisabled()
    expect(fieldUnits[1]).toBeDisabled()

    fireEvent.click(within(editor).getByRole('button', { name: '儲存範本' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '目前帳號只有瀏覽權限，已切換為唯讀模式。',
    )
    const putCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/template-systems/system-1/templates') &&
        init?.method === 'PUT',
    )
    const body = JSON.parse(String(putCall?.[1]?.body)) as {
      items: Array<{
        inspection_points: Array<{
          measurement_fields: Array<{ client_id: string; unit: string }>
          numeric_standard: {
            measurement_field_client_id: string
            unit: string
          }
        }>
      }>
    }
    const savedPoint = body.items[0].inspection_points[0]
    expect(savedPoint.numeric_standard.unit).toBe('mm')
    expect(savedPoint.numeric_standard.measurement_field_client_id).toBe(
      savedPoint.measurement_fields[1].client_id,
    )
  })

  it('saves and reloads tolerance for a range numeric standard', async () => {
    const fetchMock = templateFetch({ writeSuccess: true })
    render(<TemplatesPage />)
    fireEvent.click(
      await screen.findByRole('button', { name: '編輯：欄杆尺寸' }),
    )
    fireEvent.change(screen.getByLabelText('容許誤差'), {
      target: { value: '0.5' },
    })
    fireEvent.change(screen.getByLabelText('條件'), {
      target: { value: 'range' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存範本' }))
    await screen.findByRole('status')

    const putCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/template-systems/system-1/templates') &&
        init?.method === 'PUT',
    )
    const body = JSON.parse(String(putCall?.[1]?.body)) as {
      items: Array<{
        inspection_points: Array<{
          numeric_standard: {
            value: string
            condition: string
            tolerance: string
          }
        }>
      }>
    }
    expect(body.items[0].inspection_points[0].numeric_standard).toMatchObject({
      value: '110',
      condition: 'range',
      tolerance: '0.5',
    })
    fireEvent.click(screen.getByRole('button', { name: '編輯：欄杆尺寸' }))
    expect(screen.getByLabelText('容許誤差')).toHaveValue('0.5')
  })

  it('clears category and system editors when their selection changes', async () => {
    const secondCategory = { id: 'category-2', name: '道路工程' }
    const secondSystem = {
      id: 'system-2',
      category_id: secondCategory.id,
      name: '路面',
    }
    templateFetch({
      categoryItems: [category, secondCategory],
      systemItems: [system, secondSystem],
    })
    render(<TemplatesPage />)
    await screen.findByRole('option', { name: '道路工程' })

    fireEvent.change(screen.getByLabelText('工程類別名稱'), {
      target: { value: '未儲存分類草稿' },
    })
    fireEvent.change(screen.getByLabelText('選擇工程類別'), {
      target: { value: secondCategory.id },
    })
    await waitFor(() => {
      expect(screen.getByLabelText('工程類別名稱')).toHaveValue('道路工程')
    })

    await screen.findByRole('option', { name: '路面' })
    fireEvent.change(screen.getByLabelText('系統名稱'), {
      target: { value: '未儲存系統草稿' },
    })
    fireEvent.change(screen.getByLabelText('選擇系統'), {
      target: { value: secondSystem.id },
    })
    await waitFor(() => {
      expect(screen.getByLabelText('系統名稱')).toHaveValue('路面')
    })
  })

  it('updates and deletes an item using the full system collection API', async () => {
    const fetchMock = templateFetch({ writeSuccess: true })
    render(<TemplatesPage />)
    fireEvent.click(
      await screen.findByRole('button', { name: '編輯：欄杆尺寸' }),
    )
    fireEvent.change(screen.getByLabelText('項目名稱'), {
      target: { value: '更新後的欄杆尺寸' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存範本' }))

    expect(await screen.findByText(/更新後的欄杆尺寸/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      '查核項目範本已儲存。',
    )
    fireEvent.click(
      screen.getByRole('button', { name: '刪除：更新後的欄杆尺寸' }),
    )
    expect(
      screen.getByText('確定刪除「更新後的欄杆尺寸」？'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }))
    await waitFor(() => {
      expect(screen.queryByText(/更新後的欄杆尺寸/)).not.toBeInTheDocument()
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      '查核項目範本已刪除。',
    )
    const puts = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith('/template-systems/system-1/templates') &&
        init?.method === 'PUT',
    )
    expect(puts).toHaveLength(2)
    expect(JSON.parse(String(puts[1][1]?.body)).items).toEqual([])
  })

  it('normalizes server-shaped rows before deleting one from a system', async () => {
    const fetchMock = templateFetch({
      templateItems: [...templates, secondTemplate],
      writeSuccess: true,
    })
    render(<TemplatesPage />)
    fireEvent.click(
      await screen.findByRole('button', { name: '刪除：欄杆尺寸' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }))

    await waitFor(() => {
      expect(screen.queryByText(/欄杆尺寸/)).not.toBeInTheDocument()
    })
    const putCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/template-systems/system-1/templates') &&
        init?.method === 'PUT',
    )
    const body = JSON.parse(String(putCall?.[1]?.body)) as {
      items: Array<{
        id: string
        inspection_points: Array<{
          id?: string
          numeric_standard: Record<string, unknown>
          measurement_fields: Array<Record<string, unknown>>
          evidence_requirements: Array<Record<string, unknown>>
        }>
      }>
    }
    expect(body.items).toHaveLength(1)
    expect(body.items[0].id).toBe('template-2')
    expect(body.items[0].inspection_points[0]).not.toHaveProperty('id')
    expect(
      body.items[0].inspection_points[0].numeric_standard,
    ).not.toHaveProperty('measurement_field_id')
    expect(
      body.items[0].inspection_points[0].measurement_fields[0],
    ).not.toHaveProperty('id')
    expect(
      body.items[0].inspection_points[0].evidence_requirements[0],
    ).toEqual({ min_count: 2 })
  })

  it('shows a clear localized validation message for 422', async () => {
    templateFetch({ writeError: 422 })
    render(<TemplatesPage />)
    fireEvent.click(
      await screen.findByRole('button', { name: '編輯：欄杆尺寸' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '儲存範本' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '資料驗證失敗，請檢查必填欄位與數值格式。',
    )
    expect(
      screen.getByRole('form', { name: '查核項目編輯器' }),
    ).toBeInTheDocument()
  })
})
