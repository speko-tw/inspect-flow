import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CurrentUserProvider } from '../../../auth/useCurrentUser'
import { HttpError } from '../../../http'
import { currentUserFixture } from '../../../testing/contractFixtures'
import {
  compareRevisions,
  getSuggestion,
  listRevisions,
  type SuggestionRevision,
} from './api'
import {
  comparisonResponse,
  event,
  IDS,
  LIN,
  makeContent,
  makeDetail,
  makeRevision,
  WU,
} from './fixtures'
import SuggestionComparePage from './SuggestionComparePage'

vi.mock('./api')

function threeVersions(): SuggestionRevision[] {
  const first = makeRevision(1, {
    events: [
      event('PENDING', LIN, '2026-10-31T01:00:00Z'),
      event('RETURNED', WU, '2026-10-31T02:00:00Z', '請補充'),
    ],
  })
  const secondContent = makeContent({ title: '鋼筋綁紮與間距檢查' })
  secondContent.inspection_points[0].numeric_standard!.value = '180'
  const second = makeRevision(2, { content: secondContent })
  const thirdContent = makeContent({ title: '鋼筋綁紮通用版' })
  thirdContent.inspection_points[0].numeric_standard!.value = '180'
  thirdContent.inspection_points = thirdContent.inspection_points.slice(0, 1)
  const third = makeRevision(3, {
    content: thirdContent,
    editor_id: WU.id,
    editor_name: WU.name,
  })
  return [first, second, third]
}

function renderCompare(revisions: SuggestionRevision[]) {
  vi.mocked(getSuggestion).mockResolvedValue(
    makeDetail({ current_revision: revisions.at(-1)! }),
  )
  vi.mocked(listRevisions).mockResolvedValue(revisions)
  vi.mocked(compareRevisions).mockImplementation(async (_id, fromId, toId) =>
    comparisonResponse(
      revisions.find((r) => r.id === fromId)!,
      revisions.find((r) => r.id === toId)!,
    ),
  )
  return render(
    <CurrentUserProvider
      value={{ user: currentUserFixture(), clear: vi.fn() }}
    >
      <MemoryRouter
        initialEntries={[`/templates/suggestions/${IDS.suggestion}/compare`]}
      >
        <Routes>
          <Route
            element={<SuggestionComparePage />}
            path="/templates/suggestions/:suggestionId/compare"
          />
          <Route element={<p>詳情頁</p>} path="/templates/suggestions/:id" />
        </Routes>
      </MemoryRouter>
    </CurrentUserProvider>,
  )
}

