import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const tokensCss = readFileSync('src/styles/tokens.css', 'utf8')
const stylesCss = readFileSync('src/styles.css', 'utf8')

function variablesIn(rule: string) {
  return Object.fromEntries(
    [...rule.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [
      key,
      value.trim(),
    ]),
  )
}

function declarationsIn(rule: string) {
  return Object.fromEntries(
    rule
      .split(';')
      .map((declaration) => {
        const separator = declaration.indexOf(':')
        return [
          declaration.slice(0, separator).trim(),
          declaration.slice(separator + 1).trim(),
        ]
      })
      .filter(([name]) => name),
  )
}

function matchedVariables(pattern: RegExp) {
  const match = pattern.exec(tokensCss)
  expect(match, '找不到指定的主題 token 區塊').not.toBeNull()
  return variablesIn(match?.[1] ?? '')
}

function contrastRatio(foreground: string, background: string) {
  function luminance(color: string) {
    const channels = color.match(/[\da-f]{2}/gi)
    expect(channels, `無效的色值 ${color}`).toHaveLength(3)
    const [red, green, blue] = channels!.map((channel) => {
      const value = Number.parseInt(channel, 16) / 255
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4
    })

    return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!
  }

  const values = [luminance(foreground), luminance(background)].sort(
    (first, second) => second - first,
  )
  return (values[0]! + 0.05) / (values[1]! + 0.05)
}

const light = matchedVariables(
  /:root,\s*:root\[data-theme='light'\]\s*\{([^}]*)\}/,
)
const darkOverrides = matchedVariables(
  /:root\[data-theme='dark'\]\s*\{([^}]*)\}/,
)
const dark = { ...light, ...darkOverrides }
const systemDarkOverrides = matchedVariables(
  /:root:not\(\[data-theme\]\),\s*:root\[data-theme='system'\]\s*\{([^}]*)\}/,
)
const systemDark = { ...light, ...systemDarkOverrides }

const requiredTokens = [
  '--color-brand-primary',
  '--color-brand-accent',
  '--color-bg-page',
  '--color-bg-surface',
  '--color-bg-raised',
  '--color-bg-muted',
  '--color-text-primary',
  '--color-text-secondary',
  '--color-text-inverse',
  '--color-text-disabled',
  '--color-text-on-accent',
  '--color-text-on-primary',
  '--color-text-on-danger',
  '--color-border',
  '--color-border-control',
  '--color-border-strong',
  '--color-focus',
  '--color-selection',
  '--color-link',
  '--color-action-primary',
  '--color-action-primary-hover',
  '--color-action-danger-hover',
  '--color-status-success',
  '--color-status-success-bg',
  '--color-status-success-border',
  '--color-status-warning',
  '--color-status-warning-bg',
  '--color-status-warning-border',
  '--color-status-danger',
  '--color-status-danger-bg',
  '--color-status-danger-border',
  '--color-status-info',
  '--color-status-info-bg',
  '--color-status-info-border',
  '--color-status-neutral',
  '--color-status-neutral-bg',
  '--color-status-neutral-border',
  '--space-1',
  '--space-2',
  '--space-3',
  '--space-4',
  '--space-5',
  '--space-6',
  '--space-8',
  '--space-10',
  '--space-12',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-xl',
  '--shadow-header',
  '--shadow-panel',
  '--shadow-focus',
  '--font-family-sans',
  '--font-size-body',
  '--font-size-small',
  '--font-size-heading',
  '--line-height-body',
  '--line-height-heading',
  '--motion-fast',
  '--motion-medium',
]

