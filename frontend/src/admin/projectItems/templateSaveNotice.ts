/** TPL-R23：存檔結果只供來源卡片顯示一次，兩端共用相同 state 契約。 */
export type SavedTemplateNotice = {
  savedFromItemId: string
  savedTemplateTitle: string
  savedTemplateId: string
  savedCategoryId?: string
  savedSystemId?: string
}

/** 保留套用標示與其他導頁狀態；只消費存為範本的提示欄位。 */
export type ProjectItemsLocationState = Partial<SavedTemplateNotice> & {
  highlightedItemIds?: unknown
  [key: string]: unknown
}

/** UDS-R18：清掉 history 中的提示，離頁返回與重新整理不得再次播放。 */
export function withoutTemplateSaveNotice(state: ProjectItemsLocationState) {
  const remaining = { ...state }
  for (const key of [
    'savedFromItemId',
    'savedTemplateTitle',
    'savedTemplateId',
    'savedCategoryId',
    'savedSystemId',
  ])
    delete remaining[key]
  return remaining
}
