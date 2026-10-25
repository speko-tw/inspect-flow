/** IP-R12：只有未封存且仍可執行的任務需要改派，歷史紀錄中性呈現。 */
export function inactiveAssigneeNotice(status: string, archived: boolean) {
  return !archived && ['DRAFT', 'PENDING', 'IN_PROGRESS'].includes(status)
    ? '（已停用，請改派）'
    : '（已停用）'
}

/** 保留建議人名稱並醒目提示停用狀態，讓內業知道需要改派（#734）。 */
export function SuggestedAssignee({
  person,
  status,
  archived,
  unassignedLabel = '未指定',
}: {
  status: string
  archived: boolean
  unassignedLabel?: string
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
        (inactiveAssigneeNotice(status, archived).includes('請改派') ? (
          <strong className="field-error">（已停用，請改派）</strong>
        ) : (
          <span>（已停用）</span>
        ))}
    </span>
  )
}
