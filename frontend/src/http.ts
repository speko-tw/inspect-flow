// 共用 HTTP 層：JSON 請求、錯誤 envelope 解析、游標分頁與錯誤文案。
//
// 各功能區的錯誤類別（ManagementApiError、FieldApiError、
// ProjectTemplatesApiError）都繼承 HttpError，所以 `status`、`code`、
// `details` 的讀法一致，`isForbidden` 也能認得所有類別。

export const API_BASE = '/api/v1'

/** API 回傳非預期狀態碼時拋出；`code`、`details` 取自錯誤 envelope。 */
export class HttpError extends Error {
  readonly status: number
  readonly code?: string
  readonly details?: unknown

  constructor(status: number, code?: string, details?: unknown) {
    super(`API 錯誤（狀態碼 ${status}）`)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export type HttpErrorClass = new (
  status: number,
  code?: string,
  details?: unknown,
) => HttpError

export type PageParams = Record<string, string>

interface CursorPage<T> {
  items: T[]
  next_cursor: string | null
}

/**
 * 送出同站 JSON 請求。成功回傳解析後的本文（204 回 `undefined`）；
 * 失敗拋出 `ErrorClass`，並盡力帶上 `error.code` 與 `error.details`。
 */
export async function request<T>(
  path: string,
  init?: RequestInit,
  ErrorClass: HttpErrorClass = HttpError,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  if (!response.ok) {
    let code: string | undefined
    let details: unknown
    try {
      const body = (await response.json()) as {
        error?: { code?: string; details?: unknown }
      }
      code = body.error?.code
      details = body.error?.details
    } catch {
      // 非 JSON 錯誤回應以狀態碼處理。
    }
    throw new ErrorClass(response.status, code, details)
  }

  if (response.status === 204) {
    return undefined as T
  }
  try {
    return (await response.json()) as T
  } catch {
    // 成功狀態碼但本文不是 JSON：是伺服器回應異常，不是連不上。
    throw new ErrorClass(response.status)
  }
}

/** 沿著 `next_cursor` 逐頁取完；`fetchPage` 自己決定怎麼送出請求。 */
export async function collectPages<T>(
  fetchPage: (cursor: string | null) => Promise<CursorPage<T>>,
): Promise<T[]> {
  const items: T[] = []
  let cursor: string | null = null
  do {
    const page: CursorPage<T> = await fetchPage(cursor)
    items.push(...page.items)
    cursor = page.next_cursor
  } while (cursor)
  return items
}

/** 走完 `path` 的所有分頁（每頁 100 筆，後端上限）。 */
export function listAllPages<T>(
  path: string,
  params: PageParams = {},
  ErrorClass: HttpErrorClass = HttpError,
): Promise<T[]> {
  return collectPages<T>((cursor) => {
    const query = new URLSearchParams({ limit: '100', ...params })
    if (cursor) query.set('cursor', cursor)
    return request<CursorPage<T>>(
      `${path}?${query.toString()}`,
      undefined,
      ErrorClass,
    )
  })
}

export const NETWORK_ERROR_MESSAGE = '無法連線到伺服器，請稍後再試。'
export const SESSION_EXPIRED_MESSAGE = '登入狀態已失效，請重新登入。'
export const FORBIDDEN_MESSAGE = '你沒有權限執行這項操作。'
export const SERVER_ERROR_MESSAGE = '伺服器暫時無法處理，請稍後再試。'
export const GENERIC_FAILURE_MESSAGE = '操作失敗，請稍後再試。'

/** 403，或錯誤碼是 `permission.denied`（兩者都代表沒有權限）。 */
export function isForbidden(error: unknown): boolean {
  return (
    error instanceof HttpError &&
    (error.status === 403 || error.code === 'permission.denied')
  )
}

/**
 * 網址裡的 id 找不到（404）或格式不對（422）：讀取單筆資料的頁面用它
 * 判斷要顯示「找不到」頁，而不是一句通用的錯誤文字。只用在 GET 載入；
 * 寫入請求的 422 是欄位驗證錯誤，不是找不到。
 */
export function isNotFound(error: unknown): boolean {
  return (
    error instanceof HttpError &&
    (error.status === 404 || error.status === 422)
  )
}

export interface ErrorMessageOptions {
  /** 各頁自己的 `error.code` 特例；優先於狀態碼對應。 */
  codes?: Record<string, string>
  /** 其餘狀態碼（400、404、409、422 等）的文案。 */
  fallback?: string
}

/**
 * 錯誤文案對應表：非 HTTP 錯誤＝網路問題；401＝登入失效；
 * 403／`permission.denied`＝沒有權限；5xx＝伺服器暫時無法處理。
 * 各頁只用 `codes`、`fallback` 覆寫自己的特例。
 */
export function httpErrorMessage(
  error: unknown,
  options: ErrorMessageOptions = {},
): string {
  if (!(error instanceof HttpError)) return NETWORK_ERROR_MESSAGE
  if (error.code && options.codes?.[error.code]) {
    return options.codes[error.code]
  }
  if (error.status === 401) return SESSION_EXPIRED_MESSAGE
  if (isForbidden(error)) return FORBIDDEN_MESSAGE
  if (error.status >= 500) return SERVER_ERROR_MESSAGE
  return options.fallback ?? GENERIC_FAILURE_MESSAGE
}
