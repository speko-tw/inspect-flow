import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { demoBaseUrl } from './base-url.mjs'
import {
  createLedger,
  diffPixels,
  expectedOfficeSize,
  installFault,
  loadPixels,
  settle,
  sha256,
  snapCanvas,
} from './evidence-checks.mjs'

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
// all＝原照片主線加 AC35～AC39 擴充；extended＝只跑擴充（負向控制用）。
const phase = process.env.EVIDENCE_PHASE ?? 'all'
// 負向控制：EVIDENCE_FAULT 改寫送往後端的請求，預期擴充走查在指名斷言失敗。
const fault = process.env.EVIDENCE_FAULT ?? ''
const ledger = createLedger()
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

async function mainFlow() {
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
}

const API = `${base}/api/v1`
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
const CANVAS = 'canvas[aria-label="現場照片與圖層預覽"]'
const LIBRARY_CAPTION = 'DEMO-ac-library'
const LAYER_OFF_CAPTION = 'DEMO-ac-layer-off'
const OVERRIDES = {
  project_name: 'DEMO 覆寫工程名稱',
  item_name: 'DEMO 覆寫檢驗項目',
  inspection_location: 'DEMO 覆寫檢驗位置',
}

async function getJson(url) {
  const response = await page.request.get(url)
  assert.equal(response.status(), 200, `GET ${url} -> ${response.status()}`)
  return response.json()
}

async function getBytes(url) {
  const response = await page.request.get(url)
  assert.equal(response.status(), 200, `GET ${url} -> ${response.status()}`)
  return response.body()
}

// React 受控滑桿要用原生 setter 再送 input 事件，直接 fill 不會觸發 onChange。
async function setRange(locator, value) {
  await locator.evaluate((element, next) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set.call(element, String(next))
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

async function fieldUpload(entry, caption, prepare) {
  const picker = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: entry }).first().click()
  await (await picker).setFiles(fixture)
  await page.getByRole('heading', { name: '編修現場照片' }).waitFor()
  await prepare()
  await page.getByRole('button', { name: '確認', exact: true }).click()
  await page.getByLabel(/照片註記/).fill(caption)
  await page.getByRole('button', { name: '上傳現場照片', exact: true }).click()
  await page.getByText('照片已上傳。', { exact: true }).waitFor()
  await page.getByText(caption, { exact: true }).first().waitFor()
}

async function officeCard(caption) {
  return page.locator('article').filter({ hasText: caption })
}

async function officeList() {
  return (
    await getJson(
      `${API}/inspection-tasks/${taskIdForChecks}/photos?limit=100`,
    )
  ).items
}

async function officePhotoByCaption(caption) {
  const photo = (await officeList()).find((item) => item.caption === caption)
  assert.ok(photo, `office photo ${caption} not found`)
  return photo
}

function imageUrl(photo, variant) {
  return (
    `${API}/inspection-tasks/${taskIdForChecks}/photos/${photo.id}` +
    `/image?variant=${variant}`
  )
}

async function openOfficeEditor(caption) {
  const card = await officeCard(caption)
  await card.getByRole('button', { name: /^編修內業版/ }).click()
  await page
    .getByRole('heading', { name: '編修內業版', exact: true })
    .waitFor()
}

// 以回應狀態確認套用成功；列表上的「已更新」提示會殘留，不能當完成訊號。
async function applyOfficeEditor() {
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes('/office-version') &&
      response.request().method() === 'PUT',
  )
  await page.getByRole('button', { name: '確認', exact: true }).click()
  await page.getByRole('button', { name: '確認套用', exact: true }).click()
  const response = await saved
  assert.equal(response.status(), 200, 'office-version PUT status')
  await page
    .getByRole('heading', { name: '編修內業版', exact: true })
    .waitFor({ state: 'hidden' })
}

