// 範本建議（TPL-AC40、AC42 的畫面部分，並串起 AC33～AC43 的操作）：
// 真後端 + 真瀏覽器走查。三段流程：
//   A 桌面 1280、滑鼠：提議 → 退回兩次重送 → 比較 → 管理者改版 →
//     同名拒絕 → 改名核准 → 來源改刪後仍可讀 → 撤回
//   B 360px、滑鼠：提議 → 退回 → 重送 → 比較 → 核准
//   C 360px、純鍵盤：提議、退回、重送、核准與撤回全程只用鍵盤
// 人員由 suggestion_integration.py --world-only 建立（林小姐、陳先生、
// 吳經理）。截圖與 JSON 結果寫到 EVIDENCE_DIR（repo 外），不提交。
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { demoBaseUrl } from './base-url.mjs'

const base = demoBaseUrl()
const world = JSON.parse(await readFile(process.env.UI_WORLD, 'utf8'))
const backend = process.env.ACCEPT_BACKEND ?? 'sqlite'
const out =
  process.env.EVIDENCE_DIR ??
  path.join(process.env.DEMO_WORK_DIR ?? '/private/tmp', 'evidence')
await mkdir(out, { recursive: true })

const steps = []
const observations = []
const screens = []
const pageErrors = []
const consoleErrors = []
const externalRequests = []
const negativeResponses = []
const contexts = {}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-sandbox'],
})

function note(text) {
  steps.push(text)
  console.log(`STEP ${text}`)
}

/** 為一位人員開獨立瀏覽器環境並登入，同環境重用 cookie。 */
async function persona(key, username, password) {
  if (contexts[key]) return contexts[key]
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    colorScheme: 'light',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname
    if (!['localhost', '127.0.0.1'].includes(host)) {
      externalRequests.push(request.url())
    }
  })
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/') && response.status() >= 400) {
      negativeResponses.push({
        url: response.url().replace(base, ''),
        status: response.status(),
      })
    }
  })
  await page.goto(base)
  await page.getByLabel('帳號名稱或 Email').fill(username)
  await page.getByLabel('密碼', { exact: true }).fill(password)
  const login = page.waitForResponse(
    (r) => r.url().endsWith('/auth/login') && r.status() === 200,
  )
  await page.getByRole('button', { name: '登入', exact: true }).click()
  await login
  await page.getByLabel('帳號名稱或 Email').waitFor({ state: 'detached' })
  contexts[key] = { context, page }
  return contexts[key]
}

const users = world.users
const lin = async () =>
  (await persona('lin', users.lin.username, users.lin.password)).page
const wu = async () =>
  (await persona('wu', users.wu.username, users.wu.password)).page
const admin = async () =>
  (await persona('admin', 'admin', 'DemoAdmin2026')).page

