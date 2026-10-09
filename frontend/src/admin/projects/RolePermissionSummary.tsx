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
        {codes.length === 0 && emptyText
          ? emptyText
          : summarizeRole(codes, descriptions)}
      </span>
      {details.length > 0 && (
        <>
          <button
            aria-controls={listId}
            aria-expanded={expanded}
            aria-label={`「${name}」完整權限`}
            onClick={() => setExpanded((value) => !value)}
            type="button"
          >
            完整權限
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
