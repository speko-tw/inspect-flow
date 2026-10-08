// 表單送出防護（#507）。
//
// 兩個問題都出在「Enter」：
//   1. 用 `requestSubmit()` 或表單的隱含送出（implicit submission）時，
//      停用的按鈕擋不住第二次送出，快速連按兩次 Enter 會送出兩次。
//      `useSubmitGuard` 用 ref 同步擋掉進行中的第二次送出，完成（成功、
//      失敗或丟出例外）後一定解除。
//   2. 用注音等輸入法選字時按的 Enter 只是確認選字，不是送出。標準瀏覽器
//      的 `isComposing` 為 true；Safari 這一下 `isComposing` 是 false，
//      但 `keyCode` 是 229。`isImeEnter` 兩種都認。

import { useMemo, useRef, type KeyboardEvent } from 'react'

export type SubmitGuard = {
  /**
   * 嘗試開始一次送出；已有送出進行中時回傳 false，呼叫端不得繼續。
   * 回傳 true 的呼叫端必須在結束時呼叫 `leave()`。
   */
  enter: () => boolean
  /** 結束一次送出，解除防護。 */
  leave: () => void
  /**
   * 在防護下執行 `task`：進行中的第二次呼叫直接回傳 `undefined` 而不執行；
   * `task` 結束（成功或失敗）後一定解除，錯誤原樣丟出。
   */
  run: <T>(task: () => T | Promise<T>) => Promise<T | undefined>
}

export function useSubmitGuard(): SubmitGuard {
  const inFlight = useRef(false)
  return useMemo<SubmitGuard>(() => {
    const enter = () => {
      if (inFlight.current) return false
      inFlight.current = true
      return true
    }
    const leave = () => {
      inFlight.current = false
    }
    const run = <T>(task: () => T | Promise<T>): Promise<T | undefined> => {
      if (!enter()) return Promise.resolve(undefined)
      let result: T | Promise<T>
      try {
        result = task()
      } catch (error) {
        leave()
        return Promise.reject(error)
      }
      if (!(result instanceof Promise)) {
        // 同步的工作做完就解除，不必等下一個 microtask。
        leave()
        return Promise.resolve(result)
      }
      return result.finally(leave)
    }
    return { enter, leave, run }
  }, [])
}

type KeyLike = {
  key: string
  keyCode: number
  nativeEvent: { isComposing?: boolean }
}

/** 輸入法選字中的 Enter（只是確認選字，不是送出）。 */
export function isImeEnter(event: KeyLike): boolean {
  return (
    event.key === 'Enter' &&
    (event.nativeEvent.isComposing || event.keyCode === 229)
  )
}

/**
 * 輸入法選字中的 Enter：回傳 true，並取消預設動作，避免瀏覽器的隱含送出。
 * 多行文字框的 Enter 本來就只是換行，不攔。
 * 掛在 `<form onKeyDown>` 或欄位的 `onKeyDown`；回傳 true 時呼叫端應直接返回。
 */
export function blockImeEnter(event: KeyboardEvent): boolean {
  if (!isImeEnter(event)) return false
  if (!(event.target instanceof HTMLTextAreaElement)) event.preventDefault()
  return true
}
