import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { Route, Routes, useLocation, type InitialEntry } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CurrentUserProvider } from '../../../auth/useCurrentUser'
import { HttpError } from '../../../http'
import { currentUserFixture } from '../../../testing/contractFixtures'
import { DataMemoryRouter } from '../../../testing/DataMemoryRouter'
import {
  getSuggestion,
  listRevisions,
  saveRevision,
  type SuggestionDetail,
  type SuggestionRevision,
} from './api'
import {
  event,
  IDS,
  LIN,
  makeContent,
  makeDetail,
  makeRevision,
  saveResult,
  WU,
} from './fixtures'
import { SUGGESTION_BASE, type SuggestionMode } from './paths'
import SuggestionEditPage from './SuggestionEditPage'

vi.mock('./api')

function Probe() {
  const location = useLocation()
  return (
    <div data-testid="location">
      {location.pathname}|{JSON.stringify(location.state)}
    </div>
  )
}

function renderEdit(
  mode: SuggestionMode,
  userId: string,
  detail: SuggestionDetail,
  revisions: SuggestionRevision[],
  search = '',
  state?: unknown,
) {
  vi.mocked(getSuggestion).mockResolvedValue(detail)
  vi.mocked(listRevisions).mockResolvedValue(revisions)
  const base = SUGGESTION_BASE[mode]
  const entry: InitialEntry = {
    pathname: `${base}/${IDS.suggestion}/edit`,
    search,
    state,
  }
  return render(
    <CurrentUserProvider
      value={{ user: currentUserFixture({ id: userId }), clear: vi.fn() }}
    >
      <DataMemoryRouter initialEntries={[entry]}>
        <Probe />
        <Routes>
          <Route
            element={<SuggestionEditPage mode={mode} />}
            path={`${base}/:suggestionId/edit`}
          />
          <Route element={<p>詳情頁</p>} path={`${base}/:suggestionId`} />
        </Routes>
      </DataMemoryRouter>
    </CurrentUserProvider>,
  )
}

function pendingCase() {
  const detail = makeDetail()
  return { detail, revisions: [detail.current_revision] }
}

function returnedCase(revised = false) {
  const first = makeRevision(1, {
    events: [
      event('PENDING', LIN, '2026-10-31T01:00:00Z'),
      event('RETURNED', WU, '2026-10-31T02:00:00Z', '請補充'),
    ],
  })
  const revisions = revised ? [first, makeRevision(2)] : [first]
  const current = revisions.at(-1)!
  return {
    detail: makeDetail({
      status: 'RETURNED',
      current_revision: current,
      current_revision_id: current.id,
      revision_no: current.revision_no,
    }),
    revisions,
  }
}

const titleInput = () => screen.getByLabelText(/查核項目名稱/)

afterEach(() => {
  // 先卸載畫面，避免還在跑的效果在 mock 被重設後呼叫到空實作。
  cleanup()
  vi.resetAllMocks()
})

