import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router'
import { Link } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CurrentUserProvider } from '../../auth/useCurrentUser'
import { currentUserFixture } from '../../testing/contractFixtures'
import EvidenceSection from './EvidenceSection'
import { LEAVE_MESSAGE } from './LeaveGuard'
import {
  COVERAGE,
  OVERVIEW,
  jpegWithExif,
  photo,
  uploadedPhoto,
} from './testFixtures'
import type { Coverage, FieldPhoto } from './types'

vi.mock('./imageEdit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./imageEdit')>()),
  // jsdom 不會解碼影像；用 4000×3000 的假來源驗證壓縮尺寸。
  loadImageSource: vi.fn(async () => ({
    image: {} as CanvasImageSource,
    width: 4000,
    height: 3000,
    release: vi.fn(),
  })),
}))

interface CanvasCalls {
  toBlob: Array<{
    width: number
    height: number
    type?: string
    quality?: number
  }>
  puts: Uint8ClampedArray[]
  texts: string[]
}

/** jsdom 沒有畫布；用記錄呼叫的假 2D context 驗證輸出參數。 */
function stubCanvas(): CanvasCalls {
  const calls: CanvasCalls = { toBlob: [], puts: [], texts: [] }
  const context = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    strokeText: vi.fn(),
    fillText: vi.fn((text: string) => calls.texts.push(text)),
    measureText: (text: string) => ({ width: text.length * 14 }),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    getImageData: () => ({
      data: new Uint8ClampedArray([100, 100, 100, 255]),
    }),
    putImageData: (image: { data: Uint8ClampedArray }) =>
      calls.puts.push(image.data),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (() => context) as never,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
    quality?: number,
  ) {
    calls.toBlob.push({
      width: this.width,
      height: this.height,
      type,
      quality,
    })
    callback(new Blob(['jpeg-bytes'], { type: 'image/jpeg' }))
  })
  return calls
}

interface Server {
  coverage: Coverage
  photos: FieldPhoto[]
  /** 回傳 Response 或丟錯；第 n 次（從 0 起）POST 呼叫。 */
  post: (attempt: number) => Response | Promise<Response>
}

/** 假的照片 API：依路徑回覆，並記錄每次 POST 的表單與標頭。 */
function stubApi(server: Server) {
  const posts: Array<{ form: FormData; key: string | null }> = []
  const requests: Array<{ method: string; url: string; body: unknown }> = []
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      requests.push({ method, url, body: init?.body })
      if (method === 'POST') {
        posts.push({
          form: init?.body as FormData,
          key: new Headers(init?.headers).get('Idempotency-Key'),
        })
        return server.post(posts.length - 1)
      }
      if (method === 'PATCH') return Response.json(photo())
      if (method === 'DELETE') return new Response(null, { status: 204 })
      if (url.includes('/evidence')) return Response.json(server.coverage)
      return Response.json({ items: server.photos, next_cursor: null })
    },
  )
  vi.stubGlobal('fetch', fetcher)
  return { fetcher, posts, requests }
}

const created = () =>
  Response.json(uploadedPhoto({ id: 'photo-new' }), { status: 201 })
const offline = () => {
  throw new TypeError('Failed to fetch')
}

function renderSection(
  props: Partial<Parameters<typeof EvidenceSection>[0]> = {},
) {
  return render(
    <CurrentUserProvider
      value={{
        user: currentUserFixture({
          has_field_access: true,
          name_zh: '張先生',
        }),
        clear: vi.fn(),
      }}
    >
      <MemoryRouter>
        <EvidenceSection
          location={{ zone_name: '一樓', location_text: '東側' }}
          projectName="示範工程甲"
          status="IN_PROGRESS"
          taskId="task-1"
          {...props}
        />
      </MemoryRouter>
    </CurrentUserProvider>,
  )
}

const cameraInput = () =>
  screen.getByLabelText('使用相機拍照', { selector: 'input' })
const libraryInput = () =>
  screen.getByLabelText('從相簿選照片', { selector: 'input' })

async function choose(
  buttonName: string,
  input: () => HTMLElement = cameraInput,
  file = new File(['raw'], 'IMG_0001.jpg', { type: 'image/jpeg' }),
) {
  fireEvent.click(await screen.findByRole('button', { name: buttonName }))
  fireEvent.change(input(), { target: { files: [file] } })
  await screen.findByRole('heading', { name: '編修現場照片' })
}

