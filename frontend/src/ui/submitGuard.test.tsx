import { act, fireEvent, render, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { deferred } from '../testing/submitGuard'
import { blockImeEnter, isImeEnter, useSubmitGuard } from './submitGuard'

describe('useSubmitGuard', () => {
  it('runs the task once while the first one is in flight', async () => {
    const { result } = renderHook(() => useSubmitGuard())
    const gate = deferred<string>()
    const task = vi.fn(() => gate.promise)

    const first = result.current.run(task)
    const second = result.current.run(task)

    expect(task).toHaveBeenCalledTimes(1)
    await expect(second).resolves.toBeUndefined()
    gate.resolve('ok')
    await expect(first).resolves.toBe('ok')
  })

  it('accepts a new submit once the task succeeded', async () => {
    const { result } = renderHook(() => useSubmitGuard())
    const task = vi.fn(async () => 'ok')

    await result.current.run(task)
    await result.current.run(task)

    expect(task).toHaveBeenCalledTimes(2)
  })

  it('accepts a new submit after the task failed, and rethrows', async () => {
    const { result } = renderHook(() => useSubmitGuard())
    const failing = vi.fn(async () => {
      throw new Error('boom')
    })
    const working = vi.fn(async () => 'ok')

    await expect(result.current.run(failing)).rejects.toThrow('boom')
    await expect(result.current.run(working)).resolves.toBe('ok')
    expect(failing).toHaveBeenCalledTimes(1)
    expect(working).toHaveBeenCalledTimes(1)
  })

  it('releases right away when a synchronous task throws', async () => {
    const { result } = renderHook(() => useSubmitGuard())

    await expect(
      result.current.run(() => {
        throw new Error('sync')
      }),
    ).rejects.toThrow('sync')
    expect(result.current.enter()).toBe(true)
  })

  it('releases a synchronous task without waiting for a microtask', () => {
    const { result } = renderHook(() => useSubmitGuard())
    const task = vi.fn()

    void result.current.run(task)
    void result.current.run(task)

    expect(task).toHaveBeenCalledTimes(2)
  })

  it('enter and leave guard manual try/finally blocks', () => {
    const { result } = renderHook(() => useSubmitGuard())

    expect(result.current.enter()).toBe(true)
    expect(result.current.enter()).toBe(false)
    result.current.leave()
    expect(result.current.enter()).toBe(true)
  })

  it('keeps the same guard across re-renders', () => {
    const { result, rerender } = renderHook(() => useSubmitGuard())
    const before = result.current
    act(() => {
      expect(before.enter()).toBe(true)
    })

    rerender()

    expect(result.current).toBe(before)
    expect(result.current.enter()).toBe(false)
  })
})

describe('isImeEnter and blockImeEnter', () => {
  function Probe({ onResult }: { onResult: (value: boolean) => void }) {
    return (
      <form onKeyDown={(event) => onResult(blockImeEnter(event))}>
        <input aria-label="欄位" />
        <textarea aria-label="多行" />
      </form>
    )
  }

  it('treats isComposing and keyCode 229 as IME Enter', () => {
    const make = (init: object) => ({
      key: 'Enter',
      keyCode: 13,
      nativeEvent: { isComposing: false },
      ...init,
    })
    expect(isImeEnter(make({ nativeEvent: { isComposing: true } }))).toBe(true)
    expect(isImeEnter(make({ keyCode: 229 }))).toBe(true)
    expect(isImeEnter(make({}))).toBe(false)
    expect(isImeEnter(make({ key: 'a', keyCode: 229 }))).toBe(false)
  })

  it('cancels the default action of an IME Enter in an input', () => {
    const results: boolean[] = []
    const { getByLabelText } = render(
      <Probe onResult={(v) => results.push(v)} />,
    )
    const input = getByLabelText('欄位')

    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(
      false,
    )
    expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })).toBe(
      false,
    )
    expect(results).toEqual([true, true])
  })

  it('leaves a normal Enter and other keys alone', () => {
    const { getByLabelText } = render(<Probe onResult={() => undefined} />)
    const input = getByLabelText('欄位')

    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true)
    expect(fireEvent.keyDown(input, { key: 'a', keyCode: 229 })).toBe(true)
  })

  it('does not cancel Enter in a textarea (it only inserts a line break)', () => {
    const results: boolean[] = []
    const { getByLabelText } = render(
      <Probe onResult={(v) => results.push(v)} />,
    )

    expect(
      fireEvent.keyDown(getByLabelText('多行'), {
        key: 'Enter',
        isComposing: true,
      }),
    ).toBe(true)
    expect(results).toEqual([true])
  })
})
