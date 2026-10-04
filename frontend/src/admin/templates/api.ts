import { request } from '../api'

export interface Page<T> {
  items: T[]
  next_cursor: string | null
}

export interface TemplateCategory {
  id: string
  name: string
}

export interface TemplateSystem {
  id: string
  category_id: string
  name: string
}

export interface MeasurementField {
  id?: string
  client_id?: string
  name: string
  field_type: 'text' | 'number'
  unit: string | null
}

export interface InspectionPoint {
  id?: string
  sequence: number
  title: string
  instruction: string
  text_standard: { text: string } | null
  numeric_standard: {
    value: string | null
    condition: '<=' | '>=' | '=' | 'range'
    unit: string
    tolerance: string | null
    range_form?: 'interval' | 'tolerance' | null
    lower_bound?: string | null
    upper_bound?: string | null
    measurement_field_id?: string
    measurement_field_client_id?: string
  } | null
  measurement_fields: MeasurementField[]
  evidence_requirements: Array<{
    id?: string
    evidence_type?: 'photo'
    required?: boolean
    min_count: number
    max_count?: number | null
  }>
}

export interface TemplateItem {
  id?: string
  system_id: string
  sequence: number
  title: string
  instruction: string
  inspection_points: InspectionPoint[]
}

export interface TemplateSystemCollection {
  items: TemplateItem[]
}

async function listAll<T>(path: string): Promise<T[]> {
  const rows: T[] = []
  let cursor: string | null = null
  do {
    const params = new URLSearchParams({ limit: '100' })
    if (cursor) params.set('cursor', cursor)
    const page = await request<Page<T>>(`${path}?${params.toString()}`)
    rows.push(...page.items)
    cursor = page.next_cursor
  } while (cursor)
  return rows
}

export function listTemplateCategories(): Promise<TemplateCategory[]> {
  return listAll('/template-categories')
}

export function createTemplateCategory(
  name: string,
): Promise<TemplateCategory> {
  return request('/template-categories', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function renameTemplateCategory(
  id: string,
  name: string,
): Promise<TemplateCategory> {
  return request(`/template-categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export function deleteTemplateCategory(id: string): Promise<void> {
  return request(`/template-categories/${id}`, { method: 'DELETE' })
}

export function listTemplateSystems(
  categoryId: string,
): Promise<TemplateSystem[]> {
  return listAll(`/template-categories/${categoryId}/systems`)
}

export function createTemplateSystem(
  categoryId: string,
  name: string,
): Promise<TemplateSystem> {
  return request(`/template-categories/${categoryId}/systems`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function renameTemplateSystem(
  id: string,
  name: string,
): Promise<TemplateSystem> {
  return request(`/template-systems/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export function deleteTemplateSystem(id: string): Promise<void> {
  return request(`/template-systems/${id}`, { method: 'DELETE' })
}

export function getSystemTemplates(
  systemId: string,
): Promise<TemplateSystemCollection> {
  return listAll<TemplateItem>(`/template-systems/${systemId}/templates`).then(
    (items) => ({ items }),
  )
}

export function putSystemTemplates(
  systemId: string,
  items: TemplateItem[],
): Promise<TemplateSystemCollection> {
  return request(`/template-systems/${systemId}/templates`, {
    method: 'PUT',
    body: JSON.stringify({ items }),
  })
}
