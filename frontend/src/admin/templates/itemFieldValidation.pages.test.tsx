import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CurrentUserProvider } from '../../auth/useCurrentUser'
import { currentUserFixture } from '../../testing/contractFixtures'
import { DataMemoryRouter } from '../../testing/DataMemoryRouter'
import { ManagementApiError } from '../api'
import type { ProjectItemApi } from '../projectItems/api'
import ProjectItemChangePage from '../projectItems/ProjectItemChangePage'
import * as api from './api'
import type { TemplateItem } from './api'
import TemplatesPage from './TemplatesPage'

const item: TemplateItem = {
  id: 'item-1',
  system_id: 'system-1',
  sequence: 1,
  title: '共同項目',
  instruction: '',
  inspection_points: [
    {
      id: 'point-1',
      sequence: 1,
      title: '厚度',
      instruction: '',
      text_standard: null,
      numeric_standard: {
        condition: 'range',
        range_form: 'interval',
        value: null,
        tolerance: null,
        lower_bound: '1',
        upper_bound: '2',
        unit: 'mm',
        measurement_field_id: 'field-1',
      },
      measurement_fields: [
        { id: 'field-1', name: '厚度', field_type: 'number', unit: 'mm' },
      ],
      evidence_requirements: [{ min_count: 1 }],
    },
  ],
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function openEditor(
  page: 'template' | 'project',
  source = structuredClone(item),
  duplicate = false,
) {
  const write = vi.fn()
  let element
  if (page === 'template') {
    vi.spyOn(api, 'listTemplateCategories').mockResolvedValue([
      { id: 'category-1', name: '測試工程', system_count: 1 },
    ])
    vi.spyOn(api, 'listTemplateSystems').mockResolvedValue([
      { id: 'system-1', category_id: 'category-1', name: '測試系統' },
    ])
    vi.spyOn(api, 'getSystemTemplates').mockResolvedValue({
      items: [
        source,
        ...(duplicate
          ? [{ ...structuredClone(item), id: 'item-2', title: '既有名稱' }]
          : []),
      ],
    })
    vi.spyOn(api, 'updateTemplateItem').mockImplementation(write)
    write.mockImplementation(async (_id, payload) => ({
      ...payload,
      id: 'item-1',
    }))
    element = <TemplatesPage canManage />
  } else {
    const projectApi: ProjectItemApi = {
      loadPreview: vi.fn(async () => ({
        item: {
          ...source,
          id: 'item-1',
          project_id: 'project-1',
          source_template_name: '共同來源',
          source_category_name: null,
          source_system_name: null,
          applied_at: '2026-10-24T00:00:00Z',
        },
        affectedTasks: [],
      })),
      update: write,
    }
    write.mockImplementation(async () => {
      if (duplicate) {
        throw new ManagementApiError(
          409,
          'project_inspection_item.duplicate_name',
        )
      }
      return {
        ...source,
        id: 'item-1',
        reinspection_selected: false,
        affected_tasks: [],
      }
    })
    element = (
      <Routes>
        <Route
          path="/projects/:projectId/items/:itemId"
          element={<ProjectItemChangePage api={projectApi} />}
        />
      </Routes>
    )
  }
  render(
    <CurrentUserProvider
      value={{
        user: currentUserFixture({ is_admin: true }),
        clear: vi.fn(),
      }}
    >
      <DataMemoryRouter initialEntries={['/projects/project-1/items/item-1']}>
        {element}
      </DataMemoryRouter>
    </CurrentUserProvider>,
  )
  if (page === 'template') {
    const navigation = await screen.findByRole('complementary', {
      name: '範本庫導覽',
    })
    fireEvent.click(
      await within(navigation).findByRole('button', { name: '測試系統' }),
    )
    fireEvent.click(await screen.findByRole('button', { name: '共同項目' }))
    fireEvent.click(screen.getByRole('button', { name: '編輯查核項目' }))
  }
  await screen.findByLabelText(/查核項目名稱/)
  const save = () =>
    fireEvent.click(
      screen.getByRole('button', {
        name: page === 'template' ? '儲存查核項目' : '儲存變更',
      }),
    )
  const confirm = () => {
    if (page === 'project') {
      fireEvent.click(screen.getByRole('button', { name: '確認儲存' }))
    }
  }
  return { write, save, confirm }
}

describe.each(['template', 'project'] as const)('%s 共用欄位規則', (page) => {
  it.each([
    ['下限', ''],
    ['上限', '   '],
  ])('區間%s空白時送出前阻擋並聚焦', async (label, value) => {
    const { write, save } = await openEditor(page)
    const field = screen.getByLabelText(new RegExp(`^${label}`))
    fireEvent.change(field, { target: { value } })
    save()
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
    await waitFor(() => expect(field).toHaveFocus())
    expect(screen.getAllByText(`請填寫有效的${label}`).length).toBeGreaterThan(
      0,
    )
    expect(write).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('非區間條件允許有限負容差', async () => {
    const { write, save, confirm } = await openEditor(page)
    fireEvent.click(screen.getByRole('radio', { name: '＝' }))
    fireEvent.change(screen.getByLabelText(/^標準值/), {
      target: { value: '3' },
    })
    fireEvent.change(screen.getByLabelText(/^容許誤差/), {
      target: { value: '-0.5' },
    })
    save()
    confirm()
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    const payload = write.mock.calls[0][page === 'template' ? 1 : 2]
    expect(payload.inspection_points[0].numeric_standard).toMatchObject({
      condition: '=',
      value: '3',
      tolerance: '-0.5',
    })
  })

  it('省略 range_form 的舊資料顯示並送出 tolerance', async () => {
    const source = structuredClone(item)
    const standard = source.inspection_points[0].numeric_standard!
    delete standard.range_form
    Object.assign(standard, {
      value: '3',
      tolerance: '0.5',
      lower_bound: null,
      upper_bound: null,
    })
    const { write, save, confirm } = await openEditor(page, source)
    expect(
      screen.getByRole('radio', { name: '標準值 ± 容許誤差' }),
    ).toBeChecked()
    expect(screen.queryByLabelText(/^下限/)).toBeNull()
    fireEvent.change(screen.getByLabelText(/查核項目名稱/), {
      target: { value: '更新共同項目' },
    })
    save()
    confirm()
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    expect(
      write.mock.calls[0][page === 'template' ? 1 : 2].inspection_points[0]
        .numeric_standard.range_form,
    ).toBe('tolerance')
  })

  it('同名維持各頁的唯一範圍與錯誤來源', async () => {
    const { write, save, confirm } = await openEditor(
      page,
      structuredClone(item),
      true,
    )
    fireEvent.change(screen.getByLabelText(/查核項目名稱/), {
      target: { value: '既有名稱' },
    })
    save()
    if (page === 'template') {
      expect(
        screen.getAllByText('此系統已有同名查核項目，請換個名稱').length,
      ).toBeGreaterThan(0)
      expect(write).not.toHaveBeenCalled()
    } else {
      confirm()
      expect(await screen.findByRole('alert')).toHaveTextContent(
        '這個專案已有同名查核項目，請換個名稱。',
      )
      expect(write).toHaveBeenCalledTimes(1)
    }
    expect(screen.getByLabelText(/查核項目名稱/)).toHaveValue('既有名稱')
  })
})
