// 批次預覽需要對每個選取的帳號或公司各查一次；最多選 200 筆時，
// 一次全部送出會瞬間佔滿瀏覽器連線與後端資料庫連線池（#732）。

/** 批次預覽同時進行的請求數上限。 */
export const BATCH_PREVIEW_CONCURRENCY = 6

/**
 * 依序領取工作、同時最多 `limit` 個請求，結果順序與 `items` 相同。
 *
 * 任一請求失敗就不再發出新的請求並回報第一個錯誤，行為與
 * `Promise.all` 一致，但不會在失敗後繼續送完剩餘請求。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  run: (item: T) => Promise<R>,
  limit: number = BATCH_PREVIEW_CONCURRENCY,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let failed = false
  async function worker() {
    while (!failed && next < items.length) {
      const index = next++
      try {
        results[index] = await run(items[index])
      } catch (caught) {
        failed = true
        throw caught
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )
  return results
}
