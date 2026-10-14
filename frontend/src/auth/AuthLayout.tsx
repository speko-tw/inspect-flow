// 登入、變更密碼、首次設定三頁共用的置中卡片版面。只負責外觀
// （系統名稱、標題、說明文字、卡片寬度），不含任何行為；樣式在
// `styles.css` 的 `.auth-page`、`.auth-card`。

import type { ReactNode } from 'react'

export default function AuthLayout({
  title,
  lead,
  progress,
  back,
  wide = false,
  children,
}: {
  title: string
  /** 標題下方的一句說明。 */
  lead?: ReactNode
  /** 標題上方的進度（例如首次設定的步驟列）。 */
  progress?: ReactNode
  /** 卡片最上方的「返回X」連結（BackLink）。 */
  back?: ReactNode
  /** 內容較長的表單（例如新增使用者）用較寬的卡片。 */
  wide?: boolean
  children: ReactNode
}) {
  return (
    <main className="auth-page">
      <div className={wide ? 'auth-card auth-card-wide' : 'auth-card'}>
        {back}
        <p className="brand">InspectFlow 工程查核系統</p>
        {progress}
        <h1>{title}</h1>
        {lead ? <p className="lead">{lead}</p> : null}
        {children}
      </div>
    </main>
  )
}
