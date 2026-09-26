// 認證相關 API 的 fetch 包裝（AUT-R05、AUT-R07、AUT-R08）。
//
// AUT-R30：前端不得讀取、儲存或自行傳送登入 token，Cookie 由瀏覽
// 器依同源規則自動處理，因此每個請求都明確帶
// `credentials: 'same-origin'`，且不手動設定 `Authorization` 或
// `Cookie` 標頭。

const AUTH_BASE = '/api/v1/auth'

export interface CurrentUser {
  id: string
  email: string
  name_en: string
  name_zh: string
  is_admin: boolean
}

/** 目前使用者、登入 API 回傳非預期狀態碼時拋出。 */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`API 錯誤（狀態碼 ${status}）`)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * 取得目前使用者（`GET /api/v1/auth/me`）。
 *
 * 回傳 `null` 表示未登入（401 `auth.not_authenticated`，
 * AUT-R08）；其餘非成功狀態碼（例如網路錯誤轉成的例外、5xx）一律
 * 拋出 `ApiError`，呼叫端不應把這種情況當成「未登入」處理。
 */
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const response = await fetch(`${AUTH_BASE}/me`, {
    credentials: 'same-origin',
  })

  if (response.status === 401) {
    return null
  }

  if (!response.ok) {
    throw new ApiError(response.status)
  }

  return (await response.json()) as CurrentUser
}

/**
 * 以 email 與密碼登入（`POST /api/v1/auth/login`）。
 *
 * 失敗（401 `auth.invalid_credentials`、422 或其他狀態碼）一律拋出
 * `ApiError`；呼叫端依 AUT-R29 只顯示一種通用訊息，不依狀態碼分
 * 流程。
 */
export async function login(
  email: string,
  password: string,
): Promise<CurrentUser> {
  const response = await fetch(`${AUTH_BASE}/login`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })

  if (!response.ok) {
    throw new ApiError(response.status)
  }

  return (await response.json()) as CurrentUser
}

/**
 * 登出（`POST /api/v1/auth/logout`）。後端一律回 204；非 2xx 一律
 * 拋出 `ApiError`，網路層級的例外（例如打不通）也會往上拋出，不
 * 吞掉——呼叫端（`LogoutButton`）只在確定登出成功時才清掉前端狀
 * 態並導向 `/login`，避免伺服器端的登入狀態與 Cookie 其實還有
 * 效，使用者卻誤以為已經登出。
 */
export async function logout(): Promise<void> {
  const response = await fetch(`${AUTH_BASE}/logout`, {
    method: 'POST',
    credentials: 'same-origin',
  })

  if (!response.ok) {
    throw new ApiError(response.status)
  }
}
