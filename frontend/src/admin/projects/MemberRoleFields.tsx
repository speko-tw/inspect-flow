import { useId, type Ref } from 'react'

import { describeRole } from './roleDescriptions'
import type { Role } from './api'

/** 必填欄位的標示；「*」只給視覺，必填由欄位說明表達。 */
export function RequiredMark() {
  return <span aria-hidden="true"> *</span>
}

/**
 * 角色複選：每個角色名稱旁附一行白話說明（依權限碼產生，不顯示代碼）。
 * 錯誤顯示在這一欄的下方；`firstRef` 讓表單在錯誤時把焦點移到第一個選項。
 */
export default function MemberRoleFields({
  roles,
  selected,
  onChange,
  error,
  firstRef,
}: {
  roles: Role[]
  selected: string[]
  onChange: (next: string[]) => void
  error?: string
  firstRef?: Ref<HTMLInputElement>
}) {
  const baseId = useId()
  const errorId = `${baseId}-error`
  return (
    <fieldset
      aria-describedby={error ? errorId : undefined}
      className="member-roles"
    >
      <legend>
        專案角色
        <RequiredMark />
      </legend>
      <p className="member-hint">至少選一個，角色決定這個人能做什麼。</p>
      {roles.map((role, index) => {
        const nameId = `${baseId}-name-${role.id}`
        const descId = `${baseId}-desc-${role.id}`
        return (
          <label className="member-role-option" key={role.id}>
            <input
              aria-describedby={error ? `${descId} ${errorId}` : descId}
              aria-invalid={error ? true : undefined}
              aria-labelledby={nameId}
              checked={selected.includes(role.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, role.id]
                    : selected.filter((id) => id !== role.id),
                )
              }
              ref={index === 0 ? firstRef : undefined}
              type="checkbox"
              value={role.id}
            />
            <span className="member-role-text">
              <span className="member-role-name" id={nameId}>
                {role.name}
              </span>
              <span className="member-hint" id={descId}>
                {describeRole(role.permission_codes)}
              </span>
            </span>
          </label>
        )
      })}
      {error && (
        <p className="member-field-error" id={errorId}>
          {error}
        </p>
      )}
    </fieldset>
  )
}