afterEach(() => {
  // 先卸載畫面，避免還在跑的效果在 mock 被重設後呼叫到空實作。
  cleanup()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('TPL-AC36 管理者比較相鄰兩版', () => {
  it('預設比較最後兩版，列出修改與刪除的差異摘要', async () => {
    renderCompare(threeVersions())
    expect(await screen.findByText('刪除')).toBeVisible()
    expect(compareRevisions).toHaveBeenCalledWith(
      IDS.suggestion,
      'rev-2',
      'rev-3',
    )
    const summary = screen.getByRole('heading', {
      name: '差異摘要',
    }).nextElementSibling!
    expect(summary).toHaveTextContent('修改 查核項目名稱')
    expect(summary).toHaveTextContent('刪除 查核項次')
    expect(summary).toHaveTextContent('前：續接器檢查')
    expect(summary).toHaveTextContent('後：（已移除）')
  })

  it('只提供相鄰兩版的選項，切換後重新比較', async () => {
    renderCompare(threeVersions())
    await screen.findByText('刪除')
    const select = screen.getByLabelText('相鄰版本')
    expect(
      Array.from((select as HTMLSelectElement).options).map((o) => o.text),
    ).toEqual(['第 1 版／第 2 版', '第 2 版／第 3 版'])
    fireEvent.change(select, { target: { value: '2' } })
    await waitFor(() =>
      expect(compareRevisions).toHaveBeenLastCalledWith(
        IDS.suggestion,
        'rev-1',
        'rev-2',
      ),
    )
    expect(await screen.findByText(/鋼筋間距／標準/)).toBeVisible()
  })

  it('兩份完整內容各列編輯者、審核紀錄與退回原因', async () => {
    renderCompare(threeVersions())
    fireEvent.change(await screen.findByLabelText('相鄰版本'), {
      target: { value: '2' },
    })
    const before = await screen.findByText('前版：第 1 版完整內容')
    const side = before.closest('details')!
    expect(side).toHaveTextContent('退回原因：請補充')
    expect(side).toHaveTextContent('鋼筋綁紮')
  })

  it('「看後版」展開該版並跳到同一穩定項次，缺側回項目內容', async () => {
    renderCompare(threeVersions())
    await screen.findByText('刪除')
    const sides = document.querySelectorAll<HTMLDetailsElement>(
      '.suggestion-compare-side',
    )
    sides.forEach((side) => {
      side.open = false
    })
    const row = screen.getByText('刪除').closest('li')!
    fireEvent.click(row.querySelector('button:nth-of-type(1)')!)
    expect(sides[0].open).toBe(true)
    expect(document.activeElement?.id).toBe(
      `compare-before-point-${IDS.coupler}`,
    )
    fireEvent.click(row.querySelector('button:nth-of-type(2)')!)
    expect(sides[1].open).toBe(true)
    // 後版沒有被刪除的項次，回到項目內容本身。
    expect(document.activeElement?.id).toBe('compare-after-item')
    fireEvent.click(screen.getAllByRole('button', { name: '返回差異摘要' })[1])
    expect(document.activeElement?.id).toBe('suggestion-compare-summary')
  })

  it('手機寬度預設收合兩份完整內容，先看差異摘要', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true, addListener: vi.fn() }),
    )
    renderCompare(threeVersions())
    await screen.findByText('刪除')
    const sides = document.querySelectorAll<HTMLDetailsElement>(
      '.suggestion-compare-side',
    )
    expect(Array.from(sides).map((side) => side.open)).toEqual([false, false])
  })

  it('桌機寬度兩份內容並排展開', async () => {
    renderCompare(threeVersions())
    await screen.findByText('刪除')
    const sides = document.querySelectorAll<HTMLDetailsElement>(
      '.suggestion-compare-side',
    )
    expect(Array.from(sides).map((side) => side.open)).toEqual([true, true])
  })

  it('只有一版時沒有可比較的前後兩版', async () => {
    renderCompare([makeRevision(1)])
    expect(
      await screen.findByRole('heading', { name: '尚無可比較的前後兩版' }),
    ).toBeVisible()
    expect(compareRevisions).not.toHaveBeenCalled()
  })

  it('後端拒絕比較（422 非相鄰或無權限）時就近顯示提示', async () => {
    renderCompare(threeVersions())
    vi.mocked(compareRevisions).mockRejectedValue(new HttpError(422))
    fireEvent.change(await screen.findByLabelText('相鄰版本'), {
      target: { value: '2' },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('操作失敗')
  })

  it('沒有範本管理權限時顯示無權限頁，不洩漏內容', async () => {
    vi.mocked(getSuggestion).mockRejectedValue(
      new HttpError(403, 'permission.denied'),
    )
    vi.mocked(listRevisions).mockRejectedValue(
      new HttpError(403, 'permission.denied'),
    )
    render(
      <CurrentUserProvider
        value={{ user: currentUserFixture(), clear: vi.fn() }}
      >
        <MemoryRouter
          initialEntries={[`/templates/suggestions/${IDS.suggestion}/compare`]}
        >
          <Routes>
            <Route
              element={<SuggestionComparePage />}
              path="/templates/suggestions/:suggestionId/compare"
            />
          </Routes>
        </MemoryRouter>
      </CurrentUserProvider>,
    )
    expect(
      await screen.findByRole('heading', { name: '無權限' }),
    ).toBeVisible()
  })
})
