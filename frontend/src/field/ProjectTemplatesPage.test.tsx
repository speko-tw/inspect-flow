import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CurrentUser } from '../auth/api'
import { CurrentUserProvider } from '../auth/useCurrentUser'
import ProjectTemplatesPage from './ProjectTemplatesPage'

const USER: CurrentUser = {
  id: 'user-1',
  username: 'member',
  email: null,
  name_en: null,
  name_zh: null,
  is_admin: false,
  must_change_password: false,
}

function mockApi(applyResponse: Response, denyCategories = false) {
  const calls = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/template-categories?limit=100')) {
      if (denyCategories) {
        return Response.json(
          { error: { code: 'permission.denied' } },
          { status: 403 },
        )
      }
      return Response.json({
        items: [{ id: 'category-1', name: '機電' }],
        next_cursor: null,
      })
    }
    if (url.includes('/category-1/systems')) {
      return Response.json({
        items: [{ id: 'system-1', name: '空調' }],
        next_cursor: null,
      })
    }
    if (url.includes('/system-1/templates')) {
      return Response.json({
        items: [{ id: 'template-1', title: '風管檢查' }],
        next_cursor: null,
      })
    }
    if (
      url.endsWith('/inspection-items:apply-template') &&
      init?.method === 'POST'
    )
      return applyResponse
    return Response.json(
      { error: { code: 'resource.not_found' } },
      { status: 404 },
    )
  })
  vi.stubGlobal('fetch', calls)
  return calls
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/field/projects/project-1']}>
      <CurrentUserProvider value={{ user: USER, clear: vi.fn() }}>
        <Routes>
          <Route
            element={<ProjectTemplatesPage />}
            path="/field/projects/:projectId"
          />
        </Routes>
      </CurrentUserProvider>
    </MemoryRouter>,
  )
}

async function selectSystem() {
  fireEvent.change(await screen.findByLabelText('工程類別'), {
    target: { value: 'category-1' },
  })
  fireEvent.change(await screen.findByLabelText('系統'), {
    target: { value: 'system-1' },
  })
  await screen.findByRole('option', { name: '風管檢查' })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('專案範本套用（TPL-AC05、AC08）', () => {
  it('單項套用顯示副本來源與時間', async () => {
    const calls = mockApi(
      Response.json(
        [
          {
            id: 'copy-1',
            project_id: 'project-1',
            source_template_name: '風管檢查',
            applied_at: '2026-10-04T01:00:00Z',
          },
        ],
        { status: 201 },
      ),
    )
    renderPage()
    await selectSystem()
    fireEvent.change(screen.getByLabelText('查核項目'), {
      target: { value: 'template-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '套用至專案' }))

    const result = await screen.findByText(/來源：風管檢查/)
    expect(result).toBeInTheDocument()
    expect(screen.getByText(/套用時間：/)).toBeInTheDocument()
    expect(calls).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/inspection-items:apply-template',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ template_id: 'template-1' }),
      }),
    )
  })

  it('以 system_id 套用空系統時顯示空結果', async () => {
    const calls = mockApi(Response.json([], { status: 200 }))
    renderPage()
    await selectSystem()
    fireEvent.click(screen.getByLabelText('整個系統'))
    fireEvent.click(screen.getByRole('button', { name: '套用至專案' }))

    const empty = await screen.findByText('這個系統沒有項目')
    expect(empty).toBeInTheDocument()
    expect(calls).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/inspection-items:apply-template',
      expect.objectContaining({
        body: JSON.stringify({ system_id: 'system-1' }),
      }),
    )
  })

  it('寫入 403 後保留選擇並切為唯讀', async () => {
    mockApi(
      Response.json({ error: { code: 'permission.denied' } }, { status: 403 }),
    )
    renderPage()
    await selectSystem()
    fireEvent.change(screen.getByLabelText('查核項目'), {
      target: { value: 'template-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '套用至專案' }))

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: '套用至專案' }),
      ).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('查核項目')).toHaveValue('template-1')
    expect(screen.getByText('目前只能瀏覽範本。')).toBeInTheDocument()
  })

  it('讀取 403 時不顯示套用按鈕', async () => {
    mockApi(Response.json([]), true)
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '你沒有權限執行這項操作。',
    )
    expect(
      screen.queryByRole('button', { name: '套用至專案' }),
    ).not.toBeInTheDocument()
  })

  it.each([409, 422])('寫入 %i 顯示中文訊息', async (status) => {
    mockApi(
      Response.json(
        { error: { code: 'request.validation_failed' } },
        { status },
      ),
    )
    renderPage()
    await selectSystem()
    fireEvent.click(screen.getByLabelText('整個系統'))
    fireEvent.click(screen.getByRole('button', { name: '套用至專案' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      status === 409 ? '範本內容有衝突' : '範本資料無效',
    )
  })
})