// 預覽（列表上的內業版圖）要與保存版同一份：網址摘要與像素尺寸都對得上。
async function expectPreviewMatches(ac, caption, photo) {
  const card = await officeCard(caption)
  const image = card.locator('img[alt^="內業版"]').first()
  await page.waitForFunction(
    ([alt, digest]) => {
      const node = [...document.querySelectorAll('img')].find(
        (item) =>
          item.alt.startsWith('內業版，') &&
          item.closest('article')?.innerText.includes(alt),
      )
      return Boolean(node?.src.includes(`v=${digest}`) && node.complete)
    },
    [caption, photo.variants.office.sha256.slice(0, 8)],
  )
  const size = await image.evaluate((node) => ({
    width: node.naturalWidth,
    height: node.naturalHeight,
  }))
  ledger.equal(ac, 'preview image is the stored office version', size, {
    width: photo.variants.office.width,
    height: photo.variants.office.height,
  })
}

async function downloadOffice(caption) {
  const card = await officeCard(caption)
  const link = card.getByRole('link', { name: '下載內業版', exact: true })
  if (fault === 'download-wrong') {
    // 負向控制：下載連結指到現場版，模擬下載檔與保存的內業版不一致。
    await link.evaluate((node) => {
      node.href = node.href.replace('variant=office', 'variant=field')
    })
  }
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    link.click(),
  ])
  return readFile(await download.path())
}

let taskIdForChecks = ''

