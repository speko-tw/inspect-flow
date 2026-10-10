import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '../App'
import LoginPage from '../auth/LoginPage'
import SetupGate from './SetupGate'
import SetupPage from './SetupPage'
import { deferred, expectImeEnterIgnored } from '../testing/submitGuard'

const INVALID_CODE_MESSAGE =
  '首次登入碼不正確或已失效，請確認後再試；需要新的碼時，' +
  '請在伺服器重新執行 make init。'
const VALID_PASSWORD = 'correct horse battery'

const CREATED_USER = {
  id: 'user-1',
  username: 'anna.deng',
  email: 'anna.deng@demo.example',
  name_zh: '鄧安娜',
  name_en: null,
  company_id: null,
  department: null,
  location: null,
  employee_no: null,
  extension_1: null,
  extension_2: null,
  mobile: null,
  line_id: null,
  wechat_id: null,
  responsibilities: null,
  auth_source: 'local',
  is_active: true,
  is_admin: false,
  is_system: false,
  temporary_password: 'Tmp-PassW0rd-123',
}

/** 以完整標籤文字找步驟列的項目（標籤內部是分段的詞組）。 */
function stepItem(steps: HTMLElement, label: string): HTMLElement {
  const item = within(steps)
    .getAllByRole('listitem')
    .find((li) => li.querySelector('.steps-label')?.textContent === label)
  if (item === undefined) {
    throw new Error(`找不到步驟：${label}`)
  }
  return item
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

interface Backend {
  setupRequired: boolean
  passwordResponse: () => Response | Promise<Response>
  calls: Array<{ method: string; url: string; body?: unknown }>
}

function stubBackend(overrides: Partial<Backend> = {}): Backend {
  const backend: Backend = {
    setupRequired: true,
    passwordResponse: () => new Response(null, { status: 204 }),
    calls: [],
    ...overrides,
  }

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      const method = init?.method ?? 'GET'
      const body =
        typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      backend.calls.push({ method, url, body })

      if (url.endsWith('/api/v1/setup/status')) {
        return jsonResponse({ setup_required: backend.setupRequired })
      }
      if (url.endsWith('/api/v1/setup/admin-password')) {
        const response = await backend.passwordResponse()
        if (response.ok) {
          // 設定成功後後端的狀態會變成 false。
          backend.setupRequired = false
        }
        return response
      }
      if (url.endsWith('/api/v1/companies')) {
        return jsonResponse({ items: [], next_cursor: null })
      }
      if (url.startsWith('/api/v1/companies?')) {
        return jsonResponse({ items: [], next_cursor: null })
      }
      if (url.endsWith('/api/v1/users') && method === 'POST') {
        return jsonResponse(CREATED_USER, 201)
      }
      throw new Error(`unexpected fetch: ${method} ${url}`)
    }),
  )

  return backend
}

