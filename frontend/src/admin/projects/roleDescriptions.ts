// 把角色實際持有的權限碼翻成一行白話說明，畫面不顯示權限碼。
//
// 角色由管理者自訂，名稱不能代表能做什麼，所以說明一律依權限碼產生。
// 每個權限碼各自對應後端實際保護的操作，措辭不得超出那個操作：
// 權限碼清單以後端 `app/permission_codes.py` 為準，各碼保護的端點見
// `app/api/v1/inspection_planning.py` 等。新增權限碼時補一條對照；
// 沒有對照的權限碼不會顯示，也不會露出代碼。

// 順序就是說明的順序，由「管人」到「現場」。
const PHRASES: Array<[code: string, phrase: string]> = [
  ['project_member.manage', '管理專案成員與角色'],
  ['project_inspection_item.edit', '編輯專案查核項目'],
  ['project_zone.read', '查看分區'],
  ['project_zone.manage', '新增、修改與刪除分區'],
  ['inspection_plan.read', '查看計畫'],
  ['inspection_plan.create', '建立計畫'],
  ['inspection_plan.manage', '修改計畫名稱'],
  ['inspection_plan.archive', '封存計畫'],
  ['inspection_plan.unarchive', '取消封存計畫'],
  ['inspection_task.read', '查看任務'],
  ['inspection_task.create', '建立任務'],
  ['inspection_task.manage', '修改任務位置'],
  ['inspection_task.assign', '指派任務給查核員'],
  ['inspection_task.dispatch', '派出任務'],
  ['inspection_task.delete_draft', '刪除草稿任務'],
  ['inspection_task.cancel', '取消或恢復任務'],
  ['inspection_task.inspect', '到現場查核'],
]

export const NO_PERMISSION_TEXT = '尚未設定任何權限'

/** 回傳一行白話說明，例如「可建立任務、派出任務」。 */
export function describeRole(permissionCodes: string[]): string {
  const owned = new Set(permissionCodes)
  const phrases = PHRASES.filter(([code]) => owned.has(code)).map(
    ([, phrase]) => phrase,
  )
  if (phrases.length > 0) return `可${phrases.join('、')}`
  if (permissionCodes.length > 0) return '可使用部分功能'
  return NO_PERMISSION_TEXT
}
