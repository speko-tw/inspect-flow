import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CurrentUser } from '../auth/api'
import { CurrentUserProvider } from '../auth/useCurrentUser'
import ProjectTemplatesPage from './ProjectTemplatesPage'
import {
  ProjectTemplatesApiError,
  templateErrorMessage,
  type ProjectInspectionItem,
} from './projectTemplatesApi'

const USER: CurrentUser = {
  id: 'user-1',
  username: 'member',
  email: null,
  name_en: null,
  name_zh: null,
  is_admin: false,
  must_change_password: false,
}

const SAVED_ITEM: ProjectInspectionItem = {
  id: 'copy-1',
  project_id: 'project-1',
  sequence: 1,
  title: '風管檢查',
  instruction: '檢查風管',
  source_template_name: '空調',
  applied_at: '2026-10-04T01:00:00Z',
}

function mockApi(
  applyResponse: Response,
  denyCategories = false,
  options: {
    projectItems?: ProjectInspectionItem[]
    afterApplyItems?: ProjectInspectionItem[]
    canSave?: boolean
    saveResponse?: Response
    denyItems?: boolean
    paginatedItems?: ProjectInspectionItem[]
    afterSaveTemplates?: boolean
  } = {},
) {
  let applied = false
  let saved = false
  const calls = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/projects')) {
      return options.canSave
        ? Response.json([{ id: 'project-1', name: '示範工程' }])
        : Response.json(
            { error: { code: 'permission.denied' } },
            { status: 403 },
          )
    }
    if (url.includes('/inspection-items?limit=100')) {
      if (options.denyItems) {
        return Response.json(
          { error: { code: 'permission.denied' } },
          { status: 403 },
        )
      }
      if (options.paginatedItems) {
        const second = url.includes('cursor=next')
        return Response.json({
          items: [options.paginatedItems[second ? 1 : 0]],
          next_cursor: second ? null : 'next',
        })
      }
      return Response.json({
        items: applied
          ? (options.afterApplyItems ?? options.projectItems ?? [])
          : (options.projectItems ?? []),
        next_cursor: null,
      })
    }
    if (url.endsWith('/template-categories?limit=100')) {
      if (denyCategories) {
        return Response.json(
          { error: { code: 'permission.denied' } },
          { status: 403 },
        )
      }
      return Response.json({
        items: [{ id: 'category-1', name: '機電' }],
        next_cursor: null,
      })
    }
    if (url.includes('/category-1/systems')) {
      return Response.json({
        items: [{ id: 'system-1', name: '空調' }],
        next_cursor: null,
      })
    }
    if (url.includes('/system-1/templates')) {
      return Response.json({
        items: [
          { id: 'template-1', title: '風管檢查' },
          ...(saved && options.afterSaveTemplates
            ? [{ id: 'new-template-1', title: '新增的範本' }]
            : []),
        ],
        next_cursor: null,
      })
    }
    if (
      url.endsWith('/inspection-items:apply-template') &&
      init?.method === 'POST'
    ) {
      applied = true
      return applyResponse
    }
    if (
      url.endsWith('/projects/project-1/templates') &&
      init?.method === 'POST'
    ) {
      const response =
        options.saveResponse ??
        Response.json(
          {
            id: 'new-template-1',
            title: SAVED_ITEM.title,
          },
          { status: 201 },
        )
      if (response.ok) saved = true
      return response
    }
    return Response.json(
      { error: { code: 'resource.not_found' } },
      { status: 404 },
    )
  })
  vi.stubGlobal('fetch', calls)
  return calls
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/field/projects/project-1']}>
      <CurrentUserProvider value={{ user: USER, clear: vi.fn() }}>
        <Routes>
          <Route
            element={<ProjectTemplatesPage />}
            path="/field/projects/:projectId"
          />
        </Routes>
      </CurrentUserProvider>
    </MemoryRouter>,
  )
}

