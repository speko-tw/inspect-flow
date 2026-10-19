import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const base = process.env.DEMO_BASE_URL ?? 'http://localhost:18311'
const here = path.dirname(fileURLToPath(import.meta.url))
const demo = path.resolve(here, '..')
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-sandbox'],
})
const page = await browser.newPage({
  viewport: { width: 360, height: 800 },
})
page.setDefaultTimeout(15000)

async function assertFieldLayout(width) {
  await page.setViewportSize({ width, height: 800 })
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    buttons: Array.from(
      document.querySelectorAll('main button, main a.field-task-card'),
    ).map((element) => {
      const rect = element.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    }),
  }))
  assert.ok(
    dimensions.document <= dimensions.viewport,
    `${width}px Field view overflows: ${JSON.stringify(dimensions)}`,
  )
  assert.ok(dimensions.buttons.length > 0)
  for (const button of dimensions.buttons) {
    assert.ok(
      button.width >= 44 && button.height >= 44,
      `${width}px touch target <44px: ${JSON.stringify(button)}`,
    )
  }
}

try {
  await page.goto(base)
  await page.getByLabel('帳號名稱或 Email').fill('demo-field-b')
  await page.getByLabel('密碼').fill('DemoFieldB2026')
  await page.getByRole('button', { name: '登入' }).click()
  await page.getByRole('heading', { name: '我的任務' }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/tasks')
  await assertFieldLayout(360)
  await assertFieldLayout(390)
  await assertFieldLayout(768)
  await assertFieldLayout(360)

  await page.getByText('茶水間給水試壓').click()
  await page.getByRole('heading', { name: '給水管試壓檢查' }).waitFor()
  await assertFieldLayout(360)

  await page.route('**/api/v1/inspection-tasks/*', async (route) => {
    if (route.request().method() === 'POST') {
      await route.abort('failed')
      return
    }
    await route.continue()
  })
  await page.getByRole('button', { name: '開始查核' }).click()
  await page.getByRole('button', { name: '確認開始查核' }).click()
  await page.getByRole('alert').getByText(
    /網路或伺服器暫時出問題/,
  ).waitFor()
  await page.unrouteAll()
  await page.getByRole('button', { name: '確認開始查核' }).click()
  await page.getByRole('heading', { name: '查核進行中' }).waitFor()
  await page.getByRole('link', { name: '返回任務' }).click()
  await page.context().setOffline(true)
  await page.getByRole('button', { name: '待開始' }).click()
  await page.getByRole('heading', { name: '無法載入任務' }).waitFor()
  await page.getByRole('button', { name: '重試' }).waitFor()
  await page.context().setOffline(false)
  await page.getByRole('button', { name: '重試' }).click()
  await page.getByText('待開始').first().waitFor()
  await page.screenshot({
    path: path.join(demo, 'screenshots/06-field-mobile-started.png'),
    fullPage: true,
  })

  const registrations = await page.evaluate(() =>
    'serviceWorker' in navigator
      ? navigator.serviceWorker.getRegistrations().then(
          (items) => items.length,
        )
      : 0,
  )
  assert.equal(registrations, 0)
  await mkdir(path.join(demo, 'screenshots'), { recursive: true })
  process.stdout.write(JSON.stringify({
    result: 'PASS',
    browser: 'Google Chrome via Playwright',
    viewports: [360, 390, 768],
    failedStart: 'visible retryable error, then real API retry succeeded',
    offlineList: 'visible load error, then retry after reconnect succeeded',
    serviceWorkers: registrations,
  }, null, 2) + '\n')
} finally {
  await browser.close()
}
