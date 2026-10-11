import type { HttpFieldError } from '../http'

/** 只將 API pointer 對到本表單明確宣告的欄位。 */
export interface FieldErrorBinding {
  path: string
  key: string
}

/** 無法安全對應欄位的錯誤留在一般訊息區，不猜測輸入位置。 */
export interface MappedFieldErrors {
  errors: Record<string, string>
  unmatched: HttpFieldError[]
}

/**
 * 只對應表單已宣告的伺服器欄位 pointer；未知 pointer 保留原錯誤。
 * 規劃表單藉此依 ADM-R28 聚焦正確欄位，避免跨表單同名欄位混淆。
 */
export function mapFieldErrors(
  fields: readonly HttpFieldError[],
  bindings: readonly FieldErrorBinding[],
): MappedFieldErrors {
  const keyByPath = new Map<string, string>()
  for (const binding of bindings) {
    if (binding.key && !keyByPath.has(binding.path)) {
      keyByPath.set(binding.path, binding.key)
    }
  }

  const firstCodeByKey = new Map<string, string>()
  const matchedPaths = new Set<string>()
  for (const field of fields) {
    if (!isJsonPointer(field.path)) continue
    const key = keyByPath.get(field.path)
    if (!key) continue
    if (!firstCodeByKey.has(key)) firstCodeByKey.set(key, field.code)
    matchedPaths.add(field.path)
  }

  const errors: Record<string, string> = {}
  for (const binding of bindings) {
    const code = firstCodeByKey.get(binding.key)
    if (code && !(binding.key in errors)) errors[binding.key] = code
  }

  return {
    errors,
    unmatched: fields.filter(
      (field) => !matchedPaths.has(field.path) || !isJsonPointer(field.path),
    ),
  }
}

function isJsonPointer(path: string): boolean {
  return path === '' || (path.startsWith('/') && !/(?:~(?![01]))/.test(path))
}

/** 伺服器通用欄位錯誤碼（API-R10 的 `field.*`）對應的白話訊息。 */
const COMMON_FIELD_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  'field.required': '請填寫此欄位。',
  'field.invalid': '欄位格式不正確，請檢查輸入內容。',
  'field.too_long': '輸入內容太長。',
  'field.too_short': '輸入內容太短。',
  'field.out_of_range': '數值超出允許範圍。',
  'field.duplicate': '此欄位不可重複。',
}

const UNKNOWN_FIELD_ERROR_MESSAGE = '欄位內容不符合規則，請檢查後再試。'

/**
 * 把伺服器欄位錯誤碼轉成白話訊息。
 *
 * 範本、分區、計畫與任務表單原本各抄一份對照表，新增錯誤碼時容易漏改；
 * 集中在這裡。頁面專屬的碼（例如 `template.*`）由 `extra` 補上，
 * 兩邊都找不到時用不洩漏細節的通用句，不猜測欄位含義。
 */
export function fieldErrorMessage(
  code: string,
  extra: Readonly<Record<string, string>> = {},
): string {
  return (
    extra[code] ??
    COMMON_FIELD_ERROR_MESSAGES[code] ??
    UNKNOWN_FIELD_ERROR_MESSAGE
  )
}
