// 待上傳照片清單：每張照片各自走「送出 → 自動重試 → 手動重送」。
//
// 待上傳的照片只存在這個元件的記憶體（Blob 與物件網址），不寫入
// IndexedDB、localStorage 或 Cache API，也沒有離線佇列（FEV-R08、
// FEV-AC11）：重新整理或關閉頁面就會消失，所以有待上傳照片時離開頁面
// 要提示（FEV-R15、LeaveGuard）。

import { useCallback, useEffect, useRef, useState } from 'react'

import { uploadPhoto } from './evidenceApi'
import { canResend, uploadFailureMessage } from './messages'
import type { FieldPhoto, UploadRequest } from './types'
import { MAX_AUTO_RETRIES, sendWithRetry } from './uploadRetry'

/** 畫面上一張待上傳照片的狀態。 */
export interface QueuedUpload {
  localId: string
  /** 清單上顯示用，不含任何識別碼。 */
  itemTitle: string
  targetText: string
  caption: string
  previewUrl: string
  /**
   * `sending` 上傳中；`retrying` 自動重試中；`failed` 可手動重送；
   * `rejected` 後端拒絕且重試不會變好，只能放棄後重拍。
   */
  status: 'sending' | 'retrying' | 'failed' | 'rejected'
  retry: number
  message: string
}

/** 加入清單所需的內容；請求本身（含冪等鍵）在整個生命週期不變。 */
export interface UploadDraft {
  request: UploadRequest
  itemTitle: string
  targetText: string
  previewUrl: string
}

/**
 * 管理待上傳清單。上傳成功就從清單移除並呼叫 `onUploaded`；
 * 放棄會中止進行中的請求並釋放預覽。
 */
export function useUploadQueue(
  taskId: string,
  onUploaded: (photo: FieldPhoto) => void,
) {
  const [uploads, setUploads] = useState<QueuedUpload[]>([])
  // 請求內容與中止器不進 state：它們不影響畫面，且必須維持同一份。
  const requests = useRef(new Map<string, UploadRequest>())
  const controllers = useRef(new Map<string, AbortController>())
  const urls = useRef(new Map<string, string>())
  const callback = useRef(onUploaded)
  useEffect(() => {
    callback.current = onUploaded
  }, [onUploaded])

  const patch = useCallback(
    (localId: string, change: Partial<QueuedUpload>) =>
      setUploads((list) =>
        list.map((entry) =>
          entry.localId === localId ? { ...entry, ...change } : entry,
        ),
      ),
    [],
  )

  const drop = useCallback((localId: string) => {
    requests.current.delete(localId)
    controllers.current.delete(localId)
    const url = urls.current.get(localId)
    if (url) URL.revokeObjectURL(url)
    urls.current.delete(localId)
    setUploads((list) => list.filter((entry) => entry.localId !== localId))
  }, [])

  const run = useCallback(
    async (localId: string) => {
      const request = requests.current.get(localId)
      if (!request) return
      const controller = new AbortController()
      controllers.current.set(localId, controller)
      patch(localId, { status: 'sending', retry: 0, message: '' })
      try {
        // 同一個 request 物件（同鍵、同檔）送出所有嘗試（FEV-R07、R08）。
        const result = await sendWithRetry(
          () => uploadPhoto(taskId, request, controller.signal),
          {
            signal: controller.signal,
            onRetry: (retry) => patch(localId, { status: 'retrying', retry }),
          },
        )
        if (result.ok) {
          drop(localId)
          callback.current(result.value)
          return
        }
        const resendable = canResend(result.error, result.retryable)
        patch(localId, {
          status: resendable ? 'failed' : 'rejected',
          retry: MAX_AUTO_RETRIES,
          message: uploadFailureMessage(result.error),
        })
      } catch (error) {
        // 放棄時的中止不是失敗；其他例外（例如回應格式不符）當成可重送。
        if (controller.signal.aborted) return
        console.error('Photo upload failed unexpectedly:', error)
        patch(localId, {
          status: 'failed',
          message: uploadFailureMessage(error),
        })
      }
    },
    [drop, patch, taskId],
  )

  const enqueue = useCallback(
    (draft: UploadDraft) => {
      const localId = draft.request.key
      requests.current.set(localId, draft.request)
      urls.current.set(localId, draft.previewUrl)
      setUploads((list) => [
        ...list,
        {
          localId,
          itemTitle: draft.itemTitle,
          targetText: draft.targetText,
          caption: draft.request.caption,
          previewUrl: draft.previewUrl,
          status: 'sending',
          retry: 0,
          message: '',
        },
      ])
      void run(localId)
    },
    [run],
  )

  const resend = useCallback((localId: string) => void run(localId), [run])

  const abandon = useCallback(
    (localId: string) => {
      controllers.current.get(localId)?.abort()
      drop(localId)
    },
    [drop],
  )

  useEffect(() => {
    const pending = controllers.current
    const previews = urls.current
    return () => {
      for (const controller of pending.values()) controller.abort()
      for (const url of previews.values()) URL.revokeObjectURL(url)
    }
  }, [])

  return { uploads, enqueue, resend, abandon }
}
