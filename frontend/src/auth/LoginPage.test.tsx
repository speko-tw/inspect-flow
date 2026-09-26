import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import LoginPage from './LoginPage'
import LogoutButton from './LogoutButton'
import RequireAuth from './RequireAuth'

const CURRENT_USER = {
  id: 'u1',
  email: 'user@example.com',
  name_en: 'Test User',
  name_zh: '測試使用者',
  is_admin: false,
}

const GENERIC_ERROR_MESSAGE = 'Email 或密碼錯誤，請再試一次。'

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
      <Route path="/login" element={<LoginPage />} />
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

function fillAndSubmit(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: email },
  })
  fireEvent.change(screen.getByLabelText('密碼'), {
    target: { value: password },
  })
  fireEvent.click(screen.getByRole('button', { name: '登入' }))
}

describe('LoginPage 失敗時只顯示通用訊息（AUT-AC29）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('帳密錯誤（401）時顯示通用訊息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { code: 'auth.invalid_credentials' } }, 401),
      ),
    )

    render(
      <MemoryRouter initialEntries={['/login']}>
        <TestApp />
      </MemoryRouter>,
    )

    fillAndSubmit('user@example.com', 'wrong-password')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(GENERIC_ERROR_MESSAGE)
  })

  it('其他失敗原因（500）顯示相同的訊息文字', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    )

    render(
      <MemoryRouter initialEntries={['/login']}>
        <TestApp />
      </MemoryRouter>,
    )

    fillAndSubmit('user@example.com', 'anything')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(GENERIC_ERROR_MESSAGE)
  })

  it('本體不合法（422）時顯示相同的訊息文字', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { code: 'validation_error' } }, 422),
      ),
    )

    render(
      <MemoryRouter initialEntries={['/login']}>
        <TestApp />
      </MemoryRouter>,
    )

    fillAndSubmit('not-an-email', '')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(GENERIC_ERROR_MESSAGE)
  })

  it('密碼欄位的 type 為 password', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <TestApp />
      </MemoryRouter>,
    )

    expect(screen.getByLabelText('密碼')).toHaveAttribute('type', 'password')
  })
})

describe('登入不碰 token／storage，登出會清狀態並導向 /login（AUT-AC30）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('完成登入、瀏覽、登出，全程不寫入 storage 也不自設認證標頭', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    let loggedIn = false

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input)
        const method = init?.method ?? 'GET'

        if (url.endsWith('/api/v1/auth/me')) {
          return loggedIn
            ? jsonResponse(CURRENT_USER)
            : new Response(null, { status: 401 })
        }
        if (url.endsWith('/api/v1/auth/login') && method === 'POST') {
          loggedIn = true
          return jsonResponse(CURRENT_USER)
        }
        if (url.endsWith('/api/v1/auth/logout') && method === 'POST') {
          loggedIn = false
          return new Response(null, { status: 204 })
        }

        throw new Error(`unexpected fetch: ${method} ${url}`)
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter
        initialEntries={[
          { pathname: '/login', state: { from: '/protected' } },
        ]}
      >
        <TestApp />
      </MemoryRouter>,
    )

    fillAndSubmit('user@example.com', 'correct-password')

    // 瀏覽已登入的畫面。
    await screen.findByRole('heading', { name: '受保護頁面' })

    // 登出。
    fireEvent.click(screen.getByRole('button', { name: '登出' }))

    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: '受保護頁面' }),
      ).not.toBeInTheDocument()
    })
    await screen.findByRole('heading', { name: '登入' })

    expect(setItemSpy).not.toHaveBeenCalled()

    expect(fetchMock.mock.calls.length).toBeGreaterThan(0)
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit | undefined
      expect(init?.credentials ?? 'same-origin').toBe('same-origin')

      const headers = (init?.headers ?? {}) as Record<string, string>
      for (const headerName of Object.keys(headers)) {
        const normalized = headerName.toLowerCase()
        expect(normalized).not.toBe('authorization')
        expect(normalized).not.toBe('cookie')
      }
    }

    const calledUrls = fetchMock.mock.calls.map(([input]) =>
      requestUrl(input as RequestInfo | URL),
    )
    expect(calledUrls.some((url) => url.endsWith('/api/v1/auth/logout'))).toBe(
      true,
    )
  })
})