async function confirmEdit() {
  fireEvent.click(screen.getByRole('button', { name: '確認' }))
  await screen.findByRole('heading', { name: '選擇佐證項次與註記' })
}

let urlCount = 0

beforeEach(() => {
  urlCount = 0
  URL.createObjectURL = vi.fn(() => `blob:mock-${urlCount++}`)
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const defaultServer = (overrides: Partial<Server> = {}): Server => ({
  coverage: COVERAGE,
  photos: [],
  post: created,
  ...overrides,
})

describe('照片區顯示', () => {
  it('依項次顯示已有幾張、還缺幾張與拍照入口，不顯示識別碼', async () => {
    stubApi(defaultServer())
    const { container } = renderSection()
    const first = await screen.findByRole('group', { name: '1. 鋼筋間距' })
    expect(first).toHaveTextContent('尚需補拍 1 張')
    expect(first).toHaveTextContent('已有 0／需要 1 張')
    expect(
      screen.getByRole('group', { name: '2. 續接器鎖固' }),
    ).toHaveTextContent('已有 1／需要 2 張')
    expect(
      screen.getByRole('button', { name: '拍總覽照（選拍），鋼筋工程' }),
    ).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/item-a|point-1|[0-9a-f]{64}/)
  })

  it('相機與相簿是兩個入口：只有相機帶 capture', async () => {
    stubApi(defaultServer())
    renderSection()
    await screen.findByRole('group', { name: '1. 鋼筋間距' })
    expect(cameraInput()).toHaveAttribute('capture')
    expect(cameraInput()).toHaveAttribute('accept', 'image/*')
    expect(libraryInput()).not.toHaveAttribute('capture')
    expect(libraryInput()).toHaveAttribute('accept', 'image/*')
  })

  it('全部項次達標時顯示齊全提示', async () => {
    stubApi(
      defaultServer({ coverage: { ...COVERAGE, all_points_satisfied: true } }),
    )
    renderSection()
    expect(
      await screen.findByText('✓ 每個項次都已有足夠的照片。'),
    ).toBeInTheDocument()
  })

  it('任務未開始不讀照片 API、不顯示拍照', () => {
    const { fetcher } = stubApi(defaultServer())
    renderSection({ status: 'PENDING' })
    expect(
      screen.getByText('開始查核後，才能依項次拍照上傳。'),
    ).toBeInTheDocument()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('完成後唯讀：看得到照片，沒有拍照與修改入口', async () => {
    stubApi(defaultServer({ photos: [photo()] }))
    stubCanvas()
    renderSection({ status: 'COMPLETED' })
    expect(await screen.findByText('接頭近照')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /拍照/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /修改說明/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /刪除照片/ })).toBeNull()
  })

  it('封存時即使修改能力已開通，仍保留讀取並停用寫入', async () => {
    const { requests } = stubApi(defaultServer({ photos: [photo()] }))
    renderSection({ planArchived: true })
    expect(await screen.findByText('接頭近照')).toBeVisible()
    expect(
      screen.getByRole('group', { name: '1. 鋼筋間距' }),
    ).toHaveTextContent('已有 0／需要 1 張')
    expect(
      screen.queryByRole('button', { name: /^拍照|^從相簿選|^拍總覽/ }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: /修改說明|刪除照片/ }),
    ).toBeNull()
    expect(cameraInput()).toBeDisabled()
    expect(libraryInput()).toBeDisabled()
    fireEvent.change(cameraInput(), {
      target: { files: [new File(['raw'], 'photo.jpg')] },
    })
    expect(screen.queryByRole('heading', { name: '編修現場照片' })).toBeNull()
    expect(requests.every((request) => request.method === 'GET')).toBe(true)
  })

  it('載入失敗顯示說明與重試，不丟出例外', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: { code: 'x' } }, { status: 500 }),
      ),
    )
    renderSection()
    expect(
      await screen.findByText('無法載入照片資料，請稍後再試。'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重試' })).toBeEnabled()
  })
})

