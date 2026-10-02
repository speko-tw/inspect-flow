// 我的工作台用的 API：我的公司資料（`GET /api/v1/auth/me`，AUT-R08）
// 與我參與的專案（`GET /api/v1/me/projects`，#290）。
//
// 身分欄位（姓名、Email 等）由 `RequireAuth` 的 context 提供；這裡
// 只補 context 沒有的公司相關欄位。Cookie 依 AUT-R30 由瀏覽器處理，
// 因此每個請求都明確帶 `credentials: 'same-origin'`。

const API_BASE = '/api/v1'

export interface MyCompanyProfile {
  company: { id: string; name: string } | null
  department: string | null
  location: string | null
  employee_no: string | null
}

export interface MyProject {
  id: string
  project_code: string
  name: string
  client_name: string
  site_location: string
  planned_start_date: string | null
  planned_completion_date: string | null
  role_names: string[]
}

/** 工作台的 API 回傳非預期狀態碼時拋出。 */
export class FieldApiError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`API 錯誤（狀態碼 ${status}）`)
    this.name = 'FieldApiError'
    this.status = status
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new FieldApiError(response.status)
  }
  return (await response.json()) as T
}

export async function fetchMyCompanyProfile(): Promise<MyCompanyProfile> {
  const body = await getJson<Partial<MyCompanyProfile>>('/auth/me')
  return {
    company: body.company ?? null,
    department: body.department ?? null,
    location: body.location ?? null,
    employee_no: body.employee_no ?? null,
  }
}

export function fetchMyProjects(): Promise<MyProject[]> {
  return getJson<MyProject[]>('/me/projects')
}
