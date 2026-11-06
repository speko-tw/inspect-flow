import { describe, expect, it, vi } from 'vitest'

import { HttpError } from '../../http'
import {
  BASE_DELAY_MS,
  MAX_AUTO_RETRIES,
  backoffDelay,
  isRetryable,
  sendWithRetry,
} from './uploadRetry'

describe('可重試的失敗分類（FEV-R08）', () => {
  it.each([
    [new TypeError('Failed to fetch'), true],
    [new HttpError(500), true],
    [new HttpError(503), true],
    [new HttpError(408), true],
    [new HttpError(429), true],
    [new HttpError(413, 'evidence.file_too_large'), false],
    [new HttpError(422, 'evidence.invalid_image'), false],
    [new HttpError(403, 'permission.denied'), false],
    [new HttpError(409, 'evidence.requirement_changed'), false],
    [new HttpError(404), false],
  ])('%s → %s', (error, expected) => {
    expect(isRetryable(error)).toBe(expected)
  })
})

describe('指數退避（D10）', () => {
  it('約 1、2、4 秒，各加最多 25% 的抖動', () => {
    expect(backoffDelay(1, () => 0)).toBe(BASE_DELAY_MS)
    expect(backoffDelay(2, () => 0)).toBe(2 * BASE_DELAY_MS)
    expect(backoffDelay(3, () => 0)).toBe(4 * BASE_DELAY_MS)
    expect(backoffDelay(3, () => 1)).toBe(5000)
  })
})

describe('sendWithRetry（FEV-AC10）', () => {
  it('前三次失敗、第四次成功：共送四次、間隔指數成長', async () => {
    const send = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockRejectedValueOnce(new HttpError(503))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue('uploaded')
    const sleepFn = vi.fn<(ms: number) => Promise<void>>(async () => {})
    const onRetry = vi.fn()
    const result = await sendWithRetry(send, {
      sleepFn,
      onRetry,
      random: () => 0,
    })
    expect(result).toEqual({ ok: true, value: 'uploaded' })
    expect(send).toHaveBeenCalledTimes(4)
    expect(sleepFn.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000])
    expect(onRetry.mock.calls).toEqual([[1], [2], [3]])
  })

  it('持續失敗：自動重試三次後交回可手動重送的失敗', async () => {
    const error = new TypeError('offline')
    const send = vi.fn().mockRejectedValue(error)
    const result = await sendWithRetry(send, {
      sleepFn: async () => undefined,
    })
    expect(result).toEqual({ ok: false, error, retryable: true })
    expect(send).toHaveBeenCalledTimes(1 + MAX_AUTO_RETRIES)
  })

  it.each([413, 422, 403, 409])('4xx（%s）不重試', async (status) => {
    const error = new HttpError(status)
    const send = vi.fn().mockRejectedValue(error)
    const sleepFn = vi.fn()
    const result = await sendWithRetry(send, { sleepFn })
    expect(result).toEqual({ ok: false, error, retryable: false })
    expect(send).toHaveBeenCalledTimes(1)
    expect(sleepFn).not.toHaveBeenCalled()
  })

  it('中止時拋出，不再重試', async () => {
    const controller = new AbortController()
    const send = vi.fn(async () => {
      controller.abort()
      throw new TypeError('aborted')
    })
    await expect(
      sendWithRetry(send, { signal: controller.signal }),
    ).rejects.toThrow('aborted')
    expect(send).toHaveBeenCalledTimes(1)
  })
})
