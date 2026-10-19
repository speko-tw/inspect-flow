# 帳號與權限：七個現場故事

本指南依 #704、#705 已合併後的實際導覽、註冊路徑及畫面整理。截圖來自隔離的本機示範資料；不含登入密碼。畫面可能隨後續版本調整。

## 1. 新人報到：建立帳號並加入專案

系統管理者從「管理」開啟「帳號」，選「新增帳號」。精靈先收帳號資料，再依畫面逐步完成建立；建立完成後，臨時密碼只在當下提供，請透過安全管道交給本人。本指南不保存密碼截圖。

1. 開啟 [`/accounts`](/accounts)，選「新增帳號」。
2. 填寫帳號名稱和姓名，依工作需求完成後續步驟。
3. 建立完成後，安全交付畫面提供的臨時密碼。
4. 到對應專案的成員頁加入帳號，並依實際工作選擇專案角色。

![新增帳號精靈的第一步](images/account-create-step-1.png)

![系統管理者查看帳號清單](images/account-list-admin.png)

![專案成員與專案角色](images/project-members.png)

## 2. 主管看進度：從總覽開啟任務清單

`demo-manager` 登入後到「總覽」。此帳號沒有專案成員身分，畫面提供所有專案的進度檢視；點選專案進度後進入任務清單，再開啟任務明細。進度畫面不提供照片或查核結果。

實際路徑是 `/overview`、`/overview/projects/:projectId/tasks` 和 `/overview/projects/:projectId/tasks/:taskId`。`/overview/projects/:projectId` 本身不是有效頁面，也不是總覽上的連結。

![主管的總覽](images/manager-overview.png)

![主管查看專案任務清單](images/manager-project-tasks.png)

## 3. 外部協作：唯讀查看已加入的專案

`demo-consultant` 在「專案」只看到已加入的示範廠擴建機電工程。開啟查核項目後可檢視內容；本次實際畫面沒有顯示套用範本操作，也沒有「範本」導覽。是否可執行專案工作仍取決於專案角色。

![外部協作的專案清單](images/consultant-project-list.png)

![外部協作查看專案查核項目](images/consultant-project-items.png)

## 4. 查找存取原因：先比對專案角色

系統管理者在「帳號」開啟 `demo-field-b`，於「為什麼他不能做這件事？」選擇要檢查的操作及專案，再按「檢查」。本次示範選擇管理專案成員；結果顯示目前角色沒有管理成員的能力，並列出可補上的專案角色。

畫面提供前往專案成員設定的連結，不是直接一鍵授權。系統管理者應先比較角色包含的能力，再依工作需要決定是否調整；本次走查沒有套用任何角色。

![帳號存取診斷表單](images/account-diagnosis-form.png)

![診斷結果與可補上的專案角色](images/account-diagnosis-result.png)

## 5. 委派範本權限工作

系統管理者可在 `demo-template-delegate` 的帳號設定中查看委派範圍。委派者實際登入後只看到「帳號」入口，能處理受委派範圍內的工作；她不是系統管理者，也沒有「範本」導覽。

![系統管理者查看委派者帳號設定](images/delegate-scope-admin.png)

![委派者登入後的帳號清單](images/delegate-account-list.png)

## 6. 離職停用：先核對對象與影響

在「帳號」開啟目標帳號，展開「更多」，選「停用帳號」。畫面會再次顯示帳號名稱及後果「該帳號將無法登入」，再選「確認」才送出。請先核對對象；停用後回到帳號詳情確認狀態。

隔離 demo 中以 `demo-no-access` 實際完成停用，詳情顯示「已停用」；為免影響後續示範，截圖後已重新啟用，回讀顯示「啟用中」。

![停用帳號前的確認畫面](images/account-deactivate-confirm.png)

![停用後的帳號狀態](images/account-deactivated-status.png)

## 7. 修改專案角色前查看持有人數

系統管理者開啟「角色」，先查看目標角色的持有人數，再評估變更影響。示範畫面顯示「專案工程師」有 1 個帳號、「現場工程師」有 2 個帳號；修改前應先確認受影響的專案成員。

![專案角色與持有人數](images/project-role-holders.png)

## 九個示範帳號的實際入口

以下各帳號均在隔離 demo 中實際登入。截圖呈現各自的可用入口；密碼不納入指南。

| 帳號 | 登入後入口 | 畫面 |
|---|---|---|
| `admin` | 總覽；「管理」含帳號、公司、角色、紀錄 | [帳號清單](images/account-list-admin.png) |
| `demo-manager` | 總覽 | [進度總覽](images/manager-overview.png) |
| `demo-office` | 專案 | [專案清單](images/office-project-list.png) |
| `demo-field-a` | 任務、專案 | [任務清單](images/field-a-tasks.png) |
| `demo-field-b` | 任務、專案 | [任務清單](images/field-b-tasks.png) |
| `demo-template-manager` | 範本 | [範本庫](images/template-manager-library.png) |
| `demo-template-delegate` | 帳號 | [帳號清單](images/delegate-account-list.png) |
| `demo-consultant` | 專案 | [專案清單](images/consultant-project-list.png) |
| `demo-no-access` | 個人設定；顯示尚未開通功能的說明 | [個人設定](images/no-access-settings.png) |

主導覽順序為「總覽、任務、專案、範本、管理」；只顯示帳號可使用的項目。「範本」只對範本管理者或系統管理者顯示。委派者只有「帳號」時，直接顯示「帳號」入口。
