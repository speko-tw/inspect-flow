/// <reference types="node" />
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const css = readFileSync('src/styles.css', 'utf8')
const tokens = readFileSync('src/styles/tokens.css', 'utf8')
const dashboardCss = readFileSync(
  'src/admin/dashboard/DashboardPage.css',
  'utf8',
)

const shellCss = readFileSync('src/styles/g7-shell.css', 'utf8')
const pageTabsCss = readFileSync('src/components/PageTabs.module.css', 'utf8')

// 取出頂層規則（行首的選擇器）的宣告，轉成 屬性 -> 值；比對值而不是原始
// 字串，格式或宣告順序調整時測試不會誤報。
function declarationsOf(selector: string, source = css) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(source)
  expect(match, `找不到規則 ${selector}`).not.toBeNull()
  return Object.fromEntries(
    (match?.[1] ?? '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
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
    // 先去掉註解：註解裡的冒號與分號會讓宣告名稱錯位。
    (match?.[1] ?? '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
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

  it('gives account name links a 44px target on narrow screens', () => {
    const mobile = section.slice(section.indexOf('@media (max-width: 40rem)'))
    const rule = /\.users-account-name-link \{[^}]*\}/.exec(mobile)
    expect(declarationsIn(rule?.[0] ?? '')).toMatchObject({
      display: 'inline-flex',
      'align-items': 'center',
      'min-height': 'var(--touch-target)',
    })
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

// 主要按鈕的層級（#534 裁定、UDS-R04）：只靠顏色「不太明顯」，所以尺寸、
// 字重、留白都要比次要按鈕大。jsdom 不排版，這裡驗證宣告值；實際像素
// 由真瀏覽器矩陣量測。
describe('button hierarchy geometry', () => {
  const buttons = css.slice(
    css.indexOf('/* ---- 按鈕：button 與 .btn'),
    css.indexOf('/* ---- 表格 ---- */'),
  )
  const rule = (selector: string) => {
    const start = buttons.indexOf(`\n${selector} {`)
    expect(start, `找不到 ${selector}`).toBeGreaterThan(0)
    return declarationsIn(buttons.slice(start, buttons.indexOf('}', start)))
  }

  it('makes the primary taller, wider and bolder than secondary', () => {
    expect(css).toContain('--control-primary-height: 3rem;')
    expect(css).toContain('--control-primary-min-width: 8rem;')
    expect(css).toContain('--touch-target: 2.75rem;')
    const primary = rule('.btn-primary')
    const secondary = declarationsIn(
      buttons.match(/\nbutton,\n\.btn \{[^}]*\}/)?.[0] ?? '',
    )
    expect(primary['min-height']).toBe('var(--control-primary-height)')
    expect(primary['min-width']).toContain('var(--control-primary-min-width)')
    expect(primary.padding).toBe('var(--space-2) var(--space-6)')
    expect(secondary['min-height']).toBe('var(--touch-target)')
    expect(Number(primary['font-weight'])).toBeGreaterThanOrEqual(700)
    expect(Number(secondary['font-weight'])).toBeLessThanOrEqual(500)
  })

  it('keeps the primary height on narrow screens', () => {
    const narrow = css.slice(css.indexOf('觸控目標：窄螢幕一律'))
    const start = narrow.indexOf('.btn-primary {')
    expect(start).toBeGreaterThan(0)
    // 必須排在 .btn 的 min-height 之後，同特異性才不會被壓回 44px。
    expect(start).toBeGreaterThan(narrow.indexOf('.btn,'))
    expect(
      declarationsIn(narrow.slice(start, narrow.indexOf('}', start)))[
        'min-height'
      ],
    ).toBe('var(--control-primary-height)')
  })

  it('has no card-level override that flattens the primary button', () => {
    expect(css).not.toContain('.project-workspace-card .btn')
    expect(css).not.toContain('.page-load-error .btn-primary')
  })

  it('gives card and danger triggers outline-only variants', () => {
    expect(rule('.btn-emphasis')).toMatchObject({
      'border-color': 'var(--primary)',
      color: 'var(--primary)',
    })
    expect(rule('.btn-danger-outline')).toMatchObject({
      'border-color': 'var(--danger)',
      color: 'var(--error-text)',
    })
    expect(rule('.btn-danger-outline').background).toBeUndefined()
  })
})

describe('page-level rules that must not flatten the primary button', () => {
  const read = (file: string) => readFileSync(file, 'utf8')

  it('keeps 44px page rules off the 48px primary button', () => {
    expect(read('src/styles/g7-shell.css')).toContain(
      '.roles-page-tools > button:not(.btn-primary)',
    )
    expect(read('src/admin/projects/ProjectMembers.css')).toContain(
      '.member-add-form button:not(.btn-primary)',
    )
  })

  it('leaves horizontal padding to the outer main on all admin pages', () => {
    // 外層 main 已提供左右內縮；頁面再加會讓左緣與 h1 起點各頁不一致。
    expect(declarationsOf('.dashboard-page', dashboardCss).padding).toMatch(
      /^0 0 /,
    )
    expect(
      declarationsOf(
        '.dashboard-task-page',
        read('src/admin/dashboard/DashboardTaskPage.css'),
      ).padding,
    ).toMatch(/^0 0 /)
    const field = read('src/field/field-redesign.css')
    expect(
      declarationsOf('.field-shell.field-redesign', field).padding,
    ).toMatch(/^0 0 /)
    expect(
      declarationsOf('.field-redesign .field-heading', field)['font-size'],
    ).toBe('var(--font-size-heading)')
  })
})

describe('second design review layout rules', () => {
  const read = (file: string) => readFileSync(file, 'utf8')

  it('centres rows that mix 44px and 48px buttons', () => {
    expect(
      declarationsOf('.roles-page-tools', read('src/styles/g7-shell.css'))[
        'align-items'
      ],
    ).toBe('center')
    expect(declarationsOf('.card-actions')['align-items']).toBe('center')
    expect(declarationsOf('.named-row-actions')['align-items']).toBe('center')
    expect(
      declarationsOf(
        '.member-actions',
        read('src/admin/projects/ProjectMembers.css'),
      )['align-items'],
    ).toBe('center')
    expect(
      declarationsOf(
        '.wizard-actions',
        read('src/admin/module-permissions/ModulePermissionsPage.css'),
      )['align-items'],
    ).toBe('center')
  })

  it('aligns narrow page content with the header at 16px', () => {
    const narrow = css.slice(css.indexOf('/* ---- 窄螢幕 ---- */'))
    const rule = narrow.slice(
      narrow.indexOf('  main {'),
      narrow.indexOf('}', narrow.indexOf('  main {')),
    )
    expect(declarationsIn(rule).padding).toBe('var(--space-4)')
  })

  it('keeps the project code and name as separate inline blocks', () => {
    expect(declarationsOf('.project-title-code')).toMatchObject({
      display: 'inline-block',
      'white-space': 'nowrap',
    })
    expect(declarationsOf('.project-title-name').display).toBe('inline-block')
  })

  it('lets the self-batch hint span the whole account card', () => {
    expect(css).toContain(
      '.users-table-scroll .users-account-table tbody td > .field-hint {',
    )
    expect(css).toMatch(/td > \.field-hint \{\s+grid-column: 1 \/ -1;/)
  })
})

describe('shared component button geometry', () => {
  const components = readFileSync(
    'src/components/components.module.css',
    'utf8',
  )
  const rule = (selector: string) => {
    const source = `\n${components}`
    const start = source.indexOf(`\n${selector} {`)
    expect(start, `找不到 ${selector}`).toBeGreaterThanOrEqual(0)
    return declarationsIn(source.slice(start))
  }

  it('matches the global primary button size', () => {
    const primary = rule('.primary')
    expect(primary['min-height']).toBe('3rem')
    expect(primary['min-width']).toContain('8rem')
    expect(primary.padding).toContain('var(--space-6)')
    expect(Number(primary['font-weight'])).toBeGreaterThan(
      Number(rule('.button')['font-weight']),
    )
  })
})

describe('named plan and template choices', () => {
  it('uses the control-border token for both clickable lists', () => {
    expect(declarationsOf('.tpl-detail-list button').border).toBe(
      '1px solid var(--border-strong)',
    )
    expect(declarationsOf('.plan-list button')['border-color']).toBe(
      'var(--border-strong)',
    )
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

describe('Shared brand header interaction tokens', () => {
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

  it('styles only the personal menu trigger, never its items (#713)', () => {
    // 選單項目畫在淺色面板上，若吃到白字會變成白底白字。
    expect(shellCss).not.toMatch(/\.app-header-account button/)
    expect(shellCss).toContain('.app-header .app-header-personal-trigger {')
    expect(shellCss).not.toMatch(/app-header-personal-menu/)
  })

  it('loads branding from AppHeader without an overview ancestor', () => {
    const header = readFileSync('src/layout/AppHeader.tsx', 'utf8')
    expect(header).toContain("import '../styles/g7-shell.css'")
    expect(declarationsOf('header.app-header', shellCss).background).toBe(
      'var(--color-brand-primary)',
    )
    expect(shellCss).not.toContain('dashboard-shell')
    expect(dashboardCss).not.toContain('.app-header')
  })

  it('keeps both AdminPage shells independent of overview routing', () => {
    const admin = readFileSync('src/admin/AdminPage.tsx', 'utf8')
    expect(admin).not.toContain('dashboard-shell')
    expect(admin.match(/<div className="app-shell">/g)).toHaveLength(2)
  })

  it('keeps brand hover, focus and locked text readable (#737)', () => {
    expect(css).toContain(
      'a.topbar-brand:hover {\n    color: var(--color-text-inverse);',
    )
    expect(shellCss).toContain('outline: 3px solid var(--color-brand-accent);')
    const locked = declarationsOf(
      '.app-header .app-header-locked-note',
      shellCss,
    )
    expect(locked.color).toBe('var(--color-text-inverse)')
  })

  it('preserves muted locked tabs with AA contrast (UDS-R11)', () => {
    const locked = declarationsOf(
      '.app-header .app-header-nav-locked .app-header-tab',
      shellCss,
    )
    expect(locked.color.replace(/\s/g, '')).toBe(
      'color-mix(insrgb,var(--color-text-inverse)70%,' +
        'var(--color-brand-primary))',
    )
    expect(locked.color).not.toBe('var(--color-text-inverse)')
    expect(locked.opacity).toBe('1')
    // 由實際 token 算 sRGB 混色，再依 WCAG 相對亮度驗算。
    const tokenColor = (name: string) => {
      const value = tokens.match(new RegExp(`${name}: (#\\w{6});`))?.[1]
      expect(value).toBeDefined()
      return [1, 3, 5].map((offset) =>
        Number.parseInt(value!.slice(offset, offset + 2), 16),
      )
    }
    const brand = tokenColor('--color-brand-primary')
    const inverse = tokenColor('--color-text-inverse')
    const muted = inverse.map((v, i) => v * 0.7 + brand[i] * 0.3)
    const linear = (value: number) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    const luminance = (color: number[]) =>
      color
        .map((v) => linear(v / 255))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
    const contrast = (luminance(muted) + 0.05) / (luminance(brand) + 0.05)
    expect(contrast).toBeGreaterThanOrEqual(4.5)
    expect(muted).not.toEqual(inverse)
  })

  it('keeps hover borders and feedback scoped to interactive controls', () => {
    expect(shellCss).toContain(
      '.app-header .app-header-personal-trigger:hover {\n' +
        '    border-color: var(--color-brand-accent);',
    )
    const management =
      'button.app-header-management-trigger' +
      ":not([aria-current='page']):hover"
    expect(shellCss).toContain(
      `${management} {\n    border-bottom-color: transparent;`,
    )
    expect(shellCss).toContain('.app-header a.app-header-tab:hover,')
    expect(shellCss).toContain('.app-header a.app-header-tab:active,')
    expect(shellCss).not.toMatch(
      /\.app-header \.app-header-tab:(hover|active)/,
    )
    const currentLinkSelector = String.raw`\.app-header a\.app-header-tab`
    const currentStateSelectors = [
      String.raw`${currentLinkSelector}\[aria-current='page'\]:hover,`,
      String.raw`${currentLinkSelector}\[aria-current='page'\]:active,`,
      String.raw`\.app-header \.app-header-management-trigger` +
        String.raw`\[aria-current='page'\]:hover,`,
      String.raw`\.app-header \.app-header-management-trigger` +
        String.raw`\[aria-current='page'\]:active`,
    ].join(String.raw`\s*`)
    const currentStateDeclarations =
      String.raw`\s*\{\s*background: var\(--color-header-nav-current\);` +
      String.raw`\s*color: var\(--color-brand-accent\);`
    expect(shellCss).toMatch(
      new RegExp(currentStateSelectors + currentStateDeclarations),
    )
  })

  it('uses tokens for hover, pressed and current header states', () => {
    expect(shellCss).toContain('background: var(--color-header-nav-hover);')
    expect(shellCss).toContain('background: var(--color-header-nav-pressed);')
    expect(shellCss).toContain('background: var(--color-header-nav-current);')
  })

  it('sets the focus offset only in the shared shell', () => {
    expect(shellCss).toContain(
      '.app-header .app-header-tab:focus-visible {\n' +
        '  outline-offset: -3px;',
    )
    expect(css).not.toContain('.app-header-tab:focus-visible {')
  })
})

// 觸控裝置點一下後 :hover 會殘留（iOS Safari，#524），所以所有
// :hover 規則都必須包在 @media (hover: hover) 裡，只給有滑鼠的裝置。
describe('confirmation overlay boundary', () => {
  it('confines viewport positioning to the explicit modal class', () => {
    const modalRule = /(?:^|\n)\s*\.confirm-box-modal\s*\{([^}]*)\}/.exec(css)
    expect(modalRule).not.toBeNull()
    const modal = declarationsIn(modalRule?.[0] ?? '')
    expect(modal.position).toBe('fixed')
    expect(Number(modal['z-index'])).toBeGreaterThanOrEqual(1000)
    expect(modal.background).toBe('var(--surface)')
    expect(modal['box-shadow']).toContain('100vmax')
    const fixedRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /position:\s*fixed/.test(body ?? ''))
      .map(([, selector]) =>
        selector
          ?.replace(/\/\*[\s\S]*?\*\//g, '')
          .split('\n')
          .at(-1)
          ?.trim(),
      )
    expect(fixedRules).toContain('.confirm-box-modal')
    expect(
      fixedRules.filter((selector) => selector !== '.confirm-box-modal'),
    ).toEqual(['.app-header-management-menu'])
  })
})

describe('hover rules', () => {
  it('keeps every :hover and :active selector in hover-capable media', () => {
    const lines = `${css}\n${shellCss}\n${pageTabsCss}`.split('\n')
    let depth = 0
    let hoverDepth: number | null = null
    const outside: string[] = []
    lines.forEach((line, index) => {
      const content = line.trim()
      if (content.startsWith('@media (hover: hover)')) {
        hoverDepth = depth + 1
      } else if (hoverDepth !== null && depth < hoverDepth) {
        hoverDepth = null
      }
      if (
        /:(?:hover|active)(?:\b|\s|,|\{)/.test(content) &&
        !content.startsWith('/*') &&
        hoverDepth === null
      ) {
        outside.push(`${index + 1}: ${content}`)
      }
      depth += (line.match(/\{/g) ?? []).length
      depth -= (line.match(/\}/g) ?? []).length
      if (hoverDepth !== null && depth < hoverDepth) hoverDepth = null
    })
    expect(outside).toEqual([])
  })

  it('has at least one :hover rule inside the media query', () => {
    expect(css).toMatch(/@media \(hover: hover\) \{\n\s+a\.topbar-brand:hover/)
  })
})

describe('PageTabs focus and contrast modes', () => {
  it('keeps the tab list divider to one pixel, not a gold band', () => {
    const tabs = declarationsIn(
      /\.tabs\s*\{[^}]*\}/.exec(pageTabsCss)?.[0] ?? '',
    )
    expect(tabs['border-bottom']).toMatch(/^1px solid/)
    expect(pageTabsCss).not.toContain('brand-accent')
  })

  it('draws a real border for the selected tab in forced colors', () => {
    const start = pageTabsCss.indexOf('@media (forced-colors: active)')
    expect(start).toBeGreaterThanOrEqual(0)
    const block = pageTabsCss.slice(start, pageTabsCss.indexOf('\n}\n', start))
    expect(block).toContain("[aria-selected='true']")
    expect(block).toContain('border-bottom: 3px solid Highlight')
  })

  it('does not let the dashboard focus ring override the tab ring', () => {
    expect(dashboardCss).toContain(
      ".dashboard-page button:not([role='tab']):focus-visible",
    )
    expect(dashboardCss).not.toMatch(/\.dashboard-page button:focus-visible/)
    expect(
      declarationsIn(
        /\.tab:focus-visible\s*\{[^}]*\}/.exec(pageTabsCss)?.[0] ?? '',
      )['outline-offset'],
    ).toBe('-3px')
  })
})

describe('PageTabs selected state', () => {
  it('marks selected tabs with a three-pixel token-colored line', () => {
    const selectedRule = /\.tab\[aria-selected='true'\]\s*\{([^}]*)\}/.exec(
      pageTabsCss,
    )
    expect(selectedRule).not.toBeNull()
    expect(declarationsIn(selectedRule?.[0] ?? '')['box-shadow']).toBe(
      'inset 0 -3px 0 var(--color-selection)',
    )

    const ordinaryRule = /\.tab\s*\{([^}]*)\}/.exec(pageTabsCss)
    expect(ordinaryRule).not.toBeNull()
    expect(
      declarationsIn(ordinaryRule?.[0] ?? '')['box-shadow'],
    ).toBeUndefined()
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
