// 表單送出防護的測試輔助（#507）。

import { fireEvent } from '@testing-library/react'
import { expect, type Mock } from 'vitest'

export type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

/** 手動控制完成時機的 Promise：模擬「請求還沒回來」。 */
export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * 在欄位上按兩種輸入法選字的 Enter：標準瀏覽器的 `isComposing`，
 * 以及 Safari 的 `keyCode 229`。jsdom 不會自己做隱含送出，所以驗證
 * 「預設動作被取消」（真實瀏覽器就不會送出表單）；呼叫端另外確認
 * API 沒被呼叫。
 */
export function expectImeEnterIgnored(field: Element): void {
  // fireEvent 回傳 false 代表有人呼叫了 preventDefault。
  expect(fireEvent.keyDown(field, { key: 'Enter', isComposing: true })).toBe(
    false,
  )
  expect(fireEvent.keyDown(field, { key: 'Enter', keyCode: 229 })).toBe(false)
}

type FetchMock = Mock<
  (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
>

/**
 * 讓符合 `method` 與 `pattern` 的請求等到回傳的 Deferred 完成才回應
 * （模擬「請求還沒回來」）；其他請求照舊。
 */
export function holdRequests(
  fetchMock: FetchMock,
  method: string,
  pattern: RegExp,
): Deferred<void> {
  const gate = deferred()
  const original = fetchMock.getMockImplementation()
  if (!original) throw new Error('fetch mock has no implementation')
  fetchMock.mockImplementation(async (input, init) => {
    if ((init?.method ?? 'GET') === method && pattern.test(String(input))) {
      await gate.promise
    }
    return original(input, init)
  })
  return gate
}
