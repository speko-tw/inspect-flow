/** AUT-R55：快取只放三態值，不能成為儲存登入識別資訊的入口。 */
export type Appearance = 'system' | 'light' | 'dark'

export const APPEARANCE_CACHE_KEY = 'inspectflow.appearance'

/** 不信任舊快取或舊版回應，無效值一律保留跟隨裝置的原行為。 */
export function normalizeAppearance(value: unknown): Appearance {
  return value === 'light' || value === 'dark' ? value : 'system'
}

/** 由共用 token 處理顏色與裝置變動，避免各頁各自維護主題。 */
export function applyAppearance(value: Appearance): void {
  document.documentElement.dataset.theme = value
  try {
    localStorage.setItem(APPEARANCE_CACHE_KEY, value)
  } catch {
    // 無痕或停用儲存不應阻止已登入者使用帳號偏好。
  }
}
