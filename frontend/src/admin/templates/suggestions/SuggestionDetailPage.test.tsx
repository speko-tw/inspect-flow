import {
  cleanup,
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
  useLocation,
  type InitialEntry,
} from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CurrentUserProvider } from '../../../auth/useCurrentUser'
import { HttpError } from '../../../http'
import { currentUserFixture } from '../../../testing/contractFixtures'
import {
  getSystemTemplates,
  listTemplateCategories,
  listTemplateSystems,
} from '../api'
import {
  approveSuggestion,
  getPendingCount,
  getSuggestion,
  listRevisions,
  returnSuggestion,
  saveRevision,
  submitSuggestion,
  withdrawSuggestion,
  type SuggestionDetail,
  type SuggestionRevision,
} from './api'
import {
  makeContent,
  event,
  IDS,
  LIN,
  makeDetail,
  makeRevision,
  saveResult,
  WU,
} from './fixtures'
import { SUGGESTION_BASE, type SuggestionMode } from './paths'
import { DataMemoryRouter } from '../../../testing/DataMemoryRouter'
import SuggestionDetailPage from './SuggestionDetailPage'
import SuggestionEditPage from './SuggestionEditPage'

vi.mock('./api')
vi.mock('../api')

function Probe() {
  const location = useLocation()
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}|{JSON.stringify(location.state)}
    </div>
  )
}

function renderDetail(
  mode: SuggestionMode,
  userId: string,
  entry: InitialEntry = `${SUGGESTION_BASE[mode]}/${IDS.suggestion}`,
) {
  return render(
    <CurrentUserProvider
      value={{ user: currentUserFixture({ id: userId }), clear: vi.fn() }}
    >
      <MemoryRouter initialEntries={[entry]}>
        <Probe />
        <Routes>
          <Route
            element={<SuggestionDetailPage mode={mode} />}
            path={`${SUGGESTION_BASE[mode]}/:suggestionId`}
          />
          <Route
            element={<p>編輯頁</p>}
            path={`${SUGGESTION_BASE[mode]}/:suggestionId/edit`}
          />
          <Route element={<p>清單</p>} path={SUGGESTION_BASE[mode]} />
        </Routes>
      </MemoryRouter>
    </CurrentUserProvider>,
  )
}

function load(detail: SuggestionDetail, revisions: SuggestionRevision[]) {
  vi.mocked(getSuggestion).mockResolvedValue(detail)
  vi.mocked(listRevisions).mockResolvedValue(revisions)
}

/** 第 1 版被吳經理退回的退回件；`revisedTo` 為提議人之後保存的新版。 */
function returned(revisedTo = 1) {
  const first = makeRevision(1, {
    events: [
      event('PENDING', LIN, '2026-10-31T01:00:00Z'),
      event('RETURNED', WU, '2026-10-31T02:00:00Z', '請補充間距與照片要求'),
    ],
  })
  const revisions = [first]
  for (let no = 2; no <= revisedTo; no += 1) {
    revisions.push(
      makeRevision(no, { content: makeContent({ title: `鋼筋綁紮 v${no}` }) }),
    )
  }
  const current = revisions.at(-1)!
  const detail = makeDetail({
    status: 'RETURNED',
    current_revision: current,
    current_revision_id: current.id,
    revision_no: current.revision_no,
    latest_return: {
      reason: '請補充間距與照片要求',
      revision_no: 1,
      reviewer_name: '吳經理',
      returned_at: '2026-10-31T02:00:00Z',
    },
  })
  return { detail, revisions }
}

beforeEach(() => {
  vi.mocked(getPendingCount).mockResolvedValue({ pending_count: 2 })
  vi.mocked(listTemplateCategories).mockResolvedValue([
    { id: 'cat-building', name: '建築工程' },
    { id: 'cat-road', name: '道路工程' },
  ])
  vi.mocked(listTemplateSystems).mockImplementation(async (categoryId) =>
    categoryId === 'cat-building'
      ? [
          { id: 'sys-structure', category_id: categoryId, name: '結構工程' },
          { id: 'sys-water', category_id: categoryId, name: '防水工程' },
        ]
      : [],
  )
  vi.mocked(getSystemTemplates).mockResolvedValue({ items: [] })
})
afterEach(() => {
  // 先卸載畫面，避免還在跑的效果在 mock 被重設後呼叫到空實作。
  cleanup()
  vi.resetAllMocks()
})