function renderApp(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/"
          element={
            <SetupGate>
              <h1>首頁</h1>
            </SetupGate>
          }
        />
        <Route
          path="/login"
          element={
            <SetupGate>
              <LoginPage />
            </SetupGate>
          }
        />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/admin" element={<h1>管理頁</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

function fillCode(code: string) {
  fireEvent.change(screen.getByLabelText('首次登入碼'), {
    target: { value: code },
  })
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
}

/** 走完步驟 1（輸入碼）與步驟 2（設定密碼並送出）。 */
function fillPassword(
  code: string,
  password: string,
  confirmation = password,
) {
  fillCode(code)
  fireEvent.change(screen.getByLabelText('新密碼'), {
    target: { value: password },
  })
  fireEvent.change(screen.getByLabelText('再次輸入新密碼'), {
    target: { value: confirmation },
  })
  fireEvent.click(screen.getByRole('button', { name: '設定密碼' }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe.each([
  ['首次設定碼步驟', 'setup-code'],
  ['首次設定密碼步驟', 'setup-password'],
])('%s 共用表單', (_name, step) => {
  it('同步驗證後可前往下一步；防重送不適用', async () => {
    const backend = stubBackend()
    renderApp('/setup')
    await screen.findByLabelText('首次登入碼')

    if (step === 'setup-code') {
      const input = screen.getByLabelText('首次登入碼')
      fireEvent.change(input, { target: { value: 'code-123' } })
      expectImeEnterIgnored(input)
      expect(screen.getByLabelText('首次登入碼')).toBeInTheDocument()
      expect(
        backend.calls.filter((call) => call.method === 'POST'),
      ).toHaveLength(0)

      const form = screen
        .getByRole('button', { name: '下一步' })
        .closest('form')!
      fireEvent.submit(form)
      expect(await screen.findByLabelText('新密碼')).toBeInTheDocument()
      expect(
        backend.calls.filter((call) => call.method === 'POST'),
      ).toHaveLength(0)
      return
    }

    fillCode('code-123')
    const gate = deferred<Response>()
    backend.passwordResponse = () => gate.promise
    fireEvent.change(screen.getByLabelText('新密碼'), {
      target: { value: VALID_PASSWORD },
    })
    fireEvent.change(screen.getByLabelText('再次輸入新密碼'), {
      target: { value: VALID_PASSWORD },
    })
    const button = screen.getByRole('button', { name: '設定密碼' })
    const form = button.closest('form')!
    fireEvent.click(button)
    fireEvent.submit(form)
    expect(button).toBeDisabled()
    expect(
      backend.calls.filter((call) =>
        call.url.endsWith('/api/v1/setup/admin-password'),
      ),
    ).toHaveLength(1)
    gate.resolve(new Response(null, { status: 500 }))
    await screen.findByRole('alert')
  })

  if (step === 'setup-password') {
    it('IME Enter 不送出首次設定密碼 API', async () => {
      const backend = stubBackend()
      renderApp('/setup')
      await screen.findByLabelText('首次登入碼')
      fillCode('code-123')
      const input = screen.getByLabelText('新密碼')
      expectImeEnterIgnored(input)
      expect(
        backend.calls.filter((call) =>
          call.url.endsWith('/api/v1/setup/admin-password'),
        ),
      ).toHaveLength(0)
    })

    it('API 失敗後可再次送出首次設定密碼', async () => {
      const backend = stubBackend()
      let fail = true
      backend.passwordResponse = () =>
        fail
          ? new Response(null, { status: 500 })
          : new Response(null, { status: 204 })
      renderApp('/setup')
      await screen.findByLabelText('首次登入碼')
      fillCode('code-123')
      fireEvent.change(screen.getByLabelText('新密碼'), {
        target: { value: VALID_PASSWORD },
      })
      fireEvent.change(screen.getByLabelText('再次輸入新密碼'), {
        target: { value: VALID_PASSWORD },
      })
      const button = screen.getByRole('button', { name: '設定密碼' })
      fireEvent.click(button)
      await screen.findByRole('alert')
      fail = false
      fireEvent.click(button)
      await waitFor(() =>
        expect(
          backend.calls.filter((call) =>
            call.url.endsWith('/api/v1/setup/admin-password'),
          ),
        ).toHaveLength(2),
      )
    })
  }
})

describe('尚未首次設定時的導向（AUT-AC65）', () => {
  it('setup_required 為 true 時，/ 導向首次設定頁', async () => {
    stubBackend()
    renderApp('/')

    expect(
      await screen.findByRole('heading', { name: '首次設定' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '首頁' })).toBeNull()
  })

  it('正式路由（App）在 setup_required 為 true 時導向首次設定頁', async () => {
    stubBackend()
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: '首次設定' }),
    ).toBeInTheDocument()
  })

  it('setup_required 為 true 時，/login 導向首次設定頁', async () => {
    stubBackend()
    renderApp('/login')

    expect(
      await screen.findByRole('heading', { name: '首次設定' }),
    ).toBeInTheDocument()
  })

  it('setup_required 為 false 時，/ 與 /login 維持原畫面', async () => {
    stubBackend({ setupRequired: false })
    renderApp('/login')

    expect(
      await screen.findByRole('heading', { name: '登入' }),
    ).toBeInTheDocument()
  })

  it('setup_required 為 false 時，首次設定頁不可進入並導向登入頁', async () => {
    stubBackend({ setupRequired: false })
    renderApp('/setup')

    expect(
      await screen.findByRole('heading', { name: '登入' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('首次登入碼')).toBeNull()
  })

  it('狀態端點失敗時，/login 不被擋住', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    )
    renderApp('/login')

    expect(
      await screen.findByRole('heading', { name: '登入' }),
    ).toBeInTheDocument()
  })

  it('狀態端點失敗時，首次設定頁顯示錯誤而不是表單', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    )
    renderApp('/setup')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法確認系統狀態，請稍後再試。',
    )
    expect(screen.queryByLabelText('首次登入碼')).toBeNull()
  })
})

