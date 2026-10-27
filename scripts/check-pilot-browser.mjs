// DPL-AC10：僅對本機測試部署做 HTTPS、子路徑與登入流程驗收。
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'

const demoPackage = new URL('../demo/package.json', import.meta.url)
const require = createRequire(demoPackage)
const { chromium } = require('playwright')
const base = new URL(process.env.PILOT_BASE_URL ?? 'https://localhost:18701/')
assert.equal(base.protocol, 'https:')
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname))
const prefix = base.pathname.replace(/\/$/, '')
const initialLog = await readFile(process.env.PILOT_INIT_LOG, 'utf8')
const code = [
  ...initialLog.matchAll(/First-login code: ([A-Za-z0-9_-]+)/g),
].at(-1)?.[1]
assert.ok(code)
const password = 'PilotTest2026!'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ ignoreHTTPSErrors: true })
const page = await context.newPage()
page.setDefaultTimeout(15000)
const badResources = []
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error' && message.text().includes('404')) {
    errors.push(message.text())
  }
})
page.on('response', (response) => {
  if (response.status() === 404) badResources.push(response.url())
})
try {
  await page.goto(base.href)
  await page.getByLabel('首次登入碼').fill(code)
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByLabel('新密碼', { exact: false }).first().fill(password)
  await page.getByLabel('再次輸入新密碼').fill(password)
  await page.getByRole('button', { name: '設定密碼', exact: true }).click()
  await page.getByRole('link', { name: '略過，進入管理頁' }).waitFor()
  await page.getByRole('link', { name: '略過，進入管理頁' }).click()
  await page.locator('.app-header-personal-trigger').click()
  await page.getByRole('button', { name: '登出', exact: true }).click()
  await page.waitForURL((url) => url.pathname === `${prefix}/login`)
  await page.goto(`${base.origin}${prefix}/login`)
  await page.getByLabel('帳號名稱或 Email').fill('admin')
  await page.getByLabel('密碼', { exact: true }).fill('WrongPassword2026!')
  const failed = page.waitForResponse(
    (response) =>
      response.url().endsWith('/auth/login') && response.status() === 401,
  )
  await page.getByRole('button', { name: '登入', exact: true }).click()
  await failed
  await page.getByLabel('密碼', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登入', exact: true }).click()
  await page.waitForURL((url) => url.pathname === `${prefix}/overview`)
  const cookie = (await context.cookies()).find((entry) =>
    entry.name.startsWith('__Host-'),
  )
  assert.ok(cookie)
  assert.equal(cookie.secure, true)
  assert.equal(cookie.httpOnly, true)
  assert.equal(cookie.sameSite, 'Strict')
  assert.equal(cookie.path, '/')
  await page.goto(`${base.origin}${prefix}/projects/new`)
  await page.reload()
  await page.getByLabel('專案代號', { exact: false }).fill('PILOT-R2')
  await page.getByLabel('工程名稱', { exact: false }).fill('Docker HTTPS 驗收')
  await page.getByLabel('業主／委託單位', { exact: false }).fill('驗收業主')
  await page.getByLabel('整體工程地點', { exact: false }).fill('測試地點')
  await page.getByRole('button', { name: '新增專案', exact: true }).click()
  await page.waitForURL((url) => /\/projects\/[\w-]+$/.test(url.pathname))
  const projects = await context.request.get(
    `${base.origin}${prefix}/api/v1/projects`,
  )
  assert.equal(projects.status(), 200)
  assert.ok(
    (await projects.json()).items.some((p) => p.project_code === 'PILOT-R2'),
  )
  const html = await page.content()
  const resources = await page
    .locator('script[src],link[href]')
    .evaluateAll((nodes) => nodes.map((node) => node.src || node.href))
  for (const url of resources.filter((url) => url.startsWith(base.origin))) {
    assert.ok(new URL(url).pathname.startsWith(`${prefix}/`), url)
    assert.equal((await context.request.get(url)).status(), 200, url)
  }
  const manifest = await context.request.get(
    `${base.origin}${prefix}/manifest.webmanifest`,
  )
  const pwa = await manifest.json()
  assert.equal(pwa.start_url, `${prefix}/tasks/`)
  assert.equal(pwa.scope, `${prefix}/`)
  for (const icon of pwa.icons) {
    assert.equal(
      (await context.request.get(base.origin + icon.src)).status(),
      200,
    )
  }
  assert.ok(html.includes(`${prefix}/assets/`))
  await page.locator('.app-header-personal-trigger').click()
  await page.getByRole('button', { name: '登出', exact: true }).click()
  await page.waitForURL((url) => url.pathname === `${prefix}/login`)
  assert.equal(
    (await context.cookies()).filter((c) => c.name.startsWith('__Host-'))
      .length,
    0,
  )
  assert.equal(
    (
      await context.request.get(`${base.origin}${prefix}/api/v1/auth/me`)
    ).status(),
    401,
  )
  assert.deepEqual(badResources, [])
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      result: 'PASS',
      prefix,
      resources: resources.length,
      setup: true,
      login: true,
      logout: true,
      project: 'PILOT-R2',
      secure: true,
      cookiePath: '/',
      badResources,
      errors,
    }),
  )
} finally {
  await browser.close()
}
