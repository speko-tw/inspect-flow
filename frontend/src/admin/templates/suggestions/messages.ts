import { httpErrorMessage } from '../../../http'

/** 動作名稱，決定沒有權限時要說明哪一項動作被擋。 */
export type SuggestionAction =
  'propose' | 'revise' | 'submit' | 'withdraw' | 'review' | 'read'

const DENIED: Record<SuggestionAction, string> = {
  propose:
    '你目前沒有修改這個專案查核項目的權限，不能提出建議。停用的項目要先恢復。',
  revise:
    '你已沒有來源專案的查核項目編輯權限，不能修改建議；仍可查看歷程或撤回。',
  submit:
    '你已沒有來源專案的查核項目編輯權限，不能重新送審；仍可查看歷程或撤回。',
  withdraw: '你沒有權限撤回這件建議。',
  review: '你沒有範本管理權限，不能審核建議。',
  read: '你沒有權限查看這件建議。',
}

/**
 * 範本建議各動作的錯誤文案（TPL-R31、TPL-R36 的錯誤契約）：
 * 併發改動與非法轉換都請使用者重讀，不盲目覆蓋；同名由畫面另行處理。
 */
export function suggestionErrorMessage(
  error: unknown,
  action: SuggestionAction,
): string {
  return httpErrorMessage(error, {
    codes: {
      'permission.denied': DENIED[action],
      'template_suggestion.changed':
        '這件建議剛被更新，請重新讀取後再操作；你的輸入沒有被覆蓋。',
      'template_suggestion.invalid_state':
        '這件建議目前的狀態不允許這項操作，請重新讀取後再確認。',
      'template.name_conflict': '此系統已有同名範本，本次沒有新增。',
      'resource.not_found': '找不到這件建議或相關資料，請重新整理。',
    },
    fallback: '操作失敗，請稍後再試。',
  })
}