async function selectSystem() {
  fireEvent.change(await screen.findByLabelText('工程類別'), {
    target: { value: 'category-1' },
  })
  fireEvent.change(await screen.findByLabelText('系統'), {
    target: { value: 'system-1' },
  })
  await screen.findByRole('option', { name: '風管檢查' })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('專案範本套用（TPL-AC05、AC08）', () => {
  it('404 對套用、列表與存為範本使用中性訊息', () => {
    expect(templateErrorMessage(new ProjectTemplatesApiError(404))).toBe(
      '找不到指定的資料，請重新整理後再試。',
    )
  })

  it('單項套用顯示副本來源與時間', async () => {
    const calls = mockApi(
      Response.json(
        [
          {
            id: 'copy-1',
            project_id: 'project-1',
            source_template_name: '風管檢查',
            applied_at: '2026-10-04T01:00:00Z',
          },
        ],
        { status: 201 },
      ),
      false,
      { afterApplyItems: [SAVED_ITEM] },
    )
    renderPage()
    await selectSystem()
    fireEvent.change(screen.getByLabelText('查核項目'), {
      target: { value: 'template-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '套用至專案' }))

    const result = await screen.findByText(/來源：風管檢查/)
    expect(result).toBeInTheDocument()
    expect(screen.getByText(/套用時間：/)).toBeInTheDocument()
    expect(
      await screen.findByRole('rowheader', {
        name: SAVED_ITEM.title,
      }),
    ).toBeInTheDocument()
    expect(
      calls.mock.calls.filter(([url]) =>
        String(url).includes('/inspection-items?limit=100'),
      ),
    ).toHaveLength(2)
    expect(calls).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/inspection-items:apply-template',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ template_id: 'template-1' }),
      }),
    )
  })

  it('整系統套用並重載多筆副本', async () => {
    const second = {
      ...SAVED_ITEM,
      id: 'copy-2',
      sequence: 2,
      title: '水管檢查',
      applied_at: '2026-10-04T02:00:00Z',
    }
    const applied = [SAVED_ITEM, second].map((item) => ({
      id: item.id,
      project_id: item.project_id,
      source_template_name: item.source_template_name,
      applied_at: item.applied_at,
    }))
    const calls = mockApi(Response.json(applied, { status: 201 }), false, {
      afterApplyItems: [SAVED_ITEM, second],
    })
    renderPage()
    await selectSystem()
    await screen.findByText('目前沒有查核項目。')
    fireEvent.click(screen.getByLabelText('整個系統'))
    fireEvent.click(screen.getByRole('button', { name: '套用至專案' }))

    const result = await screen.findByRole('status')
    const entries = within(result).getAllByRole('listitem')
    expect(entries).toHaveLength(2)
    for (const entry of entries) {
      expect(entry).toHaveTextContent('來源：空調')
      expect(within(entry).getByText(/2026/)).toBeInTheDocument()
    }
    expect(calls).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/inspection-items:apply-template',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ system_id: 'system-1' }),
      }),
    )
    expect(
      await screen.findByRole('rowheader', { name: second.title }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('rowheader', { name: SAVED_ITEM.title }),
    ).toBeInTheDocument()
    expect(
      calls.mock.calls.filter(([url]) =>
        String(url).includes('/inspection-items?limit=100'),
      ),
    ).toHaveLength(2)
  })

  it('以 system_id 套用空系統時顯示空結果', async () => {
    const calls = mockApi(Response.json([], { status: 200 }))
    renderPage()
    await selectSystem()
    fireEvent.click(screen.getByLabelText('整個系統'))
    fireEvent.click(screen.getByRole('button', { name: '套用至專案' }))

    const empty = await screen.findByText('這個系統沒有項目')
    expect(empty).toBeInTheDocument()
    expect(calls).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/inspection-items:apply-template',
      expect.objectContaining({
        body: JSON.stringify({ system_id: 'system-1' }),
      }),
    )
  })

  it('寫入 403 後保留選擇並切為唯讀', async () => {
    mockApi(
      Response.json({ error: { code: 'permission.denied' } }, { status: 403 }),
    )
    renderPage()
    await selectSystem()
    fireEvent.change(screen.getByLabelText('查核項目'), {
      target: { value: 'template-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '套用至專案' }))

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: '套用至專案' }),
      ).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('查核項目')).toHaveValue('template-1')
    expect(screen.getByText('目前只能瀏覽範本。')).toBeInTheDocument()
  })

  it('讀取 403 時不顯示套用按鈕', async () => {
    mockApi(Response.json([]), true)
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '你沒有權限執行這項操作。',
    )
    expect(
      screen.queryByRole('button', { name: '套用至專案' }),
    ).not.toBeInTheDocument()
  })

  it.each([409, 422])('寫入 %i 顯示中文訊息', async (status) => {
    mockApi(
      Response.json(
        { error: { code: 'request.validation_failed' } },
        { status },
      ),
    )
    renderPage()
    await selectSystem()
    fireEvent.click(screen.getByLabelText('整個系統'))
    fireEvent.click(screen.getByRole('button', { name: '套用至專案' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      status === 409 ? '範本內容有衝突' : '範本資料無效',
    )
  })

  it('列表載入副本來源與時間', async () => {
    mockApi(Response.json([]), false, { projectItems: [SAVED_ITEM] })
    renderPage()

    const table = await screen.findByRole('table')
    const row = within(table).getByRole('row', { name: /風管檢查/ })
    expect(within(row).getByText('空調')).toBeInTheDocument()
    expect(within(row).getByText(/2026/)).toBeInTheDocument()
  })

  it('分頁讀完專案副本', async () => {
    mockApi(Response.json([]), false, {
      paginatedItems: [
        SAVED_ITEM,
        {
          ...SAVED_ITEM,
          id: 'copy-2',
          title: '水管檢查',
        },
      ],
    })
    renderPage()

    expect(
      await screen.findByRole('rowheader', {
        name: '水管檢查',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('rowheader', {
        name: SAVED_ITEM.title,
      }),
    ).toBeInTheDocument()
  })

  it('範本管理員可選系統並存成範本', async () => {
    const calls = mockApi(Response.json([]), false, {
      projectItems: [SAVED_ITEM],
      canSave: true,
      afterSaveTemplates: true,
    })
    renderPage()
    await selectSystem()
    fireEvent.click(
      await screen.findByRole('button', {
        name: '存為範本',
      }),
    )
    fireEvent.change(screen.getByLabelText('目標工程類別'), {
      target: { value: 'category-1' },
    })
    fireEvent.change(await screen.findByLabelText('目標系統'), {
      target: { value: 'system-1' },
    })
    const paths = [
      '/template-categories?limit=100',
      '/template-categories/category-1/systems?limit=100',
      '/template-systems/system-1/templates?limit=100',
    ]
    const requestCount = (path: string) =>
      calls.mock.calls.filter(([url]) => String(url).endsWith(path)).length
    const beforeSave = paths.map(requestCount)
    fireEvent.click(
      screen.getByRole('button', {
        name: '確認存為範本',
      }),
    )

    expect(
      await screen.findByRole('status', {
        name: '',
      }),
    ).toHaveTextContent('已存為範本。')
    expect(calls).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/templates',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          project_inspection_item_id: SAVED_ITEM.id,
          system_id: 'system-1',
        }),
      }),
    )
    expect(
      await screen.findByRole('option', { name: '新增的範本' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('系統')).toHaveValue('system-1')
    paths.forEach((path, index) => {
      expect(requestCount(path)).toBe(beforeSave[index] + 1)
    })
  })

  it('存為範本 409 顯示同名訊息並保留選擇', async () => {
    mockApi(Response.json([]), false, {
      projectItems: [SAVED_ITEM],
      canSave: true,
      saveResponse: Response.json(
        { error: { code: 'template.name_conflict' } },
        { status: 409 },
      ),
    })
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', {
        name: '存為範本',
      }),
    )
    fireEvent.change(screen.getByLabelText('目標工程類別'), {
      target: { value: 'category-1' },
    })
    fireEvent.change(await screen.findByLabelText('目標系統'), {
      target: { value: 'system-1' },
    })
    fireEvent.click(
      screen.getByRole('button', {
        name: '確認存為範本',
      }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '該系統已有同名範本。',
    )
    expect(screen.getByLabelText('目標系統')).toHaveValue('system-1')
  })

  it('非範本管理員不顯示存為範本操作', async () => {
    mockApi(Response.json([]), false, { projectItems: [SAVED_ITEM] })
    renderPage()
    await screen.findByRole('rowheader', { name: SAVED_ITEM.title })
    expect(
      screen.queryByRole('button', { name: '存為範本' }),
    ).not.toBeInTheDocument()
  })

  it('存為範本寫入 403 後隱藏操作且保留選擇', async () => {
    mockApi(Response.json([]), false, {
      projectItems: [SAVED_ITEM],
      canSave: true,
      saveResponse: Response.json(
        { error: { code: 'permission.denied' } },
        { status: 403 },
      ),
    })
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', {
        name: '存為範本',
      }),
    )
    fireEvent.change(screen.getByLabelText('目標工程類別'), {
      target: { value: 'category-1' },
    })
    fireEvent.change(await screen.findByLabelText('目標系統'), {
      target: { value: 'system-1' },
    })
    fireEvent.click(
      screen.getByRole('button', {
        name: '確認存為範本',
      }),
    )

    await waitFor(() => {
      expect(
        screen.queryByRole('button', {
          name: '存為範本',
        }),
      ).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('目標系統')).toHaveValue('system-1')
    const readOnly = screen.getByText('目前只能瀏覽查核項目。')
    expect(readOnly).toBeInTheDocument()
  })

  it('專案列表讀取 403 隱藏所有操作', async () => {
    mockApi(Response.json([]), false, { denyItems: true, canSave: true })
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '你沒有權限執行這項操作。',
    )
    expect(
      screen.queryByRole('button', {
        name: '套用至專案',
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: '存為範本',
      }),
    ).not.toBeInTheDocument()
  })
})
