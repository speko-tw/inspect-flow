import { describe, expect, it } from 'vitest'

import { createMockPlanningClient } from './api'

const PROJECT = 'project-demo-1'

describe('mock planning client', () => {
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

      expect(dispatched.suggested_assignee?.id).toBe('project-a-member-1')
      expect(started.started_by).toBe('project-a-member-2')
      expect(completed.completed_by).toBe('project-a-member-2')
      expect((await client.listPlans(PROJECT))[0].status).toBe('COMPLETED')
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
    expect((await client.listPlans(PROJECT))[0].status).toBe('DRAFT')

    const dispatched = await client.dispatchTask(task.id)
    expect(dispatched.status).toBe('PENDING')
    expect((await client.listPlans(PROJECT))[0].status).toBe('IN_PROGRESS')

    const cancelled = await client.cancelTask(task.id, '施工順序調整')
    expect(cancelled.status).toBe('CANCELLED')
    expect(cancelled.cancellation_reason).toBe('施工順序調整')
    expect((await client.listPlans(PROJECT))[0].status).toBe('CANCELLED')

    const restored = await client.restoreTask(task.id)
    expect(restored.status).toBe('PENDING')
    expect((await client.listPlans(PROJECT))[0].status).toBe('IN_PROGRESS')
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
        code: 'project_zone.required',
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
        code: 'project_zone.invalid',
      })
      await expect(client.createZone(PROJECT, '   ')).rejects.toMatchObject({
        status: 422,
        code: 'project_zone.name_invalid',
      })
      await expect(
        client.createZone(PROJECT, 'a'.repeat(129)),
      ).rejects.toMatchObject({
        status: 422,
        code: 'project_zone.name_invalid',
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
      expect(task.location.location_text).toBe('北側入口')
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
        code: 'inspection_task.location_too_long',
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
        (await client.listPlans(PROJECT))[0].tasks[0].items[0].title,
      ).toBe(task.items[0].title)
    },
  )

  it(
    'rejects invalid transitions and plan mutations after ' + 'archive',
    async () => {
      const client = createMockPlanningClient()
      const plan = await client.createPlan(PROJECT, { name: '封存' })
      await client.updatePlan(plan.id, { name: '  已更名  ' })
      expect((await client.listPlans(PROJECT))[0].name).toBe('已更名')
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
      expect(assigned.suggested_assignee?.username).toBe('field-one')
      await client.deleteDraftTask(task.id)
      expect((await client.listPlans(PROJECT))[0].tasks).toHaveLength(0)
    },
  )
})
