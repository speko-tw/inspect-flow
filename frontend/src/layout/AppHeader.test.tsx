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
import { NAV_LABELS } from './navigationLabels'

const ADMIN = currentUserFixture({
  is_admin: true,
  has_office_access: true,
  has_field_access: true,
  can_inspect_tasks: true,
  has_template_access: true,
})
const OFFICE = currentUserFixture({ has_project_access: true })
const FIELD = currentUserFixture({
  has_field_access: true,
  can_inspect_tasks: true,
})
const FIELD_PROJECT = currentUserFixture({
  has_field_access: true,
  can_inspect_tasks: true,
  has_project_access: true,
})
const MIXED = currentUserFixture({
  has_project_access: true,
  can_manage_project_planning_or_members: true,
  has_field_access: true,
  can_inspect_tasks: true,
})
const TEMPLATE_USE_ONLY = currentUserFixture({
  can_browse_templates: true,
  can_manage_template_library: false,
})
const TEMPLATE_MANAGER = currentUserFixture({
  can_manage_template_library: true,
  module_permissions: ['template.manage'],
})
const SUPERVISOR = currentUserFixture({
  has_project_access: true,
  module_permissions: ['all_project_progress.read'],
})
const DELEGATE = currentUserFixture({ delegated_modules: ['account.manage'] })
const EXTERNAL = currentUserFixture({
  has_project_access: true,
  is_external_collaborator: true,
})
const ORIGINAL_INNER_WIDTH = window.innerWidth

function renderHeader(
  user: CurrentUser,
  props: Partial<React.ComponentProps<typeof AppHeader>> = {},
  path = '/accounts',
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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: ORIGINAL_INNER_WIDTH,
  })
})

describe('全站品牌頁首（UDS-AC18）', () => {
  it.each(['/accounts', '/projects', '/templates', '/tasks'])(
    '%s 使用共用品牌外框，不依賴 overview 容器',
    (path) => {
      renderHeader(ADMIN, {}, path)
      expect(screen.getByRole('banner')).toHaveClass('app-header')
      expect(screen.getByRole('banner').closest('.dashboard-shell')).toBeNull()
    },
  )
})

describe('範本瀏覽導覽（TPL-R09）', () => {
  it('template.use-only 使用者不會看到範本管理導覽', () => {
    renderHeader(TEMPLATE_USE_ONLY)
    expect(screen.queryByRole('link', { name: '範本' })).toBeNull()
  })
})

describe('AppHeader 窄螢幕導覽（#500）', () => {
  it('導覽是單列可滑動的一個 nav，目前的分頁被捲進可見範圍', () => {
    // jsdom 不做版面：用假的尺寸模擬「目前分頁在可視範圍右側之外」。
    const offsetLeft = vi
      .spyOn(HTMLElement.prototype, 'offsetLeft', 'get')
      .mockReturnValue(500)
    const offsetWidth = vi
      .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
      .mockReturnValue(80)
    const clientWidth = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(328)
    try {
      renderHeader(ADMIN, {}, '/projects')
      const nav = screen.getByRole('navigation', { name: '管理功能' })
      expect(nav).toHaveClass('app-header-nav')
      expect(within(nav).getByRole('link', { name: '專案' })).toHaveAttribute(
        'aria-current',
        'page',
      )
      // 目前分頁右緣 580，可視寬度 328：往右捲到右緣對齊再留 8px。
      expect(nav.scrollLeft).toBe(580 - 328 + 8)
    } finally {
      offsetLeft.mockRestore()
      offsetWidth.mockRestore()
      clientWidth.mockRestore()
    }
  })
})

describe('AppHeader 導覽的「還有更多」提示（#500）', () => {
  // jsdom 不做版面：用假的尺寸模擬一條放不下的導覽列。
  function withLayout(scrollWidth: number, clientWidth: number) {
    const proto = HTMLElement.prototype
    Object.defineProperty(proto, 'scrollWidth', {
      configurable: true,
      get: () => scrollWidth,
    })
    Object.defineProperty(proto, 'clientWidth', {
      configurable: true,
      get: () => clientWidth,
    })
    return () => {
      Reflect.deleteProperty(proto, 'scrollWidth')
      Reflect.deleteProperty(proto, 'clientWidth')
    }
  }

  it('放不下且在最左：只有右緣提示；捲到底後只剩左緣提示', () => {
    const restore = withLayout(700, 328)
    try {
      renderHeader(ADMIN, {}, '/projects')
      const nav = screen.getByRole('navigation', { name: '管理功能' })
      expect(nav).toHaveAttribute('data-more-end')
      expect(nav).not.toHaveAttribute('data-more-start')
      nav.scrollLeft = 700 - 328
      fireEvent.scroll(nav)
      expect(nav).toHaveAttribute('data-more-start')
      expect(nav).not.toHaveAttribute('data-more-end')
    } finally {
      restore()
    }
  })

  it('放得下：沒有任何提示', () => {
    const restore = withLayout(300, 328)
    try {
      renderHeader(ADMIN)
      const nav = screen.getByRole('navigation', { name: '管理功能' })
      expect(nav).not.toHaveAttribute('data-more-start')
      expect(nav).not.toHaveAttribute('data-more-end')
    } finally {
      restore()
    }
  })

  it('鎖定模式（臨時密碼頁）灰色分頁那一列同樣有提示', () => {
    const restore = withLayout(700, 328)
    try {
      renderHeader(ADMIN, { locked: true, lockedNote: '請先抄下臨時密碼' })
      const tabs = document.querySelector('.app-header-tabs')
      expect(tabs).toHaveAttribute('data-more-end')
    } finally {
      restore()
    }
  })
})

