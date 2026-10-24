import type { InspectionPoint, MeasurementField, TemplateItem } from './api'

/** TPL-R24 欄位錯誤碼；共用表單錯誤仍交給 `fieldErrorMessage` 處理。 */
export const TEMPLATE_FIELD_ERROR_MESSAGES: Readonly<Record<string, string>> =
  {
    'template.sequence_duplicate': '項次順序重複，請檢查項次。',
    'template.photo_requirement_count': '每個項次必須設定一筆照片需求。',
    'template.client_id_duplicate': '實測欄位識別重複，請重新設定欄位。',
    'template.numeric_field_unbound': '請選擇有效的數字欄位。',
    'template.numeric_unit_required': '請填寫數字欄位的單位。',
    'template.text_unit_forbidden': '文字欄位不需要單位。',
    'template.bound_field_unit_forbidden': '綁定欄位的單位由數值標準帶入。',
  }

/**
 * 建立空白查核項次；需在增刪項次後維持錯誤與 React key 時產生 clientKey。
 */
export function blankPoint(
  sequence: number,
  options: { stableClientKey?: boolean } = {},
): InspectionPoint {
  return {
    ...(options.stableClientKey ? { clientKey: crypto.randomUUID() } : {}),
    sequence,
    title: '',
    instruction: '',
    text_standard: null,
    numeric_standard: null,
    measurement_fields: [],
    evidence_requirements: [{ min_count: 1 }],
  }
}

/** 依 TPL-R13 將舊格式缺省形式視為標準值加誤差；新區間須明選。 */
export function rangeForm(
  standard: NonNullable<InspectionPoint['numeric_standard']>,
): 'interval' | 'tolerance' {
  return standard.range_form ?? 'tolerance'
}

/**
 * 將項次欄位轉成編輯器使用的 clientKey 關聯；持久 ID 只留在子項欄位。
 * `stablePointKeys` 用於會重排項次的專案編輯，`fillBoundFieldUnit` 用於
 * 範本 API 對綁定欄位回傳空單位的情形。
 */
export function localizeInspectionPoints(
  points: InspectionPoint[],
  options: {
    stablePointKeys?: boolean
    fillBoundFieldUnit?: boolean
  } = {},
): InspectionPoint[] {
  const { stablePointKeys = false, fillBoundFieldUnit = false } = options
  return points.map((point) => {
    const fields = point.measurement_fields.map(localizeField)
    const standard = point.numeric_standard
    const boundKey =
      standard?.measurement_field_client_key ??
      fields.find(
        (field) =>
          Boolean(
            standard?.measurement_field_client_id &&
            field.client_id === standard.measurement_field_client_id,
          ) ||
          Boolean(
            standard?.measurement_field_id &&
            field.id === standard.measurement_field_id,
          ),
      )?.clientKey

    return {
      ...point,
      ...(stablePointKeys
        ? { clientKey: point.clientKey ?? point.id ?? crypto.randomUUID() }
        : {}),
      measurement_fields: fields.map((field) =>
        fillBoundFieldUnit &&
        Boolean(standard) &&
        Boolean(boundKey) &&
        field.clientKey === boundKey
          ? { ...field, unit: field.unit ?? standard?.unit ?? '' }
          : field,
      ),
      numeric_standard: standard
        ? {
            ...standard,
            ...(standard.condition === 'range'
              ? { range_form: rangeForm(standard) }
              : {}),
            measurement_field_id: undefined,
            measurement_field_client_id: undefined,
            measurement_field_client_key: boundKey,
          }
        : null,
    }
  })
}

/** 將範本 API 資料轉成編輯器草稿，並保留範本欄位單位的顯示值。 */
export function localizeTemplateItem(item: TemplateItem): TemplateItem {
  return {
    ...item,
    inspection_points: localizeInspectionPoints(item.inspection_points, {
      fillBoundFieldUnit: true,
    }),
  }
}

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

/**
 * 正規化範本與專案項目的寫入格式；依 IP-R13 選擇是否保留既有 id。
 */
export function forWire(
  item: TemplateItem,
  options: { includeIds?: boolean } = {},
): TemplateItem {
  const { includeIds = false } = options
  return {
    ...(includeIds && item.id ? { id: item.id } : {}),
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
        numeric?.condition === 'range' && rangeForm(numeric) === 'interval'
      const clean = (value: string | null | undefined) => value?.trim() || null
      return {
        ...(includeIds && point.id ? { id: point.id } : {}),
        sequence: point.sequence,
        title: point.title.trim(),
        instruction: point.instruction,
        measurement_fields: fields.map((field) => ({
          ...(includeIds && field.id ? { id: field.id } : {}),
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
                numeric.condition === 'range' ? rangeForm(numeric) : null,
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

/**
 * 把後端欄位錯誤的 JSON pointer 對到畫面的錯誤 key。
 * `stablePointErrorKeys` 為 true（專案項目編輯）時以 clientKey／id 取代
 * 索引：項次可被刪除或新增，索引會位移，錯誤就會顯示在錯的項次上。
 */
export function templateFieldErrorBindings(
  item: TemplateItem,
  itemIndex?: number,
  stablePointErrorKeys = false,
): Array<{ path: string; key: string }> {
  const prefix = itemIndex === undefined ? '' : `/items/${itemIndex}`
  const bindings: Array<{ path: string; key: string }> = [
    { path: `${prefix}/title`, key: 'title' },
  ]
  item.inspection_points.forEach((point, pointIndex) => {
    const pointPath = `${prefix}/inspection_points/${pointIndex}`
    const pointIdentity = stablePointErrorKeys
      ? (point.clientKey ?? point.id ?? pointIndex)
      : pointIndex
    const pointKey = `point:${pointIdentity}`
    bindings.push(
      { path: `${pointPath}/title`, key: `${pointKey}:title` },
      { path: `${pointPath}/instruction`, key: `${pointKey}:instruction` },
    )
    point.measurement_fields.forEach((field, fieldIndex) => {
      const fieldPath = `${pointPath}/measurement_fields/${fieldIndex}`
      const fieldKey = `${pointKey}:field:${fieldIndex}`
      bindings.push(
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
        standard.condition === 'range' && rangeForm(standard) === 'interval'
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
