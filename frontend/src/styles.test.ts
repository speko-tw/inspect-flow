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
    '.btn,',
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

// 按鈕（#500）：button 與 .btn 共用基底；主要按鈕要明講，submit 不再
// 自動變主要；危險色只給 .btn-danger。
describe('button rules', () => {
  const buttons = css.slice(
    css.indexOf('/* ---- 按鈕：button 與 .btn'),
    css.indexOf('/* ---- 表格 ---- */'),
  )

  it('shares one base between button and .btn', () => {
    expect(buttons).toMatch(/\nbutton,\n\.btn \{/)
    expect(buttons).toContain('text-decoration: none')
  })

  it('does not turn type=submit buttons into primary buttons', () => {
    expect(css).not.toContain("button[type='submit']")
    expect(css).not.toContain('button[type="submit"]')
  })

  it.each([
    ['.btn-primary', '--primary'],
    ['.btn-danger', '--danger'],
  ])('colours %s with its own token', (selector, token) => {
    const start = buttons.indexOf(`\n${selector} {`)
    expect(start).toBeGreaterThan(0)
    const rule = buttons.slice(start, buttons.indexOf('}', start))
    expect(rule).toContain(`var(${token})`)
  })

  it('defines the small size and the back link', () => {
    expect(buttons).toContain('\n.btn-sm {')
    expect(buttons).toContain('\n.back-link {')
  })

  it('no longer defines the old link-button classes', () => {
    expect(css).not.toContain('.button-link')
    expect(css).not.toContain('.standalone-link')
    expect(css).not.toContain('.tpl-return-project')
    expect(css).not.toContain('.field-back')
  })
})

// 目前選取（#500）：側欄、計畫清單、範本樹共用同一種 selected 樣式，
// 由 aria-current 驅動，值是 "false" 不算選取。
describe('selected rules', () => {
  const start = css.indexOf(':is(\n    .project-section-nav a')
  const rule = css.slice(start, css.indexOf('}', start))

  it('uses one rule for sidebar, plan list and template tree', () => {
    expect(start).toBeGreaterThan(0)
    expect(rule).toContain('.project-section-nav a')
    expect(rule).toContain('.plan-list button')
    expect(rule).toContain('.tpl-tree-row')
    expect(rule).toContain("[aria-current='false']")
    expect(rule).toContain('border-left-color: var(--primary)')
    expect(rule).toContain('font-weight: 700')
  })

  it('has no second selected style left on the tree or the sidebar', () => {
    expect(css).not.toContain(".tpl-tree-row[aria-current='true']")
    expect(css).not.toContain(".project-section-nav a[aria-current='page']")
  })
})

// 頁首導覽（#500）：單列、放不下時列內橫向滑動，不讓頁面橫向捲動。
describe('app header navigation', () => {
  const start = css.indexOf('\n.app-header-nav {')
  const rule = css.slice(start, css.indexOf('}', start))

  it('keeps the tabs on one scrollable row', () => {
    expect(rule).toContain('flex-wrap: nowrap')
    expect(rule).toContain('overflow-x: auto')
  })
})
