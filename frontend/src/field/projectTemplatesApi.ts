import type { TemplateCategory, TemplateSystem } from '../admin/templates/api'
import {
  HttpError,
  httpErrorMessage,
  listAllPages,
  request as httpRequest,
} from '../http'

export type { TemplateCategory, TemplateSystem } from '../admin/templates/api'

export class ProjectTemplatesApiError extends HttpError {
  constructor(status: number, code?: string, details?: unknown) {
    super(status, code, details)
    this.name = 'ProjectTemplatesApiError'
  }
}

function request<T>(path: string, init?: RequestInit): Promise<T> {
  return httpRequest<T>(path, init, ProjectTemplatesApiError)
}

function allPages<T>(path: string): Promise<T[]> {
  return listAllPages<T>(path, {}, ProjectTemplatesApiError)
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

export function listTemplateCategories(): Promise<TemplateCategory[]> {
  return allPages('/template-categories')
}

export function listTemplateSystems(
  categoryId: string,
): Promise<TemplateSystem[]> {
  return allPages(`/template-categories/${categoryId}/systems`)
}

export interface MyPermissions {
  can_manage_templates: boolean
}

/**
 * What the current user may do across projects (`GET /me/permissions`).
 * Only an explicit boolean `true` from the server allows saving as a
 * template (TPL-R09); a malformed body is an error, never a grant.
 */
export async function fetchMyPermissions(): Promise<MyPermissions> {
  const body = await request<unknown>('/me/permissions')
  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as MyPermissions).can_manage_templates !== 'boolean'
  ) {
    throw new Error('Permissions response has an unexpected shape')
  }
  return { can_manage_templates: (body as MyPermissions).can_manage_templates }
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
  if (error instanceof HttpError) {
    if (
      error.status === 409 &&
      error.code === 'project_inspection_item.duplicate_name'
    ) {
      const names = Array.isArray(error.details)
        ? error.details.filter(
            (name): name is string => typeof name === 'string',
          )
        : []
      return names.length
        ? `已套用過${names.map((name) => `『${name}』`).join('、')}，本次沒有新增任何項目。`
        : '已套用過同名項目，本次沒有新增任何項目。'
    }
    if (error.status === 409) {
      if (error.code === 'template.name_conflict') {
        return conflictingTemplateName
          ? `這個系統已有「${conflictingTemplateName}」，沒有存入範本。請改選其他系統。`
          : '該系統已有同名範本。'
      }
      return '範本內容有衝突，請重新整理後再試。'
    }
    if (error.status === 422) {
      return '選擇的範本資料無效，請檢查後再試。'
    }
    if (error.status === 404) {
      return '找不到指定的資料，請重新整理後再試。'
    }
  }
  return httpErrorMessage(error)
}