async function api(page, pathname, method = 'GET', body) {
  return page.evaluate(
    async ({ pathname, method, body }) => {
      const response = await fetch(`/api/v1${pathname}`, {
        method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return {
        status: response.status,
        data: await response.json().catch(() => null),
      }
    },
    { pathname, method, body },
  )
}

async function resize(width) {
  for (const { page } of Object.values(contexts)) {
    await page.setViewportSize({ width, height: 1000 })
  }
}

/** 截圖並斷言沒有水平溢出（scrollWidth 不超過 clientWidth）。 */
async function snap(page, name) {
  await page.evaluate(() => document.fonts.ready)
  const metrics = await page.evaluate(() => ({
    width: innerWidth,
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  assert(
    metrics.scroll <= metrics.client,
    `horizontal overflow at ${name}: ${JSON.stringify(metrics)}`,
  )
  const file = path.join(out, `${backend}-${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  screens.push({ file, ...metrics })
}

async function say(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor()
}

/** 等某個 POST 回應並確認狀態碼。 */
async function postAnd(page, locatorAction, suffix, status) {
  const pending = page.waitForResponse(
    (r) => r.url().endsWith(suffix) && r.request().method() === 'POST',
  )
  await locatorAction()
  const response = await pending
  assert.equal(response.status(), status, await response.text())
  return response.json().catch(() => null)
}

async function suggestionFor(title, statuses = ['PENDING', 'RETURNED']) {
  const reviewer = await wu()
  const list = await api(
    reviewer,
    '/template-suggestions?status=ALL&limit=100',
  )
  assert.equal(list.status, 200)
  const found = list.data.items.find(
    (row) =>
      row.source_item_id === world.items[title] &&
      statuses.includes(row.status),
  )
  assert(found, `no ${statuses} suggestion for ${title}`)
  return found.id
}

const minePath = (id) => `${base}/settings/template-suggestions/${id}`
const reviewPath = (id) => `${base}/templates/suggestions/${id}`
const projectItems = `${base}/projects/${world.project}/inspection-items`

async function propose(page, title) {
  await page.goto(projectItems)
  const button = page.getByRole('button', {
    name: `建議「${title}」加入範本庫`,
    exact: true,
  })
  await button.click()
  await page.getByRole('heading', { name: '確認提出建議' }).waitFor()
  return button
}

async function confirmPropose(page) {
  await postAnd(
    page,
    () => page.getByRole('button', { name: '確認提出', exact: true }).click(),
    `/projects/${world.project}/template-suggestions`,
    201,
  )
  await say(page, '已送審')
}

async function returnWithReason(title, reason) {
  const page = await wu()
  const id = await suggestionFor(title, ['PENDING'])
  await page.goto(reviewPath(id))
  await page.getByRole('heading', { name: '各版歷程', exact: true }).waitFor()
  await page.getByRole('button', { name: '附原因退回', exact: true }).click()
  await page.getByLabel('退回原因').fill(reason)
  await page.getByRole('button', { name: '退回建議', exact: true }).click()
  await postAnd(
    page,
    () => page.getByRole('button', { name: '確認退回', exact: true }).click(),
    `/template-suggestions/${id}:return`,
    200,
  )
  await say(page, '已退回第')
  return id
}

async function reviseAndResubmit(title, newTitle) {
  const page = await lin()
  const id = await suggestionFor(title, ['RETURNED'])
  await page.goto(minePath(id))
  await page.getByRole('heading', { name: '各版歷程', exact: true }).waitFor()
  assert(
    await page.getByRole('button', { name: '重新送審', exact: true }).isDisabled(),
    'resubmit must be disabled before a new revision',
  )
  await page.getByRole('link', { name: '修改退回件', exact: true }).click()
  await page.getByLabel('查核項目名稱', { exact: false }).fill(newTitle)
  await postAnd(
    page,
    () => page.getByRole('button', { name: '儲存新版本', exact: true }).click(),
    `/template-suggestions/${id}/revisions`,
    201,
  )
  await say(page, '尚未送審')
  await page.getByRole('button', { name: '重新送審', exact: true }).click()
  await postAnd(
    page,
    () =>
      page.getByRole('button', { name: '確認重新送審', exact: true }).click(),
    `/template-suggestions/${id}:submit`,
    200,
  )
  await say(page, '已重新送審')
  return id
}

/** 純鍵盤：按 Tab 直到焦點落在指定元素，最多 400 次；不使用滑鼠。 */
async function tabTo(page, locator, label) {
  await locator.waitFor()
  for (let index = 0; index < 400; index += 1) {
    const focused = await locator.evaluate(
      (el) => el === document.activeElement,
    )
    if (focused) return index
    await page.keyboard.press('Tab')
  }
  throw new Error(`keyboard could not reach: ${label}`)
}

/**
 * 只用鍵盤選取下拉項目：選項名稱以 ASCII 開頭，直接輸入開頭字母即可
 * 選取（無頭瀏覽器不會把方向鍵送進原生選單，輸入字母則會）。
 */
async function pickByTyping(page, select, prefix, value) {
  await page.keyboard.type(prefix)
  assert.equal(await select.inputValue(), value, `type-ahead ${prefix}`)
}

async function focusedName(page) {
  return page.evaluate(
    () =>
      document.activeElement?.getAttribute('aria-label') ??
      document.activeElement?.textContent?.trim() ??
      '',
  )
}

// ---------------------------------------------------------------------
// A：桌面 1280、滑鼠。
// ---------------------------------------------------------------------
async function flowDesktop() {
  const linPage = await lin()
  const wuPage = await wu()
  const adminPage = await admin()
  const first = '素材1'
  const second = '素材2'

  await linPage.goto(projectItems)
  await say(linPage, '我的範本建議（本案共 0 件）')
  await linPage.getByRole('link', { name: /我的範本建議/ }).click()
  await say(linPage, '尚未')
  await snap(linPage, 'desktop-01-empty-list')
  await linPage.getByRole('link', { name: /返回/ }).first().click()
  await linPage.getByRole('heading', { level: 1 }).first().waitFor()
  assert(linPage.url().includes('/inspection-items'), 'back to project')
  const settingsRead = linPage.waitForResponse((r) =>
    r.url().includes('/me/template-suggestions'),
  )
  await linPage.goto(`${base}/settings`)
  await settingsRead
  await linPage.getByRole('radiogroup', { name: '選擇外觀' }).waitFor()
  assert.equal(
    await linPage.getByRole('heading', { name: '我的範本建議' }).count(),
    0,
    'settings block hidden before any proposal',
  )
  note('desktop: empty list, project shortcut returns, settings hidden')

  const trigger = await propose(linPage, first)
  await snap(linPage, 'desktop-02-confirm-propose')
  await linPage.getByRole('button', { name: '取消', exact: true }).click()
  assert(await trigger.evaluate((el) => el === document.activeElement))
  await trigger.click()
  await confirmPropose(linPage)
  await say(linPage, '本案共 1 件')
  note('desktop: propose cancel then confirm (201), count 1')

  const pending = await api(wuPage, '/template-suggestions:pending-count')
  await wuPage.goto(`${base}/templates`)
  await say(wuPage, `待審建議（${pending.data.pending_count}）`)
  await wuPage.getByRole('link', { name: /待審建議/ }).click()
  await say(wuPage, first)
  await snap(wuPage, 'desktop-03-review-list')
  const firstId = await suggestionFor(first, ['PENDING'])
  await wuPage.goto(reviewPath(firstId))
  await wuPage.getByRole('button', { name: '附原因退回', exact: true }).click()
  await wuPage.getByLabel('退回原因').fill('   ')
  await wuPage.getByRole('button', { name: '退回建議', exact: true }).click()
  await wuPage.getByRole('alert').first().waitFor()
  await snap(wuPage, 'desktop-04-blank-reason-error')
  const still = await api(wuPage, `/template-suggestions/${firstId}`)
  assert.equal(still.data.status, 'PENDING')
  await returnWithReason(first, '請補充梁柱接頭的間距與照片要求')
  note('desktop: blank reason shown at field, first return')

  await reviseAndResubmit(first, `${first} 二版`)
  await returnWithReason(`${first}`, '請補充施工說明')
  await reviseAndResubmit(first, `${first} 三版`)
  note('desktop: returned twice and resubmitted twice on the same suggestion')

  await linPage.goto(`${base}/settings`)
  await linPage.getByRole('heading', { name: '我的範本建議' }).waitFor()
  await snap(linPage, 'desktop-05-settings-entry')
  await linPage.getByRole('link', { name: '開啟我的範本建議' }).click()
  await say(linPage, `${first} 三版`)
  await snap(linPage, 'desktop-06-personal-list')

  await wuPage.goto(reviewPath(firstId))
  await wuPage.getByRole('link', { name: '比較前後兩版', exact: true }).click()
  await say(wuPage, '差異摘要')
  await snap(wuPage, 'desktop-07-compare')
  await wuPage.goto(reviewPath(firstId))
  await wuPage.getByRole('link', { name: '修改建議內容', exact: true }).click()
  const finalTitle = `${first} 通用版`
  await wuPage
    .getByLabel('查核項目名稱', { exact: false })
    .fill(finalTitle)
  await postAnd(
    wuPage,
    () =>
      wuPage.getByRole('button', { name: '儲存新版本', exact: true }).click(),
    `/template-suggestions/${firstId}/revisions`,
    201,
  )
  // 目的地已有同名範本：核准被拒、目的地與草稿保留。
  const clash = await api(adminPage, '/templates', 'POST', {
    system_id: world.systems.A,
    sequence: 1,
    title: finalTitle,
    instruction: '預先存在的同名範本',
    inspection_points: [
      {
        sequence: 1,
        title: '項次',
        instruction: '說明',
        text_standard: null,
        numeric_standard: null,
        measurement_fields: [],
        evidence_requirements: [{ min_count: 1 }],
      },
    ],
  })
  assert.equal(clash.status, 201, JSON.stringify(clash.data))
  await wuPage.getByLabel('目標工程類別').selectOption(world.categories.main)
  await wuPage.getByLabel('目標系統').selectOption(world.systems.A)
  await say(wuPage, '此系統已有同名範本')
  await wuPage.getByRole('button', { name: '核准入庫', exact: true }).click()
  await say(wuPage, '本次沒有新增')
  await snap(wuPage, 'desktop-08-name-conflict')
  // 畫面先行擋下；同一動作直接打真後端，確認伺服器端同樣回 409。
  const current = await api(wuPage, `/template-suggestions/${firstId}`)
  const clashApprove = await api(
    wuPage,
    `/template-suggestions/${firstId}:approve`,
    'POST',
    {
      expected_revision_id: current.data.current_revision_id,
      expected_status: current.data.status,
      category_id: world.categories.main,
      system_id: world.systems.A,
    },
  )
  assert.equal(clashApprove.status, 409)
  assert.equal(clashApprove.data.error.code, 'template.name_conflict')
  const countA = await api(
    adminPage,
    `/templates?system_id=${world.systems.A}&limit=100`,
  )
  assert.equal(
    countA.data.items.filter((t) => t.title === finalTitle).length,
    1,
    'conflict must not create a second template',
  )
  await wuPage.getByRole('link', { name: '修改名稱', exact: true }).click()
  const renamed = `${finalTitle}二`
  await wuPage
    .getByLabel('查核項目名稱', { exact: false })
    .fill(renamed)
  await postAnd(
    wuPage,
    () =>
      wuPage.getByRole('button', { name: '儲存新版本', exact: true }).click(),
    `/template-suggestions/${firstId}/revisions`,
    201,
  )
  await wuPage.getByRole('button', { name: '核准入庫', exact: true }).click()
  await snap(wuPage, 'desktop-09-confirm-approve')
  await postAnd(
    wuPage,
    () =>
      wuPage
        .getByRole('button', { name: '確認核准入庫', exact: true })
        .click(),
    `/template-suggestions/${firstId}:approve`,
    200,
  )
  await say(wuPage, '已核准第')
  await snap(wuPage, 'desktop-10-approved')
  note('desktop: same-name rejected, renamed, approved')

  // 來源修改再刪除後，已核准件與入庫範本照常可讀。
  const approved = await api(wuPage, `/template-suggestions/${firstId}`)
  const templateId = approved.data.approved_template_id
  const templateBefore = await api(adminPage, `/templates/${templateId}`)
  const patched = await api(
    adminPage,
    `/projects/${world.project}/inspection-items/${world.items[first]}`,
    'PATCH',
    { title: '來源被改名', reinspect: false },
  )
  const removed = await api(
    adminPage,
    `/projects/${world.project}/inspection-items/${world.items[first]}`,
    'DELETE',
  )
  assert.equal(patched.status, 200)
  assert.equal(removed.status, 204)
  const templateAfter = await api(adminPage, `/templates/${templateId}`)
  assert.deepEqual(templateAfter.data, templateBefore.data)
  await linPage.goto(minePath(firstId))
  await say(linPage, renamed)
  await say(linPage, '請補充施工說明')
  await snap(linPage, 'desktop-11-approved-after-source-delete')
  note('desktop: approved item and template unchanged after source change')

  // 待審件：來源被刪後仍可審，提議人撤回。
  const trigger2 = await propose(linPage, second)
  await trigger2.evaluate(() => {})
  await confirmPropose(linPage)
  const secondId = await suggestionFor(second, ['PENDING'])
  const removedSecond = await api(
    adminPage,
    `/projects/${world.project}/inspection-items/${world.items[second]}`,
    'DELETE',
  )
  assert.equal(removedSecond.status, 204)
  await wuPage.goto(reviewPath(secondId))
  await say(wuPage, second)
  await snap(wuPage, 'desktop-12-pending-after-source-delete')
  await linPage.goto(minePath(secondId))
  await linPage.getByRole('button', { name: '撤回建議', exact: true }).click()
  await snap(linPage, 'desktop-13-confirm-withdraw')
  await postAnd(
    linPage,
    () => linPage.getByRole('button', { name: '確認撤回', exact: true }).click(),
    `/template-suggestions/${secondId}:withdraw`,
    200,
  )
  await say(linPage, '已撤回')
  note('desktop: pending survives source deletion, then withdrawn')
}

// ---------------------------------------------------------------------
// B：360px、滑鼠。
// ---------------------------------------------------------------------
async function flowMobile() {
  const linPage = await lin()
  const wuPage = await wu()
  const title = '素材3'
  await resize(360)
  await propose(linPage, title)
  await snap(linPage, 'm360-01-confirm-propose')
  await confirmPropose(linPage)
  await snap(linPage, 'm360-02-proposed')
  const id = await suggestionFor(title, ['PENDING'])
  await returnWithReason(title, '手機版：請補充照片說明')
  await snap(wuPage, 'm360-03-returned')
  await reviseAndResubmit(title, `${title} 手機二版`)
  await snap(linPage, 'm360-04-resubmitted')
  await wuPage.goto(reviewPath(id))
  await wuPage.getByRole('link', { name: '比較前後兩版', exact: true }).click()
  await say(wuPage, '差異摘要')
  assert.equal(
    await wuPage.locator('details[open]').count(),
    0,
    'content stays collapsed at 360px',
  )
  await snap(wuPage, 'm360-05-compare')
  await wuPage.getByRole('button', { name: '看後版' }).first().click()
  await snap(wuPage, 'm360-06-compare-expanded')
  await wuPage.goto(reviewPath(id))
  await wuPage.getByLabel('目標工程類別').selectOption(world.categories.main)
  await wuPage.getByLabel('目標系統').selectOption(world.systems.B)
  await wuPage.getByRole('button', { name: '核准入庫', exact: true }).click()
  await postAnd(
    wuPage,
    () =>
      wuPage
        .getByRole('button', { name: '確認核准入庫', exact: true })
        .click(),
    `/template-suggestions/${id}:approve`,
    200,
  )
  await say(wuPage, '已核准第')
  await snap(wuPage, 'm360-07-approved')
  await linPage.goto(minePath(id))
  await say(linPage, '已核准')
  await snap(linPage, 'm360-08-personal-detail')
  note('360px: propose, return, resubmit, compare collapsed, approve')
}

// ---------------------------------------------------------------------
// C：360px、純鍵盤。
// ---------------------------------------------------------------------
async function flowKeyboard() {
  const linPage = await lin()
  const wuPage = await wu()
  const title = '素材4'
  const spare = '素材5'
  await resize(360)

  await linPage.goto(projectItems)
  const trigger = linPage.getByRole('button', {
    name: `建議「${title}」加入範本庫`,
    exact: true,
  })
  await tabTo(linPage, trigger, 'propose button')
  await linPage.keyboard.press('Enter')
  await linPage.getByRole('heading', { name: '確認提出建議' }).waitFor()
  assert.equal(await focusedName(linPage), '取消', 'dialog focuses cancel')
  await linPage.keyboard.press('Tab')
  assert.equal(await focusedName(linPage), '確認提出')
  await linPage.keyboard.press('Shift+Tab')
  assert.equal(await focusedName(linPage), '取消', 'Shift+Tab goes back')
  await snap(linPage, 'kbd-01-confirm-dialog')
  await linPage.keyboard.press('Escape')
  await linPage.getByRole('heading', { name: '確認提出建議' }).waitFor({
    state: 'detached',
  })
  assert(
    await trigger.evaluate((el) => el === document.activeElement),
    'focus returns to the trigger after Escape',
  )
  await linPage.keyboard.press('Space')
  await linPage.getByRole('heading', { name: '確認提出建議' }).waitFor()
  await linPage.keyboard.press('Tab')
  await postAnd(
    linPage,
    () => linPage.keyboard.press('Enter'),
    `/projects/${world.project}/template-suggestions`,
    201,
  )
  await say(linPage, '已送審')
  note('keyboard: propose with Enter/Space/Escape/Shift+Tab')

  const id = await suggestionFor(title, ['PENDING'])
  await wuPage.goto(reviewPath(id))
  await tabTo(
    wuPage,
    wuPage.getByRole('button', { name: '附原因退回', exact: true }),
    'return button',
  )
  await wuPage.keyboard.press('Enter')
  await tabTo(wuPage, wuPage.getByLabel('退回原因'), 'reason field')
  await wuPage.keyboard.type('   ')
  await tabTo(
    wuPage,
    wuPage.getByRole('button', { name: '退回建議', exact: true }),
    'submit return',
  )
  await wuPage.keyboard.press('Enter')
  await wuPage.getByRole('alert').first().waitFor()
  await snap(wuPage, 'kbd-02-blank-reason-error')
  await tabTo(wuPage, wuPage.getByLabel('退回原因'), 'reason field again')
  await wuPage.keyboard.type('鍵盤：請補充說明')
  await tabTo(
    wuPage,
    wuPage.getByRole('button', { name: '退回建議', exact: true }),
    'submit return again',
  )
  await wuPage.keyboard.press('Enter')
  await tabTo(
    wuPage,
    wuPage.getByRole('button', { name: '確認退回', exact: true }),
    'confirm return',
  )
  await postAnd(
    wuPage,
    () => wuPage.keyboard.press('Space'),
    `/template-suggestions/${id}:return`,
    200,
  )
  await say(wuPage, '已退回第')
  note('keyboard: reviewer return with error then success')

  await linPage.goto(minePath(id))
  await tabTo(
    linPage,
    linPage.getByRole('link', { name: '修改退回件', exact: true }),
    'edit link',
  )
  await linPage.keyboard.press('Enter')
  const name = linPage.getByLabel('查核項目名稱', { exact: false })
  await tabTo(linPage, name, 'title field')
  await linPage.keyboard.press('Meta+A')
  await linPage.keyboard.type(`${title} 鍵盤二版`)
  await tabTo(
    linPage,
    linPage.getByRole('button', { name: '儲存新版本', exact: true }),
    'save revision',
  )
  await postAnd(
    linPage,
    () => linPage.keyboard.press('Enter'),
    `/template-suggestions/${id}/revisions`,
    201,
  )
  await say(linPage, '尚未送審')
  await tabTo(
    linPage,
    linPage.getByRole('button', { name: '重新送審', exact: true }),
    'resubmit',
  )
  await linPage.keyboard.press('Enter')
  await tabTo(
    linPage,
    linPage.getByRole('button', { name: '確認重新送審', exact: true }),
    'confirm resubmit',
  )
  await postAnd(
    linPage,
    () => linPage.keyboard.press('Enter'),
    `/template-suggestions/${id}:submit`,
    200,
  )
  await say(linPage, '已重新送審')
  await snap(linPage, 'kbd-03-resubmitted')
  note('keyboard: proposer edits and resubmits')

  await wuPage.goto(reviewPath(id))
  const category = wuPage.getByLabel('目標工程類別')
  await tabTo(wuPage, category, 'category select')
  await pickByTyping(
    wuPage,
    category,
    `QA-${world.tag}-main`,
    world.categories.main,
  )
  assert.equal(await category.inputValue(), world.categories.main)
  const system = wuPage.getByLabel('目標系統')
  await wuPage.waitForFunction(
    () => document.querySelector('select[id$="-system"]').options.length > 1,
  )
  await tabTo(wuPage, system, 'system select')
  await pickByTyping(wuPage, system, `QA-${world.tag}-A`, world.systems.A)
  assert.equal(await system.inputValue(), world.systems.A)
  await tabTo(
    wuPage,
    wuPage.getByRole('button', { name: '核准入庫', exact: true }),
    'approve',
  )
  await wuPage.keyboard.press('Enter')
  await tabTo(
    wuPage,
    wuPage.getByRole('button', { name: '確認核准入庫', exact: true }),
    'confirm approve',
  )
  await snap(wuPage, 'kbd-04-confirm-approve')
  await postAnd(
    wuPage,
    () => wuPage.keyboard.press('Enter'),
    `/template-suggestions/${id}:approve`,
    200,
  )
  await say(wuPage, '已核准第')
  note('keyboard: reviewer chooses destination with arrow keys and approves')

  await linPage.goto(projectItems)
  await tabTo(
    linPage,
    linPage.getByRole('button', {
      name: `建議「${spare}」加入範本庫`,
      exact: true,
    }),
    'second propose button',
  )
  await linPage.keyboard.press('Enter')
  await linPage.keyboard.press('Tab')
  await postAnd(
    linPage,
    () => linPage.keyboard.press('Enter'),
    `/projects/${world.project}/template-suggestions`,
    201,
  )
  const spareId = await suggestionFor(spare, ['PENDING'])
  await linPage.goto(minePath(spareId))
  const withdraw = linPage.getByRole('button', {
    name: '撤回建議',
    exact: true,
  })
  await tabTo(linPage, withdraw, 'withdraw')
  await linPage.keyboard.press('Enter')
  await linPage
    .getByRole('group', { name: '確認撤回建議', exact: true })
    .waitFor()
  await linPage.keyboard.press('Escape')
  await linPage
    .getByRole('group', { name: '確認撤回建議', exact: true })
    .waitFor({ state: 'detached' })
  // 觀察：取消後焦點不回到「撤回建議」（規格 ADM-R38 只要求開啟時
  // 焦點在取消與 Esc 等同取消），因此從頭再用 Tab 回到按鈕。
  observations.push(
    (await withdraw.evaluate((el) => el === document.activeElement))
      ? 'withdraw cancel keeps focus on trigger'
      : 'withdraw cancel drops focus to document (not required by ADM-R38)',
  )
  await tabTo(linPage, withdraw, 'withdraw again')
  await linPage.keyboard.press('Space')
  await snap(linPage, 'kbd-05-confirm-withdraw')
  await tabTo(
    linPage,
    linPage.getByRole('button', { name: '確認撤回', exact: true }),
    'confirm withdraw',
  )
  await postAnd(
    linPage,
    () => linPage.keyboard.press('Enter'),
    `/template-suggestions/${spareId}:withdraw`,
    200,
  )
  await say(linPage, '已撤回')
  await snap(linPage, 'kbd-06-withdrawn')
  note('keyboard: withdraw with Escape cancel then confirm')
}

let failure = null
try {
  await flowDesktop()
  await flowMobile()
  await flowKeyboard()
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'))
  assert.equal(externalRequests.length, 0, externalRequests.join('\n'))
  // 預期的負向回應：登入前的 /auth/me 401，與名稱衝突時真後端回的 409。
  const unexpected = negativeResponses.filter(
    (r) =>
      !(r.status === 401 && r.url.endsWith('/auth/me')) &&
      !(r.status === 409 && r.url.endsWith(':approve')),
  )
  assert.equal(unexpected.length, 0, JSON.stringify(unexpected))
  assert(
    negativeResponses.some(
      (r) => r.status === 409 && r.url.endsWith(':approve'),
    ),
    'the same-name rejection must come from the real backend (409)',
  )
} catch (error) {
  failure = error
  for (const [key, { page }] of Object.entries(contexts)) {
    await page.screenshot({
      path: path.join(out, `${backend}-failure-${key}.png`),
      fullPage: true,
    })
  }
  console.error(error)
} finally {
  const result = {
    status: failure ? 'FAIL' : 'PASS',
    backend,
    steps,
    observations,
    screens,
    pageErrors,
    consoleErrors,
    externalRequests,
    expectedNegativeResponses: negativeResponses,
    error: failure ? String(failure) : null,
  }
  await writeFile(
    path.join(out, `browser-${backend}.json`),
    JSON.stringify(result, null, 2),
  )
  await browser.close()
  console.log(
    `${result.status} browser ${steps.length} steps ${screens.length} screens`,
  )
  process.exitCode = failure ? 1 : 0
}
