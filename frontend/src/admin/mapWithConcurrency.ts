// 批次預覽需要對每個選取的帳號或公司各查一次；最多選 200 筆時，
// 一次全部送出會瞬間佔滿瀏覽器連線與後端資料庫連線池（#732）。

/** 批次預覽同時進行的請求數上限。 */
export const BATCH_PREVIEW_CONCURRENCY = 6

type ConcurrencyOptions = {
  /** 同時進行的請求數上限，預設 `BATCH_PREVIEW_CONCURRENCY`。 */
  limit?: number
  /**
   * 回傳 true 代表這一批結果已過期（例如使用者換了搜尋或換頁）。
   * 過期後不再領取新工作，並回傳已完成的部分結果，呼叫端應丟棄。
   */
  isStale?: () => boolean
}

/**
 * 依序領取工作、同時最多 `limit` 個請求，結果順序與 `items` 相同。
 *
 * 任一請求失敗就不再發出新的請求，等在途請求收尾後回報第一個錯誤，
 * 任何失敗都不交付部分結果。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  run: (item: T) => Promise<R>,
  { limit = BATCH_PREVIEW_CONCURRENCY, isStale }: ConcurrencyOptions = {},
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let failed = false
  let failure: unknown
  async function worker() {
    while (!failed && !isStale?.() && next < items.length) {
      const index = next++
      try {
        results[index] = await run(items[index])
      } catch (caught) {
        // 只記第一個錯誤；其餘在途請求的錯誤不覆蓋它。
        if (!failed) {
          failed = true
          failure = caught
        }
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )
  if (failed) throw failure
  return results
}
