import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { demoBaseUrl } from './base-url.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const demo = path.resolve(here, '..')
const base = demoBaseUrl()
const work = process.env.DEMO_WORK_DIR ?? '/private/tmp/inspectflow-demo-e2e'
const result = JSON.parse(
  await readFile(path.join(work, 'seed-result.json'), 'utf8'),
)
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-sandbox'],
})
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
})
page.setDefaultTimeout(15000)

async function signIn(username, password) {
  await page.context().clearCookies()
  await page.goto(base)
  await page.getByLabel('帳號名稱或 Email').fill(username)
  await page.getByLabel('密碼').fill(password)
  const loginResponse = page.waitForResponse(
    (response) => response.url().endsWith('/auth/login'),
  )
  await page.getByRole('button', { name: '登入' }).click()
  assert.equal((await loginResponse).status(), 200)
  await page.getByLabel('帳號名稱或 Email').waitFor({ state: 'detached' })
}

async function api(pathname, method = 'GET', body) {
  return page.evaluate(async ({ pathname, method, body }) => {
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
  }, { pathname, method, body })
}

async function openApply(projectName) {
  await page.getByRole('link', { name: '專案', exact: true }).click()
  const project = page.locator('article').filter({ hasText: projectName })
  await project.getByRole('link', { name: '套用範本' }).click()
  await page.getByRole('heading', { name: '套用範本到專案' }).waitFor()
}

async function selectElectricalSystem() {
  await page.getByRole('button', { name: '建築工程' }).click()
  await page.getByRole('button', { name: '電氣設備' }).click()
  await page.getByRole('heading', {
    name: '套用範本：電氣設備',
  }).waitFor()
}

