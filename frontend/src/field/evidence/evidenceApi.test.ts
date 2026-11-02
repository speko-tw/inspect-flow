import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  EvidenceApiError,
  UPLOAD_TIMEOUT_MS,
  UploadTimeoutError,
  buildUploadForm,
  deletePhoto,
  fetchCoverage,
  fetchFieldPhotos,
  isFieldPhoto,
  photoImageUrl,
  updatePhoto,
  uploadPhoto,
} from './evidenceApi'
import { COVERAGE, photo, uploadRequest } from './testFixtures'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('multipart 上傳欄位（FEV-R06、R07、R22）', () => {
  it('送出規格列的欄位，layer 只有開關與角落', () => {
    const form = buildUploadForm(
      uploadRequest({ pointIds: ['point-1', 'point-2'] }),
    )
    expect(form.get('sha256')).toBe('a'.repeat(64))
    expect(form.get('item_id')).toBe('item-a')
    expect(form.get('is_overview')).toBe('false')
    expect(form.getAll('point_ids')).toEqual(['point-1', 'point-2'])
    expect(form.get('caption')).toBe('近照')
    expect(form.get('captured_at')).toBe('2026-10-31T02:24:00.000Z')
    expect(JSON.parse(String(form.get('field_edit')))).toEqual({
      rotation: 90,
      brightness: 20,
    })
    expect(JSON.parse(String(form.get('layer')))).toEqual({
      enabled: true,
      corner: 'top_right',
    })
    expect(form.get('capture_source')).toBe('camera')
    expect((form.get('file') as File).type).toBe('image/jpeg')
  })

  it('沒有註記與拍攝時間就不送這兩個欄位；總覽不帶項次', () => {
    const form = buildUploadForm(
      uploadRequest({
        caption: '',
        capturedAt: null,
        isOverview: true,
        pointIds: [],
        captureSource: 'library',
      }),
    )
    expect(form.has('caption')).toBe(false)
    expect(form.has('captured_at')).toBe(false)
    expect(form.has('point_ids')).toBe(false)
    expect(form.get('is_overview')).toBe('true')
    expect(form.get('capture_source')).toBe('library')
  })
})

describe('uploadPhoto', () => {
  it('帶冪等鍵標頭，Content-Type 交給瀏覽器產生 boundary', async () => {
    const fetcher = vi.fn(async () => Response.json(photo(), { status: 201 }))
    vi.stubGlobal('fetch', fetcher)
    const result = await uploadPhoto('task-1', uploadRequest())
    expect(result.id).toBe('photo-1')
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('/api/v1/inspection-tasks/task-1/photos')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect(init.headers).toEqual({
      'Idempotency-Key': '11111111-1111-4111-8111-111111111111',
    })
    expect(init.credentials).toBe('same-origin')
  })

  it('接受冪等重放的 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(photo(), { status: 200 })),
    )
    await expect(
      uploadPhoto('task-1', uploadRequest()),
    ).resolves.toMatchObject({ id: 'photo-1' })
  })

  it('失敗時拋出帶狀態碼與錯誤碼的 EvidenceApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code: 'evidence.file_too_large' } },
          { status: 413 },
        ),
      ),
    )
    await expect(uploadPhoto('task-1', uploadRequest())).rejects.toMatchObject(
      {
        name: 'EvidenceApiError',
        status: 413,
        code: 'evidence.file_too_large',
      },
    )
  })

  it('網路中斷直接拋出原錯誤，由重試機制判斷', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    await expect(uploadPhoto('task-1', uploadRequest())).rejects.toThrow(
      TypeError,
    )
  })

  it('逾時視為可重試的網路問題', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            )
          }),
      ),
    )
    const pending = uploadPhoto('task-1', uploadRequest())
    const caught = pending.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS + 1)
    expect(await caught).toBeInstanceOf(UploadTimeoutError)
  })

  it('回應不符契約就拒收', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ id: 'photo-1' }, { status: 201 })),
    )
    await expect(uploadPhoto('task-1', uploadRequest())).rejects.toThrow(
      'unexpected shape',
    )
  })
})

describe('讀取、修改與刪除', () => {
  it('覆蓋狀態與照片清單走現場端點，並驗證形狀', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/evidence')
        ? Response.json(COVERAGE)
        : Response.json({ items: [photo()], next_cursor: null }),
    )
    vi.stubGlobal('fetch', fetcher)
    await expect(fetchCoverage('task-1')).resolves.toEqual(COVERAGE)
    await expect(fetchFieldPhotos('task-1')).resolves.toHaveLength(1)
    expect(String(fetcher.mock.calls[0][0])).toBe(
      '/api/v1/field/inspection-tasks/task-1/evidence',
    )
    expect(String(fetcher.mock.calls[1][0])).toContain(
      '/api/v1/field/inspection-tasks/task-1/photos?limit=100',
    )
  })

  it('PATCH 只送要改的欄位，DELETE 走同一個照片路徑', async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : Response.json(photo()),
    )
    vi.stubGlobal('fetch', fetcher)
    await updatePhoto('task-1', 'photo-1', { caption: null })
    await deletePhoto('task-1', 'photo-1')
    const [patchUrl, patch] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(patchUrl).toBe('/api/v1/inspection-tasks/task-1/photos/photo-1')
    expect(patch.method).toBe('PATCH')
    expect(JSON.parse(String(patch.body))).toEqual({ caption: null })
    expect(fetcher.mock.calls[1][1]?.method).toBe('DELETE')
  })

  it('圖片網址只要現場版，縮圖用 max_edge', () => {
    expect(photoImageUrl('task-1', 'photo-1', 640)).toBe(
      '/api/v1/inspection-tasks/task-1/photos/photo-1/image' +
        '?variant=field&max_edge=640',
    )
    expect(photoImageUrl('task-1', 'photo-1')).toBe(
      '/api/v1/inspection-tasks/task-1/photos/photo-1/image?variant=field',
    )
  })

  it('錯誤類別繼承 HttpError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code: 'resource.not_found' } },
          { status: 404 },
        ),
      ),
    )
    await expect(fetchCoverage('task-1')).rejects.toBeInstanceOf(
      EvidenceApiError,
    )
  })

  it('現場視圖形狀檢查：缺欄位或型別錯就拒絕', () => {
    expect(isFieldPhoto(photo())).toBe(true)
    expect(isFieldPhoto({ ...photo(), layer: null })).toBe(false)
    expect(isFieldPhoto({ ...photo(), point_ids: 'x' })).toBe(false)
    expect(isFieldPhoto(null)).toBe(false)
  })
})