describe('拍照、編修與上傳（FEV-AC03）', () => {
  it('旋轉與亮度烘進壓縮後的現場版；上傳欄位正確，原圖不傳', async () => {
    const calls = stubCanvas()
    const { posts } = stubApi(defaultServer())
    renderSection()
    await choose('拍照，1. 鋼筋間距')
    // 現場編修只有旋轉、亮度、比較與圖層開關／四角。
    expect(
      screen.queryByRole('button', { name: /裁切|對比|標註|拉直|比例/ }),
    ).toBeNull()
    expect(screen.queryByLabelText(/裁切|對比|標註|拉直|比例/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '旋轉 90°' }))
    fireEvent.change(screen.getByRole('slider'), {
      target: { value: '50' },
    })
    fireEvent.change(screen.getByLabelText('位置'), {
      target: { value: 'top_right' },
    })
    await confirmEdit()
    // 4000×3000 旋轉 90 度後長邊縮到 2560；品質 0.85（FEV-R02、D2）。
    expect(calls.toBlob.at(-1)).toMatchObject({
      width: 1920,
      height: 2560,
      type: 'image/jpeg',
      quality: 0.85,
    })
    // 亮度 +50 的倍率是 1.25，100 變成 125；圖層不烘進像素。
    expect(calls.puts.some((data) => data[0] === 125)).toBe(true)
    expect(screen.getByRole('checkbox', { name: '1. 鋼筋間距' })).toBeChecked()
    fireEvent.change(screen.getByLabelText(/照片註記/), {
      target: { value: '接頭近照' },
    })
    fireEvent.click(screen.getByRole('button', { name: '上傳現場照片' }))
    expect(await screen.findByText('照片已上傳。')).toBeInTheDocument()

    expect(posts).toHaveLength(1)
    const { form, key } = posts[0]
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    expect(form.get('item_id')).toBe('item-a')
    expect(form.getAll('point_ids')).toEqual(['point-1'])
    expect(form.get('is_overview')).toBe('false')
    expect(form.get('caption')).toBe('接頭近照')
    expect(form.get('capture_source')).toBe('camera')
    expect(form.get('sha256')).toMatch(/^[0-9a-f]{64}$/)
    expect(form.get('captured_at')).toBeNull()
    expect(JSON.parse(String(form.get('field_edit')))).toEqual({
      rotation: 90,
      brightness: 50,
    })
    expect(JSON.parse(String(form.get('layer')))).toEqual({
      enabled: true,
      corner: 'top_right',
    })
    const file = form.get('file') as File
    expect(file.type).toBe('image/jpeg')
    expect(file.size).toBe('jpeg-bytes'.length)
  })

  it('從相簿選：capture_source 為 library，帶原檔 EXIF 的拍攝時間', async () => {
    stubCanvas()
    const { posts } = stubApi(defaultServer())
    renderSection()
    const exif = jpegWithExif({
      date: '2026:10:31 10:24:00',
      offset: '+08:00',
    })
    await choose(
      '從相簿選，1. 鋼筋間距',
      libraryInput,
      new File([exif], 'a.jpg', { type: 'image/jpeg' }),
    )
    await confirmEdit()
    fireEvent.click(screen.getByRole('button', { name: '上傳現場照片' }))
    await screen.findByText('照片已上傳。')
    const { form } = posts[0]
    expect(form.get('capture_source')).toBe('library')
    expect(form.get('captured_at')).toBe('2026-10-31T02:24:00.000Z')
    // 只送壓縮後的 JPEG，沒有原檔名或 EXIF。
    expect((form.get('file') as File).name).toBe('photo.jpg')
  })

  it('總覽照不帶項次，且不要求選項次', async () => {
    stubCanvas()
    const { posts } = stubApi(defaultServer())
    renderSection()
    await choose('拍總覽照（選拍），鋼筋工程')
    await confirmEdit()
    expect(screen.getByRole('checkbox', { name: /總覽照片/ })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '上傳現場照片' }))
    await screen.findByText('照片已上傳。')
    expect(posts[0].form.get('is_overview')).toBe('true')
    expect(posts[0].form.has('point_ids')).toBe(false)
  })

  it('長按比較顯示編修前，放開返回；亮度可重設', async () => {
    stubCanvas()
    stubApi(defaultServer())
    renderSection()
    await choose('拍照，1. 鋼筋間距')
    const compare = screen.getByRole('button', { name: '按住比較編修前' })
    const capturePointer = vi.fn()
    compare.setPointerCapture = capturePointer
    fireEvent.pointerDown(compare, { pointerId: 7 })
    expect(capturePointer).toHaveBeenCalledOnce()
    expect(screen.getByText('編修前')).toBeInTheDocument()
    fireEvent.pointerUp(compare)
    expect(screen.queryByText('編修前')).toBeNull()
    fireEvent.keyDown(compare, { key: ' ' })
    expect(screen.getByText('編修前')).toBeInTheDocument()
    fireEvent.keyUp(compare, { key: ' ' })
    expect(screen.queryByText('編修前')).toBeNull()

    const reset = screen.getByRole('button', { name: '重設旋轉與亮度' })
    expect(reset).toBeDisabled()
    fireEvent.change(screen.getByRole('slider'), {
      target: { value: '-40' },
    })
    expect(reset).toBeEnabled()
    fireEvent.click(reset)
    expect(screen.getByRole('slider')).toHaveValue('0')
  })

  it('畫布捕捉指標，滿 450ms 才比較，外部放開回傳後還原', async () => {
    stubCanvas()
    stubApi(defaultServer())
    renderSection()
    await choose('拍照，1. 鋼筋間距')
    const canvas = screen.getByRole('img', { name: '現場照片與圖層預覽' })
    const capturePointer = vi.fn()
    canvas.setPointerCapture = capturePointer
    const down = new Event('pointerdown', { bubbles: true })
    Object.defineProperty(down, 'pointerId', { value: 17 })
    vi.useFakeTimers()
    fireEvent(canvas, down)
    expect(capturePointer).toHaveBeenCalledWith(17)
    act(() => vi.advanceTimersByTime(449))
    expect(screen.queryByText('編修前')).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByText('編修前')).toBeVisible()
    // 捕捉指標後，瀏覽器會把畫布外放開的 pointerup 送回畫布。
    fireEvent.pointerUp(canvas)
    expect(screen.queryByText('編修前')).toBeNull()
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.queryByText('編修前')).toBeNull()
  })

  describe.each(['leave', 'cancel', 'lost'] as const)(
    '畫布指標 %s 的生命週期',
    (ending) => {
      it.each([449, 450])('%dms 結束會清計時器並還原預覽', async (delay) => {
        stubCanvas()
        stubApi(defaultServer())
        renderSection()
        await choose('拍照，1. 鋼筋間距')
        const canvas = screen.getByRole('img', { name: '現場照片與圖層預覽' })
        canvas.setPointerCapture = vi.fn()
        vi.useFakeTimers()
        fireEvent.pointerDown(canvas)
        act(() => vi.advanceTimersByTime(delay))
        if (delay === 450) expect(screen.getByText('編修前')).toBeVisible()
        const end = {
          leave: () => fireEvent.pointerLeave(canvas),
          cancel: () => fireEvent.pointerCancel(canvas),
          lost: () =>
            fireEvent(
              canvas,
              new Event('lostpointercapture', {
                bubbles: true,
              }),
            ),
        }
        end[ending]()
        fireEvent.pointerUp(document.body)
        act(() => vi.advanceTimersByTime(1000))
        expect(screen.queryByText('編修前')).toBeNull()
      })
    },
  )

  it('圖層開關與四角改動即時反映在預覽，五欄唯讀且時間待伺服器填入', async () => {
    const calls = stubCanvas()
    stubApi(defaultServer())
    renderSection()
    await choose('拍照，1. 鋼筋間距')
    expect(calls.texts).toContain('示範工程甲')
    expect(calls.texts).toContain('上傳後以伺服器時間填入')
    calls.texts.length = 0
    fireEvent.click(screen.getByRole('checkbox', { name: '顯示工程圖層' }))
    expect(calls.texts).toHaveLength(0)
    expect(screen.getByLabelText('位置')).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: '顯示工程圖層' }))
    fireEvent.change(screen.getByLabelText('位置'), {
      target: { value: 'bottom_right' },
    })
    expect(calls.texts).toContain('示範工程甲')

    const details = screen
      .getByText('查看圖層完整文字（唯讀）')
      .closest('details') as HTMLElement
    for (const area of within(details).getAllByRole('textbox', {
      hidden: true,
    })) {
      expect(area).toHaveAttribute('readonly')
    }
    expect(
      within(details).getByLabelText('檢驗位置', { selector: 'textarea' }),
    ).toHaveValue('一樓／東側')
    expect(
      within(details).getByLabelText('檢驗人員', { selector: 'textarea' }),
    ).toHaveValue('張先生')
  })

  it('取消編修要先在頁內說明並確認，放棄後回到清單', async () => {
    stubCanvas()
    stubApi(defaultServer())
    renderSection()
    await choose('拍照，1. 鋼筋間距')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    const box = await screen.findByRole('group', { name: '放棄這張照片？' })
    expect(box).toHaveTextContent('放棄後無法找回')
    expect(within(box).getByRole('button', { name: '放棄照片' })).toHaveClass(
      'btn-danger',
    )
    fireEvent.click(within(box).getByRole('button', { name: '放棄照片' }))
    expect(
      await screen.findByRole('group', { name: '1. 鋼筋間距' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '編修現場照片' })).toBeNull()
  })

  it('非總覽沒選項次：錯誤顯示在欄位旁並聚焦第一個選項', async () => {
    stubCanvas()
    const { posts } = stubApi(defaultServer())
    renderSection()
    await choose('拍照，1. 鋼筋間距')
    await confirmEdit()
    const first = screen.getByRole('checkbox', { name: '1. 鋼筋間距' })
    fireEvent.click(first)
    fireEvent.click(screen.getByRole('button', { name: '上傳現場照片' }))
    const error = await screen.findByText('請至少選擇一個佐證項次。')
    expect(error.closest('fieldset')).not.toBeNull()
    expect(first).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(first).toHaveFocus())
    expect(posts).toHaveLength(0)
  })

  it('無法解碼的照片顯示說明並回到清單', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    stubCanvas()
    stubApi(defaultServer())
    const imageEdit = await import('./imageEdit')
    vi.mocked(imageEdit.loadImageSource).mockRejectedValueOnce(
      new Error('bad image'),
    )
    renderSection()
    fireEvent.click(
      await screen.findByRole('button', { name: '拍照，1. 鋼筋間距' }),
    )
    fireEvent.change(cameraInput(), {
      target: { files: [new File(['x'], 'bad.jpg')] },
    })
    expect(
      await screen.findByText('無法開啟這張照片，請重新拍攝或改選其他照片。'),
    ).toBeInTheDocument()
  })
})

