import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { demoBaseUrl } from './base-url.mjs'

const base = demoBaseUrl()
const screenshots = '/private/tmp/inspectflow-515-screenshots'
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-sandbox'],
})
await mkdir(screenshots, { recursive: true })

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
  await page.getByRole('heading', { name: '個人設定' }).waitFor()
  await page.getByRole('heading', { name: '外觀', exact: true }).waitFor()
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

// 首次繪製證據：暫停應用程式入口，head 快取腳本仍先套用。
const bootContext = await browser.newContext({ colorScheme: 'dark' })
await bootContext.addInitScript(() => {
  localStorage.setItem('inspectflow.appearance', 'light')
})
const bootPage = await bootContext.newPage()
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
  await bootContext.close()
}

const roles = [
  ['admin', 'DemoAdmin2026', '/overview'],
  ['demo-office', 'DemoOffice2026', '/projects'],
  ['demo-field-a', 'DemoFieldA2026', '/tasks'],
]
try {
  for (const [username, password, landing] of roles) {
    const first = await browser.newContext({ colorScheme: 'light' })
    const page = await first.newPage()
    await signIn(page, username, password, landing)
    await settings(page)
    await choose(page, '深色', 'dark')
    await first.close()

    const second = await browser.newContext({ colorScheme: 'light' })
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
    await device.emulateMedia({ colorScheme: 'dark' })
    await device.waitForFunction(
      () =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--color-bg-page')
          .trim() === '#0b1422',
    )
    await device.emulateMedia({ colorScheme: 'light' })
    await device.waitForFunction(
      () =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--color-bg-page')
          .trim() === '#f3f6fa',
    )
    await second.close()
  }

  const context = await browser.newContext({ colorScheme: 'dark' })
  const page = await context.newPage()
  await signIn(page, 'admin', 'DemoAdmin2026', '/overview')
  await settings(page)
  for (const [theme, label] of [
    ['light', '淺色'],
    ['dark', '深色'],
  ]) {
    await choose(page, label, theme)
    for (const [size, width] of [
      ['desktop', 1280],
      ['360', 360],
    ]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(`${base}/settings`)
      await page.getByRole('heading', { name: '外觀', exact: true }).waitFor()
      await page
        .getByRole('radio', { name: label, exact: true })
        .waitFor({ state: 'visible' })
      assert.equal(
        await page
          .getByRole('radio', {
            name: label,
            exact: true,
          })
          .isChecked(),
        true,
      )
      await page.evaluate(() => document.fonts.ready)
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      )
      await page.screenshot({
        path: path.join(screenshots, `settings-${theme}-${size}.png`),
        fullPage: true,
      })
      await page.goto(`${base}/projects`)
      await page.getByRole('heading', { name: '專案', exact: true }).waitFor()
      await page.locator('.app-header').waitFor()
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({
        path: path.join(screenshots, `projects-${theme}-${size}.png`),
        fullPage: true,
      })
    }
    await page.goto(`${base}/settings`)
    await page.getByRole('heading', { name: '外觀', exact: true }).waitFor()
  }
  await choose(page, '跟隨裝置（預設）', 'system')
  await context.close()
  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        roles: roles.map((role) => role[0]),
        crossDevice: true,
        systemChanges: true,
        beforeAppBoot: true,
        screenshots,
        screenshotCount: 8,
      },
      null,
      2,
    ),
  )
} finally {
  await browser.close()
}