describe('首次設定：碼與密碼（AUT-R29、AUT-R44）', () => {
  it('不同失敗的 401 都只顯示同一則通用訊息並回到步驟 1', async () => {
    const backend = stubBackend({
      passwordResponse: () =>
        jsonResponse({ error: { code: 'setup.invalid_code' } }, 401),
    })
    renderApp('/setup')
    await screen.findByLabelText('首次登入碼')

    fillPassword('wrong-code', VALID_PASSWORD)
    const first = await screen.findByRole('alert')
    expect(first.textContent).toBe(INVALID_CODE_MESSAGE)
    // 回到步驟 1，碼欄位已清空，可重新輸入。
    expect(screen.getByLabelText('首次登入碼')).toHaveValue('')

    // 沒有 code 的 401（例如被鎖定時的任何回應）也是同一則訊息。
    backend.passwordResponse = () => new Response(null, { status: 401 })
    fillPassword('another-wrong-code', VALID_PASSWORD)
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(INVALID_CODE_MESSAGE)
    })
    expect(screen.queryByRole('heading', { name: '新增使用者' })).toBeNull()
  })

  it('步驟 1 沒有輸入碼時不進入步驟 2', async () => {
    const backend = stubBackend()
    renderApp('/setup')
    await screen.findByLabelText('首次登入碼')

    fireEvent.click(screen.getByRole('button', { name: '下一步' }))

    const error = await screen.findByRole('alert')
    const code = screen.getByLabelText('首次登入碼')
    expect(
      document.querySelector('label[for="setup-code"] .auth-required-marker'),
    ).toBeInTheDocument()
    expect(error.textContent).toBe('請輸入首次登入碼。')
    expect(error).toHaveClass('shared-field-error')
    expect(code).toHaveAttribute('aria-describedby', error.id)
    expect(code).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(code).toHaveFocus())
    expect(screen.queryByLabelText('新密碼')).toBeNull()
    expect(
      backend.calls.some((call) => call.url.endsWith('/admin-password')),
    ).toBe(false)
  })

  it('步驟 2 可以回上一步，且步驟列標示目前位置', async () => {
    stubBackend()
    renderApp('/setup')
    await screen.findByLabelText('首次登入碼')
    const steps = screen.getByRole('list', { name: '設定步驟' })
    expect(steps).toHaveTextContent('首次登入碼')
    expect(steps).toHaveTextContent('設定 admin 密碼')
    expect(steps).toHaveTextContent('新增第一個使用者')
    expect(stepItem(steps, '首次登入碼')).toHaveAttribute(
      'aria-current',
      'step',
    )

    fillCode('code-123')
    expect(stepItem(steps, '設定 admin 密碼')).toHaveAttribute(
      'aria-current',
      'step',
    )

    fireEvent.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByLabelText('首次登入碼')).toHaveValue('code-123')
  })

  it('兩次密碼不一致時不送出', async () => {
    const backend = stubBackend()
    renderApp('/setup')
    await screen.findByLabelText('首次登入碼')

    fillPassword('code-123', VALID_PASSWORD, `${VALID_PASSWORD}x`)

    expect((await screen.findByRole('alert')).textContent).toBe(
      '兩次輸入的密碼不一致。',
    )
    expect(
      backend.calls.some((call) => call.url.endsWith('/admin-password')),
    ).toBe(false)
  })

  it('密碼少於 8 個字元時不送出', async () => {
    const backend = stubBackend()
    renderApp('/setup')
    await screen.findByLabelText('首次登入碼')

    fillPassword('code-123', '1234567')

    const error = await screen.findByRole('alert')
    const password = screen.getByLabelText('新密碼')
    expect(
      document.querySelector(
        'label[for="setup-password"] .auth-required-marker',
      ),
    ).toBeInTheDocument()
    expect(
      document.querySelector(
        'label[for="setup-password-confirm"] .auth-required-marker',
      ),
    ).toBeInTheDocument()
    expect(error.textContent).toBe('密碼長度必須介於 8 到 128 個字元。')
    expect(error).toHaveClass('shared-field-error')
    expect(password).toHaveAttribute('aria-describedby', error.id)
    await waitFor(() => expect(password).toHaveFocus())
    expect(
      backend.calls.some((call) => call.url.endsWith('/admin-password')),
    ).toBe(false)
  })

  it('密碼長度以字元計算：8 個中文字可以送出', async () => {
    const backend = stubBackend()
    renderApp('/setup')
    await screen.findByLabelText('首次登入碼')

    fillPassword('code-123', '一二三四五六七八')

    await screen.findByRole('heading', { name: '新增使用者' })
    expect(
      backend.calls.some((call) => call.url.endsWith('/admin-password')),
    ).toBe(true)
  })

  it('後端回 422 時顯示密碼長度訊息', async () => {
    stubBackend({
      passwordResponse: () =>
        jsonResponse({ error: { code: 'auth.password_invalid' } }, 422),
    })
    renderApp('/setup')
    await screen.findByLabelText('首次登入碼')

    fillPassword('code-123', VALID_PASSWORD)

    expect((await screen.findByRole('alert')).textContent).toBe(
      '密碼長度必須介於 8 到 128 個字元。',
    )
  })

  it('已完成設定（409）時顯示訊息與登入連結', async () => {
    stubBackend({
      passwordResponse: () =>
        jsonResponse({ error: { code: 'setup.already_completed' } }, 409),
    })
    renderApp('/setup')
    await screen.findByLabelText('首次登入碼')

    fillPassword('code-123', VALID_PASSWORD)

    const error = await screen.findByRole('alert')
    expect(error.textContent).toBe('首次設定已經完成，請改用登入頁登入。')
    const loginLink = screen.getByRole('link', { name: '前往登入頁' })
    expect(loginLink).toHaveAttribute('href', '/login')

    fireEvent.change(screen.getByLabelText('新密碼'), {
      target: { value: `${VALID_PASSWORD}x` },
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('link', { name: '前往登入頁' })).toBeNull()
  })

  it('網路錯誤時顯示連線訊息', async () => {
    const backend = stubBackend()
    renderApp('/setup')
    await screen.findByLabelText('首次登入碼')

    backend.passwordResponse = () => {
      throw new TypeError('network down')
    }
    fillPassword('code-123', VALID_PASSWORD)

    expect((await screen.findByRole('alert')).textContent).toBe(
      '無法連線到伺服器，請稍後再試。',
    )
  })

  it('密碼欄位的 type 為 password 且不自動填入舊密碼', async () => {
    stubBackend()
    renderApp('/setup')
    await screen.findByLabelText('首次登入碼')
    fillCode('code-123')

    for (const label of ['新密碼', '再次輸入新密碼']) {
      const input = screen.getByLabelText(label)
      expect(input).toHaveAttribute('type', 'password')
      expect(input).toHaveAttribute('autocomplete', 'new-password')
    }
  })
})