/**
 * 走到「照片已加入上傳」。`fakeTimers` 要在按下上傳前才啟用：
 * Testing Library 的 findBy 在假計時器下會卡住，所以前面的非同步等待
 * 都先做完，再接管退避用的計時器。
 */
async function startUpload(fakeTimers = false) {
  await choose('拍照，1. 鋼筋間距')
  await confirmEdit()
  if (fakeTimers) vi.useFakeTimers()
  fireEvent.click(screen.getByRole('button', { name: '上傳現場照片' }))
  if (!fakeTimers) {
    await screen.findByRole('heading', { name: '上傳狀態' })
  }
}

describe('自動重試與手動重送（FEV-AC10、FEV-AC11）', () => {
  it('前三次網路失敗、第四次成功：只用同一個鍵與同一份內容', async () => {
    stubCanvas()
    const { posts } = stubApi(
      defaultServer({
        post: (attempt) => (attempt < 3 ? offline() : created()),
      }),
    )
    renderSection()
    await startUpload(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(screen.getByText(/自動重試中 1／3/)).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000)
    })
    expect(posts).toHaveLength(4)
    expect(new Set(posts.map((post) => post.key)).size).toBe(1)
    expect(new Set(posts.map((post) => post.form.get('sha256'))).size).toBe(1)
    expect(screen.queryByRole('heading', { name: '上傳狀態' })).toBeNull()
    expect(screen.getByText('照片已上傳。')).toBeInTheDocument()
  })

  it('持續失敗：照片留在畫面、顯示手動重送，重送沿用同一個鍵', async () => {
    stubCanvas()
    let healthy = false
    const { posts } = stubApi(
      defaultServer({ post: () => (healthy ? created() : offline()) }),
    )
    renderSection()
    await startUpload(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000)
    })
    expect(posts).toHaveLength(4)
    expect(
      screen.getByText(/上傳失敗：目前連不上網路，照片仍留在這個畫面/),
    ).toBeInTheDocument()
    expect(screen.getByAltText('待上傳的現場照片')).toBeInTheDocument()
    healthy = true
    fireEvent.click(screen.getByRole('button', { name: '手動重送' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(posts).toHaveLength(5)
    expect(new Set(posts.map((post) => post.key)).size).toBe(1)
    expect(posts[4].form.get('sha256')).toBe(posts[0].form.get('sha256'))
    expect(screen.queryByRole('heading', { name: '上傳狀態' })).toBeNull()
  })

  it.each([
    [413, 'evidence.file_too_large', /照片檔案太大/],
    [422, 'evidence.invalid_image', /照片格式無法辨識/],
    [403, 'permission.denied', /沒有權限/],
    [409, 'evidence.requirement_changed', /標準剛更新/],
  ])('%s 不自動重試，說明原因且只能放棄', async (status, code, message) => {
    stubCanvas()
    const { posts } = stubApi(
      defaultServer({
        post: () => Response.json({ error: { code } }, { status }),
      }),
    )
    renderSection()
    await startUpload()
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(posts).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '手動重送' })).toBeNull()
    expect(
      screen.getByRole('button', { name: '放棄這張照片' }),
    ).toBeInTheDocument()
  })

  it('放棄照片先說明對象與後果，確認後從清單移除並停止重試', async () => {
    stubCanvas()
    const { posts } = stubApi(defaultServer({ post: () => offline() }))
    renderSection()
    await startUpload(true)
    fireEvent.click(screen.getByRole('button', { name: '放棄這張照片' }))
    const box = screen.getByRole('group', { name: '放棄這張照片？' })
    expect(box).toHaveTextContent('佐證項次：1. 鋼筋間距')
    expect(box).toHaveTextContent('放棄後無法找回')
    fireEvent.click(within(box).getByRole('button', { name: '放棄照片' }))
    expect(screen.queryByRole('heading', { name: '上傳狀態' })).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(posts.length).toBeLessThanOrEqual(1)
  })
})