describe('AppHeader', () => {
  it.each([
    ['Admin', ADMIN, ['總覽', '任務', '專案', '範本']],
    ['全專案進度主管', SUPERVISOR, ['總覽', '專案']],
    ['內業工程師', OFFICE, ['專案']],
    ['現場工程師', FIELD, ['任務']],
    ['範本管理者', TEMPLATE_MANAGER, ['範本']],
    ['委派者', DELEGATE, []],
    ['外部協作', EXTERNAL, ['專案']],
    ['全無權限', currentUserFixture(), []],
  ])('%s 只看到符合權限的固定順序導覽', (_role, user, labels) => {
    expect(memberNavItems(user).map((item) => item.label)).toEqual(labels)
  })

  it('管理下拉僅有可見子項，支援鍵盤、Esc、目前頁狀態與空清單隱藏', () => {
    renderHeader(
      OFFICE,
      {
        navItems: [
          { to: '/tasks', label: NAV_LABELS.tasks },
          { to: '/projects', label: NAV_LABELS.projects },
          { to: '/overview', label: NAV_LABELS.overview },
          { to: '/templates', label: NAV_LABELS.templates },
        ],
        managementItems: [
          { to: '/companies', label: NAV_LABELS.company },
          { to: '/roles', label: NAV_LABELS.roles },
          { to: '/logs', label: NAV_LABELS.records },
        ],
      },
      '/roles',
    )
    const trigger = screen.getByRole('button', { name: /管理/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('link', { name: '公司' })).toBeNull()
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: '公司' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
  })

  it('委派者只可見帳號時直接顯示帳號連結，不顯示管理下拉', () => {
    renderHeader(OFFICE, {
      managementItems: [{ to: '/accounts', label: NAV_LABELS.account }],
    })
    expect(screen.getByRole('link', { name: '帳號' })).toHaveAttribute(
      'href',
      '/accounts',
    )
    expect(screen.queryByRole('button', { name: /管理/ })).toBeNull()
  })

  it('窄螢幕下拉固定在視窗內，不受可捲動導覽列裁切', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 360,
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 320,
      y: 24,
      top: 24,
      right: 360,
      bottom: 68,
      left: 320,
      width: 40,
      height: 44,
      toJSON: () => ({}),
    })
    renderHeader(ADMIN, {
      managementItems: [
        { to: '/accounts', label: NAV_LABELS.account },
        { to: '/companies', label: NAV_LABELS.company },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: /管理/ }))
    const menu = screen.getByRole('group', { name: '管理' })
    expect(menu.getAttribute('style')).toBe(
      'top: 68px; left: 200px; position: fixed;',
    )
  })

  it('360px 下管理者可開啟全部管理項目且選單留在視窗內', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 360,
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 320,
      y: 24,
      top: 24,
      right: 360,
      bottom: 68,
      left: 320,
      width: 40,
      height: 44,
      toJSON: () => ({}),
    })
    renderHeader(ADMIN, {
      managementItems: [
        { to: '/accounts', label: NAV_LABELS.account },
        { to: '/companies', label: NAV_LABELS.company },
        { to: '/roles', label: NAV_LABELS.roles },
        { to: '/logs', label: NAV_LABELS.records },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: /管理/ }))

    const menu = screen.getByRole('group', { name: '管理' })
    const { left, right } = menu.getBoundingClientRect()
    expect(left).toBeGreaterThanOrEqual(0)
    expect(right).toBeLessThanOrEqual(window.innerWidth)
    expect(
      within(menu)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['帳號', '公司', '角色', '紀錄'])
  })

  it('管理項目為空時不顯示管理入口，主導覽依固定順序呈現', () => {
    renderHeader(ADMIN, {
      navItems: [
        { to: '/templates', label: NAV_LABELS.templates },
        { to: '/overview', label: NAV_LABELS.overview },
        { to: '/tasks', label: NAV_LABELS.tasks },
        { to: '/projects', label: NAV_LABELS.projects },
      ],
      managementItems: [],
    })
    expect(screen.queryByRole('button', { name: '管理' })).toBeNull()
    expect(
      within(screen.getByRole('navigation'))
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['總覽', '任務', '專案', '範本'])
  })

  it.each([
    ['系統管理者', ADMIN, '/overview'],
    ['內業', OFFICE, '/projects'],
    ['現場', FIELD, '/tasks'],
    ['有專案管理與現場權限', MIXED, '/projects'],
  ])('%s：點系統名稱回到自己的落點', (_label, user, target) => {
    renderHeader(user)
    expect(
      screen.getByRole('link', { name: 'InspectFlow 工程查核系統' }),
    ).toHaveAttribute('href', target)
  })

  it('登入者按鈕可開啟個人選單，密碼與登出不在導覽列', () => {
    renderHeader(FIELD)
    const account = screen.getByRole('button', {
      name: '示範使用者 ▾',
    }).parentElement
    expect(account).toHaveClass('app-header-account')
    const trigger = within(account as HTMLElement).getByRole('button', {
      name: '示範使用者 ▾',
    })
    expect(trigger).toHaveClass('app-header-personal-trigger')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveAttribute('aria-haspopup', 'true')
    expect(screen.queryByRole('link', { name: '設定' })).toBeNull()
    expect(screen.queryByRole('button', { name: '登出' })).toBeNull()
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: '設定' })).toHaveAttribute(
      'href',
      '/settings',
    )
    expect(screen.getByRole('button', { name: '登出' })).toBeVisible()
  })

  // #713：總覽頁頁首樣式只套在 .app-header-personal-trigger；選單項目
  // 若也帶這個 class（或落進 .app-header-account button），會變成白字白底。
  it('選單項目不帶觸發按鈕的 class，不會吃到深色頁首的白字樣式', () => {
    renderHeader(OFFICE)
    fireEvent.click(screen.getByRole('button', { name: '示範使用者 ▾' }))

    const menu = screen.getByRole('group', { name: '個人選單' })
    for (const item of [
      within(menu).getByRole('link', { name: '設定' }),
      within(menu).getByRole('button', { name: '登出' }),
    ]) {
      expect(item).not.toHaveClass('app-header-personal-trigger')
      expect(item.closest('.app-header-personal-menu')).not.toBeNull()
    }
  })

  it.each([
    ['系統管理者', ADMIN],
    ['主管', OFFICE],
    ['現場人員', FIELD],
    ['混合權限', MIXED],
  ])('%s 看得到清楚的個人選單按鈕', (_label, user) => {
    renderHeader(user)
    const trigger = screen.getByRole('button', {
      name: '示範使用者 ▾',
    })
    expect(trigger).toHaveAttribute('aria-haspopup', 'true')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: '設定' })).toBeVisible()
    expect(screen.getByRole('button', { name: '登出' })).toBeVisible()
  })

  it('混合帳號的導覽同時有專案與現場，現場帳號只有任務', () => {
    const view = renderHeader(MIXED)
    const names = (container: HTMLElement) =>
      within(container)
        .getAllByRole('link')
        .map((link) => link.textContent)
    expect(names(screen.getByRole('navigation'))).toEqual(['任務', '專案'])
    view.unmount()
    renderHeader(FIELD)
    expect(names(screen.getByRole('navigation'))).toEqual(['任務'])
  })

  it('個人選單可用鍵盤開啟，Esc 關閉並把焦點還給登入者按鈕', () => {
    renderHeader(FIELD)
    const trigger = screen.getByRole('button', {
      name: '示範使用者 ▾',
    })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })

    const passwordLink = screen.getByRole('link', { name: '設定' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(passwordLink).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('link', { name: '設定' })).toBeNull()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
  })

  it('現場加唯讀專案權限可由頁首進入專案清單', () => {
    renderHeader(FIELD_PROJECT)
    const nav = screen.getByRole('navigation', { name: '管理功能' })
    expect(within(nav).getByRole('link', { name: '專案' })).toHaveAttribute(
      'href',
      '/projects',
    )
    expect(within(nav).getByRole('link', { name: '任務' })).toBeVisible()
  })

  it('目前所在的頁面用 aria-current 標示，其他不標', () => {
    renderHeader(MIXED, {}, '/projects/p1/members')
    expect(screen.getByRole('link', { name: '專案' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: '任務' })).not.toHaveAttribute(
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
    fireEvent.click(screen.getByRole('button', { name: '示範使用者 ▾' }))
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
    expect(screen.getByText('專案').closest('[aria-hidden]')).not.toBe(null)
  })
})
