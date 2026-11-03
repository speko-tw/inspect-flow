import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CurrentUserProvider } from '../../../auth/useCurrentUser'
import { HttpError } from '../../../http'
import { currentUserFixture } from '../../../testing/contractFixtures'
import {
  getMyStatusCounts,
  getPendingCount,
  listMySuggestions,
  listReviewSuggestions,
  type SuggestionSummary,
} from './api'
import { IDS, makeSummary } from './fixtures'
import SuggestionListPage from './SuggestionListPage'
import type { SuggestionMode } from './paths'

vi.mock('./api')

const COUNTS = { PENDING: 1, RETURNED: 2, APPROVED: 3, WITHDRAWN: 0 }

function mine(items: SuggestionSummary[], total = items.length) {
  return { items, next_cursor: null, total_count: total }
}

function renderList(mode: SuggestionMode, entry: string, state?: unknown) {
  const base =
    mode === 'mine'
      ? '/settings/template-suggestions'
      : '/templates/suggestions'
  return render(
    <CurrentUserProvider
      value={{ user: currentUserFixture(), clear: vi.fn() }}
    >
      <MemoryRouter
        initialEntries={[
          {
            pathname: entry.split('?')[0],
            search: entry.includes('?') ? `?${entry.split('?')[1]}` : '',
            state,
          },
        ]}
      >
        <Routes>
          <Route element={<SuggestionListPage mode={mode} />} path={base} />
          <Route
            element={<p>專案頁</p>}
            path="/projects/:id/inspection-items"
          />
          <Route element={<p>設定頁</p>} path="/settings" />
          <Route element={<p>範本庫</p>} path="/templates" />
        </Routes>
      </MemoryRouter>
    </CurrentUserProvider>,
  )
}

beforeEach(() => {
  vi.mocked(getMyStatusCounts).mockResolvedValue(COUNTS)
  vi.mocked(getPendingCount).mockResolvedValue({ pending_count: 3 })
})
afterEach(() => {
  // 先卸載畫面，避免還在跑的效果在 mock 被重設後呼叫到空實作。
  cleanup()
  vi.resetAllMocks()
})

