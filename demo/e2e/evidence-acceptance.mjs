import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { demoBaseUrl } from './base-url.mjs'

// 只從登入頁進入；項目與任務都靠導覽點擊，不用 UUID 組網址。
const base = demoBaseUrl()
const output = path.resolve(
  process.env.EVIDENCE_DIR ?? '/private/tmp/if799-evidence',
)
const fixture = process.env.EVIDENCE_FIXTURE ?? path.join(output, 'demo.jpg')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({
  viewport: { width: 1280, height: 960 },
  colorScheme: 'light',
})
page.setDefaultTimeout(12000)
const errors = []
const writes = []
const screenshots = []
const retries = []
const findings = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('response', async (response) => {
  const request = response.request()
  if (request.method() !== 'GET' && request.url().includes('/photos')) {
    writes.push({
      method: request.method(),
      status: response.status(),
      path: new URL(request.url()).pathname,
    })
  }
})

async function snap(name) {
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 960 })
    // ResizeObserver 與畫布重繪完成後再保存，避免截到舊比例。
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        }),
    )
    await page.screenshot({
      path: path.join(output, `${name}-${width}.png`),
      fullPage: true,
    })
    screenshots.push(`${name}-${width}.png`)
    if (name.startsWith('04-layer-')) {
      const bounds = await page
        .locator('.office-layer-overlay')
        .evaluate((table) => {
          const last = table.querySelectorAll('.office-layer-table__title')[4]
          const outer = table.getBoundingClientRect()
          const canvas = table
            .closest('.office-canvas')
            .getBoundingClientRect()
          const row = last.getBoundingClientRect()
          return {
            tableBottom: Math.min(outer.bottom, canvas.bottom),
            timeTop: row.top,
            timeBottom: row.bottom,
          }
        })
      if (bounds.timeBottom > bounds.tableBottom + 1) {
        findings.push({
          id: 'label-preview-clipped',
          width,
          stage: name,
          screenshot: `${name}-${width}.png`,
          ...bounds,
        })
      }
    }
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }))
    assert.ok(
      dimensions.scroll <= dimensions.width,
      `${name}: horizontal overflow ${JSON.stringify(dimensions)}`,
    )
  }
  await page.setViewportSize({ width: 1280, height: 960 })
}

async function login(role) {
  // 使用畫面上的登出按鈕切換身分，登入網址只開啟一次。
  const logout = page.getByRole('button', { name: '登出', exact: true })
  const menu = page.locator('button[aria-controls="app-header-personal-menu"]')
  if (await menu.count()) await menu.click()
  if (await logout.count()) await logout.click()
  await page.getByLabel('帳號名稱或 Email').fill(`demo-${role}`)
  await page.getByLabel('密碼', { exact: true }).fill(
    {
      office: 'DemoOffice2026',
      'field-a': 'DemoFieldA2026',
      'field-b': 'DemoFieldB2026',
    }[role],
  )
  await page.getByRole('button', { name: '登入', exact: true }).click()
  await page.waitForURL(
    (url) => url.pathname === (role === 'office' ? '/projects' : '/tasks'),
  )
}

async function project() {
  await page.getByRole('link', { name: '專案', exact: true }).click()
  const card = page
    .locator('article')
    .filter({ hasText: '示範廠擴建機電工程' })
  await card.getByRole('link', { name: '開啟專案' }).click()
}

async function officePhotos() {
  await page.getByRole('link', { name: '計畫與任務', exact: true }).click()
  await page.getByRole('link', { name: /示範廠擴建機電工程查核計畫/ }).click()
  await page.getByRole('link', { name: '泵房止水閥標示', exact: true }).click()
  await page.getByRole('link', { name: '照片與內業編修', exact: true }).click()
  await page.getByRole('heading', { name: '泵房止水閥標示｜照片' }).waitFor()
}

