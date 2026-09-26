// 登出 API 失敗時，`LogoutButton` 不應清掉前端狀態或導向
// `/login`（見 `LogoutButton.tsx` 與 `api.ts` 的 `logout`）。

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import LogoutButton from './LogoutButton'
import RequireAuth from './RequireAuth'

const CURRENT_USER = {
  id: 'u1',
  email: 'user@example.com',
  name_en: 'Test User',
  name_zh: '測試使用者',
  is_admin: false,
}

const ERROR_MESSAGE = '登出失敗，請再試一次。'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof URL) {
    return input.toString()
  }
  return input.url
}

function ProtectedPage() {
  return (
    <main>
      <h1>受保護頁面</h1>
      <LogoutButton />
    </main>
  )
}

function TestApp() {
  return (
    <Routes>
      <Route path="/login" element={<h1>登入</h1>} />
      <Route
        path="/protected"
        element={
          <RequireAuth>
            <ProtectedPage />
          </RequireAuth>
        }
      />
    </Routes>
  )
}

describe('登出失敗時保留登入狀態（PR #164 review）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('登出 API 回 500 時不導向 /login，顯示錯誤訊息且可再按', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input)
        const method = init?.method ?? 'GET'

        if (url.endsWith('/api/v1/auth/me')) {
          return jsonResponse(CURRENT_USER)
        }
        if (url.endsWith('/api/v1/auth/logout') && method === 'POST') {
          return new Response(null, { status: 500 })
        }

        throw new Error(`unexpected fetch: ${method} ${url}`)
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <TestApp />
      </MemoryRouter>,
    )

    await screen.findByRole('heading', { name: '受保護頁面' })

    const button = screen.getByRole('button', { name: '登出' })
    fireEvent.click(button)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(ERROR_MESSAGE)

    expect(
      screen.queryByRole('heading', { name: '登入' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '受保護頁面' })).toBeVisible()

    await waitFor(() => {
      expect(button).not.toBeDisabled()
    })
  })

  it('fetch 拋網路錯誤時不導向 /login，顯示錯誤訊息且可再按', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input)
        const method = init?.method ?? 'GET'

        if (url.endsWith('/api/v1/auth/me')) {
          return jsonResponse(CURRENT_USER)
        }
        if (url.endsWith('/api/v1/auth/logout') && method === 'POST') {
          throw new TypeError('Failed to fetch')
        }

        throw new Error(`unexpected fetch: ${method} ${url}`)
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <TestApp />
      </MemoryRouter>,
    )

    await screen.findByRole('heading', { name: '受保護頁面' })

    const button = screen.getByRole('button', { name: '登出' })
    fireEvent.click(button)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(ERROR_MESSAGE)

    expect(
      screen.queryByRole('heading', { name: '登入' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '受保護頁面' })).toBeVisible()

    await waitFor(() => {
      expect(button).not.toBeDisabled()
    })
  })
})
