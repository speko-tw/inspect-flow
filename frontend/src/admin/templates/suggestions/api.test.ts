import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  approveSuggestion,
  compareRevisions,
  createSuggestion,
  getMyStatusCounts,
  getPendingCount,
  listMySuggestions,
  listReviewSuggestions,
  listRevisions,
  returnSuggestion,
  saveRevision,
  submitSuggestion,
  withdrawSuggestion,
} from './api'
import { makeContent } from './fixtures'

afterEach(() => vi.unstubAllGlobals())

function stub(...responses: Response[]) {
  const fetchMock = vi.fn()
  for (const response of responses) fetchMock.mockResolvedValueOnce(response)
  fetchMock.mockImplementation(async () => Response.json({}))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function call(fetchMock: ReturnType<typeof vi.fn>, index = 0) {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit]
  return {
    url,
    method: init?.method ?? 'GET',
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  }
}

const EXPECTED = {
  expected_revision_id: 'rev-1',
  expected_status: 'PENDING',
} as const

describe('範本建議 API 契約（TPL-R29～R36）', () => {
  it('從專案項目提出建議：只送項目識別，身分由登入者決定', async () => {
    const fetchMock = stub()
    await createSuggestion('p1', 'item-1')
    expect(call(fetchMock)).toEqual({
      url: '/api/v1/projects/p1/template-suggestions',
      method: 'POST',
      body: { project_inspection_item_id: 'item-1' },
    })
  })

  it('本人清單帶狀態與來源專案篩選，回傳篩選後件數', async () => {
    const fetchMock = stub(
      Response.json({ items: [], next_cursor: null, total_count: 3 }),
    )
    const page = await listMySuggestions({
      status: 'RETURNED',
      source_project_id: 'p1',
      cursor: 'c2',
    })
    expect(page.total_count).toBe(3)
    expect(call(fetchMock).url).toBe(
      '/api/v1/me/template-suggestions' +
        '?status=RETURNED&source_project_id=p1&cursor=c2&limit=50',
    )
  })

  it('各狀態件數用 limit=1 的四次篩選取 total_count', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const status = new URL(input, 'http://x').searchParams.get('status')
      const total = { PENDING: 2, RETURNED: 1, APPROVED: 4, WITHDRAWN: 0 }[
        status as 'PENDING'
      ]
      return Response.json({
        items: [],
        next_cursor: null,
        total_count: total,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(getMyStatusCounts('p1')).resolves.toEqual({
      PENDING: 2,
      RETURNED: 1,
      APPROVED: 4,
      WITHDRAWN: 0,
    })
    for (const [url] of fetchMock.mock.calls) {
      expect(url).toContain('limit=1')
      expect(url).toContain('source_project_id=p1')
    }
  })

  it('管理清單預設不帶狀態（後端預設待審），完整歷程用 ALL', async () => {
    const fetchMock = stub(
      Response.json({ items: [], next_cursor: null }),
      Response.json({ items: [], next_cursor: null }),
    )
    await listReviewSuggestions()
    await listReviewSuggestions({ status: 'ALL' })
    expect(call(fetchMock, 0).url).toBe(
      '/api/v1/template-suggestions?limit=50',
    )
    expect(call(fetchMock, 1).url).toBe(
      '/api/v1/template-suggestions?status=ALL&limit=50',
    )
  })

  it('待審數量走專用端點', async () => {
    const fetchMock = stub(Response.json({ pending_count: 3 }))
    await expect(getPendingCount()).resolves.toEqual({ pending_count: 3 })
    expect(call(fetchMock).url).toBe(
      '/api/v1/template-suggestions:pending-count',
    )
  })

  it('各版沿游標取完並保留順序', async () => {
    const fetchMock = stub(
      Response.json({ items: [{ id: 'a' }], next_cursor: 'n' }),
      Response.json({ items: [{ id: 'b' }], next_cursor: null }),
    )
    const items = await listRevisions('s1')
    expect(items.map((r) => r.id)).toEqual(['a', 'b'])
    expect(call(fetchMock, 1).url).toBe(
      '/api/v1/template-suggestions/s1/revisions?limit=100&cursor=n',
    )
  })

  it('比較只送兩版識別', async () => {
    const fetchMock = stub()
    await compareRevisions('s1', 'rev-1', 'rev-2')
    expect(call(fetchMock).url).toBe(
      '/api/v1/template-suggestions/s1/revisions:compare' +
        '?from_revision_id=rev-1&to_revision_id=rev-2',
    )
  })

  it('所有寫入帶 expected 欄位，不帶身分或任意狀態', async () => {
    const fetchMock = stub()
    const content = makeContent()
    await saveRevision('s1', content, EXPECTED)
    await submitSuggestion('s1', EXPECTED)
    await withdrawSuggestion('s1', EXPECTED)
    await returnSuggestion('s1', '請補充', EXPECTED)
    await approveSuggestion(
      's1',
      { category_id: 'c1', system_id: 'sys1' },
      EXPECTED,
    )
    const calls = fetchMock.mock.calls.map((_c, index) =>
      call(fetchMock, index),
    )
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /api/v1/template-suggestions/s1/revisions',
      'POST /api/v1/template-suggestions/s1:submit',
      'POST /api/v1/template-suggestions/s1:withdraw',
      'POST /api/v1/template-suggestions/s1:return',
      'POST /api/v1/template-suggestions/s1:approve',
    ])
    expect(calls[0].body).toEqual({ content, ...EXPECTED })
    expect(calls[3].body).toEqual({ reason: '請補充', ...EXPECTED })
    expect(calls[4].body).toEqual({
      category_id: 'c1',
      system_id: 'sys1',
      ...EXPECTED,
    })
    for (const { body } of calls) {
      expect(body).not.toHaveProperty('status')
      expect(body).not.toHaveProperty('proposer_id')
      expect(body).not.toHaveProperty('reviewer_id')
    }
  })
})