async function upload(caption, loseResponses = false) {
  const attempts = []
  const pattern = '**/api/v1/inspection-tasks/*/photos'
  if (loseResponses && loseResponses !== 'offline') {
    // 真後端先成功提交，再模擬三次回應遺失，驗證同鍵重送。
    await page.route(pattern, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const response = await route.fetch()
      writes.push({
        method: 'POST',
        status: response.status(),
        path: new URL(route.request().url()).pathname,
        via: 'fault-proxy',
      })
      attempts.push({
        key: route.request().headers()['idempotency-key'],
        status: response.status(),
      })
      if (attempts.length <= (loseResponses === 'manual' ? 4 : 3))
        return route.abort('failed')
      await route.fulfill({ response })
    })
  }
  const picker = page.waitForEvent('filechooser')
  await page
    .getByRole('button', { name: /^拍照，/ })
    .first()
    .click()
  await (await picker).setFiles(fixture)
  await page.getByRole('heading', { name: '編修現場照片' }).waitFor()
  for (const width of [360, 390, 768]) {
    await page.setViewportSize({ width, height: 960 })
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    )
  }
  await page.getByRole('button', { name: '旋轉 90°', exact: true }).click()
  await snap(`${caption}-editor`)
  await page.getByRole('button', { name: '確認', exact: true }).click()
  await page.getByLabel(/照片註記/).fill(caption)
  if (loseResponses === 'offline') await page.context().setOffline(true)
  await page.getByRole('button', { name: '上傳現場照片', exact: true }).click()
  if (['manual', 'offline'].includes(loseResponses)) {
    await page
      .getByRole('button', { name: '手動重送', exact: true })
      .waitFor({ timeout: 25000 })
    await page.getByRole('link', { name: '返回任務', exact: true }).click()
    await page.getByText(/照片尚未上傳，請勿關閉頁面/).waitFor()
    assert.equal(
      await page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true })
        window.dispatchEvent(event)
        return event.defaultPrevented
      }),
      true,
    )
    await snap(
      loseResponses === 'offline'
        ? '10c-offline-retained'
        : '09b-failed-retained',
    )
    if (loseResponses === 'offline') {
      const storage = await page.evaluate(async () => ({
        databases: (await indexedDB.databases()).length,
        caches: (await caches.keys()).length,
        serviceWorkers: (await navigator.serviceWorker.getRegistrations())
          .length,
      }))
      assert.deepEqual(storage, { databases: 0, caches: 0, serviceWorkers: 0 })
      await page.context().setOffline(false)
    }
    await page.getByRole('button', { name: '留在這一頁', exact: true }).click()
    await page.getByRole('button', { name: '手動重送', exact: true }).click()
  }
  await page.getByText('照片已上傳。', { exact: true }).waitFor()
  await page.getByText(caption, { exact: true }).first().waitFor()
  if (loseResponses && loseResponses !== 'offline') {
    await page.unroute(pattern)
    assert.equal(attempts.length, loseResponses === 'manual' ? 5 : 4)
    assert.equal(new Set(attempts.map((attempt) => attempt.key)).size, 1)
    assert.deepEqual(
      attempts.map((attempt) => attempt.status),
      loseResponses === 'manual'
        ? [201, 200, 200, 200, 200]
        : [201, 200, 200, 200],
    )
    retries.push(attempts)
  }
}