try {
  await signIn('demo-office', 'DemoOffice2026')
  await openApply('示範廠擴建機電工程')
  await selectElectricalSystem()
  await page.getByRole('radio', { name: /整個系統/ }).check()
  await page.getByRole('button', { name: '套用至專案' }).click()
  const applyResponse = page.waitForResponse(
    (response) => response.url().includes('apply-template'),
  )
  await page.getByRole('button', { name: '確定套用' }).click()
  const appliedResponse = await applyResponse
  assert.equal(appliedResponse.status(), 201)
  const applyResult = await appliedResponse.json()
  assert.equal(applyResult.length, 2)
  await page.getByText('已新增 2 個項目到').waitFor()
  await page.getByText('配電盤外觀檢查').waitFor()
  await page.getByText('接地電阻量測', { exact: true }).waitFor()
  await page.screenshot({
    path: path.join(demo, 'screenshots/07-template-system-applied.png'),
    fullPage: true,
  })

  const categories = await api('/template-categories')
  assert.equal(categories.status, 200)
  const category = categories.data.items.find(
    (item) => item.name === '建築工程',
  )
  const systems = await api(
    `/template-categories/${category.id}/systems`,
  )
  const electrical = systems.data.items.find(
    (item) => item.name === '電氣設備',
  )
  const templatePage = await api(
    `/template-systems/${electrical.id}/templates`,
  )
  const resistance = templatePage.data.items.find(
    (item) => item.title === '接地電阻量測',
  )
  const resistancePoint = resistance.inspection_points[0]
  const resistanceField = resistancePoint.measurement_fields[0]
  assert.equal(resistancePoint.numeric_standard.measurement_field_id,
    resistanceField.id)
  assert.equal(resistanceField.unit, 'Ω')
  assert.equal(resistancePoint.numeric_standard.unit, 'Ω')
  assert.equal(resistancePoint.numeric_standard.range_form, 'interval')
  const beforeDuplicate = await api(
    `/projects/${result.projects.B}/inspection-items`,
  )
  const duplicate = await api(
    `/projects/${result.projects.B}/inspection-items:apply-template`,
    'POST',
    { system_id: electrical.id },
  )
  assert.equal(duplicate.status, 409)
  assert.match(JSON.stringify(duplicate.data), /duplicate_name/)
  const afterDuplicate = await api(
    `/projects/${result.projects.B}/inspection-items`,
  )
  assert.equal(
    afterDuplicate.data.items.length,
    beforeDuplicate.data.items.length,
  )

  await page.getByRole('link', { name: '專案', exact: true }).click()
  const projectA = page.locator('article').filter({
    hasText: '示範大樓機電工程',
  })
  await projectA.getByRole('link', { name: '套用範本' }).click()
  await page.getByRole('heading', { name: '套用範本到專案' }).waitFor()
  await selectElectricalSystem()
  await page.getByRole('radio', {
    name: '單一項目：接地電阻量測',
  }).check()
  const singleApplyResponse = page.waitForResponse(
    (response) => response.url().includes('apply-template'),
  )
  await page.getByRole('button', { name: '套用至專案' }).click()
  assert.equal((await singleApplyResponse).status(), 201)
  await page.getByText('已新增 1 個項目到').waitFor()
  await page.getByText('接地電阻量測', { exact: true }).waitFor()
  const copiedItems = await api(
    `/projects/${result.projects.A}/inspection-items`,
  )
  const copiedResistance = copiedItems.data.items.find(
    (item) => item.title === '接地電阻量測',
  )
  const copiedPoint = copiedResistance.inspection_points[0]
  assert.equal(
    copiedPoint.numeric_standard.measurement_field_id,
    copiedPoint.measurement_fields[0].id,
  )
  assert.equal(copiedPoint.measurement_fields[0].unit, 'Ω')

  await signIn('admin', 'DemoAdmin2026')
  await page.getByRole('link', { name: '專案', exact: true }).click()
  const projectB = page.locator('article').filter({
    hasText: '示範廠擴建機電工程',
  })
  await projectB.getByRole('link', { name: '套用範本' }).click()
  await page.getByRole('heading', { name: '套用範本到專案' }).waitFor()
  const sourceItem = page.locator('.tpl-project-items li').filter({
    hasText: '接地電阻量測',
  })
  await sourceItem.getByRole('button', { name: '存為範本' }).click()
  await page.getByRole('button', { name: '建築工程' }).click()
  await page.getByRole('button', { name: '電氣設備' }).click()
  await page.getByRole('button', { name: '存入這個系統' }).click()
  await page.getByRole('alert').getByText(
    /已有「接地電阻量測」/,
  ).waitFor()
  await page.screenshot({
    path: path.join(demo, 'screenshots/08-template-name-conflict.png'),
    fullPage: true,
  })

  await signIn('demo-consultant', 'DemoConsultant2026')
  const externalProjectCards = page.locator('article')
  await page.getByRole('link', { name: '專案', exact: true }).click()
  const externalProject = externalProjectCards.filter({
    hasText: '示範廠擴建機電工程',
  })
  await externalProject.getByRole('link', { name: '開啟專案' }).waitFor()
  await externalProject.getByRole('link', { name: '套用範本' }).waitFor({
    state: 'detached',
  })
  assert.equal(
    await page.getByRole('link', { name: '範本', exact: true }).count(),
    0,
  )
  await page.goto(`${base}/templates`)
  await page.getByRole('heading', { name: '無權限' }).waitFor()
  await page.getByText('你沒有使用這個頁面的權限。').waitFor()
  await page.goto(
    `${base}/projects/${result.projects.B}/inspection-items/templates`,
  )
  await page.getByRole('heading', { name: '套用範本到專案' }).waitFor()
  // 外部協作只能唯讀瀏覽：先選到系統，再確認沒有套用入口並說明原因。
  await selectElectricalSystem()
  await page.getByText('你沒有修改此專案查核項目的權限。').waitFor()
  assert.equal(
    await page.getByRole('button', { name: '套用至專案' }).count(),
    0,
  )
  assert.equal(await api('/template-categories').then((r) => r.status), 200)
  const deniedWrite = await api('/template-categories', 'POST', {
    name: '不應建立的外部範本類別',
  })
  assert.equal(deniedWrite.status, 403)
  const deniedApply = await api(
    `/projects/${result.projects.B}/inspection-items:apply-template`,
    'POST',
    { system_id: electrical.id },
  )
  assert.equal(deniedApply.status, 403)

  await signIn('demo-field-b', 'DemoFieldB2026')
  const noTemplateAccess = await api('/template-categories')
  assert.equal(noTemplateAccess.status, 403)

  process.stdout.write(JSON.stringify({
    result: 'PASS',
    browser: 'Google Chrome via Playwright',
    wholeSystem: 'two items applied from the demo-office project route',
    singleItem: 'bound numeric field and unit applied from the UI',
    duplicate: 'real API returned 409 without partial writes',
    saveConflict: 'real API conflict visible in the Admin UI',
    external: 'library readable; template write and project apply denied',
    noTemplateModule: 'template library API returned 403',
  }, null, 2) + '\n')
} finally {
  await browser.close()
}
