import { describe, expect, it } from 'vitest'

import payloadFixture from './fixtures/template-item-payload.json'
import type { TemplateItem } from './api'
import { forWire } from './templateEditorUtils'

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
