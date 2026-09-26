import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '../App'

const ADMIN_USER = {
  id: 'u1',
  email: 'admin@example.com',
  name_en: 'Admin User',
  name_zh: '管理員',
  is_admin: true,
}

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

function LocationProbe() {
  const location = useLocation()
  return (
    <div data-testid="location-probe">
      {`${location.pathname}${location.search}${location.hash}|` +
        JSON.stringify(location.state)}
    </div>
  )
}

function renderApp(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <LocationProbe />
      <App />
    </MemoryRouter>,
  )
}

describe('RequireAuth 導向登入頁並保留原路徑（AUT-AC28）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('/admin 未登入時導向 /login，並保留原路徑', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    )

    renderApp(['/admin/reports?x=1'])

    await screen.findByRole('heading', { name: '登入' })

    const probe = screen.getByTestId('location-probe').textContent ?? ''
    expect(probe).toContain('/login')
    expect(probe).toContain('/admin/reports?x=1')
  })

  it('/field 未登入時導向 /login，並保留原路徑', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    )

    renderApp(['/field/tasks'])

    await screen.findByRole('heading', { name: '登入' })

    const probe = screen.getByTestId('location-probe').textContent ?? ''
    expect(probe).toContain('/login')
    expect(probe).toContain('/field/tasks')
  })

  it('登入成功後回到原本的路徑', async () => {
    let loggedIn = false

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input)
        const method = init?.method ?? 'GET'

        if (url.endsWith('/api/v1/auth/me')) {
          return loggedIn
            ? jsonResponse(ADMIN_USER)
            : new Response(null, { status: 401 })
        }
        if (url.endsWith('/api/v1/auth/login') && method === 'POST') {
          loggedIn = true
          return jsonResponse(ADMIN_USER)
        }

        throw new Error(`unexpected fetch: ${method} ${url}`)
      }),
    )

    renderApp(['/admin/reports'])

    await screen.findByRole('heading', { name: '登入' })

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'admin@example.com' },
    })
    fireEvent.change(screen.getByLabelText('密碼'), {
      target: { value: 'correct-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: '登入' }))

    await screen.findByRole('heading', { name: 'Admin' })

    await waitFor(() => {
      const probe = screen.getByTestId('location-probe').textContent ?? ''
      expect(probe.startsWith('/admin/reports|')).toBe(true)
    })
  })

  it('目前使用者 API 回傳非 401 的錯誤時不導向登入頁', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    )

    renderApp(['/admin'])

    await screen.findByRole('alert')

    const probe = screen.getByTestId('location-probe').textContent ?? ''
    expect(probe).not.toContain('/login')
    expect(probe.startsWith('/admin|')).toBe(true)
  })
})