describe('TPL-R32 審核者修改待審內容', () => {
  it('改內容保存為新版，導回詳情並說明尚未選目的地', async () => {
    const { detail, revisions } = pendingCase()
    renderEdit('review', WU.id, detail, revisions)
    vi.mocked(saveRevision).mockResolvedValue(
      saveResult(
        makeRevision(2, {
          editor_id: WU.id,
          content: makeContent({ title: '鋼筋綁紮通用版' }),
        }),
      ),
    )
    await screen.findByText(/目前已存第 1 版；本次修改另存新版本/)
    fireEvent.change(titleInput(), { target: { value: '鋼筋綁紮通用版' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存新版本' }))
    await screen.findByText('詳情頁')
    expect(saveRevision).toHaveBeenCalledWith(
      IDS.suggestion,
      expect.objectContaining({ title: '鋼筋綁紮通用版' }),
      { expected_revision_id: 'rev-1', expected_status: 'PENDING' },
    )
    const state = JSON.parse(
      screen.getByTestId('location').textContent!.split('|')[1],
    )
    expect(state.notice).toBe('已存第 2 版，請選擇目的地後再按核准。')
  })

  it('已選目的地時提示目的地已保留', async () => {
    const { detail, revisions } = pendingCase()
    vi.mocked(saveRevision).mockResolvedValue(saveResult(makeRevision(2)))
    renderEdit('review', WU.id, detail, revisions, '', {
      target: { category_id: 'c', system_id: 's' },
    })
    await screen.findByText(/目前已存第 1 版/)
    fireEvent.change(titleInput(), { target: { value: '改名' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存新版本' }))
    await screen.findByText('詳情頁')
    const state = JSON.parse(
      screen.getByTestId('location').textContent!.split('|')[1],
    )
    expect(state.notice).toBe('已存第 2 版，目的地已保留，可再按核准。')
    expect(state.target).toEqual({ category_id: 'c', system_id: 's' })
  })

  it('內容沒有變更仍送後端覆核，回原版時顯示「內容沒有變更」', async () => {
    const { detail, revisions } = pendingCase()
    vi.mocked(saveRevision).mockResolvedValue(
      saveResult(detail.current_revision),
    )
    renderEdit('review', WU.id, detail, revisions)
    await screen.findByText(/目前已存第 1 版/)
    fireEvent.click(screen.getByRole('button', { name: '儲存新版本' }))
    await screen.findByText('詳情頁')
    expect(saveRevision).toHaveBeenCalledTimes(1)
    const state = JSON.parse(
      screen.getByTestId('location').textContent!.split('|')[1],
    )
    expect(state.notice).toBe(
      '內容沒有變更，沿用原版本；請選擇目的地後再按核准。',
    )
  })

  it('後端回原版（無變更）時同樣不稱已存新版', async () => {
    const { detail, revisions } = pendingCase()
    vi.mocked(saveRevision).mockResolvedValue(
      saveResult(detail.current_revision),
    )
    renderEdit('review', WU.id, detail, revisions)
    await screen.findByText(/目前已存第 1 版/)
    fireEvent.change(titleInput(), { target: { value: '改了又保存' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存新版本' }))
    await screen.findByText('詳情頁')
    const state = JSON.parse(
      screen.getByTestId('location').textContent!.split('|')[1],
    )
    expect(state.notice).toMatch(/^內容沒有變更/)
  })

  it('審核中修改須完整合法：名稱留白就近顯示錯誤並聚焦，不送出', async () => {
    const { detail, revisions } = pendingCase()
    renderEdit('review', WU.id, detail, revisions)
    await screen.findByText(/目前已存第 1 版/)
    fireEvent.change(titleInput(), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存新版本' }))
    const summary = await screen.findByRole('alert')
    expect(summary).toHaveTextContent('尚有 1 處要修正')
    expect(
      within(summary).getByRole('button', { name: '請填寫查核項目名稱' }),
    ).toBeVisible()
    await waitFor(() => expect(titleInput()).toHaveFocus())
    expect(saveRevision).not.toHaveBeenCalled()
  })

  it('後端 422 把錯誤貼在對應欄位並保留草稿', async () => {
    const { detail, revisions } = pendingCase()
    vi.mocked(saveRevision).mockRejectedValue(
      Object.assign(new HttpError(422), {
        fields: [
          { path: '/content/title', code: 'field.too_long' },
          {
            path: '/content/inspection_points/0/title',
            code: 'field.required',
          },
        ],
      }),
    )
    renderEdit('review', WU.id, detail, revisions)
    await screen.findByText(/目前已存第 1 版/)
    fireEvent.change(titleInput(), { target: { value: '新的名稱' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存新版本' }))
    // 錯誤同時出現在摘要與欄位旁。
    expect(await screen.findAllByText('輸入內容太長。')).toHaveLength(2)
    expect(
      document.querySelector('[data-error-key="title"] + .field-error'),
    ).toHaveTextContent('輸入內容太長。')
    expect(screen.getAllByText('請填寫此欄位。')).toHaveLength(2)
    expect(titleInput()).toHaveValue('新的名稱')
    expect(screen.getByTestId('location')).toHaveTextContent('/edit|')
  })

  it('併發改動回 409 時請使用者重讀，草稿不被清掉', async () => {
    const { detail, revisions } = pendingCase()
    vi.mocked(saveRevision).mockRejectedValue(
      new HttpError(409, 'template_suggestion.changed'),
    )
    renderEdit('review', WU.id, detail, revisions)
    await screen.findByText(/目前已存第 1 版/)
    fireEvent.change(titleInput(), { target: { value: '我的修改' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存新版本' }))
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0)
    expect(
      screen.getByText(/這件建議剛被更新，請重新讀取後再操作/),
    ).toBeVisible()
    expect(titleInput()).toHaveValue('我的修改')
  })

  it('從重送錯誤清單跳來時直接顯示並聚焦該欄位的錯誤', async () => {
    const { detail, revisions } = returnedCase(true)
    detail.current_revision.content.inspection_points[0].title = ''
    renderEdit(
      'mine',
      LIN.id,
      detail,
      revisions,
      `?focus=${encodeURIComponent(`point:${IDS.spacing}:title`)}`,
    )
    await screen.findByText(/目前已存第 2 版/)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '尚有 1 處要修正',
    )
    await waitFor(() =>
      expect(document.getElementById('point-0-title')).toHaveFocus(),
    )
  })

  it('上下移保留邏輯識別、數值綁定與各項照片草稿', async () => {
    const { detail, revisions } = pendingCase()
    renderEdit('review', WU.id, detail, revisions)
    vi.mocked(saveRevision).mockResolvedValue(saveResult(makeRevision(2)))
    await screen.findByText(/目前已存第 1 版/)
    fireEvent.change(screen.getAllByLabelText(/照片至少幾張/)[0], {
      target: { value: '3' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: '下移欄位' })[0])
    fireEvent.click(screen.getAllByRole('button', { name: '下移項次' })[0])
    fireEvent.click(screen.getByRole('button', { name: '儲存新版本' }))
    await screen.findByText('詳情頁')
    const content = vi.mocked(saveRevision).mock.calls[0][1]
    expect(content.inspection_points.map((p) => p.logical_id)).toEqual([
      IDS.coupler,
      IDS.spacing,
    ])
    const spacing = content.inspection_points[1]
    expect(spacing.sequence).toBe(2)
    expect(spacing.measurement_fields.map((f) => f.logical_id)).toEqual([
      IDS.notesField,
      IDS.spacingField,
    ])
    expect(spacing.measurement_fields.map((f) => f.sort_order)).toEqual([0, 1])
    expect(spacing.numeric_standard?.measurement_field_logical_id).toBe(
      IDS.spacingField,
    )
    expect(spacing.evidence_requirements).toEqual([{ min_count: 3 }])
    expect(content.inspection_points[0].evidence_requirements).toEqual([
      { min_count: 2 },
    ])
  })

  it('「修改名稱」捷徑：焦點直達名稱、其他項次收合，之後可手動展開', async () => {
    const { detail, revisions } = pendingCase()
    renderEdit('review', WU.id, detail, revisions, '?rename=1&focus=title')
    await screen.findByText(/目前已存第 1 版/)
    await waitFor(() => expect(titleInput()).toHaveFocus())
    await waitFor(() =>
      expect(document.querySelectorAll('.tpl-point-card[open]')).toHaveLength(
        0,
      ),
    )
    const summary = screen.getAllByText(/項次 1：/)[0]
    fireEvent.click(summary)
    await waitFor(() =>
      expect(document.querySelectorAll('.tpl-point-card[open]')).toHaveLength(
        1,
      ),
    )
  })

  it('放棄未儲存變更先確認：按鈕為「繼續編輯／放棄修改」，繼續則草稿仍在', async () => {
    const { detail, revisions } = pendingCase()
    renderEdit('review', WU.id, detail, revisions)
    await screen.findByText(/目前已存第 1 版/)
    fireEvent.change(titleInput(), { target: { value: '改一半' } })
    fireEvent.click(screen.getAllByRole('link', { name: '取消修改' })[0])
    const box = await screen.findByRole('group', {
      name: '放棄未儲存變更',
    })
    expect(box).toHaveTextContent('本次未儲存的改動會遺失')
    fireEvent.click(within(box).getByRole('button', { name: '繼續編輯' }))
    expect(titleInput()).toHaveValue('改一半')
    expect(screen.queryByText('詳情頁')).toBeNull()
    fireEvent.click(screen.getAllByRole('link', { name: '取消修改' })[0])
    fireEvent.click(
      within(
        await screen.findByRole('group', { name: '放棄未儲存變更' }),
      ).getByRole('button', { name: '放棄修改' }),
    )
    expect(await screen.findByText('詳情頁')).toBeVisible()
    expect(saveRevision).not.toHaveBeenCalled()
  })
})

describe('TPL-R36 提議人修改退回件', () => {
  it('退回件可先保存未完成內容，訊息明寫尚未送審', async () => {
    const { detail, revisions } = returnedCase()
    vi.mocked(saveRevision).mockResolvedValue(
      saveResult(makeRevision(2, { content: makeContent({ title: '' }) })),
    )
    renderEdit('mine', LIN.id, detail, revisions)
    await screen.findByText(/目前已存第 1 版/)
    fireEvent.change(titleInput(), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存新版本' }))
    await screen.findByText('詳情頁')
    expect(saveRevision).toHaveBeenCalledWith(
      IDS.suggestion,
      expect.objectContaining({ title: '' }),
      { expected_revision_id: 'rev-1', expected_status: 'RETURNED' },
    )
    const state = JSON.parse(
      screen.getByTestId('location').textContent!.split('|')[1],
    )
    expect(state.notice).toBe('已保存第 2 版，尚未送審。')
    expect(state.confirmResubmit).toBe(false)
  })

  it('退回後還沒改過內容時「儲存並重新送審」停用並說明原因', async () => {
    const { detail, revisions } = returnedCase()
    renderEdit('mine', LIN.id, detail, revisions)
    await screen.findByText(/目前已存第 1 版/)
    const button = screen.getByRole('button', { name: '儲存並重新送審' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(
      '請先修改退回內容，才能重新送審。',
    )
    fireEvent.change(titleInput(), { target: { value: '改過了' } })
    expect(button).toBeEnabled()
  })

  it('已保存過退回後的新版時，不改內容也能重新送審', async () => {
    const { detail, revisions } = returnedCase(true)
    renderEdit('mine', LIN.id, detail, revisions)
    await screen.findByText(/目前已存第 2 版/)
    expect(
      screen.getByRole('button', { name: '儲存並重新送審' }),
    ).toBeEnabled()
  })

  it('儲存並重新送審先驗完整性：失敗不存新版、不送審', async () => {
    const { detail, revisions } = returnedCase()
    renderEdit('mine', LIN.id, detail, revisions)
    await screen.findByText(/目前已存第 1 版/)
    fireEvent.change(titleInput(), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存並重新送審' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '尚有 1 處要修正',
    )
    expect(saveRevision).not.toHaveBeenCalled()
    await waitFor(() => expect(titleInput()).toHaveFocus())
  })

  it('完整時先存新版再回詳情，要求開啟重送確認', async () => {
    const { detail, revisions } = returnedCase()
    vi.mocked(saveRevision).mockResolvedValue(saveResult(makeRevision(2)))
    renderEdit('mine', LIN.id, detail, revisions)
    await screen.findByText(/目前已存第 1 版/)
    fireEvent.change(titleInput(), { target: { value: '補好了' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存並重新送審' }))
    await screen.findByText('詳情頁')
    const state = JSON.parse(
      screen.getByTestId('location').textContent!.split('|')[1],
    )
    expect(state.confirmResubmit).toBe(true)
    expect(state.notice).toBe('已保存第 2 版，尚未送審。')
  })

  it('失去來源專案編輯權時保存被擋並提示，草稿保留', async () => {
    const { detail, revisions } = returnedCase()
    vi.mocked(saveRevision).mockRejectedValue(
      new HttpError(403, 'permission.denied'),
    )
    renderEdit('mine', LIN.id, detail, revisions)
    await screen.findByText(/目前已存第 1 版/)
    fireEvent.change(titleInput(), { target: { value: '想改的名稱' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存新版本' }))
    expect(
      await screen.findByText(
        /已沒有來源專案的查核項目編輯權限，不能修改建議/,
      ),
    ).toBeVisible()
    expect(titleInput()).toHaveValue('想改的名稱')
  })

  it('待審中的件提議人不能修改，只能回詳情撤回', async () => {
    const { detail, revisions } = pendingCase()
    renderEdit('mine', LIN.id, detail, revisions)
    expect(
      await screen.findByRole('heading', { name: '目前不能修改這件建議' }),
    ).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('待審期間只能撤回')
    expect(screen.queryByLabelText(/查核項目名稱/)).toBeNull()
  })

  it('不是提議人本人不能修改別人的退回件', async () => {
    const { detail, revisions } = returnedCase()
    renderEdit('mine', 'someone-else', detail, revisions)
    expect(
      await screen.findByRole('heading', { name: '目前不能修改這件建議' }),
    ).toBeVisible()
  })

  it('審核者不能修改已退回的件', async () => {
    const { detail, revisions } = returnedCase()
    renderEdit('review', WU.id, detail, revisions)
    expect(
      await screen.findByRole('heading', { name: '目前不能修改這件建議' }),
    ).toBeVisible()
  })
})
