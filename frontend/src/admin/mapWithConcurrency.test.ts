import { describe, expect, it } from 'vitest'

import { mapWithConcurrency } from './mapWithConcurrency'

describe('mapWithConcurrency（#732）', () => {
  it('同時進行的請求不超過上限，結果順序不變', async () => {
    let inFlight = 0
    let peak = 0
    const items = Array.from({ length: 50 }, (_, index) => index)
    const results = await mapWithConcurrency(
      items,
      async (item) => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 1))
        inFlight -= 1
        return item * 2
      },
      4,
    )
    expect(peak).toBe(4)
    expect(results).toEqual(items.map((item) => item * 2))
  })

  it('空清單不發請求', async () => {
    expect(await mapWithConcurrency([], async () => 1)).toEqual([])
  })

  it('失敗後不再發出新的請求並回報第一個錯誤', async () => {
    const started: number[] = []
    const failure = new Error('boom')
    await expect(
      mapWithConcurrency(
        Array.from({ length: 30 }, (_, index) => index),
        async (item) => {
          started.push(item)
          await new Promise((resolve) => setTimeout(resolve, 1))
          if (item === 2) throw failure
          return item
        },
        3,
      ),
    ).rejects.toBe(failure)
    expect(started.length).toBeLessThan(30)
  })
})
