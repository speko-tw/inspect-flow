import { afterEach, describe, expect, it, vi } from 'vitest'

import { HttpError, request } from '../../http'
import { fieldErrorMessage, mapFieldErrors } from '../../ui/fieldErrors'
import payloadFixture from './fixtures/template-item-payload.json'
import templateWriteErrorFixture from './fixtures/template-write-field-error.json'
import type { TemplateItem } from './api'
import {
  blankPoint,
  forWire,
  localizeInspectionPoints,
  localizeTemplateItem,
  TEMPLATE_FIELD_ERROR_MESSAGES,
  templateFieldErrorBindings,
} from './templateEditorUtils'

afterEach(() => vi.unstubAllGlobals())

describe('forWire', () => {
  it('matches the shared payload sent to the template API', () => {
    const draft = JSON.parse(JSON.stringify(payloadFixture)) as TemplateItem
    draft.id = 'server-template-id'
    draft.inspection_points.forEach((point, index) => {
      point.id = `server-point-${index}`
      const standard = point.numeric_standard
      const bound = point.measurement_fields.find(
        (field) => field.client_id === standard?.measurement_field_client_id,
      )
      if (standard && bound) bound.unit = standard.unit
    })

    expect(JSON.parse(JSON.stringify(forWire(draft)))).toEqual(payloadFixture)
  })
})

describe('editor localization helpers', () => {
  const item: TemplateItem = {
    system_id: 'system-1',
    sequence: 1,
    title: '高度',
    instruction: '',
    inspection_points: [
      {
        id: 'point-1',
        sequence: 1,
        title: '量測高度',
        instruction: '',
        text_standard: null,
        numeric_standard: {
          value: '110',
          condition: '>=',
          unit: 'cm',
          tolerance: null,
          measurement_field_id: 'field-1',
        },
        measurement_fields: [
          {
            id: 'field-1',
            name: '高度',
            field_type: 'number',
            unit: null,
          },
        ],
        evidence_requirements: [{ min_count: 1 }],
      },
    ],
  }

  it('turns persisted bindings into client keys and clears server binding IDs', () => {
    const [point] = localizeInspectionPoints(item.inspection_points, {
      stablePointKeys: true,
    })

    expect(point.clientKey).toBe('point-1')
    expect(point.measurement_fields[0]).toMatchObject({
      id: 'field-1',
      client_id: 'field-1',
      clientKey: 'field-1',
      unit: null,
    })
    expect(point.numeric_standard).toMatchObject({
      measurement_field_id: undefined,
      measurement_field_client_id: undefined,
      measurement_field_client_key: 'field-1',
    })
  })

  it('fills a missing bound-field unit only for template editor data', () => {
    const [projectPoint] = localizeInspectionPoints(item.inspection_points)
    const templateItem = localizeTemplateItem(item)

    expect(projectPoint.measurement_fields[0].unit).toBeNull()
    expect(templateItem.inspection_points[0].measurement_fields[0].unit).toBe(
      'cm',
    )
  })

  it('adds stable keys to new project points only when requested', () => {
    expect(blankPoint(1)).not.toHaveProperty('clientKey')
    expect(blankPoint(1, { stableClientKey: true }).clientKey).toEqual(
      expect.any(String),
    )
  })

  it('maps the template text-unit error through the shared field formatter', () => {
    expect(
      fieldErrorMessage(
        'template.text_unit_forbidden',
        TEMPLATE_FIELD_ERROR_MESSAGES,
      ),
    ).toBe('文字欄位不需要單位。')
  })
})

describe('templateFieldErrorBindings', () => {
  it('maps known fields for a nested system replacement item', () => {
    const item = JSON.parse(JSON.stringify(payloadFixture)) as TemplateItem
    const bindings = templateFieldErrorBindings(item, 3)

    expect(bindings).toContainEqual({
      path: '/items/3/title',
      key: 'title',
    })
    expect(bindings).toContainEqual({
      path: '/items/3/inspection_points/6/measurement_fields/1/unit',
      key: 'point:6:field:1:unit',
    })
    expect(bindings).toContainEqual({
      path: '/items/3/inspection_points/6/numeric_standard/measurement_field_client_id',
      key: 'point:6:binding',
    })
    expect(bindings).not.toContainEqual({
      path: '/items/3/inspection_points/6/sequence',
      key: 'point:6:title',
    })
    expect(bindings).not.toContainEqual({
      path: '/items/3/inspection_points/6/measurement_fields/1/client_id',
      key: 'point:6:field:1:name',
    })
  })

  it('uses stable point keys only when the caller requests them', () => {
    const item = JSON.parse(JSON.stringify(payloadFixture)) as TemplateItem
    item.inspection_points[6].clientKey = 'stable-point-key'

    expect(templateFieldErrorBindings(item)).toContainEqual({
      path: '/inspection_points/6/title',
      key: 'point:6:title',
    })
    expect(templateFieldErrorBindings(item, undefined, true)).toContainEqual({
      path: '/inspection_points/6/title',
      key: 'point:stable-point-key:title',
    })
  })

  it('does not guess a control for sequence and client ID errors', () => {
    const item = JSON.parse(JSON.stringify(payloadFixture)) as TemplateItem
    const bindings = templateFieldErrorBindings(item)

    expect(bindings).not.toContainEqual({
      path: '/inspection_points/6/sequence',
      key: 'point:6:title',
    })
    expect(bindings).not.toContainEqual({
      path: '/inspection_points/6/measurement_fields/0/client_id',
      key: 'point:6:field:0:name',
    })
    expect(bindings).toContainEqual({
      path: '/inspection_points/6/title',
      key: 'point:6:title',
    })
  })

  it('binds only numeric controls visible for the selected range form', () => {
    const item = JSON.parse(JSON.stringify(payloadFixture)) as TemplateItem
    const intervalBindings = templateFieldErrorBindings(item)
    expect(intervalBindings).toContainEqual({
      path: '/inspection_points/6/numeric_standard/lower_bound',
      key: 'point:6:lower',
    })
    expect(intervalBindings).not.toContainEqual({
      path: '/inspection_points/6/numeric_standard/value',
      key: 'point:6:value',
    })
    expect(intervalBindings).not.toContainEqual({
      path: '/inspection_points/6/numeric_standard/tolerance',
      key: 'point:6:tolerance',
    })

    item.inspection_points[6].numeric_standard!.range_form = 'tolerance'
    const toleranceBindings = templateFieldErrorBindings(item)
    expect(toleranceBindings).toContainEqual({
      path: '/inspection_points/6/numeric_standard/value',
      key: 'point:6:value',
    })
    expect(toleranceBindings).toContainEqual({
      path: '/inspection_points/6/numeric_standard/tolerance',
      key: 'point:6:tolerance',
    })
    expect(toleranceBindings).not.toContainEqual({
      path: '/inspection_points/6/numeric_standard/lower_bound',
      key: 'point:6:lower',
    })
  })

  it('maps the shared real template-write error envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        Response.json(templateWriteErrorFixture, { status: 422 }),
      ),
    )
    let fields: Array<{ path: string; code: string }> = []
    try {
      await request('/templates', {
        method: 'POST',
        body: JSON.stringify(payloadFixture),
      })
    } catch (caught) {
      expect(caught).toBeInstanceOf(HttpError)
      fields = (caught as HttpError).fields ?? []
    }
    expect(
      mapFieldErrors(
        fields,
        templateFieldErrorBindings(payloadFixture as TemplateItem),
      ),
    ).toEqual({
      errors: {},
      unmatched: templateWriteErrorFixture.error.fields,
    })
  })
})
