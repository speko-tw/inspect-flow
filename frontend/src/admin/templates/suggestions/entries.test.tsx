import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HttpError } from '../../../http'
import {
  createSuggestion,
  getPendingCount,
  listMySuggestions,
  type SuggestionSummary,
} from './api'
import { IDS, makeSummary } from './fixtures'
import { PendingSuggestionsLink } from './PendingSuggestionsLink'
import { ProjectSuggestionLink } from './ProjectSuggestionLink'
import { ProposeSuggestion } from './ProposeSuggestion'
import { SettingsSuggestionsSection } from './SettingsSuggestionsSection'

vi.mock('./api')

function page(items: SuggestionSummary[], total = items.length) {
  return { items, next_cursor: null, total_count: total }
}

beforeEach(() => {
  vi.mocked(listMySuggestions).mockResolvedValue(page([]))
})
afterEach(() => {
  // 先卸載畫面，避免還在跑的效果在 mock 被重設後呼叫到空實作。
  cleanup()
  vi.resetAllMocks()
})

function renderInRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('TPL-AC33 專案頁「我的範本建議（本案共 N 件）」', () => {
  it('N 是本人在本專案所有狀態的件數，連到預設篩選本案的清單', async () => {
    vi.mocked(listMySuggestions).mockResolvedValue(page([], 3))
    renderInRouter(<ProjectSuggestionLink projectId="p1" refreshKey={0} />)
    const link = await screen.findByRole('link', {
      name: '我的範本建議（本案共 3 件）',
    })
    expect(link).toHaveAttribute(
      'href',
      '/settings/template-suggestions?project=p1',
    )
    expect(listMySuggestions).toHaveBeenCalledWith({
      source_project_id: 'p1',
      limit: 1,
    })
  })

  it('N 為 0 仍可進入清單', async () => {
    renderInRouter(<ProjectSuggestionLink projectId="p1" refreshKey={0} />)
    expect(
      await screen.findByRole('link', { name: '我的範本建議（本案共 0 件）' }),
    ).toBeVisible()
  })

  it('讀不到件數時仍可進入，只是不顯示數字', async () => {
    vi.mocked(listMySuggestions).mockRejectedValue(new HttpError(500))
    renderInRouter(<ProjectSuggestionLink projectId="p1" refreshKey={0} />)
    await waitFor(() => expect(listMySuggestions).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('link', { name: '我的範本建議' })).toBeVisible()
  })

  it('refreshKey 改變時重讀件數', async () => {
    vi.mocked(listMySuggestions).mockResolvedValue(page([], 1))
    const { rerender } = renderInRouter(
      <ProjectSuggestionLink projectId="p1" refreshKey={0} />,
    )
    await screen.findByText('我的範本建議（本案共 1 件）')
    vi.mocked(listMySuggestions).mockResolvedValue(page([], 2))
    rerender(
      <MemoryRouter>
        <ProjectSuggestionLink projectId="p1" refreshKey={1} />
      </MemoryRouter>,
    )
    expect(
      await screen.findByText('我的範本建議（本案共 2 件）'),
    ).toBeVisible()
  })
})

describe('TPL-AC40 範本管理頁「待審建議（N）」', () => {
  it('顯示全部待審件數並連到審核清單', async () => {
    vi.mocked(getPendingCount).mockResolvedValue({ pending_count: 3 })
    renderInRouter(<PendingSuggestionsLink />)
    const link = await screen.findByRole('link', { name: '待審建議（3）' })
    expect(link).toHaveAttribute('href', '/templates/suggestions')
  })

  it('讀不到數量時仍可進入，不顯示錯誤的 0', async () => {
    vi.mocked(getPendingCount).mockRejectedValue(new HttpError(500))
    renderInRouter(<PendingSuggestionsLink />)
    await waitFor(() => expect(getPendingCount).toHaveBeenCalled())
    expect(screen.getByRole('link', { name: '待審建議' })).toBeVisible()
  })
})

