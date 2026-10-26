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
      { limit: 4 },
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
        { limit: 3 },
      ),
    ).rejects.toBe(failure)
    expect(started.length).toBeLessThan(30)
  })

  it('等在途請求收尾才回報，且只保留第一個錯誤', async () => {
    const first = new Error('first')
    let settled = 0
    await expect(
      mapWithConcurrency(
        [0, 1, 2],
        async (item) => {
          await new Promise((resolve) => setTimeout(resolve, item * 5 + 1))
          settled += 1
          throw item === 0 ? first : new Error(`later-${item}`)
        },
        { limit: 3 },
      ),
    ).rejects.toBe(first)
    expect(settled).toBe(3)
  })

  it('過期後不再領取新工作', async () => {
    const started: number[] = []
    let stale = false
    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, index) => index),
      async (item) => {
        started.push(item)
        await new Promise((resolve) => setTimeout(resolve, 1))
        if (item === 1) stale = true
      },
      { limit: 2, isStale: () => stale },
    )
    expect(started.length).toBeLessThan(20)
  })
})
