import { describe, expect, it } from 'vitest'

import payloadFixture from './fixtures/template-item-payload.json'
import type { TemplateItem } from './api'
import { forWire, templateFieldErrorBindings } from './templateEditorUtils'

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
    expect(bindings).toContainEqual({
      path: '/items/3/inspection_points/6/sequence',
      key: 'point:6:title',
    })
  })

  it('matches single-item service paths for sequence and title errors', () => {
    const item = JSON.parse(JSON.stringify(payloadFixture)) as TemplateItem
    const bindings = templateFieldErrorBindings(item)

    expect(bindings).toContainEqual({
      path: '/inspection_points/6/sequence',
      key: 'point:6:title',
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
})
