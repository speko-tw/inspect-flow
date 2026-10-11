import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CurrentUser } from '../../auth/api'
import type { TemplateItem } from '../templates/api'
import { CurrentUserProvider } from '../../auth/useCurrentUser'
import { holdRequests as holdFetch } from '../../testing/submitGuard'
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
  has_office_access: true,
  has_field_access: false,
  has_template_access: false,
}

const PROJECT_ITEM: ProjectInspectionItem = {
  id: 'copy-1',
  project_id: 'project-1',
  sequence: 1,
  title: '管線查核',
  instruction: '確認管線安裝',
  source_template_name: '給排水',
  applied_at: '2026-10-04T01:00:00Z',
}

const TEMPLATE: TemplateItem = {
  id: 'template-1',
  system_id: 'system-1',
  sequence: 1,
  title: '管線查核',
  instruction: '確認管線安裝',
  inspection_points: [
    {
      sequence: 1,
      title: '坡度',
      instruction: '確認排水坡度',
      text_standard: { text: '依圖施工' },
      numeric_standard: {
        value: null,
        condition: 'range',
        unit: '%',
        tolerance: null,
        range_form: 'interval',
        lower_bound: '1',
        upper_bound: '3',
      },
      measurement_fields: [],
      evidence_requirements: [
        {
          evidence_type: 'photo',
          required: true,
          min_count: 1,
          max_count: null,
        },
      ],
    },
  ],
}

// The server decides `has_template_access` and `GET /projects` access
// from the same rule, so the mock keeps them in step via `canSave`.
let managerMock = false

function mockApi(
  options: {
    applyResponse?: Response
    saveResponse?: Response
    templates?: TemplateItem[]
    projectItems?: ProjectInspectionItem[]
    canSave?: boolean
    denyCategories?: boolean
    secondSystemTemplate?: boolean
    secondSystemGrowsAfterSave?: boolean
    reloadFailsAfterSave?: boolean
    listCounts?: boolean
  } = {},
) {
  let saveRequests = 0
  let saved = false
  managerMock = Boolean(options.canSave)
  const calls = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/v1/projects?limit=100') {
      return options.canSave
        ? Response.json({
            items: [
              {
                id: 'project-1',
                project_code: '試用 A',
                name: '試用專案 A',
              },
            ],
            next_cursor: null,
          })
        : Response.json(
            { error: { code: 'permission.denied' } },
            {
              status: 403,
            },
          )
    }
    if (url === '/api/v1/me/projects') {
      return Response.json([
        {
          id: 'project-1',
          project_code: '試用 A',
          name: '試用專案 A',
          client_name: '示範公司',
          site_location: '北部',
          planned_start_date: null,
          planned_completion_date: null,
          role_names: ['內業'],
        },
      ])
    }
    if (url.endsWith('/inspection-items?limit=100')) {
      return Response.json({
        items: options.projectItems ?? [],
        next_cursor: null,
      })
    }
    if (url === '/api/v1/template-categories?limit=100') {
      if (options.denyCategories) {
        return Response.json(
          { error: { code: 'permission.denied' } },
          {
            status: 403,
          },
        )
      }
      return Response.json({
        items: [
          { id: 'category-1', name: '建築工程' },
          { id: 'category-2', name: '土木工程' },
        ],
        next_cursor: null,
      })
    }
    if (url.includes('/category-1/systems?limit=100')) {
      return Response.json({
        items: [
          {
            id: 'system-1',
            category_id: 'category-1',
            name: '給排水',
            ...(options.listCounts ? { item_count: 2 } : {}),
          },
          {
            id: 'system-2',
            category_id: 'category-1',
            name: '電氣',
            ...(options.listCounts ? { item_count: 1 } : {}),
          },
        ],
        next_cursor: null,
      })
    }
    if (url.includes('/category-2/systems?limit=100')) {
      return Response.json({
        items: [{ id: 'system-3', category_id: 'category-2', name: '基礎' }],
        next_cursor: null,
      })
    }
    if (url.includes('/template-systems/system-1/templates?limit=100')) {
      return Response.json({
        items: options.templates ?? [
          TEMPLATE,
          {
            ...TEMPLATE,
            id: 'template-2',
            title: '水壓測試',
          },
        ],
        next_cursor: null,
      })
    }
    if (url.includes('/template-systems/system-2/templates?limit=100')) {
      if (options.reloadFailsAfterSave && saved) {
        return Response.json(
          { error: { code: 'internal_error' } },
          { status: 500 },
        )
      }
      return Response.json({
        items:
          options.secondSystemTemplate === false
            ? []
            : [
                {
                  ...TEMPLATE,
                  id: 'template-3',
                  system_id: 'system-2',
                  title: '電力查核',
                },
                ...(options.secondSystemGrowsAfterSave && saved
                  ? [
                      {
                        ...TEMPLATE,
                        id: 'template-new',
                        system_id: 'system-2',
                        title: '管線查核',
                      },
                    ]
                  : []),
              ],
        next_cursor: null,
      })
    }
    if (url.includes('/template-systems/system-3/templates?limit=100')) {
      return Response.json({ items: [], next_cursor: null })
    }
    if (url.endsWith('/inspection-items:apply-template')) {
      return (
        options.applyResponse ??
        Response.json(
          [
            {
              id: 'copy-2',
              project_id: 'project-1',
              source_template_name: '給排水',
              applied_at: '2026-10-05T01:00:00Z',
            },
          ],
          { status: 201 },
        )
      )
    }
    if (url.endsWith('/projects/project-1/templates')) {
      saveRequests += 1
      saved = true
      return options.saveResponse && saveRequests === 1
        ? options.saveResponse
        : Response.json(
            {
              id: 'template-new',
              title: '管線查核',
            },
            { status: 201 },
          )
    }
    return Response.json(
      { error: { code: 'resource.not_found' } },
      {
        status: 404,
      },
    )
  })
  vi.stubGlobal('fetch', calls)
  return calls
}

