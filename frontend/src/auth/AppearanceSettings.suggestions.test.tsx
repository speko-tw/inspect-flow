import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { currentUserFixture } from '../testing/contractFixtures'
import AppearanceSettings from './AppearanceSettings'
import { CurrentUserProvider } from './useCurrentUser'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

function renderSettings(totalCount: number | 'error') {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('/me/template-suggestions')) {
      if (totalCount === 'error') {
        return Response.json(
          { error: { code: 'permission.denied' } },
          { status: 403 },
        )
      }
      return Response.json({
        items: [],
        next_cursor: null,
        total_count: totalCount,
      })
    }
    return Response.json({})
  })
  vi.stubGlobal('fetch', fetchMock)
  render(
    <CurrentUserProvider
      value={{ user: currentUserFixture(), clear: vi.fn() }}
    >
      <MemoryRouter>
        <AppearanceSettings />
      </MemoryRouter>
    </CurrentUserProvider>,
  )
  return fetchMock
}

describe('TPL-AC40 設定頁的「我的範本建議」區塊', () => {
  it('曾提議者在外觀之後看到區塊，並連到個人清單', async () => {
    const fetchMock = renderSettings(2)
    const section = await screen.findByRole('region', {
      name: '我的範本建議',
    })
    expect(section).toHaveAttribute('id', 'template-suggestions')
    expect(section).toHaveTextContent('共 2 件')
    expect(
      within(section).getByRole('link', { name: '開啟我的範本建議' }),
    ).toHaveAttribute('href', '/settings/template-suggestions')
    expect(
      screen
        .getByRole('group', { name: '外觀' })
        .compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // 不看來源專案或 template.use：只問本人清單的未篩選總數。
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/me/template-suggestions?limit=1',
      expect.anything(),
    )
  })

  it('從未提議、或讀取失敗時整個區塊不出現', async () => {
    const empty = renderSettings(0)
    await waitFor(() => expect(empty).toHaveBeenCalled())
    expect(screen.queryByText('我的範本建議')).toBeNull()
  })

  it('讀取失敗也不出現空殼區塊', async () => {
    const failed = renderSettings('error')
    await waitFor(() => expect(failed).toHaveBeenCalled())
    expect(screen.queryByText('我的範本建議')).toBeNull()
  })
})