async function extendedFlow() {
  // ── 現場：相簿入口、現場編修器只有簡化控制、圖層開關與四角即時預覽 ──
  await login('field-a')
  await page.getByText('泵房止水閥標示', { exact: true }).click()
  await page
    .getByRole('button', { name: /^從相簿選，/ })
    .first()
    .waitFor()
  taskIdForChecks = page.url().match(UUID)?.[0] ?? ''
  ledger.ok('AC24', 'task id reachable from UI navigation', taskIdForChecks, {
    url: page.url(),
  })
  await fieldUpload(/^從相簿選，/, LIBRARY_CAPTION, async () => {
    const editor = page.locator('.evidence-editor')
    ledger.equal(
      'AC03',
      'field editor only has brightness, one corner and one layer switch',
      {
        sliders: await editor.locator('input[type=range]').count(),
        selects: await editor.locator('select').count(),
        checkboxes: await editor.locator('input[type=checkbox]').count(),
        // 說明文字會提到「裁切」，所以只數可操作的控制項。
        fineControls:
          (await editor.getByRole('tab').count()) +
          (await editor
            .getByRole('button', { name: /裁切|拉直|比例|畫筆|大小|樣式/ })
            .count()),
        editableLabelText: await editor
          .locator('textarea')
          .evaluateAll(
            (nodes) => nodes.filter((node) => !node.readOnly).length,
          ),
      },
      {
        sliders: 1,
        selects: 1,
        checkboxes: 1,
        fineControls: 0,
        editableLabelText: 0,
      },
    )
    const layerBox = page.getByRole('checkbox', { name: '顯示工程圖層' })
    const corner = page.locator('#evidence-corner')
    await layerBox.uncheck()
    await settle(page)
    ledger.equal(
      'AC35',
      'corner select disabled when layer off',
      await corner.isDisabled(),
      true,
    )
    await snapCanvas(page, 'field-off', CANVAS)
    await layerBox.check()
    await settle(page)
    for (const name of [
      'bottom_left',
      'bottom_right',
      'top_left',
      'top_right',
    ]) {
      await corner.selectOption(name)
      await settle(page)
      await snapCanvas(page, `field-${name}`, CANVAS)
      const diff = await diffPixels(page, 'field-off', `field-${name}`)
      ledger.corner(
        'AC35',
        `field preview draws the label at ${name}`,
        diff,
        name,
      )
    }
    await snap('16-field-library-editor')
  })
  const fieldPhotos = (
    await getJson(`${API}/field/inspection-tasks/${taskIdForChecks}/photos`)
  ).items
  const fieldPhoto = fieldPhotos.find(
    (item) => item.caption === LIBRARY_CAPTION,
  )
  ledger.equal(
    'AC38',
    'field API keeps capture_source=library',
    fieldPhoto.capture_source,
    'library',
  )
  ledger.equal(
    'AC35',
    'field API stores the chosen layer',
    [fieldPhoto.layer.enabled, fieldPhoto.layer.corner],
    [true, 'top_right'],
  )
  const fieldBody = await page.locator('body').innerText()
  ledger.ok(
    'AC39',
    'field JSON and screen carry no non-realtime marker',
    !('is_non_realtime_capture' in fieldPhoto) &&
      !/相簿匯入|非即時拍攝/.test(fieldBody),
    { keys: Object.keys(fieldPhoto) },
  )
  // 清單縮圖是前端依讀回的設定合成；與同一份乾淨現場版比對，只應在該角落有差。
  const thumb = `canvas.evidence-thumb[aria-label="${LIBRARY_CAPTION}"]`
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.width > 300 || false,
    thumb,
  )
  await settle(page)
  await snapCanvas(page, 'thumb', thumb)
  await loadPixels(page, 'thumb-plain', {
    url: `${imageUrl(fieldPhoto, 'field')}&max_edge=640`,
  })
  ledger.corner(
    'AC35',
    'field list thumbnail composites the label in the stored corner',
    await diffPixels(page, 'thumb', 'thumb-plain'),
    'top_right',
  )
  await snap('17-field-library-list')
  await fieldUpload(/^拍照，/, LAYER_OFF_CAPTION, async () => {
    await page.getByRole('checkbox', { name: '顯示工程圖層' }).uncheck()
    await settle(page)
  })

  // ── 內業：初版合成、完整編修、關閉圖層下載、拉直重現 ──
  await login('office')
  await project()
  await officePhotos()
  const photo = await officePhotoByCaption(LIBRARY_CAPTION)
  const card = await officeCard(LIBRARY_CAPTION)
  await card.getByText('相簿匯入', { exact: true }).waitFor()
  ledger.equal(
    'AC38',
    'office API and badge show library source',
    [photo.capture_source, photo.is_non_realtime_capture],
    ['library', true],
  )
  ledger.equal(
    'AC01',
    'exactly FIELD and OFFICE variants',
    Object.keys(photo.variants).sort(),
    ['field', 'office'],
  )
  const initialField = await getBytes(imageUrl(photo, 'field'))
  const initialOffice = await getBytes(imageUrl(photo, 'office'))
  ledger.equal(
    'AC30',
    'FIELD bytes match stored hash',
    sha256(initialField),
    photo.variants.field.sha256,
  )
  ledger.equal(
    'AC30',
    'OFFICE bytes match stored hash',
    sha256(initialOffice),
    photo.variants.office.sha256,
  )
  ledger.ok(
    'AC30',
    'OFFICE differs from FIELD when layer is on',
    photo.variants.office.sha256 !== photo.variants.field.sha256,
  )
  await loadPixels(page, 'initial-field', { buffer: initialField })
  await loadPixels(page, 'initial-office', { buffer: initialOffice })
  ledger.corner(
    'AC35',
    'only OFFICE carries the label, in the chosen corner',
    await diffPixels(page, 'initial-field', 'initial-office'),
    'top_right',
  )
  await expectPreviewMatches('AC30', LIBRARY_CAPTION, photo)
  await snap('18-office-library-initial')

  // 完整編修：旋轉、裁切、拉直、亮度、位置、樣式與三欄覆寫。
  await openOfficeEditor(LIBRARY_CAPTION)
  await page.getByRole('tab', { name: '裁切', exact: true }).click()
  for (const [key, value] of [
    ['width', 60],
    ['height', 50],
    ['x', 10],
    ['y', 10],
  ]) {
    await setRange(page.locator(`#office-crop-${key}`), value)
  }
  await setRange(page.getByRole('slider', { name: /拉直/ }), 5)
  await page.getByRole('button', { name: '向右旋轉 90°', exact: true }).click()
  await page.getByRole('tab', { name: '調整', exact: true }).click()
  await setRange(page.getByRole('slider', { name: /亮度/ }), 20)
  await page.getByRole('tab', { name: '圖層', exact: true }).click()
  await page
    .getByRole('combobox', { name: /^位置/ })
    .selectOption('bottom_right')
  await page.getByRole('combobox', { name: /樣式/ }).selectOption('paper')
  await page
    .getByLabel('工程名稱', { exact: true })
    .fill(OVERRIDES.project_name)
  await page.getByLabel('檢驗項目', { exact: true }).fill(OVERRIDES.item_name)
  await page
    .getByLabel('檢驗位置', { exact: true })
    .fill(OVERRIDES.inspection_location)
  await snap('19-office-full-edit')
  await applyOfficeEditor()

  const withLayer = await officePhotoByCaption(LIBRARY_CAPTION)
  const edit = withLayer.variants.office.edit_params
  ledger.equal(
    'AC37',
    'stored rotation / straighten / brightness',
    [edit.rotation, edit.straighten, edit.brightness],
    [90, 5, 20],
  )
  ledger.ok(
    'AC37',
    'stored crop matches the four crop sliders',
    edit.crop &&
      Math.abs(edit.crop.x - 0.1) < 0.006 &&
      Math.abs(edit.crop.y - 0.1) < 0.006 &&
      Math.abs(edit.crop.width - 0.6) < 0.006 &&
      Math.abs(edit.crop.height - 0.5) < 0.006,
    edit.crop,
  )
  ledger.equal(
    'AC02',
    'FIELD hash unchanged by office edit',
    withLayer.variants.field.sha256,
    photo.variants.field.sha256,
  )
  ledger.ok(
    'AC02',
    'OFFICE hash changed by office edit',
    withLayer.variants.office.sha256 !== photo.variants.office.sha256,
  )
  ledger.equal(
    'AC02',
    'OFFICE size follows the fixed rotate/crop rounding rule',
    {
      width: withLayer.variants.office.width,
      height: withLayer.variants.office.height,
    },
    expectedOfficeSize(withLayer.variants.field, edit),
  )
  ledger.equal(
    'AC35',
    'office layer corner / style stored',
    [withLayer.layer.corner, withLayer.layer.style, withLayer.layer.enabled],
    ['bottom_right', 'paper', true],
  )
  ledger.equal(
    'AC32',
    'three overrides stored',
    withLayer.layer.overrides,
    OVERRIDES,
  )
  ledger.equal(
    'AC34',
    'has_layer_overrides flag',
    withLayer.has_layer_overrides,
    true,
  )
  const detail = await getJson(
    `${API}/inspection-tasks/${taskIdForChecks}/photos/${withLayer.id}` +
      '?layer_history_limit=50',
  )
  ledger.ok(
    'AC36',
    'layer history records the corner change with full before/after',
    detail.layer_history.items.some(
      (item) =>
        item.before.layer.corner === 'top_right' &&
        item.after.layer.corner === 'bottom_right' &&
        item.after.layer.overrides.item_name === OVERRIDES.item_name,
    ),
    detail.layer_history.items.length,
  )
  const withLayerBytes = await getBytes(imageUrl(withLayer, 'office'))
  ledger.equal(
    'AC30',
    'image endpoint serves the stored OFFICE bytes',
    sha256(withLayerBytes),
    withLayer.variants.office.sha256,
  )
  const downloadedWithLayer = await downloadOffice(LIBRARY_CAPTION)
  ledger.equal(
    'AC30',
    'downloaded file equals stored OFFICE bytes (layer on)',
    sha256(downloadedWithLayer),
    withLayer.variants.office.sha256,
  )
  await expectPreviewMatches('AC30', LIBRARY_CAPTION, withLayer)
  await snap('20-office-full-edit-saved')

  // 重開編修器：拉直、亮度、裁切與圖層設定要讀回同值（重現）。
  await openOfficeEditor(LIBRARY_CAPTION)
  await page.getByRole('tab', { name: '裁切', exact: true }).click()
  ledger.equal(
    'AC37',
    'reopened editor shows saved straighten',
    await page.getByRole('slider', { name: /拉直/ }).inputValue(),
    '5',
  )
  ledger.ok(
    'AC37',
    'reopened editor shows saved crop width / height',
    Math.abs(
      Number(await page.locator('#office-crop-width').inputValue()) - 60,
    ) <= 0.5 &&
      Math.abs(
        Number(await page.locator('#office-crop-height').inputValue()) - 50,
      ) <= 0.5,
  )
  await page.getByRole('tab', { name: '調整', exact: true }).click()
  ledger.equal(
    'AC37',
    'reopened editor shows saved brightness',
    await page.getByRole('slider', { name: /亮度/ }).inputValue(),
    '20',
  )
  await page.getByRole('tab', { name: '圖層', exact: true }).click()
  ledger.equal(
    'AC32',
    'reopened editor shows saved overrides and layer choices',
    [
      await page.getByLabel('工程名稱', { exact: true }).inputValue(),
      await page.getByLabel('檢驗項目', { exact: true }).inputValue(),
      await page.getByLabel('檢驗位置', { exact: true }).inputValue(),
      await page.getByRole('combobox', { name: /^位置/ }).inputValue(),
      await page.getByRole('combobox', { name: /樣式/ }).inputValue(),
    ],
    [
      OVERRIDES.project_name,
      OVERRIDES.item_name,
      OVERRIDES.inspection_location,
      'bottom_right',
      'paper',
    ],
  )
  // 關閉圖層後套用並下載。
  await page.getByRole('checkbox', { name: '顯示工程標示' }).uncheck()
  await applyOfficeEditor()
  const withoutLayer = await officePhotoByCaption(LIBRARY_CAPTION)
  ledger.equal(
    'AC30',
    'layer switched off is stored',
    withoutLayer.layer.enabled,
    false,
  )
  ledger.equal(
    'AC30',
    'image edit params survive the layer toggle',
    withoutLayer.variants.office.edit_params,
    edit,
  )
  ledger.equal(
    'AC30',
    'layer never changes the output size',
    [withoutLayer.variants.office.width, withoutLayer.variants.office.height],
    [withLayer.variants.office.width, withLayer.variants.office.height],
  )
  ledger.equal(
    'AC02',
    'FIELD hash unchanged after layer toggle',
    withoutLayer.variants.field.sha256,
    photo.variants.field.sha256,
  )
  ledger.ok(
    'AC30',
    'OFFICE hash changed when the layer is removed',
    withoutLayer.variants.office.sha256 !== withLayer.variants.office.sha256,
  )
  const downloadedNoLayer = await downloadOffice(LIBRARY_CAPTION)
  ledger.equal(
    'AC30',
    'downloaded file equals stored OFFICE bytes (layer off)',
    sha256(downloadedNoLayer),
    withoutLayer.variants.office.sha256,
  )
  await expectPreviewMatches('AC30', LIBRARY_CAPTION, withoutLayer)
  await loadPixels(page, 'with-layer', { buffer: withLayerBytes })
  await loadPixels(page, 'without-layer', { buffer: downloadedNoLayer })
  ledger.corner(
    'AC35',
    'closing the layer removes only the label corner',
    await diffPixels(page, 'with-layer', 'without-layer'),
    'bottom_right',
  )
  await snap('21-office-layer-off-saved')

  // 重新開圖層：同一組參數必須逐位元重現先前的內業版。
  await openOfficeEditor(LIBRARY_CAPTION)
  await page.getByRole('tab', { name: '圖層', exact: true }).click()
  await page.getByRole('checkbox', { name: '顯示工程標示' }).check()
  await applyOfficeEditor()
  const reenabled = await officePhotoByCaption(LIBRARY_CAPTION)
  ledger.equal(
    'AC37',
    'same parameters reproduce the layer-on OFFICE bytes',
    reenabled.variants.office.sha256,
    withLayer.variants.office.sha256,
  )

  // 拉直重現：改成 0 必須不同，改回 5 必須與原版逐位元相同。
  await openOfficeEditor(LIBRARY_CAPTION)
  await page.getByRole('tab', { name: '裁切', exact: true }).click()
  await setRange(page.getByRole('slider', { name: /拉直/ }), 0)
  await applyOfficeEditor()
  const flat = await officePhotoByCaption(LIBRARY_CAPTION)
  ledger.equal(
    'AC37',
    'straighten 0 is stored',
    flat.variants.office.edit_params.straighten,
    0,
  )
  ledger.ok(
    'AC37',
    'straighten really changes the pixels',
    flat.variants.office.sha256 !== withLayer.variants.office.sha256,
  )
  await openOfficeEditor(LIBRARY_CAPTION)
  await page.getByRole('tab', { name: '裁切', exact: true }).click()
  await setRange(page.getByRole('slider', { name: /拉直/ }), 5)
  await applyOfficeEditor()
  const restored = await officePhotoByCaption(LIBRARY_CAPTION)
  ledger.equal(
    'AC37',
    'straighten 5 again reproduces the original bytes',
    restored.variants.office.sha256,
    withLayer.variants.office.sha256,
  )
  ledger.equal(
    'AC02',
    'FIELD hash still unchanged after five office edits',
    restored.variants.field.sha256,
    photo.variants.field.sha256,
  )

  // 現場關閉圖層、影像參數為預設：內業版與現場版必須同一份位元組。
  const off = await officePhotoByCaption(LAYER_OFF_CAPTION)
  const offCard = await officeCard(LAYER_OFF_CAPTION)
  await offCard.getByText('非即時拍攝', { exact: true }).waitFor()
  ledger.equal(
    'AC39',
    'camera photo without EXIF time is flagged non-realtime',
    [off.capture_source, off.is_non_realtime_capture],
    ['camera', true],
  )
  ledger.equal(
    'AC35',
    'field switch off is stored as layer disabled',
    off.layer.enabled,
    false,
  )
  ledger.equal(
    'AC30',
    'layer off with default edit keeps OFFICE bytes equal FIELD',
    off.variants.office.sha256,
    off.variants.field.sha256,
  )
  const offDownload = await downloadOffice(LAYER_OFF_CAPTION)
  ledger.equal(
    'AC30',
    'downloaded file equals FIELD bytes when layer is off',
    sha256(offDownload),
    off.variants.field.sha256,
  )
  await snap('22-office-layer-off-camera')
}

try {
  await page.goto(base)
  await installFault(page, fault)
  if (phase === 'all') await mainFlow()
  await extendedFlow()
  assert.deepEqual(errors, [])
  assert.ok(
    writes.filter((entry) => entry.method === 'POST' && entry.status === 201)
      .length >= (phase === 'all' ? 4 : 2),
  )
  assert.ok(
    writes.some((entry) => entry.method === 'PUT' && entry.status === 200),
  )
  if (phase === 'all') {
    assert.ok(
      writes.some((entry) => entry.method === 'PATCH' && entry.status === 200),
    )
    assert.ok(
      writes.some(
        (entry) =>
          entry.method === 'DELETE' && [200, 204].includes(entry.status),
      ),
    )
  }
  await writeFile(
    path.join(output, 'walkthrough.json'),
    JSON.stringify(
      {
        result: 'PASS',
        screenshots,
        retries,
        findings,
        acChecks: ledger.rows,
        phase,
        writes,
        errors,
        navigation:
          'login then UI links only; no direct task URL or API writes',
      },
      null,
      2,
    ),
  )
  console.log(`PASS (${phase}): upload → office edit → AC35～AC39 checks`)
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
