import { afterEach, describe, expect, it, vi } from 'vitest'

import { ManagementApiError } from '../api'
import { projectItemApi, type ProjectItemChange } from '../projectItems/api'
import { planningClient, type CreateTaskInput } from './api'
import contract from './fixtures/inspection-planning-boundary.json'

const PROJECT_ID = 'project-1'
const ZONE_PROJECT_ID = 'project-zones'
const ZONE_ID = '0199aabb-ccdd-7eef-8abc-1234567890ab'
const ZONE_PROJECT_ZONE_ID = '0199aabb-ccdd-7eef-8abc-1234567890ac'
const PLAN_ID = 'plan-1'
const TASK_ID = 'task-1'
const ITEM_ID = 'item-1'
const POINT_ID = 'point-1'
const ASSIGNEE_ID = 'assignee-1'

type ContractRequest = {
  method: string
  path: string
  body?: Record<string, unknown>
}

const ids: Record<string, string> = {
  $PROJECT_ID: PROJECT_ID,
  $ZONE_PROJECT_ID: ZONE_PROJECT_ID,
  // 固定 UUID 代表新增的有分區 Task 情境，
  // 確保 wire body 帶有效 ID。
  $ZONE_ID: ZONE_ID,
  $PLAN_ID: PLAN_ID,
  $TASK_ID: TASK_ID,
  $ITEM_ID: ITEM_ID,
  $POINT_ID: POINT_ID,
  $ASSIGNEE_ID: ASSIGNEE_ID,
}

// 共用同一組 wire 輸入，讓前端 client 的路徑與 body 和後端 API 契約
// 使用相同來源，避免兩邊各自維護出不同的「正確答案」（RG-M22）。
function bindIds<T>(value: T): T {
  let serialized = JSON.stringify(value)
  for (const [token, id] of Object.entries(ids)) {
    serialized = serialized.replaceAll(token, id)
  }
  return JSON.parse(serialized) as T
}

afterEach(() => vi.unstubAllGlobals())

describe('inspection planning frontend/backend boundary fixture', () => {
  it(
    [
      'sends the shared workflow contract through the ',
      'real API clients',
    ].join(''),
    async () => {
      const observed: Array<{
        url: string
        method: string
        body?: unknown
      }> = []
      const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
        const body =
          typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
        observed.push({
          url: String(input),
          method: init?.method ?? 'GET',
          ...(body === undefined ? {} : { body }),
        })
        if (
          String(input).endsWith(':dispatch') &&
          observed.filter((request) => request.url.endsWith(':dispatch'))
            .length === 1
        ) {
          return Response.json(
            { error: { code: 'inspection_plan.archived' } },
            { status: 409 },
          )
        }
        if (init?.method === 'POST' && String(input).endsWith('/zones')) {
          const projectId = String(input).includes(
            `/projects/${PROJECT_ID}/zones`,
          )
            ? PROJECT_ID
            : ZONE_PROJECT_ID
          return Response.json({
            id: projectId === PROJECT_ID ? ZONE_ID : ZONE_PROJECT_ZONE_ID,
            project_id: projectId,
            name: (body as { name: string }).name,
          })
        }
        return Response.json({})
      })
      vi.stubGlobal('fetch', fetchMock)

      const requests = contract.requests
      const zone = bindIds(requests.zone_create.body!)
      await planningClient.createZone(ZONE_PROJECT_ID, zone.name as string)

      const plan = bindIds(requests.plan_create.body!)
      await planningClient.createPlan(PROJECT_ID, {
        name: plan.name as string,
      })

      const task = bindIds(requests.task_create.body!)
      await planningClient.createTask(
        PLAN_ID,
        task as unknown as CreateTaskInput,
      )

      const taskZone = bindIds(requests.task_zone_create.body!)
      const createdTaskZone = await planningClient.createZone(
        PROJECT_ID,
        taskZone.name as string,
      )

      const zonedTask = bindIds(
        requests.task_create_with_zone.body!,
      ) as unknown as CreateTaskInput
      // 後續 Task 必須沿用 createZone 的回應 ID（RG-M22）。
      expect(zonedTask.zone_id).toBe(createdTaskZone.id)
      await planningClient.createTask(PLAN_ID, {
        ...zonedTask,
        zone_id: createdTaskZone.id,
      })
      await planningClient.setSuggestedAssignee(TASK_ID, ASSIGNEE_ID)
      await planningClient.archivePlan(PLAN_ID)
      await expect(planningClient.dispatchTask(TASK_ID)).rejects.toMatchObject(
        {
          status: 409,
          code: 'inspection_plan.archived',
        } satisfies Partial<ManagementApiError>,
      )
      await planningClient.unarchivePlan(PLAN_ID)
      await planningClient.dispatchTask(TASK_ID)
      await planningClient.startTask(TASK_ID)

      for (const key of ['item_reinspect_yes', 'item_reinspect_no'] as const) {
        const change = bindIds(
          requests[key].body!,
        ) as unknown as ProjectItemChange
        await projectItemApi.update(PROJECT_ID, ITEM_ID, change)
      }

      const cancel = bindIds(requests.task_cancel.body!)
      await planningClient.cancelTask(TASK_ID, cancel.reason as string)
      await planningClient.restoreTask(TASK_ID)
      await planningClient.archivePlan(PLAN_ID)

      // 依 fixture 的鍵值順序比對，
      // 確保新增情境也必須真的送出。
      const expected = Object.entries(requests).map(([, request]) => {
        const bound = bindIds(request as ContractRequest)
        return {
          url: `/api/v1${bound.path}`,
          method: bound.method,
          ...(bound.body === undefined ? {} : { body: bound.body }),
        }
      })
      expect(observed).toEqual(expected)
    },
  )
})
