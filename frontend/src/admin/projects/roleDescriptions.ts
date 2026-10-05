// 把角色實際持有的權限碼翻成一行白話說明，畫面不顯示權限碼。
//
// 角色由管理者自訂，名稱不能代表能做什麼，所以說明一律依權限碼產生。
// 權限碼清單以後端 `app/permission_codes.py` 為準；新增權限碼時，
// 在 `CAPABILITIES` 補一條，沒有對照的權限碼不會顯示，也不會露出代碼。

interface Capability {
  phrase: string
  // 任一權限碼符合就顯示這句。
  codes: string[]
}

// 順序就是說明的順序，由「管人」到「現場」。
// 每組互斥：同組內只顯示第一個符合的說明（強的在前）。
const GROUPS: Capability[][] = [
  [{ phrase: '管理專案成員與角色', codes: ['project_member.manage'] }],
  [{ phrase: '編輯查核項目', codes: ['project_inspection_item.edit'] }],
  [
    { phrase: '管理分區', codes: ['project_zone.manage'] },
    { phrase: '查看分區', codes: ['project_zone.read'] },
  ],
  [
    {
      phrase: '建立與修改計畫',
      codes: ['inspection_plan.manage', 'inspection_plan.create'],
    },
    { phrase: '查看計畫', codes: ['inspection_plan.read'] },
  ],
  [
    {
      phrase: '封存計畫',
      codes: ['inspection_plan.archive', 'inspection_plan.unarchive'],
    },
  ],
  [
    {
      phrase: '建立與修改任務',
      codes: ['inspection_task.manage', 'inspection_task.create'],
    },
    { phrase: '查看任務', codes: ['inspection_task.read'] },
  ],
  [{ phrase: '指派人員', codes: ['inspection_task.assign'] }],
  [{ phrase: '派出任務', codes: ['inspection_task.dispatch'] }],
  [
    {
      phrase: '刪除草稿或取消任務',
      codes: ['inspection_task.delete_draft', 'inspection_task.cancel'],
    },
  ],
  [{ phrase: '到現場查核', codes: ['inspection_task.inspect'] }],
]

export const NO_PERMISSION_TEXT = '尚未設定任何權限'

/** 回傳一行白話說明，例如「可建立與修改任務、派出任務」。 */
export function describeRole(permissionCodes: string[]): string {
  const owned = new Set(permissionCodes)
  const phrases = GROUPS.flatMap((group) => {
    const hit = group.find((capability) =>
      capability.codes.some((code) => owned.has(code)),
    )
    return hit ? [hit.phrase] : []
  })
  if (phrases.length > 0) return `可${phrases.join('、')}`
  if (permissionCodes.length > 0) return '可使用部分功能'
  return NO_PERMISSION_TEXT
}
