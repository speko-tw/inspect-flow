import { describe, expect, it } from 'vitest'

import type { TemplateItem } from './api'
import { validateItemFields } from './itemFieldValidation'
import {
  forWire,
  localizeTemplateItem,
  templateFieldErrorBindings,
} from './templateEditorUtils'

function draft(): TemplateItem {
  return {
    title: '厚度查核',
    system_id: 'system',
    sequence: 1,
    instruction: '',
    inspection_points: [
      {
        id: 'point',
        clientKey: 'stable-point',
        title: '厚度',
        instruction: '',
        sequence: 1,
        text_standard: null,
        numeric_standard: {
          condition: 'range',
          range_form: 'interval',
          lower_bound: '0',
          upper_bound: '1',
          value: null,
          tolerance: null,
          unit: 'mm',
          measurement_field_client_key: 'field',
        },
        measurement_fields: [
          {
            clientKey: 'field',
            client_id: 'field',
            name: '厚度',
            field_type: 'number',
            unit: 'mm',
          },
        ],
        evidence_requirements: [{ min_count: 1 }],
      },
    ],
  }
}

describe('validateItemFields', () => {
  it.each(['', '   ', 'NaN', 'Infinity'])('拒絕無效界限 %j', (value) => {
    const item = draft()
    item.inspection_points[0].numeric_standard!.lower_bound = value
    expect(validateItemFields(item, {})).toEqual({
      'point:0:lower': '請填寫有效的下限',
    })
    item.inspection_points[0].numeric_standard!.lower_bound = '0'
    item.inspection_points[0].numeric_standard!.upper_bound = value
    expect(validateItemFields(item, {})).toEqual({
      'point:0:upper': '請填寫有效的上限',
    })
  })

  it('零界限有效，反向區間回報下限錯誤', () => {
    const item = draft()
    expect(validateItemFields(item, {})).toEqual({})
    item.inspection_points[0].numeric_standard!.upper_bound = '-1'
    expect(validateItemFields(item, {})).toEqual({
      'point:0:range': '下限不能大於上限',
    })
  })

  it.each(['=', '<=', '>='] as const)(
    '非區間 %s 接受有限負容差',
    (condition) => {
      const item = draft()
      Object.assign(item.inspection_points[0].numeric_standard!, {
        condition,
        range_form: null,
        value: '3',
        tolerance: '-0.5',
      })
      expect(validateItemFields(item, {})).toEqual({})
      item.inspection_points[0].numeric_standard!.tolerance = 'Infinity'
      expect(validateItemFields(item, {})).toEqual({
        'point:0:tolerance': '請填寫有效的容許誤差',
      })
      item.inspection_points[0].numeric_standard!.tolerance = null
      expect(validateItemFields(item, {})).toEqual({})
    },
  )

  it('範圍的標準值加誤差仍拒絕負容差', () => {
    const item = draft()
    Object.assign(item.inspection_points[0].numeric_standard!, {
      range_form: 'tolerance',
      value: '3',
      tolerance: '-0.5',
    })
    expect(validateItemFields(item, {})).toEqual({
      'point:0:tolerance': '容許誤差不能小於 0',
    })
  })

  it('舊格式預設在讀取、檢查、送出及錯誤綁定均採 tolerance', () => {
    const item = draft()
    const standard = item.inspection_points[0].numeric_standard!
    delete standard.range_form
    Object.assign(standard, {
      value: '3',
      tolerance: '0.5',
      lower_bound: null,
      upper_bound: null,
    })
    expect(validateItemFields(item, {})).toEqual({})
    expect(
      localizeTemplateItem(item).inspection_points[0].numeric_standard,
    ).toMatchObject({ range_form: 'tolerance' })
    expect(forWire(item).inspection_points[0].numeric_standard).toMatchObject({
      range_form: 'tolerance',
      value: '3',
      tolerance: '0.5',
    })
    expect(templateFieldErrorBindings(item)).toContainEqual({
      path: '/inspection_points/0/numeric_standard/value',
      key: 'point:0:value',
    })
  })

  it('穩定項次識別不受索引改變影響，欄位必填與照片錯誤一併收集', () => {
    const item = draft()
    item.title = ''
    item.inspection_points[0].title = ''
    item.inspection_points[0].measurement_fields[0].unit = ''
    expect(
      validateItemFields(item, { '0': '0' }, { stablePointErrorKeys: true }),
    ).toMatchObject({
      title: '請填寫查核項目名稱',
      'point:stable-point:title': '請填寫項次標題',
      'point:stable-point:field:0:unit': '請填寫單位',
      'point:stable-point:photos': '照片至少需要 1 張',
    })
    item.inspection_points.unshift({
      ...draft().inspection_points[0],
      clientKey: 'new-point',
    })
    expect(
      validateItemFields(item, { '1': '0' }, { stablePointErrorKeys: true }),
    ).toHaveProperty('point:stable-point:photos', '照片至少需要 1 張')
  })
})
