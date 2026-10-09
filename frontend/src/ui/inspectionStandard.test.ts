import { describe, expect, it } from 'vitest'

import { formatInspectionStandard } from './inspectionStandard'

const point = {
  text_standard: null,
  numeric_standard: {
    value: null,
    condition: 'range' as const,
    unit: 'mm',
    tolerance: null,
    range_form: 'interval' as const,
    lower_bound: '3',
    upper_bound: '5',
    measurement_field_id: 'length',
  },
  measurement_fields: [{ id: 'length', unit: 'cm' }],
}

describe('formatInspectionStandard', () => {
  it('formats a two-sided interval with the bound field unit', () => {
    expect(formatInspectionStandard(point)).toBe('3～5 cm')
  })

  it('formats a value with tolerance, including zero', () => {
    expect(
      formatInspectionStandard({
        ...point,
        numeric_standard: {
          ...point.numeric_standard,
          value: '10',
          tolerance: '0',
          range_form: 'tolerance',
        },
      }),
    ).toBe('10 ± 0 cm')
  })

  it.each([
    ['3', null, '≥ 3 cm'],
    [null, '5', '≤ 5 cm'],
  ])('formats a one-sided interval', (lower, upper, expected) => {
    expect(
      formatInspectionStandard({
        ...point,
        numeric_standard: {
          ...point.numeric_standard,
          lower_bound: lower,
          upper_bound: upper,
        },
      }),
    ).toBe(expected)
  })

  it.each([
    ['<=', '≤ 5 ± 0.5 cm'],
    ['>=', '≥ 5 ± 0.5 cm'],
    ['=', '＝ 5 ± 0.5 cm'],
  ] as const)('preserves tolerance for %s', (condition, expected) => {
    expect(
      formatInspectionStandard({
        ...point,
        numeric_standard: {
          ...point.numeric_standard,
          condition,
          value: '5',
          tolerance: '0.5',
        },
      }),
    ).toBe(expected)
  })

  it('requires both interval bounds only when formatting an editor draft', () => {
    const draft = {
      ...point,
      numeric_standard: { ...point.numeric_standard, upper_bound: null },
    }
    expect(formatInspectionStandard(draft)).toBe('≥ 3 cm')
    expect(
      formatInspectionStandard(draft, { requireCompleteInterval: true }),
    ).toBe('標準未設定')
  })

  it('falls back to a text standard', () => {
    expect(
      formatInspectionStandard({
        ...point,
        numeric_standard: null,
        text_standard: { text: '  目視合格  ' },
      }),
    ).toBe('目視合格')
  })

  it('omits an empty bound field unit', () => {
    expect(
      formatInspectionStandard({
        ...point,
        measurement_fields: [{ id: 'length', unit: '' }],
      }),
    ).toBe('3～5')
  })

  it('omits a null unit', () => {
    expect(
      formatInspectionStandard({
        ...point,
        numeric_standard: { ...point.numeric_standard, unit: null },
        measurement_fields: [{ id: 'length', unit: null }],
      }),
    ).toBe('3～5')
  })

  it('uses a clear label when the standard is unset', () => {
    expect(
      formatInspectionStandard({ ...point, numeric_standard: null }),
    ).toBe('標準未設定')
    expect(
      formatInspectionStandard({
        ...point,
        numeric_standard: {
          ...point.numeric_standard,
          lower_bound: null,
          upper_bound: null,
        },
      }),
    ).toBe('標準未設定')
  })
})
