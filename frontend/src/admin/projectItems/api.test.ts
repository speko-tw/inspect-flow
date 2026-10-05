import { afterEach, describe, expect, it, vi } from 'vitest'

import type { InspectionPoint } from '../templates/api'
import { projectItemApi } from './api'

const item = {
  id: 'item-1',
  project_id: 'project-1',
  sequence: 1,
  title: '混凝土表面',
  instruction: '檢查表面',
  source_template_name: '範本',
  applied_at: '2026-10-05T00:00:00Z',
  inspection_points: [
    {
      id: 'point-1',
      sequence: 1,
      title: '裂縫',
      instruction: '檢查裂縫',
      text_standard: { text: '不得有裂縫' },
      numeric_standard: null,
      measurement_fields: [],
      evidence_requirements: [
        {
          id: 'evidence-1',
          evidence_type: 'photo',
          required: true,
          min_count: 1,
          max_count: null,
        },
      ],
    },
  ] as InspectionPoint[],
}

const snapshot = {
  revision: 1,
  source_standard_revision: 1,
  title: '混凝土表面',
  instruction: '檢查表面',
  source_template_name: '範本',
  is_current: true,
  superseded_reason: null,
  superseded_at: null,
  inspection_points: [],
}

const task = {
  id: 'task-1',
  project_id: 'project-1',
  plan_id: 'plan-1',
  status: 'COMPLETED',
  zone_id: null,
  zone: null,
  location_text: null,
  assignee_id: null,
  assignee: null,
  started_by: null,
  completed_by: null,
  cancellation_reason: null,
  cancelled_from: null,
  created_at: '2026-10-05T00:00:00Z',
  updated_at: '2026-10-05T00:00:00Z',
  plan_name: '地下室計畫',
  plan_archived: false,
  has_result: false,
  items: [
    {
      id: 'item-1',
      status: 'ACTIVE',
      needs_reinspection: false,
      snapshots: [],
      current_snapshot: snapshot,
    },
    {
      id: 'item-2',
      status: 'ACTIVE',
      needs_reinspection: false,
      snapshots: [],
      current_snapshot: { ...snapshot, title: '鋼筋間距' },
    },
  ],
}

afterEach(() => vi.unstubAllGlobals())

describe('projectItemApi', () => {
  it('reads every backend cursor page and maps Task snapshots', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          items: [item],
          next_cursor: null,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [task],
          next_cursor: 'next',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [{ ...task, id: 'task-2' }],
          next_cursor: null,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const preview = await projectItemApi.loadPreview('project-1', 'item-1')
    expect(preview.affectedTasks).toHaveLength(2)
    expect(preview.affectedTasks[0]).toMatchObject({
      id: 'task-1',
      name: '混凝土表面',
      planName: '地下室計畫',
      preservedItemTitles: ['鋼筋間距'],
    })
    expect(fetchMock.mock.calls[2][0]).toContain('cursor=next')
  })

  it('sends a strict PATCH body and reads affected_tasks', async () => {
    const response = {
      ...item,
      reinspection_selected: true,
      affected_tasks: [
        {
          task_id: 'task-1',
          prior_status: 'COMPLETED',
          status: 'IN_PROGRESS',
          action: 'returned_to_in_progress',
          needs_reinspection: false,
        },
      ],
    }
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(response))
    vi.stubGlobal('fetch', fetchMock)
    const result = await projectItemApi.update('project-1', 'item-1', {
      title: item.title,
      instruction: item.instruction,
      inspection_points: item.inspection_points,
      reinspect: true,
    })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string)
    expect(body.inspection_points[0]).toEqual({
      sequence: 1,
      title: '裂縫',
      instruction: '檢查裂縫',
      text_standard: { text: '不得有裂縫' },
      numeric_standard: null,
      measurement_fields: [],
      evidence_requirements: [{ min_count: 1 }],
    })
    expect(body).toHaveProperty('reinspect', true)
    expect(result.affected_tasks[0].action).toBe('returned_to_in_progress')
  })

  it('maps stored numeric field IDs to PATCH client IDs', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        ...item,
        affected_tasks: [],
        reinspection_selected: null,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await projectItemApi.update('project-1', 'item-1', {
      title: item.title,
      instruction: item.instruction,
      inspection_points: [
        {
          ...item.inspection_points[0],
          text_standard: null,
          numeric_standard: {
            value: '10',
            condition: '=',
            unit: 'mm',
            tolerance: null,
            measurement_field_id: 'field-1',
          },
          measurement_fields: [
            {
              id: 'field-1',
              name: '厚度',
              field_type: 'number',
              unit: 'mm',
            },
          ],
        },
      ],
    })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const sent = JSON.parse(init.body as string).inspection_points[0]
    expect(sent.measurement_fields).toEqual([
      {
        client_id: 'field-1',
        name: '厚度',
        field_type: 'number',
        unit: 'mm',
      },
    ])
    expect(sent.numeric_standard.measurement_field_client_id).toBe('field-1')
    expect(sent.numeric_standard).not.toHaveProperty('measurement_field_id')
  })

  it('uses the shared structured API error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code: 'inspection_plan.archived' } },
          { status: 409 },
        ),
      ),
    )
    await expect(
      projectItemApi.update('project-1', 'item-1', {
        title: item.title,
        instruction: item.instruction,
        inspection_points: item.inspection_points,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'inspection_plan.archived',
    })
  })
})
