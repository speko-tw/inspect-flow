import { useId, useState } from 'react'

import { rolePermissionDetails, summarizeRole } from './roleDescriptions'
import './RolePermissionSummary.css'

/** 顯示角色權限摘要，並由使用頁面指定展開鈕的既有樣式。 */
export default function RolePermissionSummary({
  codes,
  buttonClassName,
  descriptions,
  emptyText,
  name,
}: {
  codes: string[]
  buttonClassName?: string
  descriptions?: Map<string, string>
  emptyText?: string
  name: string
}) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const details = rolePermissionDetails(codes, descriptions)

  return (
    <div className="role-permission-summary">
      <span>
        {codes.length === 0 && emptyText
          ? emptyText
          : summarizeRole(codes, descriptions)}
      </span>
      {details.length > 0 && (
        <>
          <button
            className={buttonClassName}
            aria-controls={listId}
            aria-expanded={expanded}
            aria-label={`「${name}」完整權限`}
            onClick={() => setExpanded((value) => !value)}
            type="button"
          >
            查看完整權限
          </button>
          <ul hidden={!expanded} id={listId}>
            {details.map(({ code, label }) => (
              <li key={code}>{label}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