describe('TPL-AC36 提議人讀自己各版與原因', () => {
  it('退回件顯示退回原因、審核人與各版歷程，可切換歷史版', async () => {
    const { detail, revisions } = returned(2)
    load(detail, revisions)
    renderDetail('mine', LIN.id)
    expect(
      await screen.findByText(/第 1 版退回原因：請補充間距與照片要求/),
    ).toBeVisible()
    const history = screen
      .getByRole('heading', { name: '各版歷程' })
      .closest('section')!
    expect(history).toHaveTextContent('第 1 版')
    expect(history).toHaveTextContent('退回 · 吳經理')
    expect(history).toHaveTextContent('退回原因：請補充間距與照片要求')
    expect(history).toHaveTextContent('第 2 版')
    fireEvent.change(screen.getByLabelText('檢視版本'), {
      target: { value: '1' },
    })
    expect(
      await screen.findByRole('heading', { name: '第 1 版內容（歷史唯讀）' }),
    ).toBeVisible()
  })

  it('管理者修改的版本標示「（某人修改）」', async () => {
    const revision = makeRevision(2, {
      editor_id: WU.id,
      editor_name: WU.name,
    })
    load(makeDetail({ current_revision: revision }), [
      makeRevision(1),
      revision,
    ])
    renderDetail('mine', LIN.id)
    expect(
      await screen.findByRole('heading', { name: '第 2 版（吳經理修改）' }),
    ).toBeVisible()
  })
})

