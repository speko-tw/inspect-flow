// 開始查核被拒絕時，顯示在操作旁的說明文案（規格設計，#419）。
// 後端錯誤碼 → 文案的對照見 docs/specs/field-ui/spec.md 的介面表。

import type { FieldPerson } from './api'

const REFRESH_HINT = '返回任務清單會看到最新內容。'

export function personLabel(person: FieldPerson | null): string {
  if (!person) return '未記錄'
  if (person.is_me) return person.name_zh ? `${person.name_zh}（你）` : '你'
  return person.name_zh ?? '同專案成員'
}

export const startMessages = {
  cancelled(reason: string | null): string {
    const why = reason ? `取消原因：${reason}。` : ''
    return `內業已取消這筆任務，所以無法開始。${why}${REFRESH_HINT}`
  },
  archived:
    '這筆任務所屬的查核計畫已被內業封存，封存後任務只能查看，所以無法開始。' +
    `請洽內業確認是否取消封存。${REFRESH_HINT}`,
  // 開始者姓名只在「實際開始者」顯示一次，錯誤文案不重複。
  startedByOther: `這筆任務已經有人開始，所以不需要再開始。${REFRESH_HINT}`,
  completed: `這筆任務已經完成，所以無法開始。${REFRESH_HINT}`,
  unchanged:
    '系統拒絕了這次操作，任務目前的狀態不能開始。' +
    '請返回任務清單確認最新狀態後再試。',
  forbidden:
    '你目前沒有開始這筆任務的權限，任務沒有被改動。' +
    '請聯絡專案管理者確認你的現場查核權限。',
  passwordChange: '請先變更臨時密碼，再開始查核。任務沒有被改動。',
  missing: `找不到這筆任務，或你已無法查看它，所以無法開始。${REFRESH_HINT}`,
  retry:
    '網路或伺服器暫時出問題，這筆任務還沒有開始。' +
    '請確認連線後再按一次「確認開始查核」。',
  unknownState:
    '任務的狀態已經改變，所以無法開始，但目前抓不到最新內容。' +
    '請返回任務清單重新確認。',
} as const