describe('TPL-R34 本人清單', () => {
  it('從專案進入時預設篩選本案、顯示分狀態件數並返回專案頁', async () => {
    vi.mocked(listMySuggestions).mockResolvedValue(
      mine([makeSummary({ title: '鋼筋綁紮' })], 6),
    )
    renderList(
      'mine',
      `/settings/template-suggestions?project=${IDS.project}`,
      { origin: 'project' },
    )
    expect(
      await screen.findByRole('heading', { level: 2, name: '鋼筋綁紮' }),
    ).toBeVisible()
    expect(listMySuggestions).toHaveBeenCalledWith(
      expect.objectContaining({ source_project_id: IDS.project }),
    )
    expect(getMyStatusCounts).toHaveBeenCalledWith(IDS.project)
    expect(await screen.findByText(/本案共 6 件，包含所有狀態/)).toBeVisible()
    expect(screen.getByLabelText('各狀態件數')).toHaveTextContent(
      '待審 1 件／退回 2 件／已核准 3 件／已撤回 0 件',
    )
    fireEvent.click(screen.getByRole('link', { name: '返回專案頁' }))
    expect(await screen.findByText('專案頁')).toBeVisible()
  })

  it('從設定頁進入時看全部專案並返回設定頁', async () => {
    vi.mocked(listMySuggestions).mockResolvedValue(mine([makeSummary()]))
    renderList('mine', '/settings/template-suggestions', {
      origin: 'settings',
    })
    await screen.findByRole('heading', { level: 2, name: '鋼筋綁紮' })
    expect(listMySuggestions).toHaveBeenCalledWith(
      expect.objectContaining({ source_project_id: undefined }),
    )
    expect(getMyStatusCounts).toHaveBeenCalledWith(undefined)
    fireEvent.click(screen.getByRole('link', { name: '返回個人設定' }))
    expect(await screen.findByText('設定頁')).toBeVisible()
  })

  it('本案 0 件仍可進入並顯示空白說明', async () => {
    vi.mocked(listMySuggestions).mockResolvedValue(mine([]))
    vi.mocked(getMyStatusCounts).mockResolvedValue({
      PENDING: 0,
      RETURNED: 0,
      APPROVED: 0,
      WITHDRAWN: 0,
    })
    renderList('mine', `/settings/template-suggestions?project=${IDS.project}`)
    expect(
      await screen.findByText(
        '本案尚未提出範本建議。可返回專案頁，從查核項目提出。',
      ),
    ).toBeVisible()
  })

  it('狀態篩選改送後端條件，件數仍是全部狀態的分列', async () => {
    vi.mocked(listMySuggestions).mockResolvedValue(mine([]))
    renderList('mine', '/settings/template-suggestions')
    await waitFor(() => expect(listMySuggestions).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText('狀態'), {
      target: { value: 'RETURNED' },
    })
    await waitFor(() =>
      expect(listMySuggestions).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'RETURNED' }),
      ),
    )
    expect(getMyStatusCounts).toHaveBeenCalledTimes(1)
  })

  it('每件顯示狀態、退回原因、核准目的地與管理者修改標記', async () => {
    vi.mocked(listMySuggestions).mockResolvedValue(
      mine([
        makeSummary({
          id: 'returned',
          status: 'RETURNED',
          title: '退回的件',
          revision_no: 2,
          last_editor_id: IDS.wuUser,
          last_editor_name: '吳經理',
          latest_return: {
            reason: '請補充梁柱接頭的間距與照片要求',
            revision_no: 1,
            reviewer_name: '吳經理',
            returned_at: '2026-10-31T02:00:00Z',
          },
        }),
        makeSummary({
          id: 'approved',
          status: 'APPROVED',
          title: '核准的件',
          approval: {
            template_id: 't1',
            template_title: '鋼筋綁紮通用版',
            category_name: '建築工程',
            system_name: '結構工程',
            sequence: 8,
            revision_no: 4,
            reviewer_name: '吳經理',
            reviewed_at: '2026-10-31T03:00:00Z',
          },
        }),
      ]),
    )
    renderList('mine', '/settings/template-suggestions')
    const returned = (
      await screen.findByRole('heading', { name: '退回的件' })
    ).closest('li')!
    expect(returned).toHaveTextContent(
      '退回原因：請補充梁柱接頭的間距與照片要求',
    )
    expect(returned).toHaveTextContent('最新第 2 版（吳經理修改）')
    const approved = screen
      .getByRole('heading', { name: '核准的件' })
      .closest('li')!
    expect(approved).toHaveTextContent(
      '已入庫：建築工程／結構工程／鋼筋綁紮通用版',
    )
    expect(
      within(returned).getByRole('link', { name: /查看建議與歷程/ }),
    ).toHaveAttribute('href', '/settings/template-suggestions/returned')
  })

  it('讀取失敗顯示提示，沒有權限顯示無權限頁', async () => {
    vi.mocked(listMySuggestions).mockRejectedValueOnce(new HttpError(500))
    const { unmount } = renderList('mine', '/settings/template-suggestions')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '伺服器暫時無法處理',
    )
    unmount()
    vi.mocked(listMySuggestions).mockRejectedValueOnce(
      new HttpError(403, 'permission.denied'),
    )
    renderList('mine', '/settings/template-suggestions')
    expect(
      await screen.findByRole('heading', { name: '無權限' }),
    ).toBeVisible()
  })

  it('有下一頁時可載入更多，附加在目前清單後', async () => {
    vi.mocked(listMySuggestions)
      .mockResolvedValueOnce({
        items: [makeSummary({ id: 'a', title: '第一頁' })],
        next_cursor: 'c2',
        total_count: 2,
      })
      .mockResolvedValueOnce(mine([makeSummary({ id: 'b', title: '第二頁' })]))
    renderList('mine', '/settings/template-suggestions')
    await screen.findByRole('heading', { name: '第一頁' })
    fireEvent.click(screen.getByRole('button', { name: '載入更多' }))
    await screen.findByRole('heading', { name: '第二頁' })
    expect(screen.getByRole('heading', { name: '第一頁' })).toBeVisible()
    expect(listMySuggestions).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'c2' }),
    )
    expect(screen.queryByRole('button', { name: '載入更多' })).toBeNull()
  })
})

