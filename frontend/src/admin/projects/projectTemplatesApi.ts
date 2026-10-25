import {
  HttpError,
  httpErrorMessage,
  listAllPages,
  request as httpRequest,
} from '../../http'

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

export function listAllProjects(): Promise<ProjectSummary[]> {
  return allPages('/projects')
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
  name?: string,
): Promise<TemplateItem> {
  const body = {
    project_inspection_item_id: projectInspectionItemId,
    system_id: systemId,
    ...(name === undefined ? {} : { name }),
  }
  return request(`/projects/${projectId}/templates`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function templateErrorMessage(
  error: unknown,
  conflictingTemplateName?: string,
): string {
  if (error instanceof HttpError) {
    if (error.code === 'project_inspection_item.inactive_name') {
      return '同名項目已停用，可在已停用清單恢復。'
    }
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
        ? `已套用過${names.map((name) => `「${name}」`).join('、')}，本次沒有新增任何項目。`
        : '已套用過同名項目，本次沒有新增任何項目。'
    }
    if (error.status === 409) {
      if (error.code === 'template.name_conflict') {
        return conflictingTemplateName
          ? `這個系統已有「${conflictingTemplateName}」，沒有存入範本。請改名後重試，或改選其他系統。`
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
