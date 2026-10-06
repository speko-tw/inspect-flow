// 路徑不存在時的 404 頁（#480）：不留白，附「回首頁」連結。`/` 會
// 依登入狀態與存取摘要導向該去的落點（未登入到登入頁）。

import { Link } from 'react-router'

export default function NotFoundPage() {
  return (
    <main>
      <h1>找不到這個頁面</h1>
      <p>網址可能輸入錯誤，或這個頁面已不存在。</p>
      <Link className="button-link" to="/">
        回首頁
      </Link>
    </main>
  )
}