describe('semantic design tokens', () => {
  it('maps every required role for explicit light and dark themes', () => {
    for (const name of requiredTokens) {
      expect(light[name], `light mapping for ${name}`).toBeDefined()
      expect(dark[name], `dark mapping for ${name}`).toBeDefined()
    }
  })

  it('uses the approved prototype values for the shared palette', () => {
    expect(light).toMatchObject({
      '--color-brand-primary': '#002060',
      '--color-brand-accent': '#ffc200',
      '--color-bg-page': '#f3f6fa',
      '--color-bg-surface': '#ffffff',
      '--color-bg-muted': '#eaf0f7',
      '--color-text-primary': '#101828',
      '--color-text-secondary': '#536174',
      '--color-border': '#d4dce7',
    })
    expect(dark).toMatchObject({
      '--color-bg-page': '#0b1422',
      '--color-bg-surface': '#111f32',
      '--color-bg-raised': '#172941',
      '--color-bg-muted': '#1c3049',
      '--color-text-primary': '#eff4fb',
      '--color-text-secondary': '#b8c5d6',
      '--color-focus': '#82c9f2',
      '--color-selection': '#8cc4ff',
      '--color-border': '#344960',
    })
  })

  it('follows the system when theme is absent or set to system', () => {
    expect(tokensCss).toContain('@media (prefers-color-scheme: dark)')
    expect(systemDark['--color-bg-page']).toBe(dark['--color-bg-page'])
    expect(systemDark['--color-text-primary']).toBe(
      dark['--color-text-primary'],
    )
    for (const name of requiredTokens) {
      expect(systemDark[name], `system mapping for ${name}`).toBe(dark[name])
    }
    expect(tokensCss).toContain(":root[data-theme='light']")
    expect(tokensCss).toContain(":root[data-theme='dark']")
  })

  it('retains the reduced-motion override', () => {
    expect(tokensCss).toContain('@media (prefers-reduced-motion: reduce)')
    const reducedRule =
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*([^{}]+)\s*\{([^}]*)\}/.exec(
        tokensCss,
      )
    expect(reducedRule?.[1]).toContain(":root[data-theme='light']")
    expect(reducedRule?.[1]).toContain(":root[data-theme='dark']")
    const reduced = variablesIn(reducedRule?.[2] ?? '')
    expect(reduced).toMatchObject({
      '--motion-fast': '0ms',
      '--motion-medium': '0ms',
    })
  })

  it('maps legacy stylesheet variables to neutral semantic tokens', () => {
    expect(stylesCss).toContain("@import './styles/tokens.css';")
    const aliases = variablesIn(
      /:root\s*\{([^}]*)\}/.exec(stylesCss)?.[1] ?? '',
    )
    expect(aliases).toMatchObject({
      '--bg': 'var(--color-bg-page)',
      '--surface': 'var(--color-bg-surface)',
      '--surface-alt': 'var(--color-bg-muted)',
      '--text': 'var(--color-text-primary)',
      '--text-muted': 'var(--color-text-secondary)',
      '--border': 'var(--color-border)',
      '--border-strong': 'var(--color-border-control)',
      '--primary': 'var(--color-action-primary)',
      '--danger': 'var(--color-status-danger)',
      '--focus': 'var(--color-focus)',
      '--shadow': 'var(--shadow-panel)',
    })
    const fieldStart = stylesCss.indexOf("input:not([type='checkbox']")
    const fieldOpen = stylesCss.indexOf('{', fieldStart)
    const fieldClose = stylesCss.indexOf('}', fieldOpen)
    const fieldRule = stylesCss.slice(fieldOpen + 1, fieldClose)
    const buttonStart = stylesCss.indexOf('button,\n.btn {')
    const buttonOpen = stylesCss.indexOf('{', buttonStart)
    const buttonClose = stylesCss.indexOf('}', buttonOpen)
    const buttonRule = stylesCss.slice(buttonOpen + 1, buttonClose)
    expect(stylesCss.slice(fieldStart, fieldOpen)).toContain('textarea')
    expect(declarationsIn(fieldRule).border).toBe(
      '1px solid var(--border-strong)',
    )
    expect(declarationsIn(buttonRule).border).toBe(
      '1px solid var(--border-strong)',
    )
    expect(stylesCss).not.toMatch(/--(?:owner|company)-/i)
  })
})

describe('semantic token contrast', () => {
  it.each([
    ['light', light],
    ['dark', dark],
  ])('%s text and controls meet WCAG contrast thresholds', (_theme, map) => {
    for (const text of [
      '--color-text-primary',
      '--color-text-secondary',
      '--color-text-disabled',
      '--color-link',
    ]) {
      for (const surface of [
        '--color-bg-page',
        '--color-bg-surface',
        '--color-bg-muted',
      ]) {
        expect(
          contrastRatio(map[text]!, map[surface]!),
          `${text} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }

    for (const [foreground, background] of [
      ['--color-text-on-primary', '--color-action-primary'],
      ['--color-text-on-danger', '--color-status-danger'],
      ['--color-text-on-accent', '--color-brand-accent'],
      ['--color-text-inverse', '--color-brand-primary'],
      ['--color-status-success', '--color-status-success-bg'],
      ['--color-status-warning', '--color-status-warning-bg'],
      ['--color-status-danger', '--color-status-danger-bg'],
      ['--color-status-info', '--color-status-info-bg'],
      ['--color-status-neutral', '--color-status-neutral-bg'],
    ]) {
      expect(
        contrastRatio(map[foreground]!, map[background]!),
        `${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5)
    }

    for (const surface of ['--color-bg-page', '--color-bg-surface']) {
      expect(
        contrastRatio(map['--color-border-control']!, map[surface]!),
        `control boundary on ${surface}`,
      ).toBeGreaterThanOrEqual(3)
    }

    for (const boundary of [
      '--color-border-control',
      '--color-border-strong',
    ]) {
      for (const surface of ['--color-bg-page', '--color-bg-surface']) {
        expect(
          contrastRatio(map[boundary]!, map[surface]!),
          `${boundary} on ${surface}`,
        ).toBeGreaterThanOrEqual(3)
      }
    }

    for (const surface of [
      '--color-bg-page',
      '--color-bg-surface',
      '--color-bg-muted',
    ]) {
      expect(
        contrastRatio(map['--color-focus']!, map[surface]!),
        `focus on ${surface}`,
      ).toBeGreaterThanOrEqual(3)
    }

    for (const status of ['success', 'warning', 'danger', 'info', 'neutral']) {
      expect(
        contrastRatio(
          map[`--color-status-${status}-border`]!,
          map[`--color-status-${status}-bg`]!,
        ),
        `${status} boundary on status background`,
      ).toBeGreaterThanOrEqual(3)
    }
  })
})
