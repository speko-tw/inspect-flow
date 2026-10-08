// 狀態標籤（#501）。外觀只有五種變體；狀態要用哪個變體，一律查
// `statusBadge.ts` 的對照表，不要在各頁自己挑顏色。

import type { ReactNode } from 'react'

import {
  STATUS_BADGES,
  type BadgeStatus,
  type BadgeVariant,
} from './statusBadge'

export function Badge({
  variant = 'neutral',
  children,
}: {
  variant?: BadgeVariant
  children: ReactNode
}) {
  return <span className={`badge badge-${variant}`}>{children}</span>
}

/**
 * 依狀態碼顯示標籤；清單與詳情都用它，所以同一個狀態同一個顏色。
 * `parenthesized` 用在「名稱（狀態）」的連結、按鈕與標題：括號只留給
 * 輔助科技，畫面上只看到標籤，可存取名稱仍是「名稱（狀態）」。
 */
export function StatusBadge({
  status,
  parenthesized = false,
}: {
  status: BadgeStatus
  parenthesized?: boolean
}) {
  const { label, variant } = STATUS_BADGES[status]
  const badge = <Badge variant={variant}>{label}</Badge>
  if (!parenthesized) return badge
  return (
    <>
      <span className="visually-hidden">（</span>
      {badge}
      <span className="visually-hidden">）</span>
    </>
  )
}
