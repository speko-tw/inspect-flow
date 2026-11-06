// 上傳的自動重試與退避（FEV-R08、FEV-AC10、D10）。
//
// 失敗時照片必須留在畫面上：這裡只負責「送出、判斷能不能重試、等待、
// 再送」，不碰照片內容。每一輪都用呼叫端給的同一個 `send`，所以冪等鍵與
// 內容自然沿用；後端靠冪等鍵確保只留一筆照片（FEV-R07）。

import { HttpError } from '../../http'

/** 自動重試次數（不含第一次送出）；之後改手動重送（FEV-R08）。 */
export const MAX_AUTO_RETRIES = 3
/** 第一次重試前的基礎等待；之後每次加倍，約 1、2、4 秒（D10）。 */
export const BASE_DELAY_MS = 1000
/** 隨機抖動上限（基礎等待的比例），避免多張照片同時重試。 */
const JITTER = 0.25

/**
 * 判斷失敗能不能自動重試：沒有回應（斷線、逾時）、5xx、408、429
 * 可以；其餘 4xx（413、422、403、409 等）重試也不會變好，直接交給
 * 畫面說明（FEV-R08、D10）。
 */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof HttpError)) return true
  return error.status >= 500 || error.status === 408 || error.status === 429
}

/** 第 n 次重試前的等待時間（n 從 1 起算）。 */
export function backoffDelay(
  retry: number,
  random: () => number = Math.random,
): number {
  return Math.round(BASE_DELAY_MS * 2 ** (retry - 1) * (1 + JITTER * random()))
}

/** 可被中止的等待；中止時立即以 `AbortError` 結束。 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 一輪上傳的結果；失敗時帶最後一次的錯誤，供畫面挑說明文字。 */
export type AttemptResult<T> =
  { ok: true; value: T } | { ok: false; error: unknown; retryable: boolean }

/**
 * 送出並在可重試的失敗後依指數退避重送，最多 `MAX_AUTO_RETRIES` 次。
 * 不可重試的錯誤立即回傳；用盡次數回傳最後的錯誤且 `retryable` 為真，
 * 畫面據此顯示手動重送。`signal` 中止時拋出 `AbortError`。
 *
 * @param send 每次都送同一個請求（同一冪等鍵、同一份內容）。
 * @param onRetry 準備第 n 次重試時通知畫面（n 從 1 起算）。
 */
export async function sendWithRetry<T>(
  send: () => Promise<T>,
  options: {
    signal?: AbortSignal
    onRetry?: (retry: number) => void
    sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>
    random?: () => number
  } = {},
): Promise<AttemptResult<T>> {
  const wait = options.sleepFn ?? sleep
  for (let retry = 0; ; retry++) {
    try {
      return { ok: true, value: await send() }
    } catch (error) {
      if (options.signal?.aborted) throw error
      if (!isRetryable(error)) {
        return { ok: false, error, retryable: false }
      }
      if (retry === MAX_AUTO_RETRIES) {
        return { ok: false, error, retryable: true }
      }
      options.onRetry?.(retry + 1)
      await wait(backoffDelay(retry + 1, options.random), options.signal)
    }
  }
}
