/**
 * 網址路由參數（專案 id、查核項目 id 等）是否像一個資源 id。
 *
 * 為什麼要檢查：這些參數會原樣拼進 API 路徑。特製網址（例如
 * `/admin/projects/..%2Fcompanies%3F/planning`）解碼後含有 `/`、`?`、
 * `.`，請求就會打到別的端點（F-S01）。後端的 id 是 UUID，只由英數字
 * 與連字號組成；這裡只擋「不可能是 id 的字元」，不重複後端的 UUID 驗證
 * （格式不對的 id 後端回 422，畫面照 ADM-R25 顯示找不到）。
 */
export function isResourceId(value: string | undefined): value is string {
  return value !== undefined && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)
}