describe('TPL-AC40 管理者待審清單', () => {
  const items = [
    makeSummary({
      id: 'old',
      title: '較舊但剛重送',
      proposer_name: '陳先生',
      last_submitted_at: '2026-10-31T09:00:00Z',
    }),
    makeSummary({
      id: 'new',
      title: '較新的件',
      last_submitted_at: '2026-10-31T05:00:00Z',
    }),
  ]

  it('待審數來自專用計數，不受搜尋與清單件數影響', async () => {
    vi.mocked(listReviewSuggestions).mockResolvedValue({
      items,
      next_cursor: null,
    })
    renderList('review', '/templates/suggestions')
    expect(await screen.findByText('待審建議（3）')).toBeVisible()
    fireEvent.change(screen.getByLabelText('名稱或來源專案'), {
      target: { value: '較新' },
    })
    vi.mocked(listReviewSuggestions).mockResolvedValue({
      items: [items[1]],
      next_cursor: null,
    })
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }))
    await waitFor(() =>
      expect(listReviewSuggestions).toHaveBeenLastCalledWith({
        status: 'PENDING',
        cursor: null,
        q: '較新',
      }),
    )
    expect(await screen.findByText('符合條件 1 件')).toBeVisible()
    expect(screen.getByText('待審建議（3）')).toBeVisible()
    expect(getPendingCount).toHaveBeenCalledTimes(1)
  })

  it('保留後端最近送審時間排序，不只重排已載入的頁面', async () => {
    vi.mocked(listReviewSuggestions).mockResolvedValue({
      items,
      next_cursor: null,
    })
    renderList('review', '/templates/suggestions')
    await screen.findByRole('heading', { name: '較舊但剛重送' })
    const titles = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)
    expect(titles).toEqual(['較舊但剛重送', '較新的件'])
  })

  it('預設只列待審，切到全部時改以完整歷程查詢', async () => {
    vi.mocked(listReviewSuggestions).mockResolvedValue({
      items: [],
      next_cursor: null,
    })
    renderList('review', '/templates/suggestions')
    await waitFor(() =>
      expect(listReviewSuggestions).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'PENDING' }),
      ),
    )
    fireEvent.change(screen.getByLabelText('狀態'), {
      target: { value: 'all' },
    })
    await waitFor(() =>
      expect(listReviewSuggestions).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'ALL' }),
      ),
    )
    expect(getPendingCount).toHaveBeenCalledTimes(1)
  })

  it('返回範本庫，且列出送審時間與提議人', async () => {
    vi.mocked(listReviewSuggestions).mockResolvedValue({
      items,
      next_cursor: null,
    })
    renderList('review', '/templates/suggestions')
    const row = (
      await screen.findByRole('heading', { name: '較舊但剛重送' })
    ).closest('li')!
    expect(row).toHaveTextContent('提議人：陳先生')
    expect(row).toHaveTextContent('最近送審：')
    expect(
      within(row).getByRole('link', { name: /開啟審核/ }),
    ).toHaveAttribute('href', '/templates/suggestions/old')
    fireEvent.click(screen.getByRole('link', { name: '返回範本庫' }))
    expect(await screen.findByText('範本庫')).toBeVisible()
  })

  it('不顯示「待審建議」以外的通知或未讀標記', async () => {
    vi.mocked(listReviewSuggestions).mockResolvedValue({
      items,
      next_cursor: null,
    })
    renderList('review', '/templates/suggestions')
    await screen.findByText('待審建議（3）')
    expect(screen.queryByText(/通知|未讀/)).toBeNull()
  })
})
