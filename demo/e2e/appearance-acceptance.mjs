import assert from 'node:assert/strict'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { demoBaseUrl } from './base-url.mjs'

const base = demoBaseUrl()
const work = process.env.DEMO_WORK_DIR ?? '/private/tmp/inspectflow-demo-e2e'
const screenshots = path.join(work, 'screenshots', 'appearance')
const handoffScreenshots = process.env.APPEARANCE_HANDOFF_DIR
  ? path.resolve(process.env.APPEARANCE_HANDOFF_DIR)
  : screenshots
const roles = [
  ['admin', 'DemoAdmin2026', '/overview'],
  ['demo-office', 'DemoOffice2026', '/projects'],
  ['demo-field-a', 'DemoFieldA2026', '/tasks'],
]
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-sandbox'],
})
const shots = []
const contrasts = []
const restored = []
let failure

async function context(options) {
  const value = await browser.newContext(options)
  value.setDefaultTimeout(15000)
  return value
}

// 真實帳號與 UI 操作驗證各入口，不用注入登入 Cookie 取代走查。
async function signIn(page, username, password, landing) {
  await page.goto(base)
  await page.getByLabel('帳號名稱或 Email').fill(username)
  await page.getByLabel('密碼', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登入', exact: true }).click()
  await page.waitForURL((url) => url.pathname === landing)
  await page.locator('.app-header-personal-trigger').waitFor()
}

async function settings(page) {
  await page.locator('.app-header-personal-trigger').click()
  await page
    .getByRole('group', { name: '個人選單' })
    .getByRole('link', { name: '設定', exact: true })
    .click()
  await readySettings(page)
}

async function readySettings(page) {
  await page.getByRole('heading', { name: '個人設定' }).waitFor()
  const group = page.getByRole('group', { name: '外觀', exact: true })
  await group.waitFor()
  assert.equal(
    await group.evaluate((el) => getComputedStyle(el).borderTopLeftRadius),
    '0px',
  )
  assert.equal(await page.getByLabel('目前密碼', { exact: true }).count(), 1)
}

async function choose(page, label, value) {
  const radio = page.getByRole('radio', { name: label, exact: true })
  if (!(await radio.isChecked())) {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/v1/auth/me') &&
        r.request().method() === 'PATCH',
    )
    await radio.check()
    assert.equal((await response).status(), 200)
    await page.getByText('外觀已儲存。', { exact: true }).waitFor()
  }
  await page.waitForFunction(
    (value) => document.documentElement.dataset.theme === value,
    value,
  )
}

// 主產物依 DEMO_WORK_DIR 隔離；另複製到工作單指定的交付位置。
async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      }),
  )
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  )
  const filename = `${name}.png`
  const destination = path.join(screenshots, filename)
  await page.screenshot({ path: destination, fullPage: true })
  if (path.resolve(handoffScreenshots) !== path.resolve(screenshots)) {
    await copyFile(destination, path.join(handoffScreenshots, filename))
  }
  shots.push(filename)
}

async function measureRadio(page, theme) {
  const values = await page
    .locator('.appearance-options input:not(:checked)')
    .first()
    .evaluate((input) => {
      const style = getComputedStyle(input)
      let ancestor = input.parentElement
      while (
        ancestor &&
        ['transparent', 'rgba(0, 0, 0, 0)'].includes(
          getComputedStyle(ancestor).backgroundColor,
        )
      )
        ancestor = ancestor.parentElement
      return {
        border: style.borderTopColor,
        width: Number.parseFloat(style.borderTopWidth),
        inside: style.backgroundColor,
        outside: getComputedStyle(ancestor).backgroundColor,
      }
    })
  function luminance(color) {
    const rgb = color
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number)
    const linear = rgb.map((value) => {
      const n = value / 255
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
    })
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
  }
  function ratio(a, b) {
    const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y)
    return (high + 0.05) / (low + 0.05)
  }
  const inside = ratio(values.border, values.inside)
  const outside = ratio(values.border, values.outside)
  assert.ok(values.width >= 2)
  assert.ok(inside >= 3 && outside >= 3)
  contrasts.push({
    theme,
    ...values,
    insideContrast: inside,
    outsideContrast: outside,
  })
}

