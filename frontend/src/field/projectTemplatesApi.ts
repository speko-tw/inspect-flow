import type { TemplateCategory, TemplateSystem } from '../admin/templates/api'
import { getSystemTemplates } from '../admin/templates/api'

export type { TemplateCategory, TemplateSystem } from '../admin/templates/api'

const API_BASE = '/api/v1'

export class ProjectTemplatesApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
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
    throw new ProjectTemplatesApiError(response.status, code, details)
  }
  return (await response.json()) as T
}

export interface ProjectSummary {
  id: string
  project_code: string
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

export interface ProjectInspectionItem extends AppliedItem {
  sequence: number
  title: string
  instruction: string
}

interface Page<T> {
  items: T[]
  next_cursor: string | null
}

async function allPages<T>(
  path: string,
  baseParams = new URLSearchParams(),
): Promise<T[]> {
  const items: T[] = []
  let cursor: string | null = null
  do {
    const params = new URLSearchParams(baseParams)
    params.set('limit', '100')
    if (cursor) params.set('cursor', cursor)
    const page: Page<T> = await request(`${path}?${params.toString()}`)
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
  return getSystemTemplates(systemId).then((result) =>
    result.items.filter(
      (item): item is typeof item & { id: string } =>
        typeof item.id === 'string',
    ),
  )
}

export function listAllProjects(): Promise<ProjectSummary[]> {
  return allPages('/projects')
}

export function listProjectInspectionItems(
  projectId: string,
): Promise<ProjectInspectionItem[]> {
  return allPages(`/projects/${projectId}/inspection-items`)
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

export function saveProjectItemAsTemplate(
  projectId: string,
  projectInspectionItemId: string,
  systemId: string,
): Promise<TemplateItem> {
  return request(`/projects/${projectId}/templates`, {
    method: 'POST',
    body: JSON.stringify({
      project_inspection_item_id: projectInspectionItemId,
      system_id: systemId,
    }),
  })
}

export function templateErrorMessage(
  error: unknown,
  conflictingTemplateName?: string,
): string {
  if (
    error instanceof ProjectTemplatesApiError ||
    (typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof error.status === 'number')
  ) {
    const apiError = error as ProjectTemplatesApiError
    if (
      apiError.status === 409 &&
      apiError.code === 'project_inspection_item.duplicate_name'
    ) {
      const names = Array.isArray(apiError.details)
        ? apiError.details.filter(
            (name): name is string => typeof name === 'string',
          )
        : []
      return names.length
        ? `已套用過${names.map((name) => `『${name}』`).join('、')}，本次沒有新增任何項目。`
        : '已套用過同名項目，本次沒有新增任何項目。'
    }
    if (apiError.status === 409) {
      if (apiError.code === 'template.name_conflict') {
        return conflictingTemplateName
          ? `這個系統已有「${conflictingTemplateName}」，沒有存入範本。請改選其他系統。`
          : '該系統已有同名範本。'
      }
      return '範本內容有衝突，請重新整理後再試。'
    }
    if (apiError.status === 422) {
      return '選擇的範本資料無效，請檢查後再試。'
    }
    if (apiError.status === 404) {
      return '找不到指定的資料，請重新整理後再試。'
    }
    if (apiError.status === 403) {
      return '你沒有權限執行這項操作。'
    }
  }
  return '無法連線到伺服器，請稍後再試。'
}
