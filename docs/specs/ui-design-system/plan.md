# 前端設計系統：實作計畫（草案）

**規格**：[spec.md](spec.md)

> 本計畫隨規格 PR 提供草案，供後續拆分實作 task。須待本規格 PR 合併並凍結後，才依最終規格內容執行或開實作 issue；規格凍結前不得宣稱此計畫已核准。

計畫先建立語意 token 與共用元件，再按功能規格分批套用頁面，最後補齊規範與跨頁驗收。這能讓每波以可重用基礎支援後續頁面，並避免 0.5.0 第四波權限畫面自行建立另一套互動語彙。

## 任務

| ID | 內容 | 改動的檔案 | 依賴 | 對應 AC | Issue |
|---|---|---|---|---|---|
| T1 | 建立中性語意 token：品牌、表面、文字、邊界、焦點、狀態、間距、圓角、陰影、字型及動態；加入淺／深色映射與色彩對比檢查 | `frontend/src/styles/`、`frontend/src/styles.css`、token tests | 本規格凍結 | UDS-AC04、09、15 | 待開 task |
| T2 | 建立共用 Button、IconButton、Badge、Tag、Card、SectionHeader、Field、Input、InfoRow、StatCard 等元件，定義所需變體、互動狀態與可及語意 | `frontend/src/components/`、元件測試 | T1 | UDS-AC03、04、09、16 | 待開 task |
| T3 | 建立共用表單群組、錯誤欄位、錯誤摘要、送出生命週期與確認包裝模式；處理 IME 組字、重複送出及同步／非同步失敗 | `frontend/src/components/forms/`、`frontend/src/components/confirm/`、元件測試 | T1、T2 | UDS-AC05～07 | 待開 task |
| T4 | 建立清單＋詳情、獨立新增／修改、空／載入／失敗及手機逐層版面模式；定義 CJK 斷行與 reduced-motion 基礎 | `frontend/src/components/layout/`、`frontend/src/styles/`、元件測試 | T1、T2 | UDS-AC02、10、11、15 | 待開 task |
| T5 | 將 tokens、共用元件及版面模式套用至 Field UI 主要清單與任務詳情，驗收 360px、鍵盤、狀態與任務操作 | `frontend/src/field/`、Field 頁面測試 | T2～T4；`field-ui` 與 `inspection-planning` 對應契約已凍結 | UDS-AC02、03、07、10、11、15 | 待開 task |
| T6 | 將 tokens、元件及清單／詳情模式套用至 Admin 專案清單與摘要；依凍結 API 顯示 `member_count`、搜尋及 cursor，不以前端推算替代 | `frontend/src/admin/projects/ProjectsPage.tsx`、專案清單測試與契約 fixture | T2～T4；#413 搜尋／cursor 契約；#286 的 `domain-model` spec-change 與 `admin-dashboard` T6a 合併，且正式 `member_count` 契約凍結 | UDS-AC02～05、12、13、16 | 待開 task |
| T7 | 在人員模組權限、委派及權限組合頁套用共用元件並驗收狀態、錯誤與確認互動；功能與授權規則仍由 `admin-dashboard` T4 負責，不重做其契約 | `frontend/src/admin/module-permissions/` 專用樣式與測試；不改 `AdminPage.tsx` 或權限 API | T1～T4 已完成；`domain-model` 任務 L／N／O、`authentication` 任務 P 與 `admin-dashboard` T4（#581、#582）已合併 | UDS-AC03、05～07、09、10 | 待開 task |
| T8 | 套用共用表單、錯誤與回饋模式至 Admin 新增／修改與密碼流程，驗收新增修改分離、未儲存提醒、IME、送出生命週期 | 指定的 Admin／Auth 表單檔案及相關測試 | T2、T3；各頁功能規格與 API 契約已凍結 | UDS-AC02、05～07、09 | 待開 task |
| T9 | 在帳號偏好資料契約核准後，實作外觀三態、跨裝置保存與首次繪製快取；確認頁首、內容與狀態一同切換 | 指定的 Auth 外觀設定檔案、共用樣式入口及契約測試 | T1、T2；先依 #515 確認規格歸屬，完成必要的帳號欄位／API spec-change 並合併凍結契約 | UDS-AC04、08、14 | 待開 task |
| T10 | 補齊元件規範、使用指引、設計系統回饋及跨頁視覺／無障礙驗收；追蹤各功能頁的套用範圍 | `docs/`、`frontend/src/components/`、相關測試 | T1～T9；前端主要路由已套用 | UDS-AC01、09～16 | 待開 task |