describe('TPL-R31 重送條件（提議人）', () => {
  it('退回後尚未保存新版時重新送審停用並說明原因', async () => {
    const { detail, revisions } = returned(1)
    load(detail, revisions)
    renderDetail('mine', LIN.id)
    const button = await screen.findByRole('button', { name: '重新送審' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(
      '請先修改退回內容並保存新版本，才能重新送審。',
    )
    expect(screen.getByRole('link', { name: '修改退回件' })).toBeVisible()
    fireEvent.click(button)
    expect(submitSuggestion).not.toHaveBeenCalled()
  })

  it('保存退回後的新版即可重送：先確認、取消不送出、確認才送並重讀', async () => {
    const { detail, revisions } = returned(2)
    load(detail, revisions)
    vi.mocked(submitSuggestion).mockResolvedValue(detail)
    renderDetail('mine', LIN.id)
    fireEvent.click(await screen.findByRole('button', { name: '重新送審' }))
    const box = await screen.findByRole('group', { name: '確認重新送審' })
    expect(box).toHaveTextContent('沿用同一件建議')
    expect(box).toHaveTextContent(
      '待審期間不能修改，只能撤回；撤回後不能再重送。',
    )
    fireEvent.click(within(box).getByRole('button', { name: '取消' }))
    expect(submitSuggestion).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '重新送審' }))
    fireEvent.click(
      within(
        await screen.findByRole('group', { name: '確認重新送審' }),
      ).getByRole('button', { name: '確認重新送審' }),
    )
    await waitFor(() =>
      expect(submitSuggestion).toHaveBeenCalledWith(IDS.suggestion, {
        expected_revision_id: 'rev-2',
        expected_status: 'RETURNED',
      }),
    )
    expect(await screen.findByText('第 2 版已重新送審。')).toBeVisible()
    expect(getSuggestion).toHaveBeenCalledTimes(2)
  })

  it('未完成的內容重送前列出所有欄位並可跳到編輯器', async () => {
    const { detail, revisions } = returned(2)
    detail.current_revision.content.title = ''
    detail.current_revision.content.inspection_points[0].title = ''
    load(detail, revisions)
    renderDetail('mine', LIN.id)
    fireEvent.click(await screen.findByRole('button', { name: '重新送審' }))
    const summary = await screen.findByRole('alert')
    expect(summary).toHaveTextContent('此版尚未送審，請完成以下欄位')
    expect(
      within(summary).getByRole('link', { name: '請填寫查核項目名稱' }),
    ).toHaveAttribute(
      'href',
      `/settings/template-suggestions/${IDS.suggestion}/edit?focus=title`,
    )
    expect(
      within(summary).getByRole('link', { name: '請填寫項次標題' }),
    ).toBeVisible()
    expect(screen.queryByRole('group', { name: '確認重新送審' })).toBeNull()
    expect(submitSuggestion).not.toHaveBeenCalled()
  })

  it('從編輯頁「儲存並重新送審」回來時直接開啟重送確認', async () => {
    const { detail, revisions } = returned(2)
    load(detail, revisions)
    renderDetail('mine', LIN.id, {
      pathname: `${SUGGESTION_BASE.mine}/${IDS.suggestion}`,
      state: { confirmResubmit: true, notice: '已保存第 2 版，尚未送審。' },
    })
    expect(
      await screen.findByRole('group', { name: '確認重新送審' }),
    ).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent(
      '已保存第 2 版，尚未送審。',
    )
  })

  it('失去來源專案編輯權時重送被擋並提示，仍可撤回', async () => {
    const { detail, revisions } = returned(2)
    load(detail, revisions)
    vi.mocked(submitSuggestion).mockRejectedValue(
      new HttpError(403, 'permission.denied'),
    )
    renderDetail('mine', LIN.id)
    fireEvent.click(await screen.findByRole('button', { name: '重新送審' }))
    fireEvent.click(
      within(
        await screen.findByRole('group', { name: '確認重新送審' }),
      ).getByRole('button', { name: '確認重新送審' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '已沒有來源專案的查核項目編輯權限，不能重新送審',
    )
    // 確認框關閉後，修改與重送入口停用，撤回仍在。
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(
      await screen.findByText(
        '來源專案編輯權已失效，仍可查看歷程及撤回；不能修改或重送。',
      ),
    ).toBeVisible()
    expect(screen.queryByRole('link', { name: '修改退回件' })).toBeNull()
    expect(screen.getByRole('button', { name: '重新送審' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '撤回建議' })).toBeEnabled()
  })

  it('409 併發時請使用者重讀，不盲目覆蓋', async () => {
    const { detail, revisions } = returned(2)
    load(detail, revisions)
    vi.mocked(submitSuggestion).mockRejectedValue(
      new HttpError(409, 'template_suggestion.changed'),
    )
    renderDetail('mine', LIN.id)
    fireEvent.click(await screen.findByRole('button', { name: '重新送審' }))
    fireEvent.click(
      within(
        await screen.findByRole('group', { name: '確認重新送審' }),
      ).getByRole('button', { name: '確認重新送審' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '這件建議剛被更新，請重新讀取後再操作',
    )
    expect(getSuggestion).toHaveBeenCalledTimes(2)
  })
})

describe('撤回與終止狀態（提議人）', () => {
  it('撤回先確認並說明後果，取消保留，確認後重讀', async () => {
    const detail = makeDetail()
    load(detail, [detail.current_revision])
    vi.mocked(withdrawSuggestion).mockResolvedValue(detail)
    renderDetail('mine', LIN.id)
    expect(screen.queryByRole('link', { name: '修改退回件' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: '撤回建議' }))
    const box = await screen.findByRole('group', { name: '確認撤回建議' })
    expect(box).toHaveTextContent('本件不能再重送')
    fireEvent.click(within(box).getByRole('button', { name: '取消' }))
    expect(withdrawSuggestion).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '撤回建議' }))
    fireEvent.click(await screen.findByRole('button', { name: '確認撤回' }))
    await waitFor(() =>
      expect(withdrawSuggestion).toHaveBeenCalledWith(IDS.suggestion, {
        expected_revision_id: 'rev-1',
        expected_status: 'PENDING',
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      '已撤回第 1 版',
    )
  })

  it('已核准件顯示入庫結果，沒有修改、撤回或核准入口', async () => {
    const revision = makeRevision(4)
    load(
      makeDetail({
        status: 'APPROVED',
        current_revision: revision,
        approval: {
          template_id: 't1',
          template_title: '鋼筋綁紮通用版',
          category_name: '建築工程',
          system_name: '結構工程',
          sequence: 8,
          revision_no: 4,
          reviewer_name: '吳經理',
          reviewed_at: '2026-10-31T09:00:00Z',
        },
      }),
      [revision],
    )
    renderDetail('mine', LIN.id)
    expect(
      await screen.findByText(
        /已核准第 4 版，入庫：建築工程／結構工程／鋼筋綁紮通用版，序號 8/,
      ),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: '撤回建議' })).toBeNull()
    expect(screen.queryByRole('link', { name: /修改/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '核准入庫' })).toBeNull()
  })
})