// 正在保存時的連續方向鍵不得重入，也不能把焦點移到未選取的 radio。
async function feedbackScreenshots(page, theme, label) {
  const other = theme === 'light' ? ['dark', '深色'] : ['light', '淺色']
  await choose(page, other[1], other[0])
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  let writes = 0
  const hold = async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    writes += 1
    await gate
    await route.continue()
  }
  const pattern = '**/api/v1/auth/me'
  await page.route(pattern, hold)
  const target = page.getByRole('radio', { name: label, exact: true })
  const previous = page.getByRole('radio', { name: other[1], exact: true })
  await previous.focus()
  try {
    await Promise.all([
      page.waitForRequest(
        (request) =>
          request.url().endsWith('/api/v1/auth/me') &&
          request.method() === 'PATCH',
      ),
      page.keyboard.press(theme === 'light' ? 'ArrowLeft' : 'ArrowRight'),
    ])
    await page.getByText('正在儲存外觀…', { exact: true }).waitFor()
    for (let n = 0; n < 2; n += 1) {
      await page.keyboard.press(theme === 'light' ? 'ArrowRight' : 'ArrowLeft')
      assert.equal(await target.isChecked(), true)
      assert.equal(
        await target.evaluate((el) => el === document.activeElement),
        true,
      )
      assert.equal(await target.isEnabled(), true)
    }
    assert.equal(writes, 1)
    assert.equal(
      await page.getByRole('radiogroup').getAttribute('aria-busy'),
      'true',
    )
    await capture(page, `feedback-${theme}-saving`)
  } finally {
    release()
  }
  await page.getByText('外觀已儲存。', { exact: true }).waitFor()
  await page.unroute(pattern, hold)
  assert.equal(
    await target.evaluate((el) => el === document.activeElement),
    true,
  )
  await capture(page, `feedback-${theme}-saved`)

  const fail = async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'request.failed' } }),
    })
  }
  await page.route(pattern, fail)
  try {
    await previous.check()
    await page.getByText(/外觀儲存失敗，已回復原設定/).waitFor()
    assert.equal(await target.isChecked(), true)
    assert.equal(
      await target.evaluate((el) => el === document.activeElement),
      true,
    )
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme)
    await capture(page, `feedback-${theme}-failed`)
  } finally {
    await page.unroute(pattern, fail)
  }
}

