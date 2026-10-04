const API_BASE = '/api/v1'

export class ProjectTemplatesApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super(`API 錯誤（狀態碼 ${status}）`)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
    try {
      const body = (await response.json()) as {
        error?: { code?: string }
      }
      code = body.error?.code
    } catch {
      // 非 JSON 錯誤回應以狀態碼處理。
    }
    throw new ProjectTemplatesApiError(response.status, code)
  }
  return (await response.json()) as T
}

export interface ProjectSummary {
  id: string
  name: string
}

export interface TemplateCategory {
  id: string
  name: string
}

export interface TemplateSystem {
  id: string
  name: string
}

export interface TemplateItem {
  id: string
  title: string
}

export interface AppliedItem {
  id: string
  project_id: string
  source_template_name: string
  applied_at: string
}

interface Page<T> {
  items: T[]
  next_cursor: string | null
}

async function allPages<T>(path: string): Promise<T[]> {
  const items: T[] = []
  let cursor: string | null = null
  do {
    const query: string = cursor
      ? `?limit=100&cursor=${encodeURIComponent(cursor)}`
      : '?limit=100'
    const page: Page<T> = await request(`${path}${query}`)
    items.push(...page.items)
    cursor = page.next_cursor
  } while (cursor)
  return items
}

export function listTemplateCategories(): Promise<TemplateCategory[]> {
  return allPages('/template-categories')
}

export function listTemplateSystems(
  categoryId: string,
): Promise<TemplateSystem[]> {
  return allPages(`/template-categories/${categoryId}/systems`)
}

export function listTemplateItems(systemId: string): Promise<TemplateItem[]> {
  return allPages(`/template-systems/${systemId}/templates`)
}

export function listAllProjects(): Promise<ProjectSummary[]> {
  return request('/projects')
}

export function applyTemplate(
  projectId: string,
  source: { template_id: string } | { system_id: string },
): Promise<AppliedItem[]> {
  return request(`/projects/${projectId}/inspection-items:apply-template`, {
    method: 'POST',
    body: JSON.stringify(source),
  })
}

export function templateErrorMessage(error: unknown): string {
  if (error instanceof ProjectTemplatesApiError) {
    if (error.status === 409) {
      return '範本內容有衝突，請重新整理後再試。'
    }
    if (error.status === 422) {
      return '選擇的範本資料無效，請檢查後再試。'
    }
    if (error.status === 404) {
      return '找不到所選範本，請重新整理後再試。'
    }
    if (error.status === 403) {
      return '你沒有權限執行這項操作。'
    }
  }
  return '無法連線到伺服器，請稍後再試。'
}