describe('TPL-AC40 設定頁「我的範本建議」區塊只給曾提議者', () => {
  it('曾提議者看到區塊，連到個人清單且錨點可用', async () => {
    vi.mocked(listMySuggestions).mockResolvedValue(page([], 2))
    renderInRouter(<SettingsSuggestionsSection />)
    const section = await screen.findByRole('region', {
      name: '我的範本建議',
    })
    expect(section).toHaveAttribute('id', 'template-suggestions')
    expect(
      within(section).getByRole('link', { name: '開啟我的範本建議' }),
    ).toHaveAttribute('href', '/settings/template-suggestions')
    expect(listMySuggestions).toHaveBeenCalledWith({ limit: 1 })
  })

  it('從未提議、或讀取失敗時不顯示任何區塊', async () => {
    const { container, rerender } = renderInRouter(
      <SettingsSuggestionsSection />,
    )
    await waitFor(() => expect(listMySuggestions).toHaveBeenCalledTimes(1))
    expect(container).toBeEmptyDOMElement()
    vi.mocked(listMySuggestions).mockRejectedValue(new HttpError(403))
    rerender(
      <MemoryRouter key="again">
        <SettingsSuggestionsSection />
      </MemoryRouter>,
    )
    await waitFor(() => expect(listMySuggestions).toHaveBeenCalledTimes(2))
    expect(container).toBeEmptyDOMElement()
  })
})

describe('TPL-AC42 提出建議的事前確認', () => {
  function renderPropose(onProposed = vi.fn()) {
    renderInRouter(
      <ProposeSuggestion
        itemId={IDS.sourceItem}
        itemTitle="鋼筋綁紮"
        onProposed={onProposed}
        projectId={IDS.project}
      />,
    )
    return onProposed
  }

  it('先說明對象、複製內容、不改來源與待審限制，取消不送出', async () => {
    renderPropose()
    fireEvent.click(screen.getByRole('button', { name: /建議.*加入範本庫/ }))
    const box = await screen.findByRole('group', { name: '確認提出建議' })
    expect(within(box).getByText('對象：「鋼筋綁紮」')).toBeVisible()
    expect(box).toHaveTextContent('不改來源、不複製查核結果或照片')
    expect(box).toHaveTextContent(
      '待審期間不能修改，只能撤回；撤回後不能再重送。',
    )
    // 先聚焦取消，避免 Enter 直接送出。
    expect(within(box).getByRole('button', { name: '取消' })).toHaveFocus()
    fireEvent.click(within(box).getByRole('button', { name: '取消' }))
    expect(createSuggestion).not.toHaveBeenCalled()
    expect(screen.queryByRole('group', { name: '確認提出建議' })).toBeNull()
  })

  it('成功後留言、提供直達本案清單的連結並通知重讀件數', async () => {
    vi.mocked(createSuggestion).mockResolvedValue({} as never)
    const onProposed = renderPropose()
    fireEvent.click(screen.getByRole('button', { name: /建議.*加入範本庫/ }))
    fireEvent.click(await screen.findByRole('button', { name: '確認提出' }))
    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('「鋼筋綁紮」已送審')
    expect(notice).not.toHaveFocus()
    expect(
      within(notice).getByRole('link', { name: '查看我的範本建議' }),
    ).toHaveAttribute(
      'href',
      `/settings/template-suggestions?project=${IDS.project}`,
    )
    expect(createSuggestion).toHaveBeenCalledWith(IDS.project, IDS.sourceItem)
    expect(onProposed).toHaveBeenCalledTimes(1)
  })

  it('同一來源已有待審或退回件時提醒但不阻擋', async () => {
    vi.mocked(listMySuggestions).mockResolvedValue(
      page([makeSummary({ status: 'RETURNED' })]),
    )
    vi.mocked(createSuggestion).mockResolvedValue({} as never)
    renderPropose()
    fireEvent.click(screen.getByRole('button', { name: /建議.*加入範本庫/ }))
    expect(
      await screen.findByText(/同一來源項目已有待審或退回件/),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '確認提出' }))
    await screen.findByText(/已送審/)
  })

  it('已撤回或已核准的件不觸發提醒', async () => {
    vi.mocked(listMySuggestions).mockResolvedValue(
      page([
        makeSummary({ status: 'WITHDRAWN' }),
        makeSummary({ status: 'APPROVED' }),
      ]),
    )
    renderPropose()
    fireEvent.click(screen.getByRole('button', { name: /建議.*加入範本庫/ }))
    await screen.findByRole('group', { name: '確認提出建議' })
    await waitFor(() => expect(listMySuggestions).toHaveBeenCalled())
    expect(screen.queryByText(/同一來源項目已有/)).toBeNull()
  })

  it('失權時錯誤就近顯示在確認框內，確認框保持開啟', async () => {
    vi.mocked(createSuggestion).mockRejectedValue(
      new HttpError(403, 'permission.denied'),
    )
    const onProposed = renderPropose()
    fireEvent.click(screen.getByRole('button', { name: /建議.*加入範本庫/ }))
    fireEvent.click(await screen.findByRole('button', { name: '確認提出' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('沒有修改這個專案查核項目的權限')
    expect(screen.getByRole('group', { name: '確認提出建議' })).toBeVisible()
    expect(onProposed).not.toHaveBeenCalled()
  })
})
