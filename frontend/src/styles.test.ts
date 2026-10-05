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
    '.topbar button,',
    '.tpl-tree-row,',
  ])('raises %s to the touch target on narrow screens', (selector) => {
    expect(selectors).toContain(selector)
  })

  it('makes checkbox and radio labels the click area', () => {
    expect(labelRule).toContain("label:has(> input[type='checkbox'])")
    expect(labelRule).toContain("label:has(> input[type='radio'])")
  })
})