describe('首次設定第 1 步說明文字（#284 第 8 項）', () => {
  it('說明文字簡短成一句，避免折行後只剩「碼。」孤字', async () => {
    stubBackend()
    renderApp('/setup')
    await screen.findByLabelText('首次登入碼')

    const lead = screen.getByText('請輸入 make init 印出的首次登入碼。')
    expect(lead).toBeInTheDocument()
    // jsdom 不排版，無法直接驗證折行；用長度當代理：一句 24 字內
    // 在卡片寬度內不會折行（實際畫面由負責人複驗）。
    expect((lead.textContent ?? '').length).toBeLessThanOrEqual(24)
  })
})

describe('首次設定第 3 步完成畫面的臨時密碼（#284 第 7 項）', () => {
  it('臨時密碼旁有「複製」按鈕', async () => {
    stubBackend()
    renderApp('/setup')
    await screen.findByLabelText('首次登入碼')
    fillPassword('code-123', VALID_PASSWORD)
    await screen.findByRole('heading', { name: '新增使用者' })
    fireEvent.change(screen.getByLabelText(/^帳號名稱/), {
      target: { value: 'anna.deng' },
    })
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'anna.deng@demo.example' },
    })
    fireEvent.change(screen.getByLabelText(/^中文姓名/), {
      target: { value: '鄧安娜' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增使用者' }))

    await screen.findByLabelText('臨時密碼')
    expect(screen.getByRole('button', { name: '複製' })).toBeInTheDocument()
  })
})

