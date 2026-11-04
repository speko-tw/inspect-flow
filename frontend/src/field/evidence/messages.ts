// 照片上傳與修改失敗時給現場人員的白話說明（FEV-R08、FEV-AC10）。
// 只用 `error.code` 與狀態碼對應，不顯示技術細節或識別碼（FEV-R15）。

import { HttpError } from '../../http'
import { UploadTimeoutError } from './evidenceApi'

const CODE_MESSAGES: Record<string, string> = {
  'evidence.file_too_large': '照片檔案太大，無法上傳。請放棄後重新拍攝。',
  'evidence.invalid_image': '照片格式無法辨識。請放棄後重新拍攝。',
  'evidence.sha256_mismatch': '照片在傳輸中不完整。請按「手動重送」再試一次。',
  'evidence.invalid_target':
    '選的項次與這個查核項目不符。請放棄後重新選擇項次。',
  'evidence.requirement_changed':
    '這個查核項目的標準剛更新，舊項次已失效。請重新整理頁面後再拍。',
  'evidence.task_locked':
    '這個任務目前只能查看照片，可能已完成或取消。請返回任務清單確認狀態。',
  'inspection_plan.archived':
    '所屬計畫已封存，照片只能查看，無法新增、修改或刪除。',
  'evidence.idempotency_conflict':
    '這張照片的上傳內容有衝突。請放棄後重新拍攝。',
  'evidence.photo_deleted': '這張照片已被刪除。',
  'evidence.photo_locked': '這張照片已被鎖定，不能修改或刪除。',
  'permission.denied':
    '你目前沒有權限在這個任務新增、修改或刪除照片。請返回任務清單確認。',
}

/** 離線或連不上伺服器；照片仍留在畫面（FEV-AC11）。 */
export const OFFLINE_MESSAGE =
  '目前連不上網路，照片仍留在這個畫面。網路恢復後請按「手動重送」。'

/** 持續遇到伺服器暫時性錯誤（5xx、408、429）。 */
const SERVER_BUSY_MESSAGE =
  '伺服器暫時無法處理，照片仍留在這個畫面。請稍後按「手動重送」。'

/** 上傳失敗的說明文字；會帶出下一步（重送或放棄）。 */
export function uploadFailureMessage(error: unknown): string {
  if (error instanceof UploadTimeoutError) return OFFLINE_MESSAGE
  if (!(error instanceof HttpError)) return OFFLINE_MESSAGE
  if (error.code && CODE_MESSAGES[error.code]) {
    return CODE_MESSAGES[error.code]
  }
  if (error.status === 413) return CODE_MESSAGES['evidence.file_too_large']
  if (error.status === 403) return CODE_MESSAGES['permission.denied']
  if (error.status === 404) {
    return '找不到這個任務，可能已被取消派送。請返回任務清單。'
  }
  if (error.status === 401) return '登入狀態已失效，請重新登入後再上傳。'
  if (error.status >= 500 || error.status === 408 || error.status === 429) {
    return SERVER_BUSY_MESSAGE
  }
  return '照片無法上傳。請放棄後重新拍攝，若仍失敗請聯絡管理員。'
}

/** 修改註記、對應與刪除失敗的說明文字。 */
export function mutationFailureMessage(error: unknown): string {
  if (!(error instanceof HttpError)) {
    return '目前連不上網路，請稍後再試。'
  }
  if (error.code && CODE_MESSAGES[error.code]) {
    return CODE_MESSAGES[error.code]
  }
  if (error.status === 403) return CODE_MESSAGES['permission.denied']
  if (error.status === 404) return '找不到這張照片，可能已被刪除。'
  if (error.status === 409)
    return '照片或任務狀態已改變，目前無法修改或刪除。請重新整理後確認。'
  if (error.status === 422) return '送出的內容有誤，請檢查後再試。'
  if (error.status >= 500) return '伺服器暫時無法處理，請稍後再試。'
  return '操作失敗，請稍後再試。'
}

/**
 * 上傳失敗後是否仍提供「手動重送」：可重試的失敗用盡自動次數後，
 * 以及傳輸不完整（雜湊不符）；其餘 4xx 只能放棄後重拍（FEV-R08）。
 */
export function canResend(error: unknown, retryable: boolean): boolean {
  if (retryable) return true
  return (
    error instanceof HttpError && error.code === 'evidence.sha256_mismatch'
  )
}
