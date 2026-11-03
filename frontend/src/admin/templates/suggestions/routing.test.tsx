import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import AdminPage from '../../AdminPage'
import type { CurrentUser } from '../../../auth/api'
import { CurrentUserProvider } from '../../../auth/useCurrentUser'
import { memberNavItems } from '../../../layout/AppHeader'
import { canAccessRoute, routeForPath, ROUTES } from '../../../routes'
import { currentUserFixture } from '../../../testing/contractFixtures'
import { DataMemoryRouter } from '../../../testing/DataMemoryRouter'
import { IDS } from './fixtures'

beforeAll(async () => {
  await Promise.all([
    import('../../AdminPage'),
    import('./SuggestionRoutes'),
    import('../TemplatesPage'),
  ])
})

afterEach(() => vi.unstubAllGlobals())

const NO_ACCESS = currentUserFixture({
  has_project_access: false,
  can_inspect_tasks: false,
})

describe('路由權限（TPL-R34、ADM-R50）', () => {
  it('個人清單只要登入就能進入，不要求 template.use 或來源專案權限', () => {
    for (const path of [
      '/settings/template-suggestions',
      `/settings/template-suggestions/${IDS.suggestion}`,
      `/settings/template-suggestions/${IDS.suggestion}/edit`,
    ]) {
      const route = routeForPath(path)
      expect(route, path).toBe(ROUTES.mySuggestions)
      expect(canAccessRoute(NO_ACCESS, route!)).toBe(true)
    }
  })

  it('審核清單、詳情、修改與比較都需要 template.manage（Admin 放行）', () => {
    const manager = currentUserFixture({
      module_permissions: ['template.manage'],
    })
    const onlyUse = currentUserFixture({
      module_permissions: ['template.use'],
    })
    for (const path of [
      '/templates/suggestions',
      `/templates/suggestions/${IDS.suggestion}`,
      `/templates/suggestions/${IDS.suggestion}/edit`,
      `/templates/suggestions/${IDS.suggestion}/compare`,
    ]) {
      const route = routeForPath(path)
      expect(route, path).toBe(ROUTES.reviewSuggestions)
      expect(canAccessRoute(manager, route!)).toBe(true)
      expect(
        canAccessRoute(currentUserFixture({ is_admin: true }), route!),
      ).toBe(true)
      expect(canAccessRoute(onlyUse, route!)).toBe(false)
      expect(canAccessRoute(NO_ACCESS, route!)).toBe(false)
    }
  })
})

describe('TPL-AC40 沒有新增全域入口', () => {
  it('主導覽在任何權限組合下都不列範本建議', () => {
    const everything = currentUserFixture({
      is_admin: true,
      has_project_access: true,
      can_inspect_tasks: true,
      can_create_project: true,
      can_manage_template_library: true,
      module_permissions: ['template.manage', 'template.use'],
    })
    const links = memberNavItems(everything).map((item) => item.to)
    expect(links.join(' ')).not.toMatch(/suggestion/)
  })

  it('Field 與全域外殼的原始碼沒有範本建議連結', () => {
    const roots = ['src/field', 'src/layout']
    const offenders: string[] = []
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) visit(path)
        else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
          if (
            /template-suggestions|templates\/suggestions/.test(
              readFileSync(path, 'utf8'),
            )
          ) {
            offenders.push(path)
          }
        }
      }
    }
    roots.forEach(visit)
    expect(offenders).toEqual([])
  })
})

describe('管理外殼註冊', () => {
  const admin: CurrentUser = currentUserFixture({
    is_admin: true,
    has_template_access: true,
    can_manage_template_library: true,
    can_browse_templates: true,
    module_permissions: ['template.manage'],
  })

  function renderAt(path: string, user: CurrentUser) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          items: [],
          next_cursor: null,
          total_count: 0,
          pending_count: 0,
        }),
      ),
    )
    return render(
      <CurrentUserProvider value={{ user, clear: vi.fn() }}>
        <DataMemoryRouter initialEntries={[path]}>
          {/* App.tsx 把 /settings 與其他管理頁分兩個入口掛同一個 AdminPage。 */}
          <Routes>
            <Route element={<AdminPage />} path="/settings/*" />
            <Route element={<AdminPage />} path="/*" />
          </Routes>
        </DataMemoryRouter>
      </CurrentUserProvider>,
    )
  }

  it('管理者可開審核清單', async () => {
    renderAt('/templates/suggestions', admin)
    // 外殼第一次渲染較重，負載高時超過預設的 1 秒。
    expect(
      await screen.findByRole('heading', { name: '範本建議審核' }),
    ).toBeVisible()
  })

  it('非管理者但有 template.manage 也可開審核清單', async () => {
    renderAt(
      '/templates/suggestions',
      currentUserFixture({
        can_manage_template_library: true,
        has_template_access: true,
        module_permissions: ['template.manage'],
      }),
    )
    expect(
      await screen.findByRole('heading', { name: '範本建議審核' }),
    ).toBeVisible()
  })

  it('沒有 template.manage 的人開審核網址看到無權限，不載入任何建議', async () => {
    renderAt('/templates/suggestions', NO_ACCESS)
    expect(
      await screen.findByRole('heading', { name: '無權限' }),
    ).toBeVisible()
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/template-suggestions'),
      expect.anything(),
    )
  })

  it('任何登入者（含只有現場權限者）可開個人清單', async () => {
    renderAt(
      '/settings/template-suggestions',
      currentUserFixture({ can_inspect_tasks: true, has_field_access: true }),
    )
    expect(
      await screen.findByRole('heading', { name: '我的範本建議' }),
    ).toBeVisible()
  })

  it('個人清單沒有根路徑別名，也不提供比較頁', async () => {
    const { unmount } = renderAt('/template-suggestions', admin)
    expect(await screen.findByText(/找不到/, undefined)).toBeVisible()
    unmount()
    renderAt(`/settings/template-suggestions/${IDS.suggestion}/compare`, admin)
    expect(await screen.findByText(/找不到/, undefined)).toBeVisible()
  })

  it('怪異的建議識別不會拼進 API 路徑', async () => {
    renderAt('/settings/template-suggestions/..%2Fcompanies', admin)
    expect(await screen.findByText(/找不到/, undefined)).toBeVisible()
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('companies'),
      expect.anything(),
    )
  })
})
