// 記住「這個頁面執行期間，上一次的登入狀態」，只用來判斷登入頁能不能
// 沿用原本要去的頁面（#489）。三種狀態：
//
// - `none`：這個頁面執行期間沒有人登入過（直接開深層連結、重新整理
//   後都是這個狀態），無從辨識上一位，原頁面新帳號看得到就回去
//   （AUT-R29）；
// - `user`：最後一位登入的人；逾時後重新登入，是同一人才回原頁，換人
//   去落點；
// - `signedOut`：剛主動登出。結束工作不保留原頁面，所以不論是誰
//   登入都去落點，登出後按上一頁再換人登入也一樣。
//
// 只放在記憶體：AUT-R30 不允許把登入資訊寫進 `localStorage`、
// `sessionStorage`。代價是重新整理頁面後狀態回到 `none`，這時只能退回
// 「原頁面新帳號看得到才回去」（見 `landing.ts` 的 `canVisit`），仍不會
// 帶人去看不到的頁面。

export type PreviousSession =
  { kind: 'none' } | { kind: 'user'; userId: string } | { kind: 'signedOut' }

let previous: PreviousSession = { kind: 'none' }

/** 驗證成功時記下目前使用者；會蓋掉「已登出」狀態。 */
export function rememberUser(userId: string): void {
  previous = { kind: 'user', userId }
}

/** 主動登出：之後的登入一律去落點。 */
export function markSignedOut(): void {
  previous = { kind: 'signedOut' }
}

export function previousSession(): PreviousSession {
  return previous
}

/** 回到「沒有任何記錄」；給測試隔離用。 */
export function resetSessionMemory(): void {
  previous = { kind: 'none' }
}
