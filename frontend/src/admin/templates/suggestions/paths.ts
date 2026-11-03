/** 範本建議的兩條路由：提議人個人清單與管理者審核（TPL-R34）。 */
export type SuggestionMode = 'mine' | 'review'

/**
 * 個人清單掛在 `/settings` 之下，已登入者皆能進入；審核掛在範本管理頁
 * 之下，由路由權限（template.manage）把關。不新增全域導覽項目。
 */
export const SUGGESTION_BASE: Record<SuggestionMode, string> = {
  mine: '/settings/template-suggestions',
  review: '/templates/suggestions',
}

/** 專案頁連結帶本案篩選時使用的查詢參數名稱。 */
export const PROJECT_FILTER_PARAM = 'project'

/** 依來源回到專案頁或設定頁（TPL-R34）；`projectId` 有值代表從專案進入。 */
export type SuggestionOrigin = 'project' | 'settings'

/** 站內導覽時帶著的狀態，讓返回與核准目的地不因換頁而遺失。 */
export interface SuggestionNavState {
  origin?: SuggestionOrigin
  /** 回清單時要還原的查詢字串（含本案篩選）。 */
  listSearch?: string
  /** 核准目的地；改名後回到詳情時保留（TPL-AC42）。 */
  target?: { category_id: string; system_id: string }
  notice?: string
  /** 儲存並重新送審後，詳情頁直接開啟重送確認。 */
  confirmResubmit?: boolean
}

export function suggestionPath(
  mode: SuggestionMode,
  id?: string,
  tail?: 'edit' | 'compare',
): string {
  const base = SUGGESTION_BASE[mode]
  if (!id) return base
  return tail ? `${base}/${id}/${tail}` : `${base}/${id}`
}

/** 專案查核項目頁，從專案進入個人清單後返回的位置。 */
export function projectItemsPath(projectId: string): string {
  return `/projects/${projectId}/inspection-items`
}

/** 專案頁「我的範本建議」連結：直接開本人清單並預設篩選本案。 */
export function projectSuggestionsPath(projectId: string): string {
  return `${SUGGESTION_BASE.mine}?${PROJECT_FILTER_PARAM}=${encodeURIComponent(
    projectId,
  )}`
}
