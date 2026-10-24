import { readFileSync } from 'node:fs'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataMemoryRouter } from '../testing/DataMemoryRouter'
import { currentUserFixture } from '../testing/contractFixtures'
import { deferred } from '../testing/submitGuard'
import { login } from './api'
import { APPEARANCE_CACHE_KEY, type Appearance } from './appearance'
import AppearanceSettings from './AppearanceSettings'
import ChangePasswordPage from './ChangePasswordPage'
import { CurrentUserProvider } from './useCurrentUser'

function accountView(appearance: Appearance, id = 'person-a') {
  return (
    <CurrentUserProvider
      value={{
        user: currentUserFixture({ id, appearance }),
        clear: vi.fn(),
      }}
    >
      <AppearanceSettings />
    </CurrentUserProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('AUT-R55 三態外觀', () => {
  it('以帳號值覆蓋快取，提供預設、淺色、深色三態', () => {
    localStorage.setItem(APPEARANCE_CACHE_KEY, 'dark')
    render(accountView('system'))
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByLabelText('跟隨裝置（預設）')).toBeChecked()
    expect(document.documentElement).toHaveAttribute('data-theme', 'system')
    expect(localStorage.getItem(APPEARANCE_CACHE_KEY)).toBe('system')
  })

  it('立即預覽三態，成功後快取與帳號保存值一致', async () => {
    const fetchMock = vi.fn(async (_input, init?: RequestInit) =>
      Response.json(JSON.parse(String(init?.body))),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(accountView('system'))
    for (const [value, label] of [
      ['light', '淺色'],
      ['dark', '深色'],
      ['system', '跟隨裝置（預設）'],
    ]) {
      fireEvent.click(screen.getByLabelText(label))
      expect(document.documentElement).toHaveAttribute('data-theme', value)
      await screen.findByText('外觀已儲存。')
      expect(screen.getByLabelText(label)).toBeChecked()
      expect(localStorage.getItem(APPEARANCE_CACHE_KEY)).toBe(value)
      expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/auth/me', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appearance: value }),
      })
    }
  })

  it('保存失敗會回復原選項、主題與快取，並可重新選擇重試', async () => {
    const pending = deferred<Response>()
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(Response.json({ appearance: 'light' }))
    vi.stubGlobal('fetch', fetchMock)
    render(accountView('dark'))
    fireEvent.click(screen.getByLabelText('淺色'))
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(screen.getByLabelText('深色')).toBeEnabled()
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-busy', 'true')
    pending.resolve(Response.json({}, { status: 500 }))
    expect(await screen.findByText(/外觀儲存失敗/)).toHaveTextContent(
      '已回復原設定',
    )
    expect(screen.getByLabelText('深色')).toBeChecked()
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(localStorage.getItem(APPEARANCE_CACHE_KEY)).toBe('dark')
    fireEvent.click(screen.getByLabelText('淺色'))
    await screen.findByText('外觀已儲存。')
    expect(screen.queryByText(/外觀儲存失敗/)).toBeNull()
  })

  it('方向鍵連續切換時保存中的選擇會忽略，焦點與選取保持一致', async () => {
    const keyboard = userEvent.setup()
    const pending = deferred<Response>()
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(Response.json({ appearance: 'dark' }))
    vi.stubGlobal('fetch', fetchMock)
    render(accountView('system'))
    const initial = screen.getByLabelText('跟隨裝置（預設）')
    const light = screen.getByLabelText('淺色')
    const dark = screen.getByLabelText('深色')
    await keyboard.tab()
    expect(initial).toHaveFocus()
    await keyboard.keyboard('{ArrowRight}')
    expect(light).toBeChecked()
    expect(light).toHaveFocus()
    await keyboard.keyboard('{ArrowRight}{ArrowRight}')
    expect(light).toBeChecked()
    expect(light).toHaveFocus()
    expect(dark).not.toBeChecked()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    pending.resolve(Response.json({ appearance: 'light' }))
    await screen.findByText('外觀已儲存。')
    expect(light).toHaveFocus()
    await keyboard.keyboard('{ArrowRight}')
    await waitFor(() => expect(dark).toBeChecked())
    expect(dark).toHaveFocus()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('常駐 polite 容器在保存中、成功與失敗都只更新文字', async () => {
    const keyboard = userEvent.setup()
    const pending = deferred<Response>()
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(Response.json({}, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    const view = render(accountView('system'))
    const live = view.container.querySelector('[aria-live="polite"]')!
    expect(live).toBeEmptyDOMElement()
    expect(live).toHaveAttribute('aria-atomic', 'true')
    await keyboard.click(screen.getByLabelText('淺色'))
    expect(live).toHaveTextContent('正在儲存外觀…')
    pending.resolve(Response.json({ appearance: 'light' }))
    await waitFor(() => expect(live).toHaveTextContent('外觀已儲存。'))
    await keyboard.click(screen.getByLabelText('深色'))
    await waitFor(() => expect(live).toHaveTextContent('已回復原設定'))
    expect(view.container.querySelector('[aria-live="polite"]')).toBe(live)
    expect(screen.getByLabelText('淺色')).toBeChecked()
    expect(screen.getByLabelText('淺色')).toHaveFocus()
    expect(screen.getByRole('group', { name: '外觀' })).toHaveClass(
      'form-pattern-group',
    )
  })

  it('快取不可寫也仍能套用並保存帳號偏好', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ appearance: 'light' })),
    )
    render(accountView('dark'))
    fireEvent.click(screen.getByLabelText('淺色'))
    await screen.findByText('外觀已儲存。')
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })

  it('換帳號後以前一帳號的晚到失敗回應也不能覆蓋新主題', async () => {
    const pending = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => pending.promise),
    )
    const view = render(accountView('dark'))
    fireEvent.click(screen.getByLabelText('淺色'))
    view.rerender(accountView('system', 'person-b'))
    pending.resolve(Response.json({}, { status: 500 }))
    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute('data-theme', 'system'),
    )
    expect(screen.getByLabelText('跟隨裝置（預設）')).toBeChecked()
    expect(localStorage.getItem(APPEARANCE_CACHE_KEY)).toBe('system')
  })

  it('同帳號取得新伺服器偏好時同步主題', () => {
    const view = render(accountView('dark'))
    view.rerender(accountView('light'))
    expect(screen.getByLabelText('淺色')).toBeChecked()
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })

  it('新帳號登入回應優先於前一帳號的深色快取', async () => {
    localStorage.setItem(APPEARANCE_CACHE_KEY, 'dark')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          currentUserFixture({ appearance: 'light', id: 'new-user' }),
        ),
      ),
    )
    await login('new-user', 'password')
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(localStorage.getItem(APPEARANCE_CACHE_KEY)).toBe('light')
  })

  it('強制變更密碼時不新增外觀操作，密碼表單仍可用', () => {
    render(
      <DataMemoryRouter initialEntries={['/settings']}>
        <CurrentUserProvider
          value={{
            user: currentUserFixture({
              must_change_password: true,
              appearance: 'dark',
            }),
            clear: vi.fn(),
          }}
        >
          <ChangePasswordPage />
        </CurrentUserProvider>
      </DataMemoryRouter>,
    )
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.getByLabelText('目前密碼')).toBeVisible()
  })
})

describe('UDS-AC08 首次繪製快取', () => {
  const html = readFileSync('index.html', 'utf8')
  const inline = html.match(/<script>([\s\S]*?)<\/script>/)![1]

  it.each(['system', 'light', 'dark', null, 'sepia'])(
    '在載入應用程式前安全套用 %s',
    (value) => {
      const storage = { getItem: vi.fn(() => value) }
      new Function('localStorage', 'document', inline)(storage, document)
      expect(document.documentElement.dataset.theme).toBe(
        value === 'light' || value === 'dark' ? value : 'system',
      )
      expect(storage.getItem).toHaveBeenCalledWith(APPEARANCE_CACHE_KEY)
      expect(html.indexOf('<script>')).toBeLessThan(
        html.indexOf('src="/src/main.tsx"'),
      )
    },
  )

  it('快取不可讀時跟隨裝置，不阻擋啟動', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked')
      },
    }
    new Function('localStorage', 'document', inline)(storage, document)
    expect(document.documentElement).toHaveAttribute('data-theme', 'system')
  })
})