describe('離開提示（FEV-R15、FEV-AC22）', () => {
  const leave = () => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event
  }

  it('編修中、待上傳時關閉頁面會被攔下；沒有未完成照片時不攔', async () => {
    stubCanvas()
    stubApi(defaultServer({ post: () => offline() }))
    renderSection()
    await screen.findByRole('group', { name: '1. 鋼筋間距' })
    expect(leave().defaultPrevented).toBe(false)
    await startUpload()
    const event = leave()
    expect(event.defaultPrevented).toBe(true)
    expect(LEAVE_MESSAGE).toBe('照片尚未上傳，請勿關閉頁面')
  })

  it('上傳完成後不再攔截', async () => {
    stubCanvas()
    stubApi(defaultServer())
    renderSection()
    await startUpload()
    await screen.findByText('照片已上傳。')
    expect(leave().defaultPrevented).toBe(false)
  })

  it('站內導覽被攔下時顯示頁內確認，可留下或離開', async () => {
    stubCanvas()
    stubApi(defaultServer({ post: () => new Promise<Response>(() => {}) }))
    const router = createMemoryRouter([
      {
        path: '/',
        element: (
          <CurrentUserProvider
            value={{
              user: currentUserFixture({ has_field_access: true }),
              clear: vi.fn(),
            }}
          >
            <Link to="/other">離開此頁</Link>
            <EvidenceSection
              location={{ zone_name: null, location_text: null }}
              projectName="示範工程甲"
              status="IN_PROGRESS"
              taskId="task-1"
            />
          </CurrentUserProvider>
        ),
      },
      { path: '/other', element: <p>其他頁</p> },
    ])
    render(<RouterProvider router={router} />)
    await startUpload()
    fireEvent.click(screen.getByRole('link', { name: '離開此頁' }))
    const box = await screen.findByRole('group', { name: '照片尚未上傳' })
    expect(box).toHaveTextContent(LEAVE_MESSAGE)
    fireEvent.click(within(box).getByRole('button', { name: '留在這一頁' }))
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: '照片尚未上傳' })).toBeNull(),
    )
    expect(router.state.location.pathname).toBe('/')
    fireEvent.click(screen.getByRole('link', { name: '離開此頁' }))
    const again = await screen.findByRole('group', { name: '照片尚未上傳' })
    fireEvent.click(
      within(again).getByRole('button', { name: '離開並放棄照片' }),
    )
    expect(await screen.findByText('其他頁')).toBeInTheDocument()
  })
})

