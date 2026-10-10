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

function mockFetch() {
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
        return Response.json(
          url.searchParams.get('cursor')
            ? { items: [{ ...first, id: 'third' }], next_cursor: null }
            : { items: [first], next_cursor: 'second-page' },
        )
      }
      return Response.json({}, { status: 404 })
    },
  )
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

afterEach(() => vi.unstubAllGlobals())

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
      expect(params.get('from')).toBe(
        new Date('2026-10-10T08:00').toISOString(),
      )
      expect(params.get('to')).toBe(new Date('2026-10-11T08:00').toISOString())
    })
    fireEvent.click(screen.getByRole('button', { name: '下一頁' }))
    await waitFor(() => {
      expect(
        fetcher.mock.calls.some(([input]) =>
          String(input).includes('cursor=second-page'),
        ),
      ).toBe(true)
    })
    expect(screen.getByText('第 2 頁')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '上一頁' }))
    await waitFor(() => {
      expect(screen.getByText('第 1 頁')).toBeInTheDocument()
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
    fireEvent.change(screen.getByLabelText('結束時間（不含）'), {
      target: { value: '2026-10-10T08:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: '查詢' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      '起始時間不得晚於結束時間。',
    )
    expect(fetcher.mock.calls).toHaveLength(before)
  })
})
