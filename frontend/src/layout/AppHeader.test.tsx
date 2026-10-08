// 共用頁首（#494）：系統名稱連到各身分自己的落點、導覽的選取樣式、
// 登出鈕固定在帳號區、登出失敗的錯誤在頁首下方，以及鎖定模式
// （臨時密碼結果頁，ADM-R15）不能離開。

import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CurrentUser } from '../auth/api'
import { CurrentUserProvider } from '../auth/useCurrentUser'
import { currentUserFixture } from '../testing/contractFixtures'
import AppHeader, { memberNavItems } from './AppHeader'

const ADMIN = currentUserFixture({
  is_admin: true,
  has_office_access: true,
  has_field_access: true,
  has_template_access: true,
})
const OFFICE = currentUserFixture({ has_office_access: true })
const FIELD = currentUserFixture({ has_field_access: true })
const MIXED = currentUserFixture({
  has_office_access: true,
  has_field_access: true,
})

function renderHeader(
  user: CurrentUser,
  props: Partial<React.ComponentProps<typeof AppHeader>> = {},
  path = '/admin',
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CurrentUserProvider value={{ user, clear: vi.fn() }}>
        <AppHeader
          navItems={memberNavItems(user)}
          navLabel="管理功能"
          user={user}
          {...props}
        />
      </CurrentUserProvider>
    </MemoryRouter>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('AppHeader', () => {
  it.each([
    ['系統管理者', ADMIN, '/admin'],
    ['內業', OFFICE, '/admin/projects'],
    ['現場', FIELD, '/field'],
    ['內業加現場', MIXED, '/admin/projects'],
  ])('%s：點系統名稱回到自己的落點', (_label, user, target) => {
    renderHeader(user)
    expect(
      screen.getByRole('link', { name: 'InspectFlow 工程查核系統' }),
    ).toHaveAttribute('href', target)
  })

  it('帳號區：登入者與登出鈕在同一組', () => {
    renderHeader(FIELD)
    const account = screen.getByText(/登入者：示範使用者/).parentElement
    expect(account).toHaveClass('app-header-account')
    expect(
      within(account as HTMLElement).getByRole('button', { name: '登出' }),
    ).toBeVisible()
  })

  it('混合帳號的導覽同時有內業與現場，現場帳號只有今日任務與變更密碼', () => {
    const view = renderHeader(MIXED)
    const names = (container: HTMLElement) =>
      within(container)
        .getAllByRole('link')
        .map((link) => link.textContent)
    expect(names(screen.getByRole('navigation'))).toEqual([
      '我的專案',
      '今日任務',
      '變更密碼',
    ])
    view.unmount()
    renderHeader(FIELD)
    expect(names(screen.getByRole('navigation'))).toEqual([
      '今日任務',
      '變更密碼',
    ])
  })

  it('目前所在的頁面用 aria-current 標示，其他不標', () => {
    renderHeader(MIXED, {}, '/admin/projects/p1/members')
    expect(screen.getByRole('link', { name: '我的專案' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: '今日任務' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('顯示呼叫端給的標籤', () => {
    renderHeader(ADMIN, { badge: <h1 className="topbar-badge">Admin</h1> })
    expect(screen.getByRole('heading', { name: 'Admin' })).toHaveClass(
      'topbar-badge',
    )
  })

  it('登出失敗：錯誤在頁首下方，不在帳號區裡', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    )
    const { container } = renderHeader(FIELD)
    fireEvent.click(screen.getByRole('button', { name: '登出' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('登出失敗，請再試一次。')
    expect(container.querySelector('header')).not.toContainElement(alert)
    expect(alert.previousElementSibling).toBe(
      container.querySelector('header'),
    )
  })

  it('鎖定模式：系統名稱不是連結、導覽不能點、沒有登出鈕，並有提示', () => {
    renderHeader(ADMIN, {
      locked: true,
      lockedNote: '請先抄下臨時密碼',
    })
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('button', { name: '登出' })).toBeNull()
    expect(screen.getByText('InspectFlow 工程查核系統')).toBeVisible()
    expect(screen.getByText(/登入者：示範使用者/)).toBeVisible()
    expect(screen.getByText('請先抄下臨時密碼')).toBeVisible()
    // 灰字的導覽項目只是外觀，不進無障礙樹。
    expect(screen.getByText('我的專案').closest('[aria-hidden]')).not.toBe(
      null,
    )
  })
})
