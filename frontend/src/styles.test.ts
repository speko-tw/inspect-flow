/// <reference types="node" />
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const css = readFileSync('src/styles.css', 'utf8')

// jsdom 不套用版面，所以只守住規則本身：token 存在，且窄螢幕那一段
// 列出所有要 >= 44px 的元件。實際尺寸以真瀏覽器 360px 量測為準。
describe('touch target rules', () => {
  const section = css.slice(css.indexOf('觸控目標：窄螢幕'))
  const declaration = section.indexOf('min-height: var(--touch-target)')
  const selectors = section.slice(section.indexOf('{') + 1, declaration)
  const labelRule = section.slice(declaration)

  it('defines --touch-target as 2.75rem (44px)', () => {
    expect(css).toMatch(/--touch-target:\s*2\.75rem;/)
  })

  it('applies the token inside the 40rem media query', () => {
    expect(section).toContain('@media (max-width: 40rem)')
    expect(declaration).toBeGreaterThan(0)
  })

  it.each([
    'button,',
    'select,',
    '.button-link,',
    'td button,',
    '.app-header-account button,',
    '.tpl-tree-row,',
  ])('raises %s to the touch target on narrow screens', (selector) => {
    expect(selectors).toContain(selector)
  })

  it('makes checkbox and radio labels the click area', () => {
    expect(labelRule).toContain("label:has(> input[type='checkbox'])")
    expect(labelRule).toContain("label:has(> input[type='radio'])")
  })
})

// 提示框（#494）：role 只給預設，不再把所有 status 畫成成功；
// 種類由 .notice-* 決定。
describe('notice rules', () => {
  const statusRule = css.slice(
    css.indexOf(":where([role='status']) {"),
    css.indexOf(":where([role='status']) h2"),
  )

  it('draws role=status neutral, not as a success box', () => {
    expect(statusRule).toContain('var(--surface-alt)')
    expect(statusRule).not.toContain('--success')
  })

  it.each(['success', 'info', 'warning', 'error'])(
    'defines .notice-%s with its own colours',
    (kind) => {
      const start = css.indexOf(`\n.notice-${kind} {\n  border-color`)
      expect(start).toBeGreaterThan(0)
      const rule = css.slice(start, css.indexOf('}', start))
      expect(rule).toContain(`var(--${kind}-bg)`)
      expect(rule).toContain(`var(--${kind}-text)`)
      expect(rule).toContain(`var(--${kind}-border)`)
    },
  )
})
