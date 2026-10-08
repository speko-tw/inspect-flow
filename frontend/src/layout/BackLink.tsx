// 「返回上一層」的共用寫法（#500）。
//
// 頁首的上一層一律用 BackLink：‹ 加上 `Link`（站內導覽，不整頁重載），
// 文字寫成「返回X」。‹ 只是裝飾，用 aria-hidden 隱藏，所以連結的
// 名稱就是「返回X」。同一頁內切換面板（沒有換網址）用 BackButton，
// 外觀相同。錯誤頁與空狀態的出口不用這個，改用次要按鈕樣式的連結
// （`<Link className="btn">`）。

import type { ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router'

export function BackLink({
  children,
  className,
  ...props
}: Omit<LinkProps, 'children'> & { children: ReactNode }) {
  return (
    <Link
      {...props}
      className={className ? `back-link ${className}` : 'back-link'}
    >
      <span aria-hidden="true">‹</span>
      {children}
    </Link>
  )
}

export function BackButton({
  children,
  className,
  onClick,
}: {
  children: ReactNode
  className?: string
  onClick: () => void
}) {
  return (
    <button
      className={className ? `back-link ${className}` : 'back-link'}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true">‹</span>
      {children}
    </button>
  )
}
