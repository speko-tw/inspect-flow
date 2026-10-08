// 記住「這個頁面執行期間最後一位登入的人」，只用來判斷登入頁能不能
// 沿用原本要去的頁面（#489）：
//
// - 工作階段逾時後重新登入，若還是同一個人，才回到原頁；
// - 換了另一個人，一律依新帳號的落點，不帶他去上一位的頁面；
// - 主動登出時清掉，下一位登入者沒有任何「上一位」的痕跡。
//
// 只放在記憶體：AUT-R30 不允許把登入資訊寫進 `localStorage`、
// `sessionStorage`。代價是重新整理頁面後就忘了上一位是誰，這時
// 退回「原頁面是新帳號看得到的才回去」（見 `landing.ts` 的
// `canVisit`），仍不會帶人去看不到的頁面。

let lastUserId: string | null = null

export function rememberUser(userId: string): void {
  lastUserId = userId
}

/** 最後一位登入的使用者 id；沒有記錄（例如剛重新整理）回傳 `null`。 */
export function recallUser(): string | null {
  return lastUserId
}

export function forgetUser(): void {
  lastUserId = null
}
