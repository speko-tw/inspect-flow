/// <reference types="node" />
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const css = readFileSync('src/styles.css', 'utf8')
const tokens = readFileSync('src/styles/tokens.css', 'utf8')
const dashboardCss = readFileSync(
  'src/admin/dashboard/DashboardPage.css',
  'utf8',
)

// 取出頂層規則（行首的選擇器）的宣告，轉成 屬性 -> 值；比對值而不是原始
// 字串，格式或宣告順序調整時測試不會誤報。
function declarationsOf(selector: string, source = css) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(source)
  expect(match, `找不到規則 ${selector}`).not.toBeNull()
  return Object.fromEntries(
    (match?.[1] ?? '')
      .split(';')
      .map((line) => line.split(/:(.*)/s))
      .filter(([name, value]) => name.trim() && value)
      .map(([name, value]) => [name.trim(), value.trim()]),
  )
}

function declarationsIn(rule: string) {
  const match = /\{([^}]*)/.exec(rule)
  expect(match, '找不到 CSS 宣告區塊').not.toBeNull()
  return Object.fromEntries(
    (match?.[1] ?? '')
      .split(';')
      .map((line) => line.split(/:(.*)/s))
      .filter(([name, value]) => name.trim() && value)
      .map(([name, value]) => [name.trim(), value.trim()]),
  )
}

describe('required field markers', () => {
  it('keeps a direct required mark beside its label text', () => {
    expect(
      declarationsOf(
        'label:has(> .required-mark):not(:has(input, select, textarea))',
      ).display,
    ).toBe('block')
    expect(declarationsOf('.required-label').display).toBe('inline-flex')
  })
})

describe('setup page line breaks (#317, UDS-R13)', () => {
  const narrowRules = css.slice(css.indexOf('@media (max-width: 40rem)'))

  it('keeps step labels intact with a safe overflow break', () => {
    expect(declarationsOf('.steps-label')).toMatchObject({
      'word-break': 'keep-all',
      'overflow-wrap': 'anywhere',
    })
  })

  it('keeps setup descriptions intact with a safe overflow break', () => {
    expect(declarationsOf('.auth-card:has(> .steps) .lead')).toMatchObject({
      'word-break': 'keep-all',
      'overflow-wrap': 'anywhere',
    })
  })

  it('stacks steps and labels vertically on narrow screens', () => {
    expect(narrowRules).toMatch(/\.steps \{[^}]*flex-direction: column;/)
    expect(narrowRules).toMatch(/\.steps li \{[^}]*flex-direction: row;/)
  })
})

describe('trial feedback card actions', () => {
  it('keeps card actions content-sized and allows wrapping', () => {
    expect(declarationsOf('.card-actions')).toMatchObject({
      display: 'flex',
      'flex-wrap': 'wrap',
      gap: 'var(--space-2)',
    })
    expect(css).toContain('.card-actions > button,')
    expect(css).toContain('flex: 0 0 auto;')
    expect(css).toContain('min-height: 44px;')
    expect(declarationsOf('.card-action').width).toBe('fit-content')
  })

  it('keeps progress cards readable with compact status badges', () => {
    expect(declarationsOf('.progress-card').color).toBe('var(--text)')
    expect(declarationsOf('.progress-card')['text-decoration']).toBe('none')
    expect(declarationsOf('.progress-card > .badge')['justify-self']).toBe(
      'start',
    )
  })
})

// #517 的管理頁與專案頁都在共用 main 內，表單和分區列沿用共用間距。
describe('page and zone spacing', () => {
  it('keeps the same main inset for admin and project sections', () => {
    expect(declarationsOf('main').padding).toBe(
      'var(--space-5) var(--space-4)',
    )
  })

  it('separates the zone label from its action and row buttons', () => {
    expect(declarationsOf('form').gap).toBe('var(--space-4) var(--space-3)')
    expect(declarationsOf('.named-row-actions').gap).toBe('var(--space-2)')
  })
})

// Field 桌機內容沿用全站最大寬度，手機繼續使用原本窄欄。
describe('field content alignment', () => {
  it('keeps the narrow column by default', () => {
    expect(declarationsOf('.field-shell').width).toBe('min(100%, 440px)')
  })

  it('expands only on desktop to align with the shared header', () => {
    const media = /@media \(min-width: 64rem\) \{([\s\S]*?\n\})/.exec(
      css.slice(css.indexOf('.field-shell {')),
    )
    expect(media).not.toBeNull()
    expect(declarationsOf('  .field-shell', media?.[1] ?? '').width).toBe(
      'min(100%, var(--content-width))',
    )
  })
})

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
    'summary',
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
    expect(declarationsIn(statusRule).background).toBe('var(--surface-alt)')
  })

  it.each(['success', 'info', 'warning', 'error'])(
    'defines .notice-%s with its own colours',
    (kind) => {
      const start = css.indexOf(`\n.notice-${kind} {\n  border-color`)
      expect(start).toBeGreaterThan(0)
      const declarations = declarationsIn(
        css.slice(start, css.indexOf('}', start)),
      )
      expect(declarations.background).toBe(`var(--${kind}-bg)`)
      expect(declarations.color).toBe(`var(--${kind}-text)`)
      expect(declarations['border-color']).toBe(`var(--${kind}-border)`)
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
    expect(
      declarationsIn(buttons.match(/\nbutton,\n\.btn \{[^}]*\}/)?.[0] ?? '')[
        'text-decoration'
      ],
    ).toBe('none')
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
    expect(
      Object.values(declarationsIn(rule)).some(
        (value) => value === `var(${token})`,
      ),
    ).toBe(true)
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
    const declarations = declarationsIn(rule)
    expect(declarations['border-left-color']).toBe('var(--primary)')
    expect(declarations['font-weight']).toBe('700')
  })

  it('has no second selected style left on the tree or the sidebar', () => {
    expect(css).not.toContain(".tpl-tree-row[aria-current='true']")
    expect(css).not.toContain(".project-section-nav a[aria-current='page']")
  })
})

