// 狀態碼到標籤文字與顏色變體的唯一對照表（#501）。
//
// 計畫與任務共用同一組狀態詞，同一個詞在任何畫面都是同一個顏色：
//   neutral 灰：還沒開始或已結束但沒有結果（草稿、已取消、已封存、停用）
//   warning 黃：輪到人處理（待開始）
//   info    藍：進行中
//   success 綠：已完成、啟用
//   danger  紅：目前沒有狀態使用；保留給未來的失敗或逾期。
// 新增狀態只改這個檔案。

export type BadgeVariant =
  'neutral' | 'success' | 'warning' | 'danger' | 'info'

export const STATUS_BADGES = {
  DRAFT: { label: '草稿', variant: 'neutral' },
  PENDING: { label: '待開始', variant: 'warning' },
  IN_PROGRESS: { label: '進行中', variant: 'info' },
  COMPLETED: { label: '已完成', variant: 'success' },
  CANCELLED: { label: '已取消', variant: 'neutral' },
  ARCHIVED: { label: '已封存', variant: 'neutral' },
  ACTIVE: { label: '啟用', variant: 'success' },
  INACTIVE: { label: '停用', variant: 'neutral' },
} as const satisfies Record<string, { label: string; variant: BadgeVariant }>

export type BadgeStatus = keyof typeof STATUS_BADGES

/** 帳號與公司的啟用旗標轉成狀態碼。 */
export function activeStatus(isActive: boolean): BadgeStatus {
  return isActive ? 'ACTIVE' : 'INACTIVE'
}
