// 判斷登入成功後要導回的路徑是不是安全的站內路徑。
//
// `RequireAuth` 把原路徑放進 `location.state`（不是 URL query），
// 所以一般使用者無法透過分享連結竄改；即便如此仍在這裡做一次防
// 禦性檢查，避免任何來源（例如未來改成 query 參數，或呼叫端傳入
// 不受信任的值）意外造成 open redirect：只接受以單一 `/` 開頭、
// 不是 `//`（protocol-relative URL）或反斜線變形的路徑。
export function isSafeRedirectPath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.startsWith('/\\')
  )
}
