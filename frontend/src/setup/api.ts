// 首次設定 API 的 fetch 包裝（AUT-R44）。兩條路由都是公開路由，
// 不需要登入；成功設定密碼後，後端以 `Set-Cookie` 回傳 admin 的
// 登入 Cookie，由瀏覽器依同源規則處理，前端不讀取也不轉存
// （AUT-R30）。

import { ApiError, readErrorCode } from '../auth/api'

const SETUP_BASE = '/api/v1/setup'

/**
 * 查詢是否還需要首次設定（`GET /api/v1/setup/status`）。
 *
 * 回傳 `true` 代表 `admin` 還沒設定密碼；非 2xx 一律拋出
 * `ApiError`，呼叫端自行決定狀態不明時怎麼處理。
 */
export async function fetchSetupRequired(): Promise<boolean> {
  const response = await fetch(`${SETUP_BASE}/status`, {
    credentials: 'same-origin',
  })

  if (!response.ok) {
    throw new ApiError(response.status)
  }

  const body = (await response.json()) as { setup_required?: unknown }
  return body.setup_required === true
}

/**
 * 以首次登入碼設定 admin 密碼（`POST /api/v1/setup/admin-password`）。
 *
 * 成功回 204。失敗拋出帶 `code` 的 `ApiError`：401
 * `setup.invalid_code`（碼錯誤、過期、作廢或被鎖，後端刻意不區
 * 分）、409 `setup.already_completed`、422 `auth.password_invalid`。
 */
export async function setAdminPassword(
  code: string,
  password: string,
): Promise<void> {
  const response = await fetch(`${SETUP_BASE}/admin-password`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code, password }),
  })

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorCode(response))
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  // AUT-R29：invalid_code 只顯示一種通用訊息，不洩漏是碼錯、過期
  // 還是被鎖定（AUT-R45）。
  'setup.invalid_code':
    '首次登入碼不正確或已失效，請確認後再試；需要新的碼時，' +
    '請在伺服器重新執行 make init。',
  'setup.already_completed': '首次設定已經完成，請改用登入頁登入。',
  'auth.password_invalid': '密碼長度必須介於 8 到 128 個字元。',
}

/** 把首次設定 API 的失敗轉成給使用者看的繁中訊息。 */
export function setupErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return '無法連線到伺服器，請稍後再試。'
  }
  if (error.code && ERROR_MESSAGES[error.code]) {
    return ERROR_MESSAGES[error.code]
  }
  if (error.status === 401) {
    return ERROR_MESSAGES['setup.invalid_code']
  }
  if (error.status === 409) {
    return ERROR_MESSAGES['setup.already_completed']
  }
  if (error.status === 422) {
    return ERROR_MESSAGES['auth.password_invalid']
  }
  return '設定失敗，請稍後再試。'
}
