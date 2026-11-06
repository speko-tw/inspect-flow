/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const dir = 'src/field/evidence'
const sources = readdirSync(dir)
  .filter((name) => /\.(ts|tsx)$/.test(name) && !name.includes('.test.'))
  .filter((name) => name !== 'testFixtures.ts')
  .map((name) => ({
    name,
    text: readFileSync(path.join(dir, name), 'utf8'),
  }))

/** 去掉註解，避免說明文字裡提到的 API 名稱造成誤判。 */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('不留下本機資料、不做離線佇列（FEV-R08、FEV-AC11）', () => {
  it.each([
    ['localStorage', /\blocalStorage\b/],
    ['sessionStorage', /\bsessionStorage\b/],
    ['IndexedDB', /\bindexedDB\b|\bIDB[A-Z]/],
    ['Cache API', /\bcaches\b|\bCacheStorage\b/],
    ['Service Worker', /\bserviceWorker\b|\bServiceWorker\b/],
    ['Background Sync', /\bSyncManager\b|\.sync\.register/],
  ])('照片區程式碼沒有使用 %s', (_name, pattern) => {
    for (const source of sources) {
      expect(code(source.text), source.name).not.toMatch(pattern)
    }
  })

  it('應用程式沒有註冊 Service Worker', () => {
    const entries = ['src/main.tsx', 'src/App.tsx', 'index.html']
    for (const file of entries) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(
        /serviceWorker\s*\.\s*register/,
      )
    }
  })
})

describe('版面（FEV-R15、FEV-AC22）', () => {
  const css = readFileSync(path.join(dir, 'evidence.css'), 'utf8')

  it('按鈕與核取方塊至少 44px，內容可換行而不撐出水平捲動', () => {
    expect(css).toMatch(
      /\.evidence-section button[^{]*\{[^}]*min-height: 44px/,
    )
    expect(css).toMatch(/\.evidence-check \{[^}]*min-height: 44px/)
    expect(css).toMatch(
      /\.evidence-check input\[type='checkbox'\] \{[^}]*24px/,
    )
    expect(css).toMatch(/\.evidence-thumb \{[^}]*max-width: 100%/)
    expect(css).toMatch(/minmax\(min\(100%, 15rem\), 1fr\)/)
  })

  it('強制色彩模式使用系統核取方塊外觀', () => {
    const block = css.match(
      /@media\s*\(forced-colors:\s*active\)\s*\{([\s\S]*?)\n\}/,
    )
    expect(block?.[1]).toContain('appearance: auto;')
  })

  it('沒有提供對比、標註、裁切等現場不允許的控制項文案', () => {
    const editor = readFileSync(path.join(dir, 'PhotoEditor.tsx'), 'utf8')
    const labels = [...editor.matchAll(/>\s*([^<>{}\n]+?)\s*</g)].map(
      (match) => match[1],
    )
    for (const label of labels) {
      expect(label).not.toMatch(/對比|畫筆|標註工具|濾鏡|拉直|比例/)
    }
  })
})