function renderPage(
  user: CurrentUser = { ...USER, has_template_access: managerMock },
  viewerPermissions = ['project_inspection_item.edit'],
) {
  return render(
    <MemoryRouter
      initialEntries={['/admin/projects/project-1/inspection-items/templates']}
    >
      <CurrentUserProvider value={{ user, clear: vi.fn() }}>
        <Routes>
          <Route
            element={
              <ProjectTemplatesPage viewerPermissions={viewerPermissions} />
            }
            path="/admin/projects/:projectId/inspection-items/templates"
          />
          <Route
            element={<p>PROJECT_DETAIL</p>}
            path="/admin/projects/:projectId/inspection-items"
          />
          <Route
            element={<p>PROJECT_DETAIL</p>}
            path="/admin/projects/:projectId"
          />
        </Routes>
      </CurrentUserProvider>
    </MemoryRouter>,
  )
}

function useMobileViewport() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

async function chooseSystem(itemTitle = '管線查核') {
  const nav = screen.getByRole('complementary', { name: '範本庫導覽' })
  fireEvent.click(await within(nav).findByRole('button', { name: '建築工程' }))
  fireEvent.click(await within(nav).findByRole('button', { name: '給排水' }))
  await within(nav).findByRole('button', {
    name: new RegExp(`^${itemTitle}(?:，已套用)?$`),
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('專案範本套用與存為範本（#429）', () => {
  it('把 409 衝突名稱轉成原型指定訊息，並保留中性 404', () => {
    expect(
      templateErrorMessage(
        new ProjectTemplatesApiError(
          409,
          'project_inspection_item.duplicate_name',
          ['管線查核'],
        ),
      ),
    ).toBe('已套用過『管線查核』，本次沒有新增任何項目。')
    expect(templateErrorMessage(new ProjectTemplatesApiError(404))).toBe(
      '找不到指定的資料，請重新整理後再試。',
    )
  })

  it('預覽單一項目後套用，返回專案看到新項目', async () => {
    const calls = mockApi()
    renderPage()
    await chooseSystem()
    fireEvent.click(screen.getByRole('button', { name: '管線查核' }))
    expect(screen.getByText('將新增 1 個項目')).toBeInTheDocument()
    expect(screen.getByText(/確認排水坡度/)).toBeInTheDocument()
    expect(screen.getByText('數值標準：坡度 1～3 %')).toBeInTheDocument()
    expect(screen.getByText('文字標準：依圖施工')).toBeInTheDocument()
    expect(screen.getByText('照片：至少 1 張')).toBeInTheDocument()
    expect(screen.getByText(/之後修改範本不會更新/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '套用至專案' }))
    expect(await screen.findByText('PROJECT_DETAIL')).toBeInTheDocument()
    expect(calls).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/inspection-items:apply-template',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ template_id: 'template-1' }),
      }),
    )
  })

  it('預覽尚未設定標準的項次時顯示白話提示', async () => {
    const item = structuredClone(TEMPLATE)
    item.inspection_points[0].numeric_standard = null
    item.inspection_points[0].text_standard = null
    mockApi({ templates: [item] })
    renderPage()
    await chooseSystem()
    fireEvent.click(screen.getByRole('button', { name: '管線查核' }))
    expect(screen.getByText('標準未設定')).toBeInTheDocument()
  })

  it('單項名稱以 strip 與 casefold 比對，已套用項目不能再次選取', async () => {
    const template = { ...TEMPLATE, title: 'Pump ß' }
    mockApi({
      templates: [template],
      projectItems: [{ ...PROJECT_ITEM, title: '  PUMP ss  ' }],
    })
    renderPage()
    await chooseSystem('Pump ß')

    const itemRadio = screen.getByRole('radio', {
      name: '單一項目：Pump ß',
    })
    expect(itemRadio).toBeDisabled()
    await waitFor(() => expect(itemRadio).toBeChecked())
    expect(screen.getAllByText('已套用').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText('專案已有同名項目，需要第二份請先改名'),
    ).toHaveLength(1)
    expect(screen.getByRole('button', { name: '套用至專案' })).toBeDisabled()
  })

  it('名稱正規化剝除 Python 空白但不剝除 BOM', async () => {
    const pump = { ...TEMPLATE, title: 'Pump' }
    const beam = { ...TEMPLATE, id: 'template-2', title: 'Beam' }
    mockApi({
      templates: [pump, beam],
      projectItems: [
        { ...PROJECT_ITEM, title: '\u0085Pump\u001f' },
        { ...PROJECT_ITEM, id: 'copy-2', title: '\uFEFFBeam\uFEFF' },
      ],
    })
    renderPage()
    await chooseSystem('Pump')

    expect(
      screen.getByRole('radio', { name: '單一項目：Pump' }),
    ).toBeDisabled()
    expect(screen.getByRole('radio', { name: '單一項目：Beam' })).toBeEnabled()
  })

  it('沒有編輯權限仍可讀取套用頁但不提供寫入操作', async () => {
    mockApi()
    renderPage(USER, [])
    await chooseSystem()

    expect(
      screen.getByRole('region', { name: '範本操作' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('你沒有修改此專案查核項目的權限。'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '套用至專案' }),
    ).not.toBeInTheDocument()
  })

  it('全部項目已套用時預選單項並說明沒有可套用項目', async () => {
    mockApi({
      templates: [
        TEMPLATE,
        { ...TEMPLATE, id: 'template-2', title: '水壓測試' },
      ],
      projectItems: [
        { ...PROJECT_ITEM, title: ' 管線查核 ' },
        { ...PROJECT_ITEM, id: 'copy-2', title: '水壓測試' },
      ],
    })
    renderPage()
    await chooseSystem()

    expect(
      await screen.findByRole('heading', { name: '沒有可套用的項目' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('專案已有這個系統的全部項目。'),
    ).toBeInTheDocument()
    const systemRadio = screen.getByLabelText('整個系統（2 個項目）')
    expect(systemRadio).toBeDisabled()
    expect(systemRadio).not.toBeChecked()
    expect(systemRadio).toHaveAttribute(
      'aria-describedby',
      'system-applied-help',
    )
    const itemRadio = screen.getByRole('radio', {
      name: '單一項目：管線查核',
    })
    expect(itemRadio).toBeDisabled()
    expect(itemRadio).toBeChecked()
    expect(screen.queryByText('將新增 1 個項目')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '套用至專案' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '套用至專案' })).toHaveAttribute(
      'aria-describedby',
      'system-applied-help',
    )
  })

  it('部分項目已套用時顯示數量並禁止部分套用', async () => {
    const calls = mockApi({
      templates: [
        TEMPLATE,
        { ...TEMPLATE, id: 'template-2', title: '水壓測試' },
      ],
      projectItems: [{ ...PROJECT_ITEM, title: ' 管線查核 ' }],
    })
    renderPage()
    await chooseSystem()

    expect(screen.getByLabelText('整個系統（2 個項目）')).toBeChecked()
    expect(screen.getAllByText(/1 項已套用/)).toHaveLength(1)
    expect(screen.getByRole('button', { name: '套用至專案' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '套用至專案' })).toHaveAttribute(
      'aria-describedby',
      'system-applied-help',
    )
    expect(calls).not.toHaveBeenCalledWith(
      '/api/v1/projects/project-1/inspection-items:apply-template',
      expect.anything(),
    )
  })

  it('整個系統切換後從樹選單一項目，只送出該範本 ID', async () => {
    const calls = mockApi()
    renderPage()
    await chooseSystem()
    fireEvent.click(screen.getByLabelText('整個系統（2 個項目）'))
    fireEvent.click(screen.getByRole('button', { name: '管線查核' }))
    expect(screen.getByText('將新增 1 個項目')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '套用至專案' }))
    expect(await screen.findByText('PROJECT_DETAIL')).toBeInTheDocument()
    expect(calls).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/inspection-items:apply-template',
      expect.objectContaining({
        body: JSON.stringify({ template_id: 'template-1' }),
      }),
    )
  })

  it('選單改選單項後再選整個系統，送出 system_id', async () => {
    const calls = mockApi()
    renderPage()
    await chooseSystem()
    fireEvent.click(screen.getByRole('button', { name: '管線查核' }))
    fireEvent.click(screen.getByRole('button', { name: '給排水' }))
    expect(screen.getByLabelText('整個系統（2 個項目）')).toBeChecked()
    expect(screen.getByRole('button', { name: '套用至專案' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '套用至專案' }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: '確定套用' }))
    expect(await screen.findByText('PROJECT_DETAIL')).toBeInTheDocument()
    expect(calls).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/inspection-items:apply-template',
      expect.objectContaining({
        body: JSON.stringify({ system_id: 'system-1' }),
      }),
    )
  })

  it('保留每個已開啟系統自己的項目與計數', async () => {
    mockApi()
    renderPage()
    const nav = screen.getByRole('complementary', { name: '範本庫導覽' })
    fireEvent.click(
      await within(nav).findByRole('button', { name: '建築工程' }),
    )
    fireEvent.click(await within(nav).findByRole('button', { name: '給排水' }))
    await within(nav).findByRole('button', { name: '管線查核' })
    fireEvent.click(within(nav).getByRole('button', { name: '電氣' }))
    await screen.findByRole('heading', { name: '套用範本：電氣' })
    const water = within(nav).getByRole('button', { name: '給排水' })
    expect(water).toHaveTextContent('2 個查核項目')
    fireEvent.click(water)
    expect(
      await screen.findByRole('heading', { name: '套用範本：給排水' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('整個系統（2 個項目）')).toBeChecked()
    expect(screen.getByLabelText('單一項目：管線查核')).toBeInTheDocument()
  })

  it('手機在清單與詳情間切換，返回後保留樹的展開狀態', async () => {
    useMobileViewport()
    mockApi()
    renderPage()
    const layout = await screen.findByRole('region', { name: '範本操作' })
    const paneLayout = layout.parentElement
    expect(paneLayout).toHaveAttribute('data-pane', 'list')
    fireEvent.click(await screen.findByRole('button', { name: '建築工程' }))
    expect(paneLayout).toHaveAttribute('data-pane', 'detail')
    fireEvent.click(screen.getByRole('button', { name: '返回選擇' }))
    expect(paneLayout).toHaveAttribute('data-pane', 'list')
    expect(screen.getByRole('button', { name: '建築工程' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('手機選取類別後可從詳情直接選系統', async () => {
    useMobileViewport()
    mockApi()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '建築工程' }))
    const detail = screen.getByRole('region', { name: '範本操作' })
    const electrical = await within(detail).findByRole('button', {
      name: '電氣',
    })
    expect(electrical).toBeInTheDocument()
    fireEvent.click(electrical)
    expect(
      await screen.findByRole('heading', { name: '套用範本：電氣' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('開啟詳情')).not.toBeInTheDocument()
  })

  it('手機類別清單顯示各系統的查核項目數', async () => {
    useMobileViewport()
    mockApi({ listCounts: true })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '建築工程' }))

    const detail = screen.getByRole('region', { name: '範本操作' })
    expect(await within(detail).findByText('2 個查核項目')).toBeInTheDocument()
    expect(within(detail).getByText('1 個查核項目')).toBeInTheDocument()
  })

  it('整系統多項套用前要求頁內確認', async () => {
    const calls = mockApi()
    renderPage()
    await chooseSystem()
    fireEvent.click(screen.getByLabelText('整個系統（2 個項目）'))
    expect(screen.getByText('將新增 2 個項目')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '套用至專案' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('一次新增 2 個項目')
    expect(dialog).toHaveTextContent(
      '套用後可在查核項目修改內容，目前無法刪除',
    )
    expect(dialog).not.toHaveTextContent('改名')
    fireEvent.click(within(dialog).getByRole('button', { name: '確定套用' }))
    expect(await screen.findByText('PROJECT_DETAIL')).toBeInTheDocument()
    expect(calls).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/inspection-items:apply-template',
      expect.objectContaining({
        body: JSON.stringify({ system_id: 'system-1' }),
      }),
    )
  })

  it('同名 409 提供改選範本與返回專案兩個出口', async () => {
    mockApi({
      applyResponse: Response.json(
        {
          error: {
            code: 'project_inspection_item.duplicate_name',
            details: ['管線查核'],
          },
        },
        { status: 409 },
      ),
    })
    renderPage()
    await chooseSystem()
    fireEvent.click(screen.getByRole('button', { name: '管線查核' }))
    fireEvent.click(screen.getByRole('button', { name: '套用至專案' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '已套用過『管線查核』，本次沒有新增任何項目。',
    )
    // 聚焦在 useEffect 裡；alert 插入 DOM 後才聚焦，所以要等。
    await waitFor(() =>
      expect(
        within(screen.getByRole('alert')).getByRole('button', {
          name: '改選其他範本',
        }),
      ).toHaveFocus(),
    )
    expect(
      screen.getByRole('button', { name: '改選其他範本' }),
    ).toBeInTheDocument()
    // 頁首的 BackLink 與錯誤框裡的出口各一個。
    expect(screen.getAllByRole('link', { name: '返回查核項目' })).toHaveLength(
      2,
    )
    fireEvent.click(
      within(screen.getByRole('alert')).getByRole('link', {
        name: '返回查核項目',
      }),
    )
    expect(await screen.findByText('PROJECT_DETAIL')).toBeInTheDocument()
  })

  it('同名 409 的改選出口會清除錯誤並返回範本選擇', async () => {
    mockApi({
      applyResponse: Response.json(
        {
          error: {
            code: 'project_inspection_item.duplicate_name',
            details: ['管線查核'],
          },
        },
        { status: 409 },
      ),
    })
    renderPage()
    await chooseSystem()
    fireEvent.click(screen.getByRole('button', { name: '管線查核' }))
    fireEvent.click(screen.getByRole('button', { name: '套用至專案' }))
    const alert = await screen.findByRole('alert')
    fireEvent.click(
      within(alert).getByRole('button', {
        name: '改選其他範本',
      }),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('選擇範本')).toBeInTheDocument()
  })

  it('存為範本同名時保留來源與目的地，改選其他系統可完成', async () => {
    const calls = mockApi({
      canSave: true,
      projectItems: [PROJECT_ITEM],
      saveResponse: Response.json(
        {
          error: {
            code: 'template.name_conflict',
          },
        },
        { status: 409 },
      ),
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '存為範本' }))
    expect(
      screen.getByRole('heading', {
        name: '將「管線查核」存為範本',
      }),
    ).toBeInTheDocument()
    const nav = screen.getByRole('complementary', { name: '範本庫導覽' })
    fireEvent.click(
      await within(nav).findByRole('button', { name: '建築工程' }),
    )
    fireEvent.click(await within(nav).findByRole('button', { name: '電氣' }))
    expect(screen.getByText(/範本庫 \/ 建築工程 \/ 電氣/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/名稱/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '存入這個系統' }))
    const conflict = await screen.findByRole('alert')
    expect(conflict).toHaveTextContent(
      '這個系統已有「管線查核」，沒有存入範本。請改選其他系統。',
    )
    // 聚焦在 useEffect 裡；alert 插入 DOM 後才聚焦，所以要等。
    await waitFor(() =>
      expect(
        within(conflict).getByRole('button', { name: '改選系統' }),
      ).toHaveFocus(),
    )
    expect(
      within(nav).getByRole('button', { name: '電氣' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '改選系統' }))
    fireEvent.click(within(nav).getByRole('button', { name: '土木工程' }))
    fireEvent.click(await within(nav).findByRole('button', { name: '基礎' }))
    fireEvent.click(screen.getByRole('button', { name: '存入這個系統' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      '已將「管線查核」存入「土木工程 / 基礎」。',
    )
    // 成功後只留頁首的返回連結，不再多一個同名按鈕（#516）。
    expect(screen.getAllByRole('link', { name: '返回查核項目' })).toHaveLength(
      1,
    )
    expect(calls).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/templates',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          project_inspection_item_id: 'copy-1',
          system_id: 'system-3',
        }),
      }),
    )
  })

  it('存為範本後，目標系統在範本樹的項目數會重新載入（#487）', async () => {
    mockApi({
      canSave: true,
      projectItems: [PROJECT_ITEM],
      secondSystemGrowsAfterSave: true,
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '存為範本' }))
    const nav = screen.getByRole('complementary', { name: '範本庫導覽' })
    fireEvent.click(
      await within(nav).findByRole('button', { name: '建築工程' }),
    )
    fireEvent.click(await within(nav).findByRole('button', { name: '電氣' }))
    await waitFor(() =>
      expect(
        within(nav).getByRole('button', { name: '電氣' }),
      ).toHaveTextContent('1 個查核項目'),
    )
    fireEvent.click(screen.getByRole('button', { name: '存入這個系統' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      '已將「管線查核」存入「建築工程 / 電氣」。',
    )
    await waitFor(() =>
      expect(
        within(nav).getByRole('button', { name: '電氣' }),
      ).toHaveTextContent('2 個查核項目'),
    )
  })

  async function saveIntoSecondSystem(): Promise<HTMLElement> {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '存為範本' }))
    const nav = screen.getByRole('complementary', { name: '範本庫導覽' })
    fireEvent.click(
      await within(nav).findByRole('button', { name: '建築工程' }),
    )
    fireEvent.click(await within(nav).findByRole('button', { name: '電氣' }))
    await waitFor(() =>
      expect(
        within(nav).getByRole('button', { name: '電氣' }),
      ).toHaveTextContent('1 個查核項目'),
    )
    fireEvent.click(screen.getByRole('button', { name: '存入這個系統' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      '已將「管線查核」存入「建築工程 / 電氣」。',
    )
    return nav
  }

  it('存檔後重新載入失敗時，目標系統的數量加 1，不退回存檔前的數字（#492）', async () => {
    mockApi({
      canSave: true,
      projectItems: [PROJECT_ITEM],
      reloadFailsAfterSave: true,
      listCounts: true,
    })
    const nav = await saveIntoSecondSystem()
    await waitFor(() =>
      expect(
        within(nav).getByRole('button', { name: '電氣' }),
      ).toHaveTextContent('2 個查核項目'),
    )
    // 沒動到的系統維持列表帶回的數量。
    expect(
      within(nav).getByRole('button', { name: '給排水' }),
    ).toHaveTextContent('2 個查核項目')
  })

  it('範本讀取 403 時切成唯讀，仍保留既有專案項目', async () => {
    mockApi({ denyCategories: true, projectItems: [PROJECT_ITEM] })
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '你沒有權限執行這項操作。',
    )
    expect(
      screen.getByText('範本讀取權限不足，無法載入其他內容。'),
    ).toBeInTheDocument()
    expect(screen.getByText('管線查核')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '套用至專案' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '存為範本' }),
    ).not.toBeInTheDocument()
  })

  it('空系統明確說明沒有可套用項目且不允許送出', async () => {
    mockApi({ secondSystemTemplate: false })
    renderPage()
    const nav = screen.getByRole('complementary', { name: '範本庫導覽' })
    fireEvent.click(
      await within(nav).findByRole('button', { name: '建築工程' }),
    )
    fireEvent.click(await within(nav).findByRole('button', { name: '電氣' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      '這個系統沒有查核項目。',
    )
    expect(screen.getByRole('button', { name: '套用至專案' })).toBeDisabled()
  })

  it('有權限者在權限被收回後寫入 403，停用並顯示權限訊息', async () => {
    mockApi({
      canSave: true,
      projectItems: [PROJECT_ITEM],
      saveResponse: Response.json(
        { error: { code: 'permission.denied' } },
        { status: 403 },
      ),
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '存為範本' }))
    const nav = screen.getByRole('complementary', { name: '範本庫導覽' })
    fireEvent.click(within(nav).getByRole('button', { name: '建築工程' }))
    fireEvent.click(await within(nav).findByRole('button', { name: '電氣' }))
    fireEvent.click(screen.getByRole('button', { name: '存入這個系統' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '你沒有權限執行這項操作。',
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      '目前只能瀏覽查核項目。',
    )
    expect(screen.getByRole('button', { name: '存入這個系統' })).toBeDisabled()
  })

  describe('存為範本的顯示權限（#482，TPL-R09）', () => {
    const urls = (calls: ReturnType<typeof mockApi>) =>
      calls.mock.calls.map(([input]) => String(input))

    it('一般專案成員看不到存為範本，且不靠 403 降級讀專案', async () => {
      const calls = mockApi({ canSave: false, projectItems: [PROJECT_ITEM] })
      renderPage()
      expect(await screen.findByText('管線查核')).toBeInTheDocument()
      expect(await screen.findByText(/試用專案 A/)).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: '存為範本' }),
      ).not.toBeInTheDocument()
      expect(urls(calls)).toContain('/api/v1/me/projects')
      expect(urls(calls)).not.toContain('/api/v1/projects?limit=100')
    })

    it('範本管理員（has_template_access）看得到存為範本', async () => {
      const calls = mockApi({ canSave: true, projectItems: [PROJECT_ITEM] })
      renderPage({ ...USER, has_template_access: true })
      expect(
        await screen.findByRole('button', { name: '存為範本' }),
      ).toBeInTheDocument()
      expect(await screen.findByText(/試用專案 A/)).toBeInTheDocument()
      expect(urls(calls)).toContain('/api/v1/projects?limit=100')
      expect(urls(calls)).not.toContain('/api/v1/me/projects')
    })

    it('Admin（三項存取皆 true）看得到存為範本', async () => {
      mockApi({ canSave: true, projectItems: [PROJECT_ITEM] })
      renderPage({
        ...USER,
        is_admin: true,
        has_office_access: true,
        has_field_access: true,
        has_template_access: true,
      })
      expect(
        await screen.findByRole('button', { name: '存為範本' }),
      ).toBeInTheDocument()
    })

    it('has_template_access 缺值（fallback）時不顯示存為範本', async () => {
      mockApi({ canSave: true, projectItems: [PROJECT_ITEM] })
      const partial: Partial<CurrentUser> = { ...USER }
      delete partial.has_template_access
      renderPage(partial as CurrentUser)
      expect(await screen.findByText('管線查核')).toBeInTheDocument()
      expect(await screen.findByText(/試用專案 A/)).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: '存為範本' }),
      ).not.toBeInTheDocument()
    })
  })
})

