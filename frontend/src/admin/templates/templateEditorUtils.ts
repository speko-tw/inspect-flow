import type { InspectionPoint, MeasurementField } from './api'

export function numberFields(point: InspectionPoint): MeasurementField[] {
  return point.measurement_fields.filter(
    (field) => field.field_type === 'number',
  )
}

export function boundField(
  point: InspectionPoint,
): MeasurementField | undefined {
  const standard = point.numeric_standard
  return point.measurement_fields.find(
    (field) =>
      field.client_id === standard?.measurement_field_client_id ||
      field.id === standard?.measurement_field_id,
  )
}

export function addNumberField(point: InspectionPoint): InspectionPoint {
  const field: MeasurementField = {
    client_id: crypto.randomUUID(),
    name: '',
    field_type: 'number',
    unit: '',
  }
  const fields = [...point.measurement_fields, field]
  const standard = point.numeric_standard
  return {
    ...point,
    measurement_fields: fields,
    numeric_standard: standard
      ? {
          ...standard,
          measurement_field_client_id: field.client_id,
          measurement_field_id: undefined,
          unit: '',
        }
      : standard,
  }
}

export function numberStandard(point: InspectionPoint): InspectionPoint {
  let next = point
  if (!numberFields(point).length) next = addNumberField(point)
  const fields = numberFields(next)
  const existing = next.numeric_standard
  return {
    ...next,
    text_standard: null,
    numeric_standard: {
      value: existing?.value ?? '',
      condition: existing?.condition ?? 'range',
      unit: boundField(next)?.unit ?? existing?.unit ?? '',
      tolerance: existing?.tolerance ?? '',
      range_form: existing?.range_form ?? 'interval',
      lower_bound: existing?.lower_bound ?? '',
      upper_bound: existing?.upper_bound ?? '',
      measurement_field_id:
        existing?.measurement_field_id ??
        (fields.length === 1 ? fields[0].id : undefined),
      measurement_field_client_id:
        existing?.measurement_field_client_id ??
        (fields.length === 1 ? fields[0].client_id : ''),
    },
  }
}

export function numericSummary(point: InspectionPoint): string {
  const standard = point.numeric_standard
  if (!standard) return point.text_standard?.text || '不設定標準'
  const unit = boundField(point)?.unit ?? standard.unit
  if (standard.condition === 'range') {
    if ((standard.range_form ?? 'tolerance') === 'interval') {
      const lower = standard.lower_bound ?? ''
      const upper = standard.upper_bound ?? ''
      return `${lower}～${upper} ${unit}`
    }
    return `${standard.value ?? ''} ± ${standard.tolerance ?? ''} ${unit}`
  }
  const symbols = { '<=': '≤', '>=': '≥', '=': '＝', range: '範圍' }
  return `${symbols[standard.condition]} ${standard.value ?? ''} ${unit}`
}
