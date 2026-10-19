import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
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
const accounts = {
  office: ['demo-office', 'DemoOffice2026'],
  field: ['demo-field-a', 'DemoFieldA2026'],
  admin: ['admin', 'DemoAdmin2026'],
}
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-sandbox'],
})
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
})
page.setDefaultTimeout(15000)
page.on('pageerror', (error) => console.error('browser error:', error))
page.on('requestfailed', (request) => {
  console.error('request failed:', request.url(), request.failure()?.errorText)
})

async function signIn(key) {
  const [username, password] = accounts[key]
  await page.context().clearCookies()
  await page.goto(base)
  await page.getByLabel('帳號名稱或 Email').fill(username)
  await page.getByLabel('密碼').fill(password)
  await page.getByRole('button', { name: '登入' }).click()
  const landing = {
    office: '/projects',
    field: '/tasks',
    admin: '/overview',
  }[key]
  await page.waitForURL((url) => url.pathname === landing)
}

async function saveScreenshot(name) {
  const directory = path.join(demo, 'screenshots')
  await mkdir(directory, { recursive: true })
  await page.screenshot({
    path: path.join(directory, name),
    fullPage: true,
  })
}

try {
  await signIn('office')
  await page.getByRole('link', { name: '專案', exact: true }).click()
  const projectCard = page.locator('article').filter({
    hasText: '示範廠擴建機電工程',
  })
  await projectCard.getByRole('link', { name: '開啟專案' }).click()
  await page.getByRole('link', { name: '計畫與任務' }).click()
  await page.getByRole('heading', { name: '計畫與任務' }).waitFor()
  await page.getByRole('button', {
    name: '示範廠擴建機電工程查核計畫',
  }).click()
  await page.getByText('擴建廠機房派工示範').waitFor()
  const walkthrough = page.locator('article').filter({
    hasText: '擴建廠機房派工示範',
  })
  await walkthrough.getByRole('button', { name: '派出任務' }).click()
  await page.getByRole('button', { name: '確認' }).click()
  await page.getByText('已派出任務，現場可以查看了。').waitFor()
  await saveScreenshot('01-office-dispatch.png')

  await signIn('field')
  await page.getByText('擴建廠機房派工示範').click()
  await page.getByRole('heading', { name: '排水橫管坡度' }).waitFor()
  await saveScreenshot('02-field-task-detail.png')
  await page.getByRole('button', { name: '開始查核' }).click()
  await page.getByRole('button', { name: '確認' }).click()
  await page.getByText('進行中').waitFor()
  await saveScreenshot('03-field-task-started.png')

  await signIn('admin')
  await page.getByRole('link', { name: '總覽', exact: true }).click()
  await page.getByRole('heading', { name: '專案進度總覽' }).waitFor()
  await assertDashboard(page)
  await saveScreenshot('04-dashboard-progress.png')
  await page.getByRole('tab', { name: '工程師工作量' }).click()
  await page.getByText('吳怡君').waitFor()
  await saveScreenshot('05-dashboard-workload.png')

  process.stdout.write(JSON.stringify({
    result: 'PASS',
    browser: 'Google Chrome via Playwright',
    project: result.projects.B,
    walkthrough_task: result.tasks.B_walkthrough,
    screenshots: 5,
  }, null, 2) + '\n')
} finally {
  await browser.close()
}

async function assertDashboard(currentPage) {
  await currentPage.getByText('已完成').first().waitFor()
  await currentPage.getByRole('tab', { name: '專案進度' }).waitFor()
  assert.ok(result.tasks.B_completed)
  assert.ok(result.tasks.B_walkthrough)
  const dashboard = await currentPage.locator('main').innerText()
  assert.match(dashboard, /進行中\s*[1-9]/)
  assert.match(dashboard, /已完成\s*[1-9]/)
}
