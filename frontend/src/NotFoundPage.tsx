// 找不到頁面（#480、#493）：不留白，附「回首頁」連結。
//
// 最外層的 404（路徑不存在）沒有登入狀態可用，`/` 會依登入狀態與
// 存取摘要導向該去的落點（未登入到登入頁）。在登入後的畫面裡
// （專案、任務、子路徑找不到）改用 `RouteNotFound`，直接連到該帳號
// 的落點。

import { Link } from 'react-router'

export interface NotFoundPageProps {
  title?: string
  message?: string
  /** 「回首頁」的目的地；預設 `/`。 */
  homeTo?: string
  /** 已在別的 `<main>` 或專案頁框裡：不再包一層 `<main>`。 */
  embedded?: boolean
  /** 嵌在已有 `<h1>` 的頁框（例如專案頁頂端）時用 2。 */
  headingLevel?: 1 | 2
}

export default function NotFoundPage({
  title = '找不到這個頁面',
  message = '網址可能輸入錯誤，或這個頁面已不存在。',
  homeTo = '/',
  embedded = false,
  headingLevel = 1,
}: NotFoundPageProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  const content = (
    <>
      <Heading>{title}</Heading>
      <p>{message}</p>
      <Link className="btn" to={homeTo}>
        回首頁
      </Link>
    </>
  )
  return embedded ? <section>{content}</section> : <main>{content}</main>
}
