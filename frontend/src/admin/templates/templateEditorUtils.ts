import type { InspectionPoint, MeasurementField, TemplateItem } from './api'

export function numberFields(point: InspectionPoint): MeasurementField[] {
  return point.measurement_fields.filter(
    (field) => field.field_type === 'number',
  )
}

export function localizeField(field: MeasurementField): MeasurementField {
  const clientKey =
    field.clientKey ?? field.client_id ?? field.id ?? crypto.randomUUID()
  return {
    ...field,
    client_id: field.client_id ?? field.id ?? clientKey,
    clientKey,
  }
}

export function boundField(
  point: InspectionPoint,
): MeasurementField | undefined {
  const key = point.numeric_standard?.measurement_field_client_key
  if (!key) return undefined
  return point.measurement_fields.find((field) => field.clientKey === key)
}

export function addNumberField(point: InspectionPoint): InspectionPoint {
  const clientKey = crypto.randomUUID()
  const field: MeasurementField = {
    client_id: clientKey,
    clientKey,
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
          measurement_field_client_key: field.clientKey,
          measurement_field_client_id: undefined,
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
      measurement_field_id: undefined,
      measurement_field_client_id: undefined,
      measurement_field_client_key:
        existing?.measurement_field_client_key ??
        (fields.length === 1 ? fields[0].clientKey : ''),
    },
  }
}

export function forWire(item: TemplateItem): TemplateItem {
  return {
    system_id: item.system_id,
    sequence: item.sequence,
    title: item.title.trim(),
    instruction: item.instruction,
    inspection_points: item.inspection_points.map((point) => {
      const fields = point.measurement_fields.map(localizeField)
      const numeric = point.numeric_standard
      const keyByClientId = new Map(
        fields
          .filter((field) => field.client_id)
          .map((field) => [field.client_id!, field.clientKey!]),
      )
      const keyById = new Map(
        fields
          .filter((field) => field.id)
          .map((field) => [field.id!, field.clientKey!]),
      )
      const boundKey =
        numeric?.measurement_field_client_key ??
        (numeric?.measurement_field_client_id
          ? keyByClientId.get(numeric.measurement_field_client_id)
          : undefined) ??
        (numeric?.measurement_field_id
          ? keyById.get(numeric.measurement_field_id)
          : undefined)
      const bound = fields.find(
        (field) => Boolean(boundKey) && field.clientKey === boundKey,
      )
      const interval =
        numeric?.condition === 'range' && numeric.range_form === 'interval'
      const clean = (value: string | null | undefined) => value?.trim() || null
      return {
        sequence: point.sequence,
        title: point.title.trim(),
        instruction: point.instruction,
        measurement_fields: fields.map((field) => ({
          client_id: field.client_id,
          name: field.name.trim(),
          field_type: field.field_type,
          unit:
            field.field_type === 'number' &&
            Boolean(bound) &&
            field.clientKey === bound?.clientKey
              ? null
              : field.field_type === 'number'
                ? clean(field.unit)
                : null,
        })),
        numeric_standard: numeric
          ? {
              value: interval ? null : clean(numeric.value),
              condition: numeric.condition,
              unit: bound?.unit?.trim() ?? numeric.unit?.trim() ?? '',
              tolerance: interval ? null : clean(numeric.tolerance),
              range_form:
                numeric.condition === 'range'
                  ? (numeric.range_form ?? 'tolerance')
                  : null,
              lower_bound: interval ? clean(numeric.lower_bound) : null,
              upper_bound: interval ? clean(numeric.upper_bound) : null,
              measurement_field_client_id: bound?.client_id,
            }
          : null,
        text_standard: point.text_standard
          ? { text: point.text_standard.text.trim() }
          : null,
        evidence_requirements: point.evidence_requirements.map((entry) => ({
          min_count: entry.min_count,
        })),
      }
    }),
  }
}

export function numericSummary(point: InspectionPoint): string {
  const standard = point.numeric_standard
  if (!standard) return point.text_standard?.text.trim() || '未設定標準'
  const unit = boundField(point)?.unit ?? standard.unit
  if (standard.condition === 'range') {
    if ((standard.range_form ?? 'tolerance') === 'interval') {
      const lower = standard.lower_bound ?? ''
      const upper = standard.upper_bound ?? ''
      if (!lower.trim() || !upper.trim()) return '？'
      return `${lower}～${upper} ${unit}`
    }
    if (!standard.value?.trim() || !standard.tolerance?.trim()) return '？'
    return `${standard.value ?? ''} ± ${standard.tolerance ?? ''} ${unit}`
  }
  if (!standard.value?.trim()) return '？'
  const symbols = { '<=': '≤', '>=': '≥', '=': '＝', range: '範圍' }
  const tolerance =
    standard.condition === '=' && standard.tolerance?.trim()
      ? ` ± ${standard.tolerance}`
      : ''
  return `${symbols[standard.condition]} ${standard.value}${tolerance} ${unit}`
}
