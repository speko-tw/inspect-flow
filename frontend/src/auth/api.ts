// 認證相關 API 的 fetch 包裝（AUT-R05、AUT-R07、AUT-R08）。
//
// AUT-R30：前端不得讀取、儲存或自行傳送登入 token，Cookie 由瀏覽
// 器依同源規則自動處理，因此每個請求都明確帶
// `credentials: 'same-origin'`，且不手動設定 `Authorization` 或
// `Cookie` 標頭。

const AUTH_BASE = '/api/v1/auth'

export interface CurrentUser {
  id: string
  username: string
  email: string | null
  name_en: string | null
  name_zh: string | null
  is_admin: boolean
  must_change_password: boolean
  // 登入與 `me` 回傳同一份本體（AUT-R05、AUT-R08）；這四個公司欄位
  // 由我的工作台讀取，其他呼叫端不需要，所以型別上選填。
  company?: { id: string; name: string } | null
  department?: string | null
  location?: string | null
  employee_no?: string | null
}

/**
 * 目前使用者、登入、變更密碼 API 回傳非預期狀態碼時拋出。
 *
 * `code` 是錯誤 envelope 的 `error.code`（沿用 `api-conventions` 的
 * dot-namespace 命名），解析不到時為 `undefined`；呼叫端需要依錯誤
 * 碼分流訊息時才用得到（例如變更密碼頁，AUT-R34），登入頁等只顯示
 * 通用訊息的呼叫端不需要讀它。
 */
export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(status: number, code?: string) {
    super(`API 錯誤（狀態碼 ${status}）`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** 盡力從錯誤回應本體讀出 `error.code`；解析失敗回傳 `undefined`。 */
export async function readErrorCode(
  response: Response,
): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: { code?: string } }
    return body.error?.code
  } catch {
    return undefined
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
 * 以帳號名稱或 email 與密碼登入（`POST /api/v1/auth/login`）。
 *
 * 失敗（401 `auth.invalid_credentials`、422 或其他狀態碼）一律拋出
 * 帶狀態碼的 `ApiError`；登入頁對認證失敗顯示通用訊息，503 則提
 * 示伺服器暫時忙碌。
 */
export async function login(
  login: string,
  password: string,
): Promise<CurrentUser> {
  const response = await fetch(`${AUTH_BASE}/login`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ login, password }),
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

/**
 * 本人變更密碼（`POST /api/v1/auth/password`，AUT-R34）。
 *
 * 成功時後端以 `Set-Cookie` 換發登入 Cookie（AUT-R35），瀏覽器會自
 * 動處理，前端不必讀取或轉存。失敗（400 `auth.current_password_incorrect`、
 * 422 `auth.password_invalid`／`auth.password_unchanged`、403
 * `permission.denied` 或其他狀態碼）一律拋出帶 `code` 的
 * `ApiError`，呼叫端（`ChangePasswordPage`）依 `code` 顯示對應訊
 * 息，讀不到 `code` 時顯示通用錯誤訊息。
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const response = await fetch(`${AUTH_BASE}/password`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  })

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorCode(response))
  }
}
