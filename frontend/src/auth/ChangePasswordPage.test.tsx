// 變更密碼頁的頁面行為（AUT-AC42）：兩次新密碼不一致時不呼叫
// API、三個錯誤碼各顯示不同訊息、三個密碼欄位的 type 都是
// password。

import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ChangePasswordPage from './ChangePasswordPage'

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
        <Route path="/change-password" element={<ChangePasswordPage />} />
      </Routes>
    </MemoryRouter>,
  )
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

describe('變更密碼頁：兩次新密碼不一致與欄位型別（AUT-AC42）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('兩次新密碼不同時不呼叫 API，並顯示不一致的訊息', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('兩次新密碼不同時不應呼叫 API')
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()
    fillAndSubmit('current-pw', 'new-password-1', 'new-password-2')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('兩次輸入的新密碼不一致，請重新輸入。')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('三個密碼欄位的 type 都是 password', () => {
    renderPage()

    expect(screen.getByLabelText('目前密碼')).toHaveAttribute(
      'type',
      'password',
    )
    expect(screen.getByLabelText('新密碼')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('再輸入一次新密碼')).toHaveAttribute(
      'type',
      'password',
    )
  })
})

describe('變更密碼頁：三個錯誤碼各顯示不同訊息（AUT-AC42）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['auth.current_password_incorrect', 400, '目前密碼錯誤，請再試一次。'],
    ['auth.password_invalid', 422, '新密碼不符合規則，請重新輸入。'],
    ['auth.password_unchanged', 422, '新密碼不能與目前密碼相同，請重新輸入。'],
  ])('錯誤碼 %s 顯示對應訊息', async (code, status, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input)
        if (url.endsWith('/api/v1/auth/password') && init?.method === 'POST') {
          return jsonResponse({ error: { code } }, status)
        }
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )

    renderPage()
    fillAndSubmit(
      'wrong-current-password',
      'same-new-password',
      'same-new-password',
    )

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(message)
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
      vi.fn(async () =>
        jsonResponse({ error: { code: 'permission.denied' } }, 403),
      ),
    )

    renderPage()
    fillAndSubmit('current-pw', 'new-password', 'new-password')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('此帳號無法變更密碼，請洽系統管理員。')
  })

  it('未知錯誤碼顯示通用訊息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    )

    renderPage()
    fillAndSubmit('current-pw', 'new-password', 'new-password')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('變更密碼失敗，請稍後再試。')
  })
})
