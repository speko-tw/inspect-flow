/** UDS-R18：一般區塊就近捲入視窗；modal 可由呼叫端關閉捲動。 */
export type Reveal = 'nearest' | 'start' | false

/** 先決定可閱讀的捲動位置，焦點由呼叫端以 preventScroll 管理。 */
export function revealElement(
  element: HTMLElement | null,
  reveal: Reveal = 'nearest',
) {
  if (!element || reveal === false) return
  const block =
    element.getBoundingClientRect().height > window.innerHeight * 0.8
      ? 'start'
      : reveal
  element.scrollIntoView?.({ block })
}
