import { afterEach, describe, expect, it, vi } from 'vitest'

import type { InspectionPoint } from '../templates/api'
import { HttpError, request } from '../../http'
import { mapFieldErrors } from '../../ui/fieldErrors'
import {
  listProjectItems,
  projectItemApi,
  serializeProjectItemPoints,
} from './api'
import boundUnitFixture from './fixtures/project-patch-bound-unit.json'
import structureFixture from './fixtures/project-patch-structure.json'
import structureLockedFixture from './fixtures/project-patch-structure-locked.json'

const item = {
  id: 'item-1',
  project_id: 'project-1',
  sequence: 1,
  title: '混凝土表面',
  instruction: '檢查表面',
  source_template_name: '範本',
  source_category_name: '土建工程',
  source_system_name: '混凝土系統',
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
  zone: { id: 'zone-1', name: '地下室北區' },
  location_text: 'B1 柱旁',
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
  it('loads every page of project items from the shared endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ items: [item], next_cursor: 'next-page' }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [{ ...item, id: 'item-2' }],
          next_cursor: null,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(listProjectItems('project-1')).resolves.toEqual([
      item,
      { ...item, id: 'item-2' },
    ])
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/projects/project-1/inspection-items?limit=100',
      expect.any(Object),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/projects/project-1/inspection-items?limit=100&cursor=next-page',
      expect.any(Object),
    )
  })

  it('serializes the shared numeric interval structure fixture', () => {
    const points = structuredClone(
      structureFixture.inspection_points,
    ) as unknown as InspectionPoint[]
    points.forEach((point) => {
      point.measurement_fields = point.measurement_fields.map((field) => ({
        ...field,
        clientKey: field.client_id,
      }))
      if (point.numeric_standard) {
        point.numeric_standard.measurement_field_client_key =
          point.numeric_standard.measurement_field_client_id
      }
    })

    const requestBody = {
      title: structureFixture.title,
      instruction: structureFixture.instruction,
      inspection_points: serializeProjectItemPoints(points),
    }

    expect(JSON.parse(JSON.stringify(requestBody))).toEqual(structureFixture)
  })

  it('parses the shared structure_locked API response fixture', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(structureLockedFixture, { status: 422 }),
      ),
    )
    await expect(
      projectItemApi.update('project-1', 'item-1', {
        title: item.title,
        instruction: item.instruction,
        inspection_points: item.inspection_points,
        reinspect: false,
      }),
    ).rejects.toMatchObject({
      code: 'project_inspection_item.structure_locked',
      status: 422,
    })
  })

  it('keeps a new measurement field identity stable and binds its numeric standard', () => {
    const clientId = 'client-field-596'
    const points: InspectionPoint[] = [
      {
        sequence: 1,
        title: '厚度',
        instruction: '',
        text_standard: null,
        numeric_standard: {
          value: '2.5',
          condition: '=',
          unit: 'mm',
          tolerance: null,
          range_form: null,
          lower_bound: null,
          upper_bound: null,
          measurement_field_client_key: clientId,
        },
        measurement_fields: [
          {
            client_id: clientId,
            clientKey: clientId,
            name: '厚度',
            field_type: 'number',
            unit: 'mm',
          },
        ],
        evidence_requirements: [{ min_count: 1 }],
      },
    ]

    const first = serializeProjectItemPoints(points)
    const second = serializeProjectItemPoints(points)

    expect(first).toEqual(second)
    expect(first[0].measurement_fields[0]).toMatchObject({
      client_id: clientId,
      name: '厚度',
      field_type: 'number',
      unit: null,
    })
    expect(first[0].numeric_standard?.measurement_field_client_id).toBe(
      clientId,
    )
    expect(first[0].numeric_standard).not.toHaveProperty(
      'measurement_field_id',
    )
  })

  it('serializes a persisted binding after its server ID is localized', () => {
    const point: InspectionPoint = {
      id: 'point-1',
      sequence: 1,
      title: '厚度',
      instruction: '',
      text_standard: null,
      numeric_standard: {
        value: '2.5',
        condition: '=',
        unit: 'mm',
        tolerance: null,
        range_form: null,
        lower_bound: null,
        upper_bound: null,
        measurement_field_id: 'field-1',
        measurement_field_client_key: 'field-1',
      },
      measurement_fields: [
        {
          id: 'field-1',
          client_id: 'field-1',
          clientKey: 'field-1',
          name: '厚度',
          field_type: 'number',
          unit: 'mm',
        },
      ],
      evidence_requirements: [{ min_count: 1 }],
    }
    const templateEditorShape = {
      ...point,
      numeric_standard: {
        ...point.numeric_standard!,
        measurement_field_id: undefined,
        measurement_field_client_id: undefined,
      },
    }

    expect(serializeProjectItemPoints([point])).toEqual(
      serializeProjectItemPoints([templateEditorShape]),
    )
    expect(
      serializeProjectItemPoints([point])[0].numeric_standard,
    ).toMatchObject({
      measurement_field_client_id: 'field-1',
      unit: 'mm',
    })
  })

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
      zoneName: '地下室北區',
      locationText: 'B1 柱旁',
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
      id: 'point-1',
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
    /**
     * fixture 是 wire body；expected 補上持久化 ID，維持真後端契約。
     */
    const expectedRequest = structuredClone(
      boundUnitFixture.request,
    ) as unknown as {
      title: string
      instruction: string
      inspection_points: InspectionPoint[]
    }
    const expectedPoint = expectedRequest.inspection_points[0]
    expectedPoint.id = 'point-1'
    expectedPoint.measurement_fields[0].id =
      '00000000-0000-4000-8000-000000000011'
    expectedPoint.measurement_fields.push({
      id: '00000000-0000-4000-8000-000000000012',
      client_id: '00000000-0000-4000-8000-000000000012',
      name: '寬度',
      field_type: 'number',
      unit: 'cm',
    })
    const point = expectedPoint
    const numericStandard = point.numeric_standard!
    await projectItemApi.update('project-1', 'item-1', {
      title: expectedRequest.title,
      instruction: expectedRequest.instruction,
      inspection_points: [
        {
          ...point,
          numeric_standard: {
            ...numericStandard,
            measurement_field_id: numericStandard.measurement_field_client_id,
          },
        },
      ],
    })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string)
    const sent = body.inspection_points[0]
    expect(body).toEqual(expectedRequest)
    expect(sent.id).toBe('point-1')
    expect(sent).not.toHaveProperty('client_id')
    expect(sent.numeric_standard.measurement_field_client_id).toBe(
      '00000000-0000-4000-8000-000000000011',
    )
    expect(sent.numeric_standard).not.toHaveProperty('measurement_field_id')
    expect(sent.measurement_fields).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000011',
        client_id: '00000000-0000-4000-8000-000000000011',
        name: '厚度',
        field_type: 'number',
        unit: null,
      },
      {
        id: '00000000-0000-4000-8000-000000000012',
        client_id: '00000000-0000-4000-8000-000000000012',
        name: '寬度',
        field_type: 'number',
        unit: 'cm',
      },
    ])
  })

  it('maps the shared real project PATCH error envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        Response.json(boundUnitFixture.error_response, { status: 422 }),
      ),
    )
    let fields: Array<{ path: string; code: string }> = []
    try {
      await request('/projects/project-1/inspection-items/item-1', {
        method: 'PATCH',
        body: JSON.stringify(boundUnitFixture.request),
      })
    } catch (caught) {
      expect(caught).toBeInstanceOf(HttpError)
      fields = (caught as HttpError).fields ?? []
    }
    expect(
      mapFieldErrors(fields, [
        {
          path: '/inspection_points/0/measurement_fields/0/unit',
          key: 'point:0:field:0:unit',
        },
      ]),
    ).toEqual({
      errors: {
        'point:0:field:0:unit': 'template.bound_field_unit_forbidden',
      },
      unmatched: [],
    })
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
