// 登入後各頁共用的頁首（#494）：Admin 與 Field 都用同一個外殼。
//
// 上列：左邊是系統名稱（連到這個帳號的落點）與可選的標籤，右邊是
// 帳號區（「登入者：名字」加登出鈕，兩者包成一組，窄螢幕不會被拆開）。
// 下列：分頁式導覽，目前所在的頁面用同一種 selected 樣式。導覽永遠是
// 單列，放不下時在列內橫向滑動，目前的分頁會被捲進可見範圍。
// 登出失敗的錯誤顯示在頁首下方，不擠進按鈕列。
//
// `locked` 用在必須先完成一件事才能離開的畫面（臨時密碼結果頁，
// ADM-R15）：保留外殼，但系統名稱不是連結、導覽變灰不能點、沒有登出鈕。

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router'

import type { CurrentUser } from '../auth/api'
import { landingPath } from '../auth/landing'
import LogoutButton from '../auth/LogoutButton'

export const SYSTEM_NAME = 'InspectFlow 工程查核系統'

export type HeaderNavItem = {
  to: string
  label: string
  /** 導覽時帶的 location state（例如變更密碼的返回位置）。 */
  state?: unknown
}

type HeaderUser = Pick<
  CurrentUser,
  | 'name_zh'
  | 'username'
  | 'is_admin'
  | 'has_office_access'
  | 'has_field_access'
  | 'has_template_access'
>

/**
 * 非系統管理者（內業、現場、範本管理、混合）共用的導覽項目：只列後端
 * 存取摘要確認有權限的項目，不出現點了才 403 的入口（#480）。
 */
export function memberNavItems(
  user: HeaderUser,
  changePasswordState?: unknown,
): HeaderNavItem[] {
  const items: HeaderNavItem[] = []
  if (user.has_office_access) {
    items.push({ to: '/admin/projects', label: '我的專案' })
  }
  if (user.has_template_access) {
    items.push({ to: '/admin/templates', label: '範本管理' })
  }
  if (user.has_field_access) items.push({ to: '/field', label: '今日任務' })
  items.push({
    to: '/change-password',
    label: '變更密碼',
    state: changePasswordState,
  })
  return items
}

/** 依目前捲動位置設定兩端的漸層提示（`data-more-start`／`data-more-end`）。 */
function updateScrollHints(el: HTMLElement) {
  const max = el.scrollWidth - el.clientWidth
  el.toggleAttribute('data-more-start', el.scrollLeft > 1)
  el.toggleAttribute('data-more-end', el.scrollLeft < max - 1)
}

export default function AppHeader({
  user,
  navLabel,
  navItems,
  badge,
  locked = false,
  lockedNote,
  onNavigate,
}: {
  user: HeaderUser
  /** 導覽區的無障礙名稱（例如「管理功能」）。 */
  navLabel: string
  navItems: HeaderNavItem[]
  /** 系統名稱旁的標籤（例如 Admin）；由呼叫端決定語意（h1 或 p）。 */
  badge?: ReactNode
  locked?: boolean
  /** locked 時顯示在導覽位置的一句說明。 */
  lockedNote?: string
  onNavigate?: () => void
}) {
  const [logoutError, setLogoutError] = useState<string | null>(null)
  // 可橫向滑動的那一列：一般模式是 <nav>，鎖定模式是灰色分頁那一列。
  const scrollerRef = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  // 窄螢幕導覽列可橫向滑動：換頁後把目前的分頁捲進可見範圍。只動導覽列
  // 自己的 scrollLeft，不會讓整個頁面跟著捲。
  useEffect(() => {
    const nav = scrollerRef.current
    const tab = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!nav || !tab) return
    const margin = 8
    const left = tab.offsetLeft
    const right = left + tab.offsetWidth
    if (left < nav.scrollLeft) {
      nav.scrollLeft = Math.max(0, left - margin)
    } else if (right > nav.scrollLeft + nav.clientWidth) {
      nav.scrollLeft = right - nav.clientWidth + margin
    }
    updateScrollHints(nav)
  }, [pathname])
  // 「還有更多」的漸層提示：只在可捲動、且還沒捲到那一端時顯示。
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const update = () => updateScrollHints(scroller)
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      scroller.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [locked, navItems.length])
  const name = user.name_zh ?? user.username
  return (
    <>
      <header className="app-header">
        <div className="app-header-bar">
          {locked ? (
            <span className="topbar-brand">{SYSTEM_NAME}</span>
          ) : (
            <Link className="topbar-brand" to={landingPath(user)}>
              {SYSTEM_NAME}
            </Link>
          )}
          {badge}
          <div className="app-header-account">
            <span className="topbar-user">登入者：{name}</span>
            {!locked && <LogoutButton onErrorChange={setLogoutError} />}
          </div>
        </div>
        {locked ? (
          <div className="app-header-nav app-header-nav-locked">
            <span
              aria-hidden="true"
              className="app-header-tabs"
              ref={scrollerRef}
            >
              {navItems.map((item) => (
                <span className="app-header-tab" key={item.to}>
                  {item.label}
                </span>
              ))}
            </span>
            {lockedNote && (
              <span className="app-header-locked-note">{lockedNote}</span>
            )}
          </div>
        ) : (
          <nav
            aria-label={navLabel}
            className="app-header-nav"
            ref={scrollerRef}
          >
            {navItems.map((item) => (
              <NavLink
                className="app-header-tab"
                key={item.to}
                onClick={onNavigate}
                state={item.state}
                to={item.to}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      {logoutError && (
        <p className="app-header-error" role="alert">
          {logoutError}
        </p>
      )}
    </>
  )
}
