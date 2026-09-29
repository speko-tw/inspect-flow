import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '../App'

const ADMIN_USER = {
  id: 'u1',
  username: 'admin',
  email: null,
  name_en: null,
  name_zh: null,
  is_admin: true,
  must_change_password: false,
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

describe('RequireAuth 導向變更密碼頁並保留原路徑（AUT-AC41）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('/admin 需改密碼時導向 /change-password，並保留原路徑', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ ...ADMIN_USER, must_change_password: true }),
      ),
    )

    renderApp(['/admin/reports?x=1'])

    await screen.findByRole('heading', { name: '變更密碼' })

    const probe = screen.getByTestId('location-probe').textContent ?? ''
    expect(probe).toContain('/change-password')
    expect(probe).toContain('/admin/reports?x=1')
  })

  it('/field 需改密碼時導向 /change-password，並保留原路徑', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ ...ADMIN_USER, must_change_password: true }),
      ),
    )

    renderApp(['/field/tasks'])

    await screen.findByRole('heading', { name: '變更密碼' })

    const probe = screen.getByTestId('location-probe').textContent ?? ''
    expect(probe).toContain('/change-password')
    expect(probe).toContain('/field/tasks')
  })

  it.each([
    ['/admin/reports', 'Admin'],
    ['/field/tasks', 'Field'],
  ])('%s 變更密碼成功後回到原本的路徑', async (path, heading) => {
    let mustChangePassword = true

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input)
        const method = init?.method ?? 'GET'

        if (url.endsWith('/api/v1/auth/me')) {
          return jsonResponse({
            ...ADMIN_USER,
            must_change_password: mustChangePassword,
          })
        }
        if (url.endsWith('/api/v1/auth/password') && method === 'POST') {
          mustChangePassword = false
          return new Response(null, { status: 204 })
        }

        throw new Error(`unexpected fetch: ${method} ${url}`)
      }),
    )

    renderApp([path])

    await screen.findByRole('heading', { name: '變更密碼' })

    fireEvent.change(screen.getByLabelText('目前密碼'), {
      target: { value: 'old-temp-password' },
    })
    fireEvent.change(screen.getByLabelText('新密碼'), {
      target: { value: 'new-password-123' },
    })
    fireEvent.change(screen.getByLabelText('再輸入一次新密碼'), {
      target: { value: 'new-password-123' },
    })
    fireEvent.click(screen.getByRole('button', { name: '變更密碼' }))

    await screen.findByRole('heading', { name: heading })

    await waitFor(() => {
      const probe = screen.getByTestId('location-probe').textContent ?? ''
      expect(probe.startsWith(`${path}|`)).toBe(true)
    })
  })
})
