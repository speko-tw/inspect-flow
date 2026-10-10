import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import AuditLogPage from './AuditLogPage'

const projectId = '00000000-0000-0000-0000-000000000412'
const actorId = '00000000-0000-0000-0000-000000000001'

const first = {
  id: '00000000-0000-0000-0000-000000000002',
  created_at: '2026-10-10T08:30:00Z',
  created_by: actorId,
  project_id: projectId,
  event_type: 'project_zone.created',
  entity_type: 'project_zone',
  entity_id: '00000000-0000-0000-0000-000000000100',
  before: null,
  after: { name: '一樓' },
}

function mockFetch(
  auditResponse: (url: URL) => Response = (url) =>
    Response.json(
      url.searchParams.get('cursor')
        ? { items: [{ ...first, id: 'third' }], next_cursor: null }
        : { items: [first], next_cursor: 'second-page' },
    ),
) {
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname.endsWith('/projects')) {
        return Response.json({
          items: [{ id: projectId, name: '甲專案', project_code: 'P-1' }],
          next_cursor: null,
        })
      }
      if (url.pathname.endsWith('/users')) {
        return Response.json({
          items: [{ id: actorId, username: 'anna', name_zh: '安娜' }],
          next_cursor: null,
        })
      }
      if (url.pathname.endsWith('/audit-logs')) {
        if (init?.method && init.method !== 'GET') {
          return Response.json({}, { status: 405 })
        }
        return auditResponse(url)
      }
      return Response.json({}, { status: 404 })
    },
  )
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('稽核查詢頁', () => {
  it('套用四類篩選、翻頁與返回，僅送 GET 查詢', async () => {
    const fetcher = mockFetch()
    render(<AuditLogPage />)
    expect(await screen.findByText('project_zone.created')).toBeInTheDocument()
    expect(screen.getAllByText('甲專案 (P-1)')).toHaveLength(2)
    expect(screen.getAllByText('安娜 (anna)')).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('專案'), {
      target: { value: projectId },
    })
    fireEvent.change(screen.getByLabelText('操作者'), {
      target: { value: actorId },
    })
    fireEvent.change(screen.getByLabelText('起始時間（含）'), {
      target: { value: '2026-10-10T08:00' },
    })
    fireEvent.change(screen.getByLabelText('結束時間（不含）'), {
      target: { value: '2026-10-11T08:00' },
    })
    fireEvent.change(screen.getByLabelText('事件類型'), {
      target: { value: 'project_zone.created' },
    })
    fireEvent.click(screen.getByRole('button', { name: '查詢' }))
    await waitFor(() => {
      const urls = fetcher.mock.calls.map(([input]) => String(input))
      const search = urls.find(
        (url) => url.includes('/audit-logs?') && url.includes('project_id='),
      )
      expect(search).toBeDefined()
      const params = new URL(search!, 'http://localhost').searchParams
      expect(params.get('project_id')).toBe(projectId)
      expect(params.get('actor_id')).toBe(actorId)
      expect(params.get('event_type')).toBe('project_zone.created')
      expect(params.get('from')).toBe('2026-10-10T00:00:00.000Z')
      expect(params.get('to')).toBe('2026-10-11T00:00:00.000Z')
    })
    fireEvent.click(screen.getByRole('button', { name: '下一頁' }))
    await waitFor(() => {
      const nextRequest = fetcher.mock.calls.find(([input]) =>
        String(input).includes('cursor=second-page'),
      )
      expect(nextRequest).toBeDefined()
      const params = new URL(String(nextRequest?.[0]), 'http://localhost')
        .searchParams
      expect(params.get('project_id')).toBe(projectId)
      expect(params.get('actor_id')).toBe(actorId)
      expect(params.get('from')).toBe('2026-10-10T00:00:00.000Z')
      expect(params.get('to')).toBe('2026-10-11T00:00:00.000Z')
      expect(params.get('event_type')).toBe('project_zone.created')
    })
    expect(screen.getByText('第 2 頁')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '上一頁' }))
    await waitFor(() => {
      expect(screen.getByText('第 1 頁')).toBeInTheDocument()
      const auditRequests = fetcher.mock.calls.filter(([input]) =>
        String(input).includes('/audit-logs?'),
      )
      const params = new URL(
        String(auditRequests.at(-1)?.[0]),
        'http://localhost',
      ).searchParams
      expect(params.has('cursor')).toBe(false)
      expect(params.get('project_id')).toBe(projectId)
    })
    expect(fetcher.mock.calls.every(([, init]) => !init?.method)).toBe(true)
  })

  it('拒絕反向時間範圍且不送出查詢', async () => {
    const fetcher = mockFetch()
    render(<AuditLogPage />)
    await screen.findByText('project_zone.created')
    const before = fetcher.mock.calls.length
    fireEvent.change(screen.getByLabelText('起始時間（含）'), {
      target: { value: '2026-10-11T08:00' },
    })
    const toInput = screen.getByLabelText('結束時間（不含）')
    fireEvent.change(toInput, {
      target: { value: '2026-10-10T08:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: '查詢' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      '起始時間不得晚於結束時間。',
    )
    expect(toInput).toHaveFocus()
    expect(toInput).toHaveAttribute('aria-invalid', 'true')
    expect(toInput).toHaveAttribute('aria-describedby', 'audit-to-error')
    expect(fetcher.mock.calls).toHaveLength(before)
    expect(screen.getByText('project_zone.created')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('起始時間（含）'), {
      target: { value: '2026-10-09T08:00' },
    })
    expect(toInput).toHaveAttribute('aria-invalid', 'false')
    expect(toInput).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByText('起始時間不得晚於結束時間。')).toBeNull()
    expect(fetcher.mock.calls).toHaveLength(before)
  })

  it('在事件類型格式錯誤時聚焦欄位並保留原結果', async () => {
    const fetcher = mockFetch()
    render(<AuditLogPage />)
    await screen.findByText('project_zone.created')
    const before = fetcher.mock.calls.length
    const input = screen.getByLabelText('事件類型')
    fireEvent.change(input, { target: { value: 'Project Zone' } })
    fireEvent.click(screen.getByRole('button', { name: '查詢' }))

    expect(input).toHaveFocus()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', 'audit-event-type-error')
    expect(screen.getByRole('alert')).toHaveTextContent(
      '事件類型格式應為資料類型.動作。',
    )
    expect(fetcher.mock.calls).toHaveLength(before)
    expect(screen.getByText('project_zone.created')).toBeInTheDocument()
  })

  it('在第二頁更改篩選後重新查第一頁', async () => {
    const fetcher = mockFetch()
    render(<AuditLogPage />)
    await screen.findByText('project_zone.created')
    fireEvent.click(screen.getByRole('button', { name: '下一頁' }))
    await screen.findByText('第 2 頁')
    fireEvent.change(screen.getByLabelText('事件類型'), {
      target: { value: 'project_zone.updated' },
    })
    fireEvent.click(screen.getByRole('button', { name: '查詢' }))

    await waitFor(() => {
      expect(screen.getByText('第 1 頁')).toBeInTheDocument()
      const auditRequests = fetcher.mock.calls.filter(([input]) =>
        String(input).includes('/audit-logs?'),
      )
      const params = new URL(
        String(auditRequests.at(-1)?.[0]),
        'http://localhost',
      ).searchParams
      expect(params.get('event_type')).toBe('project_zone.updated')
      expect(params.has('cursor')).toBe(false)
    })
  })

  it.each([
    [422, '操作失敗，請稍後再試。'],
    [500, '伺服器暫時無法處理，請稍後再試。'],
  ])('顯示查詢 API %i 錯誤並結束載入', async (status, message) => {
    mockFetch(() =>
      Response.json({ error: { code: 'request.invalid' } }, { status }),
    )
    render(<AuditLogPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByText('載入稽核紀錄中…')).toBeNull()
    expect(screen.queryByText('project_zone.created')).toBeNull()
  })

  it('顯示空結果狀態', async () => {
    mockFetch(() => Response.json({ items: [], next_cursor: null }))
    render(<AuditLogPage />)

    expect(
      await screen.findByText('沒有符合條件的稽核紀錄。'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一頁' })).toBeDisabled()
  })
})