- 每個任務一個 PR 就能完成，並能單獨驗收。
- 每個任務至少對應一條 AC；每條 AC 至少被一個任務涵蓋。
- 跨規格依賴於建立 task 時填入實際 issue 編號；本草案不預先建立實作 issue。

## 並行分組

分波依共用樣式與元件責任拆分；共用檔案、元件目錄及路由入口不可在同一波重疊修改。

- 第 1 波：T1；tokens 先合併，作為後續共用基礎。
- 第 2 波：T2；依賴 T1，完成後 T3、T4 可依檔案責任錯開實作。
- 第 3 波：T3、T4 合併後，T5 與 T6 可在不共用元件／路由檔案時平行；同一頁或共用入口需錯開。
- 第 4 波（v0.5.0 權限畫面）：`admin-dashboard` T4（#581、#582）負責功能與授權；須等 T1～T4 的基礎元件及 `domain-model` L／N／O、`authentication` P 合併後才開始。UDS T7 只處理其後的設計系統套用與驗收，避免重複功能工作，也不因 UI 規格先行而繞過權限模型依賴。
- 後續波：T8、T9 依帳號及表單 API 契約安排；T10 在主要頁面採用後收斂規範與驗收證據。

## 風險

- **計畫仍是草案**：規格未合併凍結前，不能依本表開實作 issue；若最終 AC 有變，先更新 task 對照。
- **第四波權限依賴**：T7 同時依賴 UI 基礎與權限資料／存取契約；任何一項未合併都不得開始，以免畫面推論授權規則。
- **共用樣式衝突**：T1／T2 影響全站；任何其他頁面同時改 `frontend/src/styles.css` 或共用元件時須錯開。
- **#286 契約未凍結**：T6 不得依目前草稿自行定義 `member_count` 欄位或口徑；先等 `domain-model` spec-change／T6a 合併，並以凍結契約驗收。只計啟用中成員是 #286 於 2026-10-16 的維護者目標，仍可推翻。
- **#515 契約歸屬未定**：T9 不得先建帳號欄位或 API；先確認承接規格並完成必要的規格變更。
- **資料責任**：#286／#413 的數值與列表必須讀正式 API；前端 fixture 只用測試，不可作正式 fallback。
- **無障礙回歸**：深色語意色、焦點環、錯誤狀態及動態偏好須在兩主題與窄螢幕重驗，不能只以單一元件故事頁證明。

## 驗證（Proof）

| AC | 驗證方式 |
|---|---|
| UDS-AC01 | 核對核可原型連結、KD-70、重大畫面 RG-M21 入口與試用紀錄 |
| UDS-AC02～04、16 | 元件與頁面測試；桌機與 360px 瀏覽器走查清單、詳情、表單、狀態及 token 使用 |
| UDS-AC05～08 | Testing Library／瀏覽器測試欄旁錯誤、摘要導覽、IME、重複提交、失敗回饋、確認取消及未儲存提示 |
| UDS-AC09～11 | WCAG 對比計算、鍵盤焦點檢查、360px 互動目標幾何與 CJK 斷行走查；未達 AA 的色值不得通過 |
| UDS-AC12～13 | API contract fixture 與真後端 UI 測試：啟用成員口徑、搜尋、cursor、空結果、載入更多、失敗重試 |
| UDS-AC14 | 驗證帳號選單可達外觀與密碼入口；以真帳號偏好 API 測試跨裝置保存及首次繪製前主題套用，不以原型狀態模擬代替 |
| UDS-AC15 | `prefers-reduced-motion` 元件測試及瀏覽器偏好切換走查 |

## 考慮過但沒採用的做法

- 將文件型品牌元件原樣套用所有工作頁：核可原型的工作清單、詳情及表單有不同資訊密度；直接照搬會削弱工作掃描與手機操作。
- 先做權限頁再補共用元件：v0.5.0 第四波權限頁應沿用共用元件，且必須等待 `domain-model` L／N／O 與 `authentication` P，避免兩套互動與錯誤狀態。
