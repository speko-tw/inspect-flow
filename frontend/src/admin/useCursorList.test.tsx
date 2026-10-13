// useCursorList 的請求競態測試（F-O05）：過期回應不得覆寫新狀態。

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { deferred, type Deferred } from '../testing/submitGuard'
import type { ListPageOptions, Page } from './api'
import { useCursorList } from './useCursorList'

type Row = { id: string }

function page(ids: string[], next: string | null = null): Page<Row> {
  return { items: ids.map((id) => ({ id })), next_cursor: next }
}

/** 每次呼叫 fetchPage 都產生一個可手動完成的請求。 */
function setup() {
  const gates: Deferred<Page<Row>>[] = []
  const calls: ListPageOptions[] = []
  // 兩個函式都必須是穩定參照，與 hook 的使用限制一致。
  const fetchPage = vi.fn((params: ListPageOptions) => {
    calls.push(params)
    const gate = deferred<Page<Row>>()
    gates.push(gate)
    return gate.promise
  })
  const getErrorMessage = vi.fn(() => '載入失敗')
  const view = renderHook(() => useCursorList(fetchPage, getErrorMessage))
  return { view, gates, calls, fetchPage, getErrorMessage }
}

async function settleInitial(
  ctx: ReturnType<typeof setup>,
  result: Page<Row> = page(['initial']),
) {
  await waitFor(() => expect(ctx.gates).toHaveLength(1))
  await act(async () => {
    ctx.gates[0].resolve(result)
  })
}

describe('useCursorList race conditions', () => {
  it('ignores an older search response that arrives late', async () => {
    const ctx = setup()
    await settleInitial(ctx)

    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = ctx.view.result.current.search('a')
    })
    act(() => {
      second = ctx.view.result.current.search('b')
    })
    expect(ctx.calls.map((call) => call.q)).toEqual(['', 'a', 'b'])

    await act(async () => {
      ctx.gates[2].resolve(page(['b-result']))
      await second
    })
    expect(ctx.view.result.current.items).toEqual([{ id: 'b-result' }])

    await act(async () => {
      ctx.gates[1].resolve(page(['a-result']))
      await first
    })
    expect(ctx.view.result.current.items).toEqual([{ id: 'b-result' }])
    expect(ctx.view.result.current.appliedQuery).toBe('b')
    expect(ctx.view.result.current.loading).toBe(false)
  })

  it('drops a loadMore response when a search starts meanwhile', async () => {
    const ctx = setup()
    await settleInitial(ctx, page(['initial'], 'cursor-1'))

    let more!: Promise<void>
    act(() => {
      more = ctx.view.result.current.loadMore()
    })
    expect(ctx.calls[1]).toMatchObject({ cursor: 'cursor-1', limit: 50 })
    expect(ctx.view.result.current.loadingMore).toBe(true)

    let searching!: Promise<void>
    act(() => {
      searching = ctx.view.result.current.search('x')
    })
    expect(ctx.view.result.current.loadingMore).toBe(false)
    await act(async () => {
      ctx.gates[2].resolve(page(['x-result']))
      await searching
    })

    await act(async () => {
      ctx.gates[1].resolve(page(['stale-more'], 'cursor-stale'))
      await more
    })
    expect(ctx.view.result.current.items).toEqual([{ id: 'x-result' }])
    expect(ctx.view.result.current.nextCursor).toBeNull()
    expect(ctx.view.result.current.loadingMore).toBe(false)
  })

  it('does not update state or report errors after unmount', async () => {
    const ctx = setup()
    await waitFor(() => expect(ctx.gates).toHaveLength(1))
    ctx.view.unmount()

    await act(async () => {
      ctx.gates[0].reject(new Error('late failure'))
    })
    expect(ctx.getErrorMessage).not.toHaveBeenCalled()
    expect(ctx.view.result.current.error).toBe('')
    expect(ctx.view.result.current.items).toEqual([])
  })

  it('allows the same search to be sent again after a failure', async () => {
    const ctx = setup()
    await settleInitial(ctx)

    let failed!: Promise<void>
    act(() => {
      failed = ctx.view.result.current.search('x')
    })
    await act(async () => {
      ctx.gates[1].reject(new Error('boom'))
      await failed
    })
    expect(ctx.view.result.current.error).toBe('載入失敗')
    expect(ctx.view.result.current.loading).toBe(false)

    let retry!: Promise<void>
    act(() => {
      retry = ctx.view.result.current.search('x')
    })
    expect(ctx.fetchPage).toHaveBeenCalledTimes(3)
    await act(async () => {
      ctx.gates[2].resolve(page(['x-result']))
      await retry
    })
    expect(ctx.view.result.current.error).toBe('')
    expect(ctx.view.result.current.items).toEqual([{ id: 'x-result' }])
  })

  it('does not resend the same query while it is still in flight', async () => {
    const ctx = setup()
    await settleInitial(ctx)

    let first!: Promise<void>
    act(() => {
      first = ctx.view.result.current.search('x')
    })
    act(() => {
      void ctx.view.result.current.search('x')
    })
    expect(ctx.fetchPage).toHaveBeenCalledTimes(2)
    await act(async () => {
      ctx.gates[1].resolve(page(['x-result']))
      await first
    })
    expect(ctx.view.result.current.items).toEqual([{ id: 'x-result' }])
  })
})