describe('不留下本機資料（FEV-AC11）', () => {
  it('整個拍照到上傳流程不寫 localStorage、IndexedDB、Cache API', async () => {
    stubCanvas()
    stubApi(defaultServer())
    renderSection()
    await screen.findByRole('group', { name: '1. 鋼筋間距' })
    // 外觀偏好等既有功能可能寫 localStorage；從這裡起只看照片流程。
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const open = vi.fn()
    const cachesOpen = vi.fn()
    vi.stubGlobal('indexedDB', { open })
    vi.stubGlobal('caches', { open: cachesOpen, match: cachesOpen })
    await startUpload()
    await screen.findByText('照片已上傳。')
    expect(setItem).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    expect(cachesOpen).not.toHaveBeenCalled()
  })
})

describe('修改與刪除（T5 真端點對齊）', () => {
  it('只有拍照者本人看得到修改與刪除入口，且與新增入口分開', async () => {
    stubCanvas()
    stubApi(defaultServer({ photos: [photo(), OVERVIEW] }))
    renderSection()
    expect(await screen.findByText('接頭近照')).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: /^修改說明與項次/ }),
    ).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /^刪除照片/ })).toHaveLength(
      1,
    )
    expect(screen.getByText('總覽照片（選拍）')).toBeInTheDocument()
    expect(screen.getByText('這是其他人上傳的照片，只能查看。')).toBeVisible()
    expect(screen.getByText('佐證項次：2. 續接器鎖固')).toBeInTheDocument()
  })

  it('修改註記與項次：送出 caption 與 point_ids', async () => {
    stubCanvas()
    const { requests } = stubApi(defaultServer({ photos: [photo()] }))
    renderSection()
    fireEvent.click(
      await screen.findByRole('button', { name: /^修改說明與項次/ }),
    )
    expect(
      await screen.findByRole('heading', { name: '修改說明與項次' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /總覽照片/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: '1. 鋼筋間距' }))
    fireEvent.change(screen.getByLabelText(/照片註記/), {
      target: { value: '  已補充  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存修改' }))
    fireEvent.click(await screen.findByRole('button', { name: '確認儲存' }))
    expect(
      await screen.findByText('已儲存照片說明與項次。'),
    ).toBeInTheDocument()
    const patch = requests.find((request) => request.method === 'PATCH')
    expect(JSON.parse(String(patch?.body))).toEqual({
      caption: '已補充',
      point_ids: ['point-2', 'point-1'],
    })
  })

  it('修改失敗時錯誤顯示在表單的送出鈕旁，內容保留', async () => {
    stubCanvas()
    stubApi(defaultServer({ photos: [photo()] }))
    renderSection()
    fireEvent.click(
      await screen.findByRole('button', { name: /^修改說明與項次/ }),
    )
    await screen.findByRole('heading', { name: '修改說明與項次' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code: 'evidence.task_locked' } },
          { status: 409 },
        ),
      ),
    )
    fireEvent.change(screen.getByLabelText(/照片註記/), {
      target: { value: '保留我' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存修改' }))
    fireEvent.click(await screen.findByRole('button', { name: '確認儲存' }))
    expect(
      await screen.findByText(/這個任務目前只能查看照片/),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/照片註記/)).toHaveValue('保留我')
  })

  it('刪除先說明對象與後果，確認鈕是危險樣式，確認後送出 DELETE', async () => {
    stubCanvas()
    const { requests } = stubApi(defaultServer({ photos: [photo()] }))
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /^刪除照片/ }))
    const box = await screen.findByRole('group', { name: '刪除這張照片？' })
    expect(box).toHaveTextContent('接頭近照')
    expect(box).toHaveTextContent('佐證項次：2. 續接器鎖固')
    expect(box).toHaveTextContent('不再計入')
    const confirm = within(box).getByRole('button', { name: '刪除照片' })
    expect(confirm).toHaveClass('btn-danger')
    fireEvent.click(confirm)
    const group = screen.getByRole('region', { name: '鋼筋工程的照片' })
    expect(await within(group).findByText('已刪除照片。')).toBeVisible()
    expect(requests.some((request) => request.method === 'DELETE')).toBe(true)
  })
})

