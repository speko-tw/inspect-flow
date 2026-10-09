import { useId, useState } from 'react'

import { rolePermissionDetails, summarizeRole } from './roleDescriptions'
import './RolePermissionSummary.css'

export default function RolePermissionSummary({
  codes,
  descriptions,
  emptyText,
  name,
}: {
  codes: string[]
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
        {codes.length === 0 && emptyText ? emptyText : summarizeRole(codes)}
      </span>
      {details.length > 0 && (
        <>
          <button
            aria-controls={listId}
            aria-expanded={expanded}
            aria-label={`${expanded ? '收合' : '展開'}「${name}」完整權限`}
            onClick={() => setExpanded((value) => !value)}
            type="button"
          >
            {expanded ? '收合權限' : '完整權限'}
          </button>
          <ul hidden={!expanded} id={listId}>
            {details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