// 頁首導覽（#500）：單列、放不下時列內橫向滑動，不讓頁面橫向捲動。
describe('app header navigation', () => {
  it('keeps the tabs on one scrollable row', () => {
    const declarations = declarationsOf('.app-header-nav')
    expect(declarations['flex-wrap']).toBe('nowrap')
    expect(declarations['overflow-x']).toBe('auto')
  })

  it('fades the edge that still has hidden tabs, only when scrollable', () => {
    expect(css).toContain('.app-header [data-more-end] {')
    expect(css).toContain('.app-header [data-more-start] {')
    expect(css).toContain('.app-header [data-more-start][data-more-end] {')
    const start = css.indexOf('.app-header [data-more-end] {')
    expect(
      Object.keys(declarationsIn(css.slice(start, css.indexOf('}', start)))),
    ).toContain('mask-image')
  })
})

describe('Dashboard header interaction tokens', () => {
  it('shares the approved neutral values across light and dark themes', () => {
    const root = tokens.slice(0, tokens.indexOf("\n:root[data-theme='dark']"))
    expect(root).toContain(
      '--color-header-nav-hover: rgba(255, 255, 255, 0.11);',
    )
    expect(root).toContain(
      '--color-header-nav-pressed: rgba(255, 255, 255, 0.19);',
    )
    expect(root).toContain(
      '--color-header-nav-current: rgba(255, 255, 255, 0.15);',
    )
    expect(
      tokens.slice(tokens.indexOf("\n:root[data-theme='dark']")),
    ).not.toMatch(/--color-header-nav-(?:hover|pressed|current):/)
  })

  it('uses tokens for hover, pressed and current header states', () => {
    expect(dashboardCss).toContain(
      'background: var(--color-header-nav-hover);',
    )
    expect(dashboardCss).toContain(
      'background: var(--color-header-nav-pressed);',
    )
    expect(dashboardCss).toContain(
      'background: var(--color-header-nav-current);',
    )
  })
})

// 觸控裝置點一下後 :hover 會殘留（iOS Safari，#524），所以所有
// :hover 規則都必須包在 @media (hover: hover) 裡，只給有滑鼠的裝置。
describe('hover rules', () => {
  it('keeps every :hover rule inside @media (hover: hover)', () => {
    const lines = css.split('\n')
    let inHoverMedia = false
    const outside: string[] = []
    lines.forEach((line, index) => {
      if (line.startsWith('@media (hover: hover) {')) inHoverMedia = true
      else if (inHoverMedia && line === '}') inHoverMedia = false
      else if (
        !inHoverMedia &&
        line.includes(':hover') &&
        !line.trimStart().startsWith('*') &&
        !line.trimStart().startsWith('/*')
      ) {
        outside.push(`${index + 1}: ${line.trim()}`)
      }
    })
    expect(outside).toEqual([])
  })

  it('has at least one :hover rule inside the media query', () => {
    expect(css).toMatch(/@media \(hover: hover\) \{\n\s+a\.topbar-brand:hover/)
  })
})

// 名稱列與角色表（#526）：名稱是主角，動作靠右；角色名稱欄不折行。
describe('named row rules', () => {
  const block = (selector: string) => {
    const start = css.indexOf(`\n${selector} {\n`)
    expect(start).toBeGreaterThan(0)
    return css.slice(start, css.indexOf('}', start))
  }

  it('makes the name bold and larger than the small row buttons', () => {
    const rule = block('.named-row-name')
    const declarations = declarationsIn(rule)
    expect(declarations['font-weight']).toBe('700')
    expect(declarations['font-size']).toMatch(/1\.\d+rem/)
  })

  it('separates rows with a line and pushes actions to the right', () => {
    const declarations = declarationsOf('.named-row')
    expect(declarations['border-bottom']).toMatch(/^1px solid/)
    expect(declarations['justify-content']).toBe('space-between')
  })

  it('keeps role names on one line while permissions wrap', () => {
    expect(declarationsOf('.roles-table tbody th')['white-space']).toBe(
      'nowrap',
    )
  })
})