describe('T5 操作附近的拒絕說明', () => {
  it.each([403, 409])(
    'DELETE %s 錯誤留在原照片確認框且不顯示錯誤碼',
    async (status) => {
      stubCanvas()
      stubApi(defaultServer({ photos: [photo()] }))
      renderSection()
      fireEvent.click(await screen.findByRole('button', { name: /^刪除照片/ }))
      const box = screen.getByRole('group', { name: '刪除這張照片？' })
      const code =
        status === 403 ? 'permission.denied' : 'evidence.photo_locked'
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ error: { code } }, { status })),
      )
      fireEvent.click(within(box).getByRole('button', { name: '刪除照片' }))
      const alert = await within(box).findByRole('alert')
      expect(alert).toHaveTextContent(
        status === 403 ? /沒有權限/ : /不能修改或刪除/,
      )
      expect(alert).not.toHaveTextContent(code)
      expect(screen.getByText('接頭近照')).toBeVisible()
    },
  )

  it('總覽修改不送項次且清空註記送 null', async () => {
    stubCanvas()
    const { requests } = stubApi(
      defaultServer({ photos: [photo({ is_overview: true, point_ids: [] })] }),
    )
    renderSection()
    fireEvent.click(
      await screen.findByRole('button', { name: /^修改說明與項次/ }),
    )
    fireEvent.change(screen.getByLabelText(/照片註記/), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存修改' }))
    fireEvent.click(await screen.findByRole('button', { name: '確認儲存' }))
    await screen.findByText('已儲存照片說明與項次。')
    expect(
      JSON.parse(String(requests.find((r) => r.method === 'PATCH')?.body)),
    ).toEqual({ caption: null })
  })
})