try {
  await mkdir(screenshots, { recursive: true })
  await mkdir(handoffScreenshots, { recursive: true })
  // 暫停應用入口，證明 head 快取先於第一個應用畫面套用。
  const boot = await context({ colorScheme: 'dark' })
  await boot.addInitScript(() => {
    localStorage.setItem('inspectflow.appearance', 'light')
  })
  const bootPage = await boot.newPage()
  let releaseBoot
  const pendingBoot = new Promise((resolve) => {
    releaseBoot = resolve
  })
  await bootPage.route('**/src/main.tsx', async (route) => {
    await pendingBoot
    await route.continue()
  })
  try {
    await bootPage.goto(base, { waitUntil: 'commit' })
    await bootPage.waitForFunction(
      () => document.documentElement.dataset.theme === 'light',
    )
    assert.equal(await bootPage.locator('#root').innerHTML(), '')
  } finally {
    releaseBoot()
    await bootPage.waitForLoadState('domcontentloaded')
    await boot.close()
  }

  for (const [username, password, landing] of roles) {
    const first = await context({ colorScheme: 'light' })
    const page = await first.newPage()
    await signIn(page, username, password, landing)
    await settings(page)
    await choose(page, '深色', 'dark')
    await first.close()
    const second = await context({ colorScheme: 'light' })
    const device = await second.newPage()
    await signIn(device, username, password, landing)
    await device.waitForFunction(
      () => document.documentElement.dataset.theme === 'dark',
    )
    await settings(device)
    assert.equal(
      await device.getByLabel('深色', { exact: true }).isChecked(),
      true,
    )
    await choose(device, '跟隨裝置（預設）', 'system')
    for (const [scheme, color] of [
      ['dark', '#0b1422'],
      ['light', '#f3f6fa'],
    ]) {
      await device.emulateMedia({ colorScheme: scheme })
      await device.waitForFunction(
        (color) =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--color-bg-page')
            .trim() === color,
        color,
      )
    }
    await second.close()
  }

  const admin = await context({ colorScheme: 'dark' })
  const page = await admin.newPage()
  await signIn(page, 'admin', 'DemoAdmin2026', '/overview')
  await settings(page)
  for (const [theme, label] of [
    ['light', '淺色'],
    ['dark', '深色'],
  ]) {
    await page.setViewportSize({ width: 1280, height: 1000 })
    await feedbackScreenshots(page, theme, label)
    await measureRadio(page, theme)
    for (const [size, width] of [
      ['desktop', 1280],
      ['360', 360],
    ]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(`${base}/settings`)
      await readySettings(page)
      assert.equal(
        await page
          .getByRole('radio', {
            name: label,
            exact: true,
          })
          .isChecked(),
        true,
      )
      await capture(page, `settings-${theme}-${size}`)
      await page.goto(`${base}/projects`)
      await page.getByRole('heading', { name: '專案', exact: true }).waitFor()
      await page.locator('.app-header').waitFor()
      await capture(page, `projects-${theme}-${size}`)
    }
    await page.goto(`${base}/settings`)
    await readySettings(page)
  }

  const field = await context({ colorScheme: 'dark' })
  const fieldPage = await field.newPage()
  await signIn(fieldPage, 'demo-field-a', 'DemoFieldA2026', '/tasks')
  await settings(fieldPage)
  await choose(fieldPage, '深色', 'dark')
  for (const [size, width] of [
    ['desktop', 1280],
    ['360', 360],
  ]) {
    await fieldPage.setViewportSize({ width, height: 1000 })
    await fieldPage.goto(`${base}/tasks`)
    await fieldPage.getByRole('heading', { name: '我的任務' }).waitFor()
    await fieldPage.locator('.field-task-card').first().waitFor()
    await capture(fieldPage, `tasks-dark-${size}`)
  }
  await fieldPage.locator('.app-header-personal-trigger').click()
  await fieldPage
    .getByRole('group', { name: '個人選單' })
    .getByRole('button', { name: '登出', exact: true })
    .click()
  await fieldPage.getByRole('heading', { name: '登入', exact: true }).waitFor()
  for (const [size, width] of [
    ['desktop', 1280],
    ['360', 360],
  ]) {
    await fieldPage.setViewportSize({ width, height: 1000 })
    assert.equal(
      await fieldPage.locator('html').getAttribute('data-theme'),
      'dark',
    )
    await capture(fieldPage, `login-dark-${size}`)
  }
} catch (error) {
  failure = error
} finally {
  // 先關閉可能仍有請求的舊 context，再由新 context 還原全部碰過的帳號。
  for (const value of browser.contexts()) await value.close()
  const errors = []
  for (const [username, password] of roles) {
    const cleanup = await context({})
    try {
      const page = await cleanup.newPage()
      await page.goto(base)
      const result = await page.evaluate(
        async ({ username, password }) => {
          const login = await fetch('/api/v1/auth/login', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login: username, password }),
          })
          if (!login.ok) return { status: login.status }
          const saved = await fetch('/api/v1/auth/me', {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appearance: 'system' }),
          })
          const me = await fetch('/api/v1/auth/me')
          return {
            status: saved.status,
            appearance: (await me.json()).appearance,
          }
        },
        { username, password },
      )
      assert.deepEqual(result, { status: 200, appearance: 'system' })
      restored.push(username)
    } catch (error) {
      errors.push(error)
    } finally {
      await cleanup.close()
    }
  }
  await browser.close()
  if (errors.length)
    failure = new AggregateError(
      failure ? [failure, ...errors] : errors,
      'Demo appearance cleanup failed',
    )
}
if (failure) throw failure
const result = {
  result: 'PASS',
  roles: roles.map((role) => role[0]),
  crossDevice: true,
  systemChanges: true,
  beforeAppBoot: true,
  keyboardFocus: true,
  boundedKeyboardWait: true,
  screenshots,
  handoffScreenshots,
  screenshotCount: shots.length,
  contrasts,
  restored,
}
await writeFile(
  path.join(work, 'appearance-result.json'),
  JSON.stringify(result, null, 2) + '\n',
)
console.log(JSON.stringify(result, null, 2))