try {
  await page.goto(base)
  await login('field-a')
  await page.getByText('泵房止水閥標示', { exact: true }).click()
  await page
    .getByRole('button', { name: /^拍照，/ })
    .first()
    .waitFor()
  await snap('01-seeded-field')
  await upload('DEMO-walkthrough', true)
  await snap('02-uploaded')
  await login('office')
  await project()
  await officePhotos()
  await page.getByText(/DEMO-walkthrough/).waitFor()
  await snap('03-office-comparison')
  const photo = page.locator('article').filter({ hasText: 'DEMO-walkthrough' })
  await photo.getByRole('button', { name: /^編修內業版/ }).click()
  await page.getByRole('tab', { name: '調整', exact: true }).click()
  const brightness = page.getByRole('slider', { name: /亮度/ })
  await brightness.focus()
  await brightness.press('ArrowRight')
  await snap('04-office-editor')
  await page.getByRole('tab', { name: '圖層', exact: true }).click()
  assert.equal(
    await page.getByLabel('檢驗人員', { exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await page.getByLabel('檢驗時間', { exact: true }).isDisabled(),
    true,
  )
  await page
    .getByLabel('工程名稱', { exact: true })
    .fill('DEMO 示範工程名稱完整保留；用長文字驗證兩行省略與內業覆寫')
  for (const style of ['dark', 'outline', 'paper']) {
    await page.getByRole('combobox', { name: /樣式/ }).selectOption(style)
    await snap(`04-layer-${style}`)
  }
  await page.getByRole('link', { name: '查核項目', exact: true }).click()
  await page.getByRole('button', { name: '繼續編修', exact: true }).waitFor()
  await snap('04-unsaved-guard')
  await page.getByRole('button', { name: '繼續編修', exact: true }).click()
  await page.getByRole('button', { name: '確認', exact: true }).click()
  await page.getByRole('button', { name: '確認套用', exact: true }).click()
  await page.getByText('內業版已更新。', { exact: true }).first().waitFor()
  await snap('05-office-saved')
  await photo.getByRole('button', { name: /^查看歷程/ }).click()
  await photo.getByText('查看修改前後', { exact: true }).click()
  await photo.getByText(/自訂文字：DEMO 示範工程名稱完整保留/).waitFor()
  await snap('05-layer-history')
  await page.getByRole('link', { name: '查核項目', exact: true }).click()
  await page
    .getByRole('link', { name: '修改「止水閥標示檢查」', exact: true })
    .click()
  await page
    .getByLabel('標準文字', { exact: true })
    .fill('DEMO 標示清楚且方向一致；須補拍全景')
  await page.getByRole('button', { name: '儲存變更', exact: true }).click()
  await page
    .getByRole('radio', { name: '要，用新標準重新查核', exact: true })
    .check()
  await page
    .getByText(/舊結果與照片會保留可查/)
    .first()
    .waitFor()
  await snap('06-reinspection-confirm')
  await page.getByRole('button', { name: '確認儲存', exact: true }).click()
  await page.getByRole('heading', { name: '修改結果', exact: true }).waitFor()
  await snap('07-standard-changed')
  await officePhotos()
  await page.getByRole('combobox', { name: /照片狀態/ }).selectOption('voided')
  await page.getByText(/DEMO-walkthrough/).waitFor()
  await snap('08-voided')
  await login('field-a')
  await page.getByText('泵房止水閥標示', { exact: true }).click()
  await page
    .getByRole('button', { name: /^拍照，/ })
    .first()
    .waitFor()
  await page.getByText(/DEMO-walkthrough/).waitFor({ state: 'hidden' })
  await snap('09-recapture-needed')
  await upload('DEMO-recapture', 'manual')
  await snap('10-recaptured')
  const recapture = page.locator('li').filter({
    has: page.getByRole('heading', { name: 'DEMO-recapture', exact: true }),
  })
  await recapture.getByRole('button', { name: /^修改說明與項次/ }).click()
  await page.getByLabel(/照片註記/).fill('DEMO-recapture-updated')
  await page.getByRole('button', { name: '儲存修改', exact: true }).click()
  await page.getByRole('button', { name: '確認儲存', exact: true }).click()
  await page
    .getByRole('heading', { name: 'DEMO-recapture-updated', exact: true })
    .waitFor()
  await snap('10b-field-modified')
  await upload('DEMO-offline', 'offline')
  await login('office')
  await project()
  await officePhotos()
  await page.getByRole('combobox', { name: /照片狀態/ }).selectOption('active')
  await page.getByText(/DEMO-recapture/).waitFor()
  await page.getByText(/DEMO-walkthrough/).waitFor({ state: 'hidden' })
  await snap('11-active-recapture')
  const active = page.locator('article').filter({ hasText: 'DEMO-recapture' })
  await active.getByRole('button', { name: /^刪除照片/ }).click()
  await page.getByRole('button', { name: '保留照片', exact: true }).click()
  await active.getByRole('button', { name: /^刪除照片/ }).click()
  await page.getByRole('button', { name: '確認刪除', exact: true }).click()
  await page
    .getByRole('combobox', { name: /照片狀態/ })
    .selectOption('deleted')
  await page.getByText(/DEMO-recapture-updated/).waitFor()
  await page
    .locator('.office-photo-badge')
    .filter({
      hasText: '已刪除',
    })
    .first()
    .waitFor()
  await snap('12-deleted')
  await login('field-b')
  await page.getByRole('button', { name: /近期已完成/ }).click()
  const completed = page.getByRole('link').filter({
    hasText: '設備間試壓紀錄',
  })
  await completed.waitFor()
  assert.equal(await completed.locator('.badge-success').innerText(), '已完成')
  await snap('13-completed-list')
  await completed.click()
  assert.equal(await page.locator('.badge-success').innerText(), '已完成')
  await snap('14-completed-detail')
  await login('office')
  await project()
  await page.getByRole('link', { name: '計畫與任務', exact: true }).click()
  await page.getByRole('link', { name: /示範廠擴建機電工程查核計畫/ }).click()
  const officeCompleted = page.locator('article').filter({
    hasText: '設備間試壓紀錄',
  })
  assert.match(
    await officeCompleted.locator('.badge-success').innerText(),
    /已完成/,
  )
  await snap('15-completed-office')
  assert.deepEqual(errors, [])
  assert.ok(
    writes.filter((entry) => entry.method === 'POST' && entry.status === 201)
      .length >= 2,
  )
  assert.ok(
    writes.some((entry) => entry.method === 'PUT' && entry.status === 200),
  )
  assert.ok(
    writes.some((entry) => entry.method === 'PATCH' && entry.status === 200),
  )
  assert.ok(
    writes.some(
      (entry) =>
        entry.method === 'DELETE' && [200, 204].includes(entry.status),
    ),
  )
  await writeFile(
    path.join(output, 'walkthrough.json'),
    JSON.stringify(
      {
        result: 'PASS',
        screenshots,
        retries,
        findings,
        writes,
        errors,
        navigation:
          'login then UI links only; no direct task URL or API writes',
      },
      null,
      2,
    ),
  )
  console.log('PASS: upload → office edit → standard change → recapture')
} catch (error) {
  await page.screenshot({
    path: path.join(output, 'blocked.png'),
    fullPage: true,
  })
  await writeFile(
    path.join(output, 'blocked.txt'),
    `${error.stack}\n\n${await page.locator('body').innerText()}`,
  )
  throw error
} finally {
  await browser.close()
}