describe('縮圖的圖層預覽（FEV-R23）', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        naturalWidth = 1200
        naturalHeight = 800
        set src(_value: string) {
          setTimeout(() => this.onload?.(), 0)
        }
      },
    )
  })

  it('用讀回的 layer 與 labels 在前端合成；圖層關閉就不畫', async () => {
    const calls = stubCanvas()
    stubApi(defaultServer({ photos: [photo()] }))
    renderSection()
    await waitFor(() => expect(calls.texts).toContain('示範工程甲'))
    expect(calls.texts).toContain('2026/10/31 10:24')
  })

  it('圖層關閉時縮圖沒有標示文字', async () => {
    const calls = stubCanvas()
    const closed = photo({
      layer: { ...photo().layer, enabled: false },
    })
    stubApi(defaultServer({ photos: [closed] }))
    renderSection()
    await screen.findByRole('img', { name: '接頭近照' })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(calls.texts).toEqual([])
  })
})

describe('T5 修改入口與狀態說明', () => {
  it('預設開放本人修改，送出先確認且成功訊息留在照片區', async () => {
    stubCanvas()
    const server = defaultServer({ photos: [photo()] })
    const { requests } = stubApi(server)
    renderSection()
    fireEvent.click(
      await screen.findByRole('button', { name: /^修改說明與項次/ }),
    )
    fireEvent.change(screen.getByLabelText(/照片註記/), {
      target: { value: '新註記' },
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存修改' }))
    const box = await screen.findByRole('group', {
      name: '儲存照片說明與項次？',
    })
    expect(requests.some((r) => r.method === 'PATCH')).toBe(false)
    expect(within(box).getByRole('button', { name: '返回修改' })).toHaveFocus()
    fireEvent.click(within(box).getByRole('button', { name: '確認儲存' }))
    const group = await screen.findByRole('region', { name: '鋼筋工程的照片' })
    expect(
      await within(group).findByText('已儲存照片說明與項次。'),
    ).toBeVisible()
  })

  it.each(['COMPLETED', 'CANCELLED'] as const)(
    '任務 %s 有唯讀原因',
    async (status) => {
      stubCanvas()
      stubApi(defaultServer({ photos: [photo()] }))
      renderSection({ status })
      await screen.findByText('接頭近照')
      expect(screen.getByText(/任務已.*照片只能查看/)).toBeVisible()
      expect(
        screen.queryByRole('button', { name: /修改說明與項次|刪除照片/ }),
      ).toBeNull()
    },
  )
})