describe('首次設定：設定密碼後新增第一個使用者（AUT-AC65）', () => {
  it('設定成功後進入新增使用者步驟，送出後顯示一次臨時密碼', async () => {
    const backend = stubBackend()
    renderApp('/setup')
    await screen.findByLabelText('首次登入碼')

    fillPassword(' code-123 ', VALID_PASSWORD)

    // 設定成功後狀態變 false，流程不可被導走。
    await screen.findByRole('heading', { name: '新增使用者' })
    const passwordCall = backend.calls.find((call) =>
      call.url.endsWith('/admin-password'),
    )
    expect(passwordCall?.body).toEqual({
      code: 'code-123',
      password: VALID_PASSWORD,
    })
    expect(screen.getByLabelText('指派系統管理者權限')).not.toBeChecked()

    fireEvent.change(screen.getByLabelText(/^帳號名稱/), {
      target: { value: 'anna.deng' },
    })
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'anna.deng@demo.example' },
    })
    fireEvent.change(screen.getByLabelText(/^中文姓名/), {
      target: { value: '鄧安娜' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增使用者' }))

    expect(await screen.findByLabelText('臨時密碼')).toHaveTextContent(
      'Tmp-PassW0rd-123',
    )
    const createCall = backend.calls.find(
      (call) => call.url.endsWith('/api/v1/users') && call.method === 'POST',
    )
    expect(createCall?.body).toMatchObject({
      username: 'anna.deng',
      is_admin: false,
    })

    fireEvent.click(screen.getByRole('link', { name: '已抄下，進入管理頁' }))
    expect(
      await screen.findByRole('heading', { name: '管理頁' }),
    ).toBeInTheDocument()
  })

  it('可以略過新增使用者直接進入管理頁', async () => {
    stubBackend()
    renderApp('/setup')
    await screen.findByLabelText('首次登入碼')

    fillPassword('code-123', VALID_PASSWORD)
    await screen.findByRole('heading', { name: '新增使用者' })

    fireEvent.click(screen.getByRole('link', { name: '略過，進入管理頁' }))
    expect(
      await screen.findByRole('heading', { name: '管理頁' }),
    ).toBeInTheDocument()
  })

  it('新增使用者失敗時沿用管理頁的錯誤訊息並留在原步驟', async () => {
    const backend = stubBackend()
    renderApp('/setup')
    await screen.findByLabelText('首次登入碼')
    fillPassword('code-123', VALID_PASSWORD)
    await screen.findByRole('heading', { name: '新增使用者' })

    const original = globalThis.fetch
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (
          requestUrl(input).endsWith('/api/v1/users') &&
          init?.method === 'POST'
        ) {
          return jsonResponse(
            { error: { code: 'user.username_conflict' } },
            409,
          )
        }
        return original(input, init)
      }),
    )

    fireEvent.change(screen.getByLabelText(/^帳號名稱/), {
      target: { value: 'anna.deng' },
    })
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'anna.deng@demo.example' },
    })
    fireEvent.change(screen.getByLabelText(/^中文姓名/), {
      target: { value: '鄧安娜' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增使用者' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '帳號名稱已被使用。',
    )
    expect(backend.setupRequired).toBe(false)
    expect(screen.queryByLabelText('臨時密碼')).toBeNull()
  })
})

describe('首次登入碼表單轉換', () => {
  it('首次登入碼的表單是同步換頁，重複送出沒有副作用（不適用防連點）', async () => {
    stubBackend()
    renderApp('/setup')
    const code = await screen.findByLabelText('首次登入碼')
    fireEvent.change(code, { target: { value: 'code-123' } })
    const form = code.closest('form') as HTMLFormElement

    fireEvent.submit(form)

    expect(screen.getByLabelText('新密碼')).toBeInTheDocument()
  })
})
