type NumericStandard = {
  value: string | null
  condition: '<=' | '>=' | '=' | 'range'
  unit: string
  tolerance: string | null
  range_form?: 'interval' | 'tolerance' | null
  lower_bound?: string | null
  upper_bound?: string | null
  measurement_field_id?: string | null
  measurement_field_client_key?: string
}

type InspectionPointStandard = {
  text_standard: { text: string } | null
  numeric_standard: NumericStandard | null
  measurement_fields: Array<{
    id?: string
    clientKey?: string
    unit: string | null
  }>
}

export function formatInspectionStandard(
  point: InspectionPointStandard,
): string {
  const standard = point.numeric_standard
  if (!standard) return point.text_standard?.text.trim() || '標準未設定'

  const bound = point.measurement_fields.find(
    (field) =>
      (standard.measurement_field_client_key &&
        field.clientKey === standard.measurement_field_client_key) ||
      (standard.measurement_field_id &&
        field.id === standard.measurement_field_id),
  )
  const unit = (bound?.unit ?? standard.unit).trim()
  const suffix = unit ? ` ${unit}` : ''

  if (standard.condition === 'range') {
    if ((standard.range_form ?? 'tolerance') === 'interval') {
      const lower = standard.lower_bound?.trim()
      const upper = standard.upper_bound?.trim()
      if (lower && upper) return `${lower}～${upper}${suffix}`
      if (lower) return `≥ ${lower}${suffix}`
      if (upper) return `≤ ${upper}${suffix}`
      return '標準未設定'
    }
    const value = standard.value?.trim()
    const tolerance = standard.tolerance?.trim()
    return value && tolerance
      ? `${value} ± ${tolerance}${suffix}`
      : '標準未設定'
  }

  const value = standard.value?.trim()
  if (!value) return '標準未設定'
  const symbol = { '<=': '≤', '>=': '≥', '=': '＝' }[standard.condition]
  const tolerance = standard.tolerance?.trim()
  const extra =
    standard.condition === '=' && tolerance ? ` ± ${tolerance}` : ''
  return `${symbol} ${value}${extra}${suffix}`
}