describe('TPL-R33 管理者審核', () => {
  function pending() {
    const detail = makeDetail()
    load(detail, [detail.current_revision])
    return detail
  }

  it('待審最新版顯示修改入口與目的地選擇；兩版以上才有比較', async () => {
    pending()
    renderDetail('review', WU.id)
    expect(
      await screen.findByRole('link', { name: '修改建議內容' }),
    ).toBeVisible()
    expect(screen.queryByRole('link', { name: '比較前後兩版' })).toBeNull()
    expect(screen.getByRole('button', { name: '核准入庫' })).toBeVisible()
  })

  it('兩版以上顯示比較連結', async () => {
    const detail = makeDetail({ current_revision: makeRevision(2) })
    load(detail, [makeRevision(1), makeRevision(2)])
    renderDetail('review', WU.id)
    expect(
      await screen.findByRole('link', { name: '比較前後兩版' }),
    ).toHaveAttribute(
      'href',
      `/templates/suggestions/${IDS.suggestion}/compare`,
    )
  })

  it('檢視歷史版時說明須切回最新版才能核准，切回後可核准', async () => {
    const detail = makeDetail({ current_revision: makeRevision(2) })
    load(detail, [makeRevision(1), makeRevision(2)])
    renderDetail('review', WU.id)
    await screen.findByRole('button', { name: '核准入庫' })
    fireEvent.change(screen.getByLabelText('檢視版本'), {
      target: { value: '1' },
    })
    expect(await screen.findByText('請切回最新版才能核准')).toBeVisible()
    expect(screen.queryByRole('button', { name: '核准入庫' })).toBeNull()
    expect(screen.queryByRole('link', { name: '修改建議內容' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '切回最新第 2 版' }))
    expect(
      await screen.findByRole('button', { name: '核准入庫' }),
    ).toBeVisible()
  })

  it('未選目的地時欄位錯誤就近顯示並聚焦，不送出', async () => {
    pending()
    renderDetail('review', WU.id)
    fireEvent.click(await screen.findByRole('button', { name: '核准入庫' }))
    const category = screen.getByLabelText(/目標工程類別/)
    expect(await screen.findByText('請選擇目標工程類別')).toBeVisible()
    expect(category).toHaveFocus()
    expect(category).toBeInvalid()
    expect(screen.getByLabelText(/目標系統/)).toBeDisabled()
    await screen.findByRole('option', { name: '建築工程' })
    fireEvent.change(category, { target: { value: 'cat-building' } })
    await screen.findByRole('option', { name: '結構工程' })
    fireEvent.click(screen.getByRole('button', { name: '核准入庫' }))
    expect(await screen.findByText('請選擇目標系統')).toBeVisible()
    expect(screen.getByLabelText(/目標系統/)).toHaveFocus()
    expect(approveSuggestion).not.toHaveBeenCalled()
  })

  async function chooseTarget() {
    // 類別清單是非同步載入的，選項出現後才選得到。
    await screen.findByRole('option', { name: '建築工程' })
    fireEvent.change(await screen.findByLabelText(/目標工程類別/), {
      target: { value: 'cat-building' },
    })
    await screen.findByRole('option', { name: '結構工程' })
    fireEvent.change(screen.getByLabelText(/目標系統/), {
      target: { value: 'sys-structure' },
    })
  }

  it('選目的地後切到歷史版再回最新，保留目前選值', async () => {
    const latest = makeRevision(2)
    load(makeDetail({ current_revision: latest }), [makeRevision(1), latest])
    renderDetail('review', WU.id)
    await chooseTarget()
    fireEvent.change(screen.getByLabelText('檢視版本'), {
      target: { value: '1' },
    })
    await screen.findByText('請切回最新版才能核准')
    fireEvent.click(screen.getByRole('button', { name: '切回最新第 2 版' }))
    await screen.findByRole('option', { name: '結構工程' })
    expect(screen.getByLabelText(/目標工程類別/)).toHaveValue('cat-building')
    expect(screen.getByLabelText(/目標系統/)).toHaveValue('sys-structure')
  })

  it('選目的地後由一般修改連結進編輯頁，保存返回仍保留選值', async () => {
    const latest = makeRevision(2)
    load(makeDetail({ current_revision: latest }), [makeRevision(1), latest])
    render(
      <CurrentUserProvider
        value={{ user: currentUserFixture({ id: WU.id }), clear: vi.fn() }}
      >
        <DataMemoryRouter
          initialEntries={[`/templates/suggestions/${IDS.suggestion}`]}
        >
          <Probe />
          <Routes>
            <Route
              path="/templates/suggestions/:suggestionId"
              element={<SuggestionDetailPage mode="review" />}
            />
            <Route
              path="/templates/suggestions/:suggestionId/edit"
              element={<SuggestionEditPage mode="review" />}
            />
          </Routes>
        </DataMemoryRouter>
      </CurrentUserProvider>,
    )
    await chooseTarget()
    fireEvent.click(screen.getByRole('link', { name: '修改建議內容' }))
    await screen.findByText(/目前已存第 2 版/)
    fireEvent.change(screen.getByLabelText(/查核項目名稱/), {
      target: { value: '修改後保留目標' },
    })
    const saved = makeRevision(3, {
      content: makeContent({ title: '修改後保留目標' }),
    })
    vi.mocked(saveRevision).mockResolvedValue(saveResult(saved))
    load(makeDetail({ current_revision: saved }), [
      makeRevision(1),
      latest,
      saved,
    ])
    fireEvent.click(screen.getByRole('button', { name: '儲存新版本' }))
    await screen.findByRole('option', { name: '結構工程' })
    expect(screen.getByLabelText(/目標工程類別/)).toHaveValue('cat-building')
    expect(screen.getByLabelText(/目標系統/)).toHaveValue('sys-structure')
    expect(
      screen.getAllByText('已存第 3 版，目的地已保留，可再按核准。').length,
    ).toBeGreaterThan(0)
  })

  it('核准前顯示對象與目的地，取消不入庫，確認後送出並重讀', async () => {
    const detail = pending()
    vi.mocked(approveSuggestion).mockResolvedValue(detail)
    renderDetail('review', WU.id)
    await chooseTarget()
    fireEvent.click(screen.getByRole('button', { name: '核准入庫' }))
    const box = await screen.findByRole('group', { name: '確認核准入庫' })
    expect(box).toHaveTextContent(
      '將第 1 版「鋼筋綁紮」建立為「建築工程／結構工程」',
    )
    expect(box).toHaveTextContent('不覆蓋既有範本，也不改來源專案')
    fireEvent.click(within(box).getByRole('button', { name: '取消' }))
    expect(approveSuggestion).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '核准入庫' }))
    fireEvent.click(
      await screen.findByRole('button', { name: '確認核准入庫' }),
    )
    await waitFor(() =>
      expect(approveSuggestion).toHaveBeenCalledWith(
        IDS.suggestion,
        { category_id: 'cat-building', system_id: 'sys-structure' },
        { expected_revision_id: 'rev-1', expected_status: 'PENDING' },
      ),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      '已核准第 1 版並新增一筆範本；原建議與來源項目保留。',
    )
    expect(getPendingCount).toHaveBeenCalledTimes(2)
  })

  it('選定系統時即時預警同名，提供「修改名稱」且不阻擋選擇', async () => {
    pending()
    vi.mocked(getSystemTemplates).mockResolvedValue({
      items: [
        {
          id: 't1',
          system_id: 'sys-structure',
          sequence: 1,
          title: ' 鋼筋綁紮 ',
          instruction: '',
          inspection_points: [],
        },
      ],
    })
    renderDetail('review', WU.id)
    await chooseTarget()
    const warning = await screen.findByRole('status')
    expect(warning).toHaveTextContent(
      '此系統已有同名範本「鋼筋綁紮」。核准前請修改名稱或改選系統。',
    )
    const rename = within(warning).getByRole('link', { name: '修改名稱' })
    expect(rename).toHaveAttribute(
      'href',
      `/templates/suggestions/${IDS.suggestion}/edit?rename=1&focus=title`,
    )
    // 改選沒有同名的系統後預警消失。
    vi.mocked(getSystemTemplates).mockResolvedValue({ items: [] })
    fireEvent.change(screen.getByLabelText(/目標系統/), {
      target: { value: 'sys-water' },
    })
    await waitFor(() => expect(screen.queryByText(/已有同名範本/)).toBeNull())
  })

  it('有同名預警時按核准才拒絕本次入庫並聚焦名稱，目的地保留', async () => {
    pending()
    vi.mocked(getSystemTemplates).mockResolvedValue({
      items: [
        {
          id: 't1',
          system_id: 'sys-structure',
          sequence: 1,
          title: '鋼筋綁紮',
          instruction: '',
          inspection_points: [],
        },
      ],
    })
    renderDetail('review', WU.id)
    await chooseTarget()
    await screen.findByText(/核准前請修改名稱或改選系統/)
    fireEvent.click(screen.getByRole('button', { name: '核准入庫' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('本次沒有新增')
    expect(screen.getByLabelText(/入庫名稱/)).toHaveFocus()
    expect(screen.getByLabelText(/入庫名稱/)).toBeInvalid()
    expect(approveSuggestion).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/目標系統/)).toHaveValue('sys-structure')
  })

  it('後端回同名 409 時保持待審、保留目的地並回名稱欄', async () => {
    pending()
    vi.mocked(approveSuggestion).mockRejectedValue(
      new HttpError(409, 'template.name_conflict'),
    )
    renderDetail('review', WU.id)
    await chooseTarget()
    fireEvent.click(screen.getByRole('button', { name: '核准入庫' }))
    fireEvent.click(
      await screen.findByRole('button', { name: '確認核准入庫' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('本次沒有新增')
    await waitFor(() =>
      expect(screen.getByLabelText(/入庫名稱/)).toHaveFocus(),
    )
    expect(screen.getByLabelText(/目標工程類別/)).toHaveValue('cat-building')
    expect(screen.getByLabelText(/目標系統/)).toHaveValue('sys-structure')
    expect(screen.getByRole('button', { name: '核准入庫' })).toBeEnabled()
    expect(screen.queryByRole('group', { name: '確認核准入庫' })).toBeNull()
  })

  it('內容不完整時不能核准，列出欄位並連到編輯器', async () => {
    const detail = makeDetail()
    const [, coupler] = detail.current_revision.content.inspection_points
    coupler.evidence_requirements = [{ min_count: 0 }]
    load(detail, [detail.current_revision])
    renderDetail('review', WU.id)
    await chooseTarget()
    fireEvent.click(screen.getByRole('button', { name: '核准入庫' }))
    const summary = await screen.findByRole('alert')
    expect(summary).toHaveTextContent('內容尚未完整，不能核准')
    expect(
      within(summary).getByRole('link', { name: '照片至少需要 1 張' }),
    ).toHaveAttribute('href', expect.stringContaining('/edit?focus=point'))
    expect(approveSuggestion).not.toHaveBeenCalled()
  })

  it('從改名編輯頁回來時保留已選目的地', async () => {
    pending()
    renderDetail('review', WU.id, {
      pathname: `${SUGGESTION_BASE.review}/${IDS.suggestion}`,
      state: {
        target: { category_id: 'cat-building', system_id: 'sys-structure' },
        notice: '已存第 2 版，目的地已保留，可再按核准。',
      },
    })
    await waitFor(() =>
      expect(screen.getByLabelText(/目標工程類別/)).toHaveValue(
        'cat-building',
      ),
    )
    await waitFor(() =>
      expect(screen.getByLabelText(/目標系統/)).toHaveValue('sys-structure'),
    )
    expect(screen.getByRole('status')).toHaveTextContent('目的地已保留')
  })

  it('退回原因空白或超長就近顯示並聚焦，PENDING 不變', async () => {
    pending()
    renderDetail('review', WU.id)
    fireEvent.click(await screen.findByRole('button', { name: '附原因退回' }))
    const reason = screen.getByLabelText(/退回原因/)
    fireEvent.change(reason, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: '退回建議' }))
    expect(await screen.findByText('請填寫退回原因')).toBeVisible()
    expect(reason).toHaveFocus()
    fireEvent.change(reason, { target: { value: 'x'.repeat(1001) } })
    fireEvent.click(screen.getByRole('button', { name: '退回建議' }))
    expect(await screen.findByText('退回原因不得超過 1000 字元')).toBeVisible()
    expect(returnSuggestion).not.toHaveBeenCalled()
  })

  it('退回先確認再送出，原因去頭尾空白，成功後重讀並刷新待審數', async () => {
    const detail = pending()
    vi.mocked(returnSuggestion).mockResolvedValue(detail)
    renderDetail('review', WU.id)
    fireEvent.click(await screen.findByRole('button', { name: '附原因退回' }))
    fireEvent.change(screen.getByLabelText(/退回原因/), {
      target: { value: ' 請補充梁柱接頭的間距與照片要求 ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '退回建議' }))
    const box = await screen.findByRole('group', { name: '確認退回建議' })
    expect(box).toHaveTextContent(
      '林小姐將看到原因：請補充梁柱接頭的間距與照片要求',
    )
    fireEvent.click(within(box).getByRole('button', { name: '取消' }))
    expect(returnSuggestion).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '退回建議' }))
    fireEvent.click(await screen.findByRole('button', { name: '確認退回' }))
    await waitFor(() =>
      expect(returnSuggestion).toHaveBeenCalledWith(
        IDS.suggestion,
        '請補充梁柱接頭的間距與照片要求',
        { expected_revision_id: 'rev-1', expected_status: 'PENDING' },
      ),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      '已退回第 1 版，原因與審核人已保存。',
    )
    expect(getPendingCount).toHaveBeenCalledTimes(2)
  })

  it('後端 422 時退回原因錯誤貼在欄位旁並保留已填內容', async () => {
    pending()
    vi.mocked(returnSuggestion).mockRejectedValue(
      Object.assign(new HttpError(422), {
        fields: [{ path: '/reason', code: 'field.required' }],
      }),
    )
    renderDetail('review', WU.id)
    fireEvent.click(await screen.findByRole('button', { name: '附原因退回' }))
    fireEvent.change(screen.getByLabelText(/退回原因/), {
      target: { value: '請補充' },
    })
    fireEvent.click(screen.getByRole('button', { name: '退回建議' }))
    fireEvent.click(await screen.findByRole('button', { name: '確認退回' }))
    expect(await screen.findByText('請填寫退回原因')).toBeVisible()
    expect(screen.getByLabelText(/退回原因/)).toHaveValue('請補充')
  })

  it('審核者沒有提議人的撤回與重送入口', async () => {
    pending()
    renderDetail('review', WU.id)
    await screen.findByRole('button', { name: '核准入庫' })
    expect(screen.queryByRole('button', { name: '撤回建議' })).toBeNull()
    expect(screen.queryByRole('button', { name: '重新送審' })).toBeNull()
  })
})

describe('讀取失敗與權限', () => {
  it('404 顯示找不到、403 顯示無權限，不洩漏內容', async () => {
    vi.mocked(getSuggestion).mockRejectedValue(new HttpError(404))
    vi.mocked(listRevisions).mockRejectedValue(new HttpError(404))
    const { unmount } = renderDetail('mine', LIN.id)
    expect(await screen.findByText('找不到這件建議')).toBeVisible()
    unmount()
    vi.mocked(getSuggestion).mockRejectedValue(
      new HttpError(403, 'permission.denied'),
    )
    renderDetail('mine', LIN.id)
    expect(
      await screen.findByRole('heading', { name: '無權限' }),
    ).toBeVisible()
  })
})
