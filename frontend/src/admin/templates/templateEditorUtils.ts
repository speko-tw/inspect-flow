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
    name: point.measurement_fields.length ? '' : point.title.trim(),
    nameLinked: point.measurement_fields.length === 0,
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

export function templateFieldErrorBindings(
  item: TemplateItem,
  itemIndex?: number,
): Array<{ path: string; key: string }> {
  const prefix = itemIndex === undefined ? '' : `/items/${itemIndex}`
  const bindings: Array<{ path: string; key: string }> = [
    { path: `${prefix}/title`, key: 'title' },
  ]
  item.inspection_points.forEach((point, pointIndex) => {
    const pointPath = `${prefix}/inspection_points/${pointIndex}`
    const pointKey = `point:${pointIndex}`
    bindings.push(
      { path: `${pointPath}/sequence`, key: `${pointKey}:title` },
      { path: `${pointPath}/title`, key: `${pointKey}:title` },
      { path: `${pointPath}/instruction`, key: `${pointKey}:instruction` },
    )
    point.measurement_fields.forEach((field, fieldIndex) => {
      const fieldPath = `${pointPath}/measurement_fields/${fieldIndex}`
      const fieldKey = `${pointKey}:field:${fieldIndex}`
      bindings.push(
        { path: `${fieldPath}/client_id`, key: `${fieldKey}:name` },
        { path: `${fieldPath}/name`, key: `${fieldKey}:name` },
        { path: `${fieldPath}/field_type`, key: `${fieldKey}:type` },
        {
          path: `${fieldPath}/unit`,
          key: `${fieldKey}:${field.field_type === 'text' ? 'type' : 'unit'}`,
        },
      )
    })
    if (point.text_standard) {
      bindings.push({
        path: `${pointPath}/text_standard/text`,
        key: `${pointKey}:text`,
      })
    }
    if (point.numeric_standard) {
      const standard = point.numeric_standard
      const interval =
        standard.condition === 'range' &&
        (standard.range_form ?? 'interval') === 'interval'
      bindings.push({
        path: `${pointPath}/numeric_standard/measurement_field_client_id`,
        key: `${pointKey}:binding`,
      })
      if (interval) {
        bindings.push(
          {
            path: `${pointPath}/numeric_standard/lower_bound`,
            key: `${pointKey}:lower`,
          },
          {
            path: `${pointPath}/numeric_standard/upper_bound`,
            key: `${pointKey}:upper`,
          },
        )
      } else {
        bindings.push({
          path: `${pointPath}/numeric_standard/value`,
          key: `${pointKey}:value`,
        })
        if (
          standard.condition === 'range' ||
          standard.condition === '=' ||
          standard.tolerance
        ) {
          bindings.push({
            path: `${pointPath}/numeric_standard/tolerance`,
            key: `${pointKey}:tolerance`,
          })
        }
      }
    }
    bindings.push(
      {
        path: `${pointPath}/evidence_requirements`,
        key: `${pointKey}:photos`,
      },
      {
        path: `${pointPath}/evidence_requirements/0/min_count`,
        key: `${pointKey}:photos`,
      },
    )
  })
  return bindings
}
