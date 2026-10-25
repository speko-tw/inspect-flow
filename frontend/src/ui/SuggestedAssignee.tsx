/** 保留建議人名稱並醒目提示停用狀態，讓內業知道需要改派（#734）。 */
export function SuggestedAssignee({
  person,
  unassignedLabel = '未指定',
}: {
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
      {person?.is_active === false && (
        <strong className="field-error">（已停用，請改派）</strong>
      )}
    </span>
  )
}