describe('專案範本套用與存為範本：防連點（#507）', () => {
  // mockApi 的替身只收 input；請求本身仍帶 init，攔截時需要看 method。
  const holdRequests = (
    calls: ReturnType<typeof mockApi>,
    method: string,
    pattern: RegExp,
  ) =>
    holdFetch(
      calls as unknown as Parameters<typeof holdFetch>[0],
      method,
      pattern,
    )

  const applyCalls = (calls: ReturnType<typeof mockApi>) =>
    calls.mock.calls.filter(([url]) =>
      String(url).endsWith('/inspection-items:apply-template'),
    )

  it('單一項目連點「套用至專案」只送出一次', async () => {
    const calls = mockApi()
    renderPage()
    await chooseSystem()
    fireEvent.click(screen.getByRole('button', { name: '管線查核' }))
    const gate = holdRequests(calls, 'POST', /apply-template$/)
    const apply = screen.getByRole('button', { name: '套用至專案' })

    fireEvent.click(apply)
    fireEvent.click(apply)
    gate.resolve()

    await screen.findByText('PROJECT_DETAIL')
    expect(applyCalls(calls)).toHaveLength(1)
  })

  it('整系統套用的確認框連點「確定套用」只送出一次', async () => {
    const calls = mockApi()
    renderPage()
    await chooseSystem()
    fireEvent.click(screen.getByLabelText('整個系統（2 個項目）'))
    fireEvent.click(screen.getByRole('button', { name: '套用至專案' }))
    const confirm = within(screen.getByRole('alertdialog')).getByRole(
      'button',
      { name: '確定套用' },
    )
    const gate = holdRequests(calls, 'POST', /apply-template$/)

    fireEvent.click(confirm)
    fireEvent.click(confirm)
    gate.resolve()

    await screen.findByText('PROJECT_DETAIL')
    expect(applyCalls(calls)).toHaveLength(1)
  })

  it('套用失敗之後可以再套用', async () => {
    const calls = mockApi({
      applyResponse: Response.json(
        { error: { code: 'internal_error' } },
        { status: 500 },
      ),
    })
    renderPage()
    await chooseSystem()
    fireEvent.click(screen.getByRole('button', { name: '管線查核' }))

    fireEvent.click(screen.getByRole('button', { name: '套用至專案' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '套用至專案' }))

    await waitFor(() => expect(applyCalls(calls)).toHaveLength(2))
  })

  it('連點「存入這個系統」只送出一次', async () => {
    const calls = mockApi({ canSave: true, projectItems: [PROJECT_ITEM] })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '存為範本' }))
    const nav = screen.getByRole('complementary', { name: '範本庫導覽' })
    fireEvent.click(
      await within(nav).findByRole('button', { name: '建築工程' }),
    )
    fireEvent.click(await within(nav).findByRole('button', { name: '電氣' }))
    const gate = holdRequests(
      calls,
      'POST',
      /\/projects\/project-1\/templates$/,
    )
    const save = screen.getByRole('button', { name: '存入這個系統' })

    fireEvent.click(save)
    fireEvent.click(save)
    gate.resolve()

    await screen.findByRole('status')
    expect(
      calls.mock.calls.filter(([url]) =>
        String(url).endsWith('/projects/project-1/templates'),
      ),
    ).toHaveLength(1)
  })

  it('這一頁沒有 form 與 Enter 處理，輸入法 Enter 不適用', () => {
    mockApi()
    const { container } = renderPage()

    expect(container.querySelector('form')).toBeNull()
  })
})
