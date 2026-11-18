import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchFieldTasks, fetchRecentCompletedTasks } from './api'

const completed = {
  id: 'task-1',
  project_id: 'project-1',
  project_name: '示範工程',
  name: '完成任務',
  status: 'COMPLETED',
  dispatched_at: '2026-10-10T08:00:00Z',
  completed_at: '2026-10-11T08:00:00Z',
  location: { zone_name: null, location_text: null },
  suggested_assignee: null,
  item_summary: { first_title: null, item_count: 0 },
}

afterEach(() => vi.unstubAllGlobals())

describe('Field 任務清單 API', () => {
  it('未完成清單 validator 拒絕 COMPLETED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ items: [completed], next_cursor: null }),
      ),
    )
    await expect(
      fetchFieldTasks({ assignedToMe: true, status: null }),
    ).rejects.toThrow('Field task list response has an unexpected shape')
  })

  it('近期已完成查詢接受 COMPLETED 並驗證全量筆數', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'https://testserver')
      expect(url.searchParams.get('status')).toBe('COMPLETED')
      expect(url.searchParams.get('completed_within_days')).toBe('14')
      expect(url.searchParams.get('assigned_to_me')).toBe('false')
      return Response.json({
        items: [completed],
        next_cursor: null,
        total_count: 3,
      })
    })
    vi.stubGlobal('fetch', fetcher)

    await expect(
      fetchRecentCompletedTasks({ assignedToMe: false }),
    ).resolves.toEqual({
      items: [completed],
      next_cursor: null,
      total_count: 3,
    })
  })
})
