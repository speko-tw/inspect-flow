import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import {
  MemoryRouter,
  Route,
  Routes,
  useNavigate,
  useLocation,
  useNavigationType,
} from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CurrentUser } from '../../auth/api'
import type { TemplateItem } from '../templates/api'
import type { ProjectItemListData } from '../projectItems/api'
import { CurrentUserProvider } from '../../auth/useCurrentUser'
import { holdRequests as holdFetch } from '../../testing/submitGuard'
import ProjectTemplatesPage from './ProjectTemplatesPage'
import {
  ProjectTemplatesApiError,
  templateErrorMessage,
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
  can_manage_project_planning_or_members: true,
  has_field_access: false,
  can_inspect_tasks: false,
  has_template_access: false,
  module_permissions: [],
  delegated_modules: [],
  can_create_project: false,
  has_project_access: false,
  is_external_collaborator: false,
}

const PROJECT_ITEM: ProjectItemListData = {
  id: 'copy-1',
  project_id: 'project-1',
  sequence: 1,
  title: '管線查核',
  instruction: '確認管線安裝',
  source_template_name: '給排水',
  applied_at: '2026-10-04T01:00:00Z',
  task_count: 0,
  inspection_points: [],
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

// 這組範本管理情境以 canSave 模擬存為範本與跨專案清單的存取；
// 主管也可讀專案清單，但不因此取得存為範本的權限。
let managerMock = false

function mockApi(
  options: {
    applyResponse?: Response
    saveResponse?: Response
    templates?: TemplateItem[]
    projectItems?: ProjectItemListData[]
    projectItemsAfterApplyConflict?: ProjectItemListData[]
    canSave?: boolean
    denyCategories?: boolean
    secondSystemTemplate?: boolean
    secondSystemGrowsAfterSave?: boolean
    reloadFailsAfterSave?: boolean
    listCounts?: boolean
    failProjectItemsOnRequest?: number
  } = {},
) {
  let saveRequests = 0
  let saved = false
  let applyConflictReturned = false
  let projectItemsRequests = 0
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
      projectItemsRequests += 1
      if (projectItemsRequests === options.failProjectItemsOnRequest) {
        return Response.json(
          { error: { code: 'internal_error' } },
          { status: 500 },
        )
      }
      return Response.json({
        items: url.includes('/projects/project-2/')
          ? []
          : applyConflictReturned && options.projectItemsAfterApplyConflict
            ? options.projectItemsAfterApplyConflict
            : (options.projectItems ?? []),
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
      const response =
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
      if (response.status === 409) applyConflictReturned = true
      return response
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

function ProjectSwitcher() {
  const navigate = useNavigate()
  return (
    <button
      onClick={() =>
        navigate('/projects/project-2/inspection-items/templates')
      }
      type="button"
    >
      切換專案
    </button>
  )
}

function SaveRouteProbe() {
  const location = useLocation()
  const action = useNavigationType()
  return (
    <div data-testid="save-route-probe">
      {JSON.stringify({ action, state: location.state })}
    </div>
  )
}

function renderPage(
  user: CurrentUser = { ...USER, has_template_access: managerMock },
  viewerPermissions = ['project_inspection_item.edit'],
  showProjectSwitcher = false,
  standalone = false,
  canApplyTemplates = viewerPermissions.includes(
    'project_inspection_item.edit',
  ),
  saveItemId?: string,
) {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/projects/project-1/inspection-items/templates',
          state: saveItemId ? { saveItemId } : null,
        },
      ]}
    >
      <CurrentUserProvider value={{ user, clear: vi.fn() }}>
        <SaveRouteProbe />
        {showProjectSwitcher && <ProjectSwitcher />}
        <Routes>
          <Route
            element={
              <ProjectTemplatesPage
                canApplyTemplates={canApplyTemplates}
                standalone={standalone}
                viewerPermissions={viewerPermissions}
              />
            }
            path="/projects/:projectId/inspection-items/templates"
          />
          <Route
            element={<p>PROJECT_DETAIL</p>}
            path="/projects/:projectId/inspection-items"
          />
          <Route element={<p>PROJECT_DETAIL</p>} path="/projects/:projectId" />
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
  it('標題層級預設為 h2，避免與專案頁框的 h1 重複（F-O08）', async () => {
    mockApi({ canSave: true })
    renderPage({ ...USER, has_template_access: true }, [])

    // #744：標題依賴 /projects 的資料，先等專案載入再驗標題層級。
    await screen.findByText('試用 A 試用專案 A', {
      selector: '.tpl-crumb',
    })
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: '套用範本到專案',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  })

  it('只顯示套用日期，且存為範本按鈕依內容排版', async () => {
    mockApi({ canSave: true, projectItems: [PROJECT_ITEM] })
    renderPage({ ...USER, has_template_access: true })

    const appliedTime = await screen.findByText(/2026/)
    expect(appliedTime.tagName).toBe('TIME')
    expect(appliedTime.textContent).toBe('2026/10/4')
    expect(screen.getByText('來源範本：給排水')).toBeVisible()
    expect(screen.getByRole('button', { name: '存為範本' })).toHaveClass(
      'card-action',
    )
  })

  it('非成員套用頁沒有專案頁框，標題從 h1 開始（F-O08）', async () => {
    mockApi({ canSave: true })
    renderPage({ ...USER, has_template_access: true }, [], false, true)

    // #744：獨立頁的 h1 同樣須先等專案資料，不以最終標題代替載入前提。
    await screen.findByText('試用 A｜試用專案 A', {
      selector: '.tpl-crumb',
    })
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: '套用範本到專案',
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', {
        level: 2,
        name: '套用範本到專案',
      }),
    ).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText('試用 A｜試用專案 A')).toBeInTheDocument()
  })

  it('把 409 衝突名稱轉成原型指定訊息，並保留中性 404', () => {
    expect(
      templateErrorMessage(
        new ProjectTemplatesApiError(
          409,
          'project_inspection_item.duplicate_name',
          ['管線查核'],
        ),
      ),
    ).toBe('已套用過「管線查核」，本次沒有新增任何項目。')
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

  it('單項名稱以 strip 與 casefold 比對，無可套用項目時只顯示說明', async () => {
    const template = { ...TEMPLATE, title: 'Pump ß' }
    mockApi({
      templates: [template],
      projectItems: [{ ...PROJECT_ITEM, title: '  PUMP ss  ' }],
    })
    renderPage()
    await chooseSystem('Pump ß')

    expect(
      await screen.findByText('專案已有這些項目，沒有可套用項目。'),
    ).toBeVisible()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.getByRole('button', { name: '套用至專案' })).toBeDisabled()
  })

  it('專案項目載入完成前停用套用，全部已套用後只顯示說明', async () => {
    const calls = mockApi({
      templates: [TEMPLATE],
      projectItems: [PROJECT_ITEM],
    })
    const gate = holdFetch(
      calls as unknown as Parameters<typeof holdFetch>[0],
      'GET',
      /inspection-items\?limit=100$/,
    )
    renderPage()
    await chooseSystem()

    const apply = screen.getByRole('button', { name: '套用至專案' })
    expect(apply).toBeDisabled()
    expect(calls).not.toHaveBeenCalledWith(
      '/api/v1/projects/project-1/inspection-items:apply-template',
      expect.anything(),
    )

    gate.resolve()

    expect(
      await screen.findByText('專案已有這些項目，沒有可套用項目。'),
    ).toBeVisible()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(apply).toBeDisabled()
    expect(apply).toHaveAttribute('aria-describedby', 'selected-applied-help')
  })

  it('切換專案時等新項目載入後才啟用套用', async () => {
    const calls = mockApi({
      templates: [TEMPLATE],
      projectItems: [{ ...PROJECT_ITEM, title: '其他項目' }],
    })
    renderPage(USER, ['project_inspection_item.edit'], true)
    await chooseSystem()
    fireEvent.click(screen.getByRole('button', { name: '管線查核' }))
    const apply = screen.getByRole('button', { name: '套用至專案' })
    expect(apply).toBeEnabled()

    const gate = holdFetch(
      calls as unknown as Parameters<typeof holdFetch>[0],
      'GET',
      /projects\/project-2\/inspection-items\?limit=100$/,
    )
    fireEvent.click(screen.getByRole('button', { name: '切換專案' }))
    await waitFor(() =>
      expect(
        calls.mock.calls.filter(([url]) =>
          String(url).includes(
            '/projects/project-2/inspection-items?limit=100',
          ),
        ),
      ).toHaveLength(1),
    )
    expect(apply).toBeDisabled()

    gate.resolve()
    await waitFor(() => expect(apply).toBeEnabled())
  })

  it('套用遇到同名 409 後重新載入專案項目並即時標示已套用', async () => {
    const calls = mockApi({
      templates: [TEMPLATE],
      projectItemsAfterApplyConflict: [PROJECT_ITEM],
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

    await waitFor(() =>
      expect(
        screen.getAllByText('已套用', { selector: '.tpl-applied-status' }),
      ).not.toHaveLength(0),
    )
    expect(
      screen.getByRole('radio', { name: '單一項目：管線查核' }),
    ).toBeDisabled()
    expect(
      calls.mock.calls.filter(([url]) =>
        String(url).endsWith('/inspection-items?limit=100'),
      ),
    ).toHaveLength(2)
  })

  it('初載項目失敗時停用套用並可重試', async () => {
    const calls = mockApi({
      templates: [TEMPLATE],
      failProjectItemsOnRequest: 1,
    })
    renderPage()
    await chooseSystem()
    fireEvent.click(screen.getByRole('button', { name: '管線查核' }))

    const loadError = await screen.findByText(/伺服器暫時無法處理/)
    expect(loadError.closest('[role="alert"]')).not.toBeNull()
    expect(loadError.closest('.tpl-layout')).toBeNull()
    const apply = screen.getByRole('button', { name: '套用至專案' })
    expect(apply).toBeDisabled()
    const retry = screen.getByRole('button', {
      name: '重新載入專案項目',
    })
    fireEvent.click(retry)
    const pageTitle = screen.getByRole('heading', {
      name: '套用範本到專案',
    })
    await waitFor(() => expect(pageTitle).toHaveFocus())

    await waitFor(() => expect(apply).toBeEnabled())
    expect(
      calls.mock.calls.filter(([url]) =>
        String(url).endsWith('/inspection-items?limit=100'),
      ),
    ).toHaveLength(2)
  })

  it('409 後載入失敗可於頁級重試並更新套用狀態', async () => {
    const calls = mockApi({
      templates: [TEMPLATE],
      projectItemsAfterApplyConflict: [PROJECT_ITEM],
      failProjectItemsOnRequest: 2,
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

    const loadError = await screen.findByText(/伺服器暫時無法處理/)
    expect(loadError.closest('[role="alert"]')).not.toBeNull()
    expect(loadError.closest('.tpl-layout')).toBeNull()
    const apply = screen.getByRole('button', { name: '套用至專案' })
    expect(apply).toBeDisabled()
    const retry = screen.getByRole('button', {
      name: '重新載入專案項目',
    })
    // #429：先完成衝突提示的焦點效果，再驗證重試同步移焦的行為。
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '改選其他範本' }),
      ).toHaveFocus(),
    )
    fireEvent.click(retry)
    expect(
      screen.getByRole('heading', {
        name: '套用範本到專案',
      }),
    ).toHaveFocus()

    await waitFor(() =>
      expect(
        screen.getByRole('radio', { name: '單一項目：管線查核' }),
      ).toBeDisabled(),
    )
    expect(
      calls.mock.calls.filter(([url]) =>
        String(url).endsWith('/inspection-items?limit=100'),
      ),
    ).toHaveLength(3)
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

  it('缺少套用旗標時不提供套用操作，即使有專案項目編輯權限', async () => {
    mockApi()
    renderPage(USER, ['project_inspection_item.edit'], false, false, false)
    await chooseSystem()

    expect(
      screen.getByText('需要範本可使用與查核可使用權限，才能套用範本。'),
    ).toBeVisible()
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
      await screen.findByText('專案已有這些項目，沒有可套用項目。'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /套用預覽/ })).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(document.querySelector('.tpl-preview-list')).toBeNull()
    expect(screen.queryByText('專案已有這個系統的全部項目。')).toBeNull()
    expect(screen.queryByText('將新增 1 個項目')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '套用至專案' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '套用至專案' })).toHaveAttribute(
      'aria-describedby',
      'selected-applied-help',
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
    // ConfirmBox 的初始焦點由 effect 設定，等待它完成後再檢查。
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: '取消' }),
      ).toHaveFocus(),
    )
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
      '套用後可在查核項目修改或刪除；已有任務使用的項目不能刪除。',
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
      '已套用過「管線查核」，本次沒有新增任何項目。',
    )
    expect(screen.getByRole('heading', { name: '套用項目預覽' })).toBeVisible()
    expect(screen.queryByText('將新增 1 個項目')).toBeNull()
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
    expect(
      within(screen.getByRole('alert')).getByRole('link', {
        name: '返回專案',
      }),
    ).toHaveAttribute('href', '/projects/project-1')
    fireEvent.click(
      within(screen.getByRole('alert')).getByRole('link', {
        name: '返回專案',
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

  it('存為範本名稱預填來源且衝突後改名可重試', async () => {
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
    const firstItem = (await screen.findByText('管線查核')).closest(
      'li',
    ) as HTMLElement
    fireEvent.click(
      within(firstItem).getByRole('button', { name: '存為範本' }),
    )
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
    const nameInput = screen.getByRole('textbox', { name: '範本名稱' })
    expect(nameInput).toHaveValue('管線查核')
    fireEvent.change(nameInput, { target: { value: '第一次命名' } })
    fireEvent.click(screen.getByRole('button', { name: '存入這個系統' }))
    const conflict = await screen.findByRole('alert')
    expect(conflict).toHaveTextContent(
      '這個系統已有「第一次命名」，沒有存入範本。請改名後重試，或改選其他系統。',
    )
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(nameInput).toHaveAttribute(
      'aria-describedby',
      'save-template-name-error',
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
    fireEvent.change(nameInput, { target: { value: '改名後的查核' } })
    fireEvent.click(screen.getByRole('button', { name: '存入這個系統' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      '已將「改名後的查核」存入「建築工程 / 電氣」。',
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
          system_id: 'system-2',
          name: '改名後的查核',
        }),
      }),
    )
  })

  it('專案項目卡片入口帶來源 id 並直接進入預填存檔狀態', async () => {
    mockApi({ canSave: true, projectItems: [PROJECT_ITEM] })
    renderPage(
      { ...USER, has_template_access: true },
      [],
      false,
      false,
      false,
      PROJECT_ITEM.id,
    )

    expect(
      await screen.findByRole('heading', {
        name: '將「管線查核」存為範本',
      }),
    ).toBeInTheDocument()
    const nav = screen.getByRole('complementary', { name: '範本庫導覽' })
    fireEvent.click(
      await within(nav).findByRole('button', { name: '建築工程' }),
    )
    fireEvent.click(await within(nav).findByRole('button', { name: '電氣' }))
    expect(screen.getByRole('textbox', { name: '範本名稱' })).toHaveValue(
      '管線查核',
    )
    expect(
      screen.queryByRole('button', { name: '存為範本' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '存入這個系統' }))
    expect(await screen.findByText('PROJECT_DETAIL')).toBeVisible()
    const route = JSON.parse(
      screen.getByTestId('save-route-probe').textContent!,
    )
    expect(route.action).toBe('REPLACE')
    expect(route.state).toMatchObject({
      savedFromItemId: PROJECT_ITEM.id,
      savedTemplateTitle: '管線查核',
    })
  })

  it('可編輯項目但無範本管理權限時只提示一次存回範本需求', async () => {
    mockApi({ canSave: false, projectItems: [PROJECT_ITEM] })
    renderPage(USER, ['project_inspection_item.edit'])

    const hint = await screen.findByText(
      '要把項目存回範本庫，需要「管理範本庫」功能，請找系統管理者開通。',
    )
    expect(hint).toBeInTheDocument()
    expect(
      screen.getAllByText(
        '要把項目存回範本庫，需要「管理範本庫」功能，請找系統管理者開通。',
      ),
    ).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '存為範本' })).toBeNull()
  })

  it('存為範本後，目標系統在範本樹的項目數會重新載入（#487）', async () => {
    useMobileViewport()
    mockApi({
      canSave: true,
      projectItems: [
        PROJECT_ITEM,
        { ...PROJECT_ITEM, id: 'item-2', title: '第二項目' },
      ],
      secondSystemGrowsAfterSave: true,
    })
    renderPage()
    const firstItem = (await screen.findByText('管線查核')).closest(
      'li',
    ) as HTMLElement
    fireEvent.click(
      within(firstItem).getByRole('button', { name: '存為範本' }),
    )
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
    expect(
      await screen.findByRole('button', { name: '儲存中…' }),
    ).toBeDisabled()
    const projectItemsPanel = (
      await screen.findByRole('heading', {
        name: '專案查核項目',
      })
    ).closest('section') as HTMLElement
    expect(within(projectItemsPanel).getByRole('status')).toHaveTextContent(
      '已將「管線查核」存入「建築工程 / 電氣」。',
    )
    const layout = projectItemsPanel.closest('.tpl-layout')
    expect(layout).toHaveAttribute('data-pane', 'list')
    expect(within(projectItemsPanel).getByRole('status')).toBeVisible()
    expect(
      screen.getByRole('heading', { name: '套用範本到專案' }),
    ).toBeInTheDocument()
    const secondItem = screen
      .getByText('第二項目')
      .closest('li') as HTMLElement
    fireEvent.click(
      within(secondItem).getByRole('button', { name: '存為範本' }),
    )
    fireEvent.click(within(nav).getByRole('button', { name: '建築工程' }))
    fireEvent.click(within(nav).getByRole('button', { name: '電氣' }))
    expect(
      screen.queryByText('已將「管線查核」存入「建築工程 / 電氣」。'),
    ).toBeNull()
    expect(await screen.findByLabelText('範本名稱')).toHaveValue('第二項目')
    await waitFor(() =>
      expect(
        within(nav).getByRole('button', { name: '電氣' }),
      ).toHaveTextContent('2 個查核項目'),
    )
  })

  async function saveIntoSecondSystem(): Promise<HTMLElement> {
    renderPage()
    const item = (await screen.findByText('管線查核')).closest(
      'li',
    ) as HTMLElement
    fireEvent.click(within(item).getByRole('button', { name: '存為範本' }))
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
    const saveButton = await screen.findByRole('button', {
      name: '儲存中…',
    })
    expect(saveButton).toBeDisabled()
    const projectItemsPanel = (
      await screen.findByRole('heading', {
        name: '專案查核項目',
      })
    ).closest('section') as HTMLElement
    expect(within(projectItemsPanel).getByRole('status')).toHaveTextContent(
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
        can_inspect_tasks: true,
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

it('TPL-AC32：停用同名提供恢復連結，啟用同名保留改名提示', async () => {
  mockApi({
    projectItems: [{ ...PROJECT_ITEM, is_active: false }],
  })
  renderPage()
  await chooseSystem()
  const radio = screen.getByLabelText('單一項目：管線查核')
  expect(radio).toBeDisabled()
  expect(screen.getByText('同名項目已停用，可在已停用清單恢復')).toBeVisible()
  const link = screen.getByRole('link', { name: '前往已停用清單' })
  expect(link).toHaveAttribute('href', '/projects/project-1/inspection-items')
  expect(screen.queryByText('專案已有同名項目，需要第二份請先改名')).toBeNull()
  fireEvent.click(link)
  expect(await screen.findByText('PROJECT_DETAIL')).toBeVisible()
})

it('TPL-AC32：專案存為範本清單不列停用項目並提示恢復', async () => {
  mockApi({
    canSave: true,
    projectItems: [
      PROJECT_ITEM,
      { ...PROJECT_ITEM, id: 'inactive', title: '停用來源', is_active: false },
    ],
  })
  renderPage()
  expect(await screen.findByRole('button', { name: '存為範本' })).toBeEnabled()
  expect(screen.queryByText('停用來源')).toBeNull()
  expect(screen.getByText('停用項目須先恢復，才能存為範本。')).toBeVisible()
})

it('TPL-AC32：沒有停用項目時不顯示先恢復的提示', async () => {
  mockApi({ canSave: true, projectItems: [PROJECT_ITEM] })
  renderPage()
  expect(await screen.findByRole('button', { name: '存為範本' })).toBeEnabled()
  expect(screen.queryByText('停用項目須先恢復，才能存為範本。')).toBeNull()
})

it('TPL-AC32：網址帶入停用來源時不進入存檔狀態', async () => {
  mockApi({
    canSave: true,
    projectItems: [{ ...PROJECT_ITEM, is_active: false }],
  })
  renderPage(
    { ...USER, has_template_access: true },
    [],
    false,
    false,
    false,
    PROJECT_ITEM.id,
  )
  expect(
    await screen.findByText('停用項目須先恢復，才能存為範本。'),
  ).toBeVisible()
  expect(
    screen.queryByRole('heading', { name: /存為範本/ }),
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '存入這個系統' })).toBeNull()
})

it('TPL-AC32：存為範本遇來源已停用，說明先恢復而非同名衝突', async () => {
  mockApi({
    canSave: true,
    projectItems: [PROJECT_ITEM],
    saveResponse: Response.json(
      { error: { code: 'project_inspection_item.inactive_name' } },
      { status: 409 },
    ),
  })
  renderPage()
  const row = (await screen.findByText('管線查核')).closest(
    'li',
  ) as HTMLElement
  fireEvent.click(within(row).getByRole('button', { name: '存為範本' }))
  const nav = screen.getByRole('complementary', { name: '範本庫導覽' })
  fireEvent.click(await within(nav).findByRole('button', { name: '建築工程' }))
  fireEvent.click(await within(nav).findByRole('button', { name: '電氣' }))
  fireEvent.click(screen.getByRole('button', { name: '存入這個系統' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '來源項目已停用，請先到已停用清單恢復，才能存為範本。',
  )
})
