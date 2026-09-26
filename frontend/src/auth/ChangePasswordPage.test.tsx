// 變更密碼頁的頁面行為（AUT-AC42）：兩次新密碼不一致時不呼叫
// API、三個錯誤碼各顯示不同訊息、三個密碼欄位的 type 都是
// password；另外驗證本頁在 `RequireAuth` 內仍可用 `LogoutButton`
// 登出（AUT-R30、AUT-R33）。頁面需要 `RequireAuth` 提供的
// `useCurrentUser` context 才能渲染 `LogoutButton`，因此這裡的
// 替身沿用 `LogoutButton.test.tsx` 的寫法，連同
// `/api/v1/auth/me` 一併模擬。

import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ChangePasswordPage from './ChangePasswordPage'
import RequireAuth from './RequireAuth'

const TEMP_PASSWORD_USER = {
  id: 'u1',
  email: 'user@example.com',
  name_en: 'Test User',
  name_zh: '測試使用者',
  is_admin: false,
  must_change_password: true,
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/change-password']}>
      <Routes>
        <Route path="/login" element={<h1>登入</h1>} />
        <Route
          path="/change-password"
          element={
            <RequireAuth>
              <ChangePasswordPage />
            </RequireAuth>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

async function renderReadyPage() {
  renderPage()
  await screen.findByRole('heading', { name: '變更密碼' })
}

function fillAndSubmit(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('目前密碼'), {
    target: { value: current },
  })
  fireEvent.change(screen.getByLabelText('新密碼'), {
    target: { value: next },
  })
  fireEvent.change(screen.getByLabelText('再輸入一次新密碼'), {
    target: { value: confirm },
  })
  fireEvent.click(screen.getByRole('button', { name: '變更密碼' }))
}

describe('變更密碼頁：不一致、三種錯誤碼、欄位型別（AUT-AC42）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('同一次渲染依序測試不一致、三種錯誤碼與欄位型別', async () => {
    const codesByCall: Array<[number, string]> = [
      [400, 'auth.current_password_incorrect'],
      [422, 'auth.password_invalid'],
      [422, 'auth.password_unchanged'],
    ]
    let postCallCount = 0

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input)
        if (url.endsWith('/api/v1/auth/me')) {
          return jsonResponse(TEMP_PASSWORD_USER)
        }
        if (url.endsWith('/api/v1/auth/password') && init?.method === 'POST') {
          const [status, code] = codesByCall[postCallCount]
          postCallCount += 1
          return jsonResponse({ error: { code } }, status)
        }
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )

    await renderReadyPage()

    expect(screen.getByLabelText('目前密碼')).toHaveAttribute(
      'type',
      'password',
    )
    expect(screen.getByLabelText('新密碼')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('再輸入一次新密碼')).toHaveAttribute(
      'type',
      'password',
    )

    // 第一次：兩次新密碼不一致，不呼叫變更密碼 API。
    fillAndSubmit('current-pw', 'new-password-1', 'new-password-2')
    let alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('兩次輸入的新密碼不一致，請重新輸入。')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(postCallCount).toBe(0)
    const messages = [alert.textContent]

    // 第二次：兩次新密碼一致，API 回 400 目前密碼錯誤。
    fillAndSubmit(
      'wrong-current-password',
      'same-new-password',
      'same-new-password',
    )
    alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('目前密碼錯誤，請再試一次。')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(postCallCount).toBe(1)
    messages.push(alert.textContent)

    // 第三次：API 回 422 新密碼不符規則。
    fillAndSubmit(
      'same-current-password',
      'same-new-password',
      'same-new-password',
    )
    alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('新密碼不符合規則，請重新輸入。')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(postCallCount).toBe(2)
    messages.push(alert.textContent)

    // 第四次：API 回 422 新密碼與目前密碼相同。
    fillAndSubmit(
      'same-current-password',
      'same-new-password',
      'same-new-password',
    )
    alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('新密碼不能與目前密碼相同，請重新輸入。')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(postCallCount).toBe(3)
    messages.push(alert.textContent)

    expect(new Set(messages).size).toBe(messages.length)
  })
})

// 補充：AUT-AC42 只列了上面三個錯誤碼，但 AUT-R34 另外定義外部帳號
// 的 403 permission.denied，且任何呼叫端都可能遇到未登記的錯誤
// 碼；這兩個案例不在 AC42 的條列範圍內，屬本任務「要做的」範圍
// （見 issue #191 工作單），一併驗證避免遺漏。
describe('變更密碼頁：外部帳號與未知錯誤（補充，非 AUT-AC42 條列範圍）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('外部帳號（403 permission.denied）顯示對應訊息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input)
        if (url.endsWith('/api/v1/auth/me')) {
          return jsonResponse(TEMP_PASSWORD_USER)
        }
        return jsonResponse({ error: { code: 'permission.denied' } }, 403)
      }),
    )

    await renderReadyPage()
    fillAndSubmit('current-pw', 'new-password', 'new-password')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('此帳號無法變更密碼，請洽系統管理員。')
  })

  it('未知錯誤碼顯示通用訊息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input)
        if (url.endsWith('/api/v1/auth/me')) {
          return jsonResponse(TEMP_PASSWORD_USER)
        }
        return new Response(null, { status: 500 })
      }),
    )

    await renderReadyPage()
    fillAndSubmit('current-pw', 'new-password', 'new-password')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('變更密碼失敗，請稍後再試。')
  })
})

describe('變更密碼頁可登出（AUT-R30、AUT-R33）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('臨時密碼帳號在本頁按登出，回到 /login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input)
        const method = init?.method ?? 'GET'
        if (url.endsWith('/api/v1/auth/me')) {
          return jsonResponse(TEMP_PASSWORD_USER)
        }
        if (url.endsWith('/api/v1/auth/logout') && method === 'POST') {
          return new Response(null, { status: 204 })
        }
        throw new Error(`unexpected fetch: ${method} ${url}`)
      }),
    )

    await renderReadyPage()

    fireEvent.click(screen.getByRole('button', { name: '登出' }))

    await screen.findByRole('heading', { name: '登入' })
  })
})
