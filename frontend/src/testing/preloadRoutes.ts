/**
 * 預先載入 App 與 AdminPage 以 lazy() 拆包的路由模組，給會渲染 <App /> 的
 * 測試檔在 beforeAll 呼叫（#295）。
 *
 * 為什麼需要：vitest 每個測試檔各有獨立的模組快取，檔案內第一次
 * 走到 lazy 路由時，要現場轉換並載入整個頁面的相依模組；這段
 * 一次性的成本在負載高（CI、並行跑多個測試檔）時會超過 findBy
 * 預設的 1 秒，讓「第一個」走到該路由的測試誤判失敗，後面的測試
 * 卻都通過。把載入成本移到 beforeAll（hook 逾時 10 秒），各測試
 * 的斷言仍維持預設逾時，真的卡住或壞掉時照樣會失敗。
 *
 * 這份清單必須涵蓋 src/App.tsx 與 src/admin/AdminPage.tsx 的 lazy()；
 * 新增 lazy 路由時一併加在這裡。
 */
export async function preloadLazyRoutes(): Promise<void> {
  await Promise.all([
    import('../admin/AdminPage'),
    import('../admin/templates/TemplatesPage'),
    import('../admin/projects/ProjectTemplatesPage'),
    import('../admin/projectItems/ProjectItemChangePage'),
    import('../field/FieldPage'),
    import('../setup/SetupPage'),
  ])
}
