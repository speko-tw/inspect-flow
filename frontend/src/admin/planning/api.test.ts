import { afterEach, describe, expect, it, vi } from 'vitest'

import { ManagementApiError } from '../api'
import { createMockPlanningClient } from './api.mock'
import { planningClient, planningErrorMessage } from './api'

const PROJECT = 'project-demo-1'

describe('mock planning client', () => {
  it('uses the backend error code for an invalid plan name', async () => {
    const client = createMockPlanningClient()
    await expect(
      client.createPlan(PROJECT, { name: '   ' }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'inspection_plan.invalid_name',
    })
  })

  it('paginates plans and fetches task details separately', async () => {
    const client = createMockPlanningClient()
    const created = []
    for (let index = 0; index < 21; index += 1) {
      created.push(await client.createPlan(PROJECT, { name: `計畫 ${index}` }))
    }

    const first = await client.listPlans(PROJECT)
    expect(first.items).toHaveLength(20)
    expect(first.items[0]).not.toHaveProperty('tasks')
    expect(first.next_cursor).toBe('20')
    const second = await client.listPlans(PROJECT, first.next_cursor)
    expect(second.items).toHaveLength(1)
    expect(second.next_cursor).toBeNull()

    const [item] = await client.listProjectItems(PROJECT)
    const task = await client.createTask(created[0].id, {
      item_ids: [item.id],
      suggested_assignee_id: null,
      zone_id: null,
      location_text: '東側',
    })
    expect((await client.getPlan(created[0].id)).tasks).toEqual([task])
    expect(await client.getTask(task.id)).toMatchObject({
      zone_id: null,
      zone: null,
      location_text: '東側',
      assignee_id: null,
      started_by: null,
      completed_by: null,
    })
  })

  it(
    'keeps assignment advisory and records the actual field ' + 'operator',
    async () => {
      const client = createMockPlanningClient({
        actingUserId: 'project-a-member-2',
        completionReady: true,
      })
      const plan = await client.createPlan(PROJECT, { name: '現場操作者' })
      const [item] = await client.listProjectItems(PROJECT)
      const task = await client.createTask(plan.id, {
        item_ids: [item.id],
        suggested_assignee_id: 'project-a-member-1',
        zone_id: null,
        location_text: null,
      })

      const dispatched = await client.dispatchTask(task.id)
      const started = await client.startTask(task.id)
      const completed = await client.completeTask(task.id)

      expect(dispatched.assignee_id).toBe('project-a-member-1')
      expect(started.started_by).toBe('project-a-member-2')
      expect(completed.completed_by).toBe('project-a-member-2')
      expect((await client.getPlan(plan.id)).status).toBe('COMPLETED')
      await expect(
        client.updateLocation(task.id, {
          zone_id: null,
          location_text: '完成後不可改地點',
        }),
      ).rejects.toMatchObject({ status: 409 })
      await expect(client.cancelTask(task.id, '不允許')).rejects.toMatchObject(
        {
          status: 409,
        },
      )
    },
  )

  it('derives plan and task states through business actions', async () => {
    const client = createMockPlanningClient()
    const plan = await client.createPlan(PROJECT, { name: '  第一階段  ' })
    expect(plan.name).toBe('第一階段')
    expect(plan.status).toBe('DRAFT')

    const [item] = await client.listProjectItems(PROJECT)
    const task = await client.createTask(plan.id, {
      item_ids: [item.id],
      suggested_assignee_id: null,
      zone_id: null,
      location_text: '地下室',
    })
    expect(task.status).toBe('DRAFT')
    expect((await client.getPlan(plan.id)).status).toBe('DRAFT')

    const dispatched = await client.dispatchTask(task.id)
    expect(dispatched.status).toBe('PENDING')
    expect((await client.getPlan(plan.id)).status).toBe('IN_PROGRESS')

    const cancelled = await client.cancelTask(task.id, '施工順序調整')
    expect(cancelled.status).toBe('CANCELLED')
    expect(cancelled.cancellation_reason).toBe('施工順序調整')
    expect((await client.getPlan(plan.id)).status).toBe('CANCELLED')

    const restored = await client.restoreTask(task.id)
    expect(restored.status).toBe('PENDING')
    expect((await client.getPlan(plan.id)).status).toBe('IN_PROGRESS')
  })

  it(
    'enforces zone rules, Unicode name conflicts, ' +
      'and referenced deletion',
    async () => {
      const client = createMockPlanningClient()
      const zone = await client.createZone(PROJECT, '  北區  ')
      expect(zone.name).toBe('北區')
      await expect(client.createZone(PROJECT, ' 北區 ')).rejects.toMatchObject(
        {
          status: 409,
          code: 'project_zone.name_conflict',
        },
      )

      const plan = await client.createPlan(PROJECT, { name: '巡查' })
      const [item] = await client.listProjectItems(PROJECT)
      const task = await client.createTask(plan.id, {
        item_ids: [item.id],
        suggested_assignee_id: null,
        zone_id: zone.id,
        location_text: null,
      })
      await expect(client.deleteZone(PROJECT, zone.id)).rejects.toMatchObject({
        status: 409,
        code: 'project_zone.in_use',
      })

      await client.dispatchTask(task.id)
      await expect(
        client.updateLocation(task.id, {
          zone_id: null,
          location_text: '位置',
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: 'inspection_task.invalid_zone',
      })

      const otherProjectZone = await client.createZone(
        'project-demo-2',
        '南區',
      )
      await expect(
        client.updateLocation(task.id, {
          zone_id: otherProjectZone.id,
          location_text: null,
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: 'inspection_task.invalid_zone',
      })
      await expect(client.createZone(PROJECT, '   ')).rejects.toMatchObject({
        status: 422,
        code: 'project_zone.invalid_name',
      })
      await expect(
        client.createZone(PROJECT, 'a'.repeat(129)),
      ).rejects.toMatchObject({
        status: 422,
        code: 'project_zone.invalid_name',
      })
    },
  )

  it(
    'supports free text without zones and restricts location edits ' +
      'by state',
    async () => {
      const client = createMockPlanningClient()
      const plan = await client.createPlan('project-demo-2', {
        name: '無分區',
      })
      const [item] = await client.listProjectItems('project-demo-2')
      const task = await client.createTask(plan.id, {
        item_ids: [item.id],
        suggested_assignee_id: null,
        zone_id: null,
        location_text: '  北側入口  ',
      })
      expect(task.location_text).toBe('北側入口')
      await client.updateLocation(task.id, {
        zone_id: null,
        location_text: '更新位置',
      })
      await expect(
        client.updateLocation(task.id, {
          zone_id: null,
          location_text: 'x'.repeat(257),
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: 'inspection_task.invalid_location',
      })

      await client.dispatchTask(task.id)
      await client.updateLocation(task.id, {
        zone_id: null,
        location_text: '派出後仍可修改',
      })
      await client.startTask(task.id)
      await client.updateLocation(task.id, {
        zone_id: null,
        location_text: '進行中可修改',
      })
      const cancelled = await client.cancelTask(task.id, '取消驗證')
      await expect(
        client.updateLocation(cancelled.id, {
          zone_id: null,
          location_text: '取消後不可改',
        }),
      ).rejects.toMatchObject({ status: 409 })
    },
  )

  it(
    'keeps task snapshots independent from returned item ' + 'objects',
    async () => {
      const client = createMockPlanningClient()
      const plan = await client.createPlan(PROJECT, { name: '快照' })
      const [item] = await client.listProjectItems(PROJECT)
      const task = await client.createTask(plan.id, {
        item_ids: [item.id],
        suggested_assignee_id: null,
        zone_id: null,
        location_text: null,
      })
      item.title = '外部修改'
      expect(
        (await client.getPlan(plan.id)).tasks?.[0].items[0].current_snapshot
          ?.title,
      ).toBe(task.items[0].current_snapshot?.title)
    },
  )

  it(
    'rejects invalid transitions and plan mutations after ' + 'archive',
    async () => {
      const client = createMockPlanningClient()
      const plan = await client.createPlan(PROJECT, { name: '封存' })
      await client.updatePlan(plan.id, { name: '  已更名  ' })
      expect((await client.getPlan(plan.id)).name).toBe('已更名')
      const archived = await client.archivePlan(plan.id)
      expect(archived.status).toBe('ARCHIVED')
      await expect(
        client.createTask(plan.id, {
          item_ids: ['item-demo-1'],
          suggested_assignee_id: null,
          zone_id: null,
          location_text: null,
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: 'inspection_plan.archived',
      })
      const unarchived = await client.unarchivePlan(plan.id)
      expect(unarchived.status).toBe('DRAFT')
    },
  )

  it(
    'supports suggested assignment and deleting only draft ' + 'tasks',
    async () => {
      const client = createMockPlanningClient()
      const plan = await client.createPlan(PROJECT, { name: '草稿刪除' })
      const [item] = await client.listProjectItems(PROJECT)
      const task = await client.createTask(plan.id, {
        item_ids: [item.id],
        suggested_assignee_id: null,
        zone_id: null,
        location_text: null,
      })
      const assigned = await client.setSuggestedAssignee(
        task.id,
        'project-a-member-1',
      )
      expect(
        (await client.listProjectAssignees(PROJECT)).find(
          (member) => member.id === assigned.assignee_id,
        )?.username,
      ).toBe('field-one')
      await client.deleteDraftTask(task.id)
      expect((await client.getPlan(plan.id)).tasks).toHaveLength(0)
    },
  )
})

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

    expect(plans).toEqual({ items: [], next_cursor: 'cursor-2' })
    expect(task.items[0].current_snapshot?.title).toBe('外牆檢查')
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
