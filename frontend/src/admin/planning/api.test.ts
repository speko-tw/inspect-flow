import { afterEach, describe, expect, it, vi } from 'vitest'

import { ManagementApiError } from '../api'
import { planningClient, planningErrorMessage } from './api'

const PROJECT = 'project-demo-1'

describe('planning HTTP client contract', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('explains invalid zone and plan names beside their fields', () => {
    expect(
      planningErrorMessage(
        new ManagementApiError(422, 'project_zone.invalid_name'),
      ),
    ).toBe('分區名稱不可空白，且不得超過 128 字元。')
    expect(
      planningErrorMessage(
        new ManagementApiError(422, 'inspection_plan.invalid_name'),
      ),
    ).toBe('計畫名稱不可空白，且不得超過 128 字元。')
  })

  it.each([
    [401, '登入狀態已失效，請重新登入。'],
    [403, '你沒有權限執行這項操作，畫面已切換為唯讀。'],
    [500, '伺服器暫時無法處理，請稍後再試。'],
    [409, '目前狀態不允許這項操作，請重新整理。'],
    [404, '找不到資料，請重新整理後再試。'],
  ])('maps status %s to the shared planning message', (status, text) => {
    expect(planningErrorMessage(new ManagementApiError(status))).toBe(text)
  })

  it('reads Task snapshots and paginated API envelopes', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.includes('/inspection-plans?')) {
        const cursor = new URL(path, 'http://localhost').searchParams.get(
          'cursor',
        )
        return Response.json(
          cursor
            ? { items: [], next_cursor: null }
            : { items: [], next_cursor: 'cursor-2' },
        )
      }
      return Response.json({
        id: 'task-1',
        name: '現場外牆任務',
        project_id: PROJECT,
        plan_id: 'plan-1',
        status: 'DRAFT',
        zone_id: null,
        zone: null,
        location_text: null,
        assignee_id: null,
        assignee: null,
        started_by: null,
        completed_by: null,
        cancellation_reason: null,
        cancelled_from: null,
        items: [
          {
            id: 'item-1',
            status: 'PENDING',
            needs_reinspection: false,
            snapshots: [],
            current_snapshot: {
              revision: 1,
              title: '外牆檢查',
              instruction: '確認外牆狀況',
            },
          },
        ],
        created_at: '2026-10-05T00:00:00Z',
        updated_at: '2026-10-05T00:00:00Z',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const plans = await planningClient.listPlans(PROJECT)
    const task = await planningClient.getTask('task-1')
    const updatedTask = await planningClient.updateTaskItems('task-1', {
      item_ids: ['item-2'],
    })

    expect(plans).toEqual({ items: [], next_cursor: 'cursor-2' })
    expect(task.name).toBe('現場外牆任務')
    expect(task.items[0].current_snapshot?.title).toBe('外牆檢查')
    expect(updatedTask.id).toBe('task-1')
    expect(updatedTask.name).toBe(task.name)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(
        '/api/v1/projects/project-demo-1/inspection-plans?',
      ),
      expect.objectContaining({ credentials: 'same-origin' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/inspection-tasks/task-1',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/inspection-tasks/task-1/items',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ item_ids: ['item-2'] }),
        credentials: 'same-origin',
      }),
    )
  })

  it('uses the assignee API instead of the project member list', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ items: [], next_cursor: null }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await planningClient.listProjectAssignees(PROJECT)

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        '/projects/project-demo-1/inspection-task-assignees?',
      ),
      expect.any(Object),
    )
  })
})
