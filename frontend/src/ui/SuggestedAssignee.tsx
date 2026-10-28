/** IP-R12：只有未封存且仍可執行的任務需要改派，歷史紀錄中性呈現。 */
export function inactiveAssigneeNotice(status: string, archived: boolean) {
  return !archived && ['DRAFT', 'PENDING', 'IN_PROGRESS'].includes(status)
    ? '（已停用，請改派）'
    : '（已停用）'
}

/** 保留停用者名稱；唯讀總覽可關閉改派提醒（IP-R12）。 */
export function SuggestedAssignee({
  person,
  status,
  archived,
  unassignedLabel = '未指定',
  showReassignNotice = true,
}: {
  status: string
  archived: boolean
  unassignedLabel?: string
  showReassignNotice?: boolean
  person: {
    name_zh: string | null
    username?: string
    is_active?: boolean
  } | null
}) {
  return (
    <span>
      {person?.name_zh || person?.username || unassignedLabel}
      {person?.is_active === false &&
        (showReassignNotice &&
        inactiveAssigneeNotice(status, archived).includes('請改派') ? (
          <strong className="field-error">（已停用，請改派）</strong>
        ) : (
          <span>（已停用）</span>
        ))}
    </span>
  )
}
