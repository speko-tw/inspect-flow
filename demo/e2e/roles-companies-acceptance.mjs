import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { demoBaseUrl } from './base-url.mjs'

const base = demoBaseUrl()
const work = process.env.DEMO_WORK_DIR ?? '/private/tmp/inspectflow-demo-e2e'
const output = process.env.ROLES_COMPANIES_HANDOFF_DIR ??
  path.join(work, 'roles-companies')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  channel: 'chrome', headless: true, args: ['--no-sandbox'],
})
const context = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
})
const page = await context.newPage()
page.setDefaultTimeout(15000)
const metrics = []
const failures = []
page.on('pageerror', (error) => failures.push(error.message))
// 錯誤畫面截圖後捨棄隔離資料庫的草稿，避免 beforeunload 阻擋下一例。
page.on('dialog', (dialog) => dialog.accept())

async function api(url, method = 'GET', body) {
  const result = await page.evaluate(async ({ url, method, body }) => {
    const response = await fetch(`/api/v1${url}`, {
      method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, data: await response.json() }
  }, { url, method, body })
  assert.ok(result.status < 300, `${method} ${url}: ${result.status}`)
  return result.data
}
async function login(username, password, landing) {
  await context.clearCookies()
  await page.goto(base)
  await page.getByLabel('帳號名稱或 Email').fill(username)
  await page.getByLabel('密碼', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登入', exact: true }).click()
  await page.waitForURL((url) => url.pathname === landing)
}
async function heading(name) {
  await page.getByRole('heading', { name, exact: true }).waitFor()
}
async function visit(url, name) {
  await page.goto(base + url)
  await heading(name)
  await page.getByText('載入中…', { exact: true }).waitFor({ state: 'hidden' })
}
async function capture(name, theme, width) {
  await page.evaluate(async () => {
    await document.fonts.ready
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    window.scrollTo(0, 0)
    await new Promise((resolve) => requestAnimationFrame(() =>
      requestAnimationFrame(resolve)))
  })
  await page.mouse.move(0, 0)
  const value = await page.locator('main').evaluate((main) => {
    const visible = (el) => Boolean(el.getClientRects().length) &&
      getComputedStyle(el).visibility !== 'hidden'
    const buttons = Array.from(main.querySelectorAll('button, a.btn'))
      .filter(visible)
    const describe = (el) => ({
      text: el.textContent.trim(), height: el.getBoundingClientRect().height,
      fontWeight: getComputedStyle(el).fontWeight,
    })
    const primary = buttons.filter((el) => el.matches('.btn-primary'))
    const secondary = buttons.filter((el) => !el.matches(
      '.btn-primary, .btn-danger, .btn-danger-outline, .btn-emphasis',
    ))
    return {
      primaryCount: primary.length, primary: primary.map(describe),
      secondary: secondary.map(describe),
      emphasis: buttons.filter((el) => el.matches('.btn-emphasis'))
        .map(describe),
      dangerOutline: buttons.filter((el) => el.matches('.btn-danger-outline'))
        .map(describe),
      solidDangerCount: buttons.filter((el) => el.matches('.btn-danger'))
        .length,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      theme: document.documentElement.dataset.theme,
      definitionMargins: Array.from(main.querySelectorAll('dd')).map(
        (el) => getComputedStyle(el).marginInlineStart),
      requiredLabels: Array.from(main.querySelectorAll('.required-label'))
        .filter(visible).map((el) => ({
          text: el.textContent.trim(),
          height: el.getBoundingClientRect().height,
          lineHeight: getComputedStyle(el).lineHeight,
        })),
    }
  })
  metrics.push({ page: name, width, expectedTheme: theme, ...value })
  await page.screenshot({
    path: path.join(output, `${name}-${width}-${theme}.png`),
    fullPage: true, animations: 'disabled',
  })
  assert.equal(value.theme, theme)
  assert.ok(value.primaryCount <= 1, `${name}: 主按鈕數量`)
  for (const button of value.primary) {
    assert.ok(button.height >= 48, `${name}: ${JSON.stringify(button)}`)
    assert.equal(button.fontWeight, '700')
  }
  for (const button of value.secondary) {
    assert.ok(button.height >= 44, `${name}: ${JSON.stringify(button)}`)
  }
  assert.equal(value.solidDangerCount, name.endsWith('-confirm') ? 1 : 0)
  assert.equal(value.horizontalOverflow, false, `${name}: 橫向溢位`)
}

let adminAppearance
let fieldAppearance
try {
  await login('admin', 'DemoAdmin2026', '/overview')
  adminAppearance = (await api('/auth/me')).appearance
  await visit('/roles', '專案角色')
  assert.equal(await page.getByLabel('角色名稱').count(), 0)
  await page.getByRole('link', { name: '新增角色', exact: true }).click()
  await page.waitForURL('**/roles/new')
  await page.reload()
  await page.getByLabel('角色名稱').fill('網址驗收角色')
  await page.getByRole('button', { name: '建立角色', exact: true }).click()
  await heading('網址驗收角色')
  const rolePath = new URL(page.url()).pathname
  assert.match(rolePath, /^\/roles\/[a-f0-9-]+$/)
  await page.getByText('已建立角色「網址驗收角色」。').waitFor()
  await page.goBack()
  await page.waitForURL('**/roles')
  await page.goForward()
  await page.waitForURL(`**${rolePath}`)
  await heading('網址驗收角色')
  await page.reload()
  await heading('網址驗收角色')
  assert.equal(await page.getByText('已建立角色「網址驗收角色」。')
    .count(), 0)
  await page.getByRole('link', { name: '修改角色', exact: true }).click()
  await page.waitForURL(`**${rolePath}/edit`)
  await page.getByLabel('角色名稱').fill('網址驗收角色已修改')
  await page.getByRole('button', { name: '儲存角色', exact: true }).click()
  await page.getByRole('button', { name: '確認修改角色' }).click()
  await heading('網址驗收角色已修改')
  assert.equal(new URL(page.url()).pathname, rolePath)
  await page.goBack()
  await page.waitForURL(`**${rolePath}`)
  await page.goForward()
  await page.waitForURL(`**${rolePath}`)
  await heading('網址驗收角色已修改')

  await visit('/companies', '公司管理')
  await page.getByRole('link', { name: '新增公司', exact: true }).click()
  await page.waitForURL('**/companies/new')
  await page.reload()
  await page.getByLabel('公司名稱', { exact: true }).fill('網址驗收公司')
  await page.getByRole('button', { name: '新增公司', exact: true }).click()
  await heading('網址驗收公司')
  const companyPath = new URL(page.url()).pathname
  assert.match(companyPath, /^\/companies\/[a-f0-9-]+$/)
  await page.goBack()
  await page.waitForURL('**/companies')
  await page.goForward()
  await page.waitForURL(`**${companyPath}`)
  await heading('網址驗收公司')
  await page.getByRole('button', { name: '修改公司名稱' }).click()
  await page.getByLabel('公司名稱', { exact: true }).fill('網址驗收公司已改名')
  await page.getByRole('button', { name: '儲存公司名稱' }).click()
  await heading('網址驗收公司已改名')
  await page.getByRole('button', { name: '停用公司', exact: true }).click()
  await page.getByRole('button', { name: '確認停用公司' }).waitFor()
  assert.equal((await api(companyPath)).is_active, true)
  await page.getByRole('button', { name: '確認停用公司' }).click()
  await page.getByRole('button', { name: '啟用公司', exact: true }).click()
  await page.getByRole('button', { name: '確認啟用公司' }).waitFor()
  assert.equal((await api(companyPath)).is_active, false)
  await page.getByRole('button', { name: '確認啟用公司' }).click()
  await page.getByRole('button', { name: '停用公司', exact: true }).waitFor()

  await visit('/companies', '公司管理')
  await page.getByLabel('搜尋公司').fill('網址驗收')
  await page.getByRole('button', { name: '搜尋', exact: true }).click()
  await page.getByRole('link', { name: '網址驗收公司已改名', exact: true })
    .click()
  await heading('網址驗收公司已改名')
  await page.getByRole('link', { name: '返回公司清單' }).click()
  assert.equal(await page.getByLabel('搜尋公司').inputValue(), '網址驗收')

  const seed = JSON.parse(await readFile(path.join(work, 'seed-result.json')))
  const roles = (await api('/roles')).items
  const engineer = roles.find((role) => role.name === '專案工程師')
  const creator = await api('/roles/creator-role')
  const creatorData = await api(`/roles/${creator.role_id}`)
  const externalRole = await api('/roles', 'POST', {
    name: '外部協作驗收角色', permission_codes: ['project.read'],
  })
  await api(`/roles/${externalRole.id}`, 'PATCH', {
    is_external_allowed: true,
  })
  const consultantRoles = `/projects/${seed.projects.B}/members/` +
    `${seed.users.consultant}/roles`
  await api(consultantRoles, 'PUT', { role_ids: [externalRole.id] })
  const companyWithUsers = await api(`/companies/${seed.company_id}`)
  const readerRole = roles.find((role) => role.name === '專案查閱人員')
  for (const [width, theme] of [[1280, 'light'], [360, 'dark']]) {
    await page.setViewportSize({ width, height: 1000 })
    await api('/auth/me', 'PATCH', { appearance: theme })
    for (const [name, url, title] of [
      ['roles-list', '/roles', '專案角色'],
      ['role-detail', rolePath, '網址驗收角色已修改'],
      ['role-new', '/roles/new', '新增角色'],
      ['role-edit', `${rolePath}/edit`, '修改角色「網址驗收角色已修改」'],
      ['companies-list', '/companies', '公司管理'],
      ['company-detail', companyPath, '網址驗收公司已改名'],
      ['company-new', '/companies/new', '新增公司'],
    ]) {
      await visit(url, title)
      if (url.endsWith('/new') || url.endsWith('/edit')) {
        await page.getByLabel(name.startsWith('role') ? '角色名稱' : '公司名稱')
          .waitFor()
      }
      await capture(name, theme, width)
    }
    await visit(`/roles/${engineer.id}`, engineer.name)
    await page.getByRole('heading', { name: /權限（共/ }).waitFor()
    assert.equal(await page.getByRole('button', { name: /完整權限/ }).count(), 0)
    await capture('engineer-detail', theme, width)
    await visit(`/roles/${creator.role_id}`, creatorData.name)
    await page.getByText('這個角色是「新專案預設角色」', { exact: false }).waitFor()
    await capture('creator-detail', theme, width)

    await visit('/roles/new', '新增角色')
    const createdName = `成功驗收角色${width}`
    await page.getByLabel('角色名稱').fill(createdName)
    await page.getByRole('button', { name: '建立角色', exact: true }).click()
    await heading(createdName)
    await page.getByText(`已建立角色「${createdName}」。`).waitFor()
    await capture('role-created-success', theme, width)
    const createdPath = new URL(page.url()).pathname
    await page.getByRole('link', { name: '修改角色', exact: true }).click()
    await page.getByLabel('角色名稱').fill(`${createdName}已修改`)
    await page.getByRole('button', { name: '儲存角色', exact: true }).click()
    await page.getByRole('button', { name: '確認修改角色' }).click()
    await heading(`${createdName}已修改`)
    await page.getByText(`已更新角色「${createdName}已修改」。`).waitFor()
    await capture('role-updated-success', theme, width)
    await page.getByRole('link', { name: '修改角色', exact: true }).click()
    await page.getByLabel('角色名稱').fill(engineer.name)
    await page.getByRole('button', { name: '儲存角色', exact: true }).click()
    await page.getByRole('button', { name: '確認修改角色' }).click()
    await page.getByText('角色名稱已被使用（不分大小寫）。').waitFor()
    await capture('role-name-error', theme, width)
    await visit(`/roles/${externalRole.id}/edit`, `修改角色「${externalRole.name}」`)
    await page.getByLabel('外部協作帳號可用', { exact: true }).uncheck()
    await page.getByRole('button', { name: '儲存角色', exact: true }).click()
    await page.getByRole('button', { name: '確認修改角色' }).click()
    await page.getByText(
      '目前有外部協作人員持有這個角色，不能取消「外部協作帳號可用」。' +
      '請先移除他們的這個角色。',
    ).waitFor()
    await capture('role-external-error', theme, width)
    await visit(createdPath, `${createdName}已修改`)
    await page.getByRole('button', { name: '刪除角色', exact: true }).click()
    await page.getByRole('button', { name: '確認刪除角色' }).waitFor()
    await capture('role-delete-confirm', theme, width)

    const realCompanyPath = `/companies/${companyWithUsers.id}`
    await visit(realCompanyPath, companyWithUsers.name)
    await page.getByRole('button', { name: '修改公司名稱' }).click()
    assert.equal(await page.getByRole('button', {
      name: '停用公司', exact: true,
    }).isDisabled(), true)
    await capture('company-renaming', theme, width)
    await page.getByRole('button', { name: '取消', exact: true }).click()
    const rename = page.getByRole('button', { name: '修改公司名稱' })
    assert.equal(await rename.evaluate(
      (el) => el === document.activeElement,
    ), true)
    await page.getByRole('button', { name: '停用公司', exact: true }).click()
    await page.getByRole('button', { name: '確認停用公司' }).waitFor()
    await capture('company-disable-confirm', theme, width)
    await page.getByRole('button', { name: '確認停用公司' }).click()
    await page.getByText(`已停用公司「${companyWithUsers.name}」。`).waitFor()
    await capture('company-disabled-success', theme, width)
    await api(realCompanyPath + '/active', 'PUT', {
      is_active: true, disable_user_ids: [],
    })
  }
  await api(consultantRoles, 'PUT', { role_ids: [readerRole.id] })
  await api('/auth/me', 'PATCH', { appearance: adminAppearance ?? 'system' })
  adminAppearance = undefined
  await login('demo-field-a', 'DemoFieldA2026', '/tasks')
  fieldAppearance = (await api('/auth/me')).appearance
  for (const [width, theme] of [[1280, 'light'], [360, 'dark']]) {
    await page.setViewportSize({ width, height: 1000 })
    await api('/auth/me', 'PATCH', { appearance: theme })
    for (const url of ['/roles/new', rolePath, `${rolePath}/edit`,
      '/companies/new', companyPath]) {
      await visit(url, '無權限')
      assert.equal(await page.getByRole('textbox').count(), 0)
      await page.reload()
      await heading('無權限')
      assert.equal(new URL(page.url()).pathname, url)
    }
    await capture('access-denied', theme, width)
  }
  await api('/auth/me', 'PATCH', { appearance: fieldAppearance ?? 'system' })
  fieldAppearance = undefined
  assert.deepEqual(failures, [])
  console.log(`角色與公司 Chrome 驗收 PASS，${metrics.length} 頁面量測`)
} finally {
  // 偏好屬帳號資料：即使驗收中止也還原，避免影響其他獨立流程。
  if (fieldAppearance !== undefined) {
    await api('/auth/me', 'PATCH', { appearance: fieldAppearance })
  }
  if (adminAppearance !== undefined) {
    await login('admin', 'DemoAdmin2026', '/overview')
    await api('/auth/me', 'PATCH', { appearance: adminAppearance })
  }
  await writeFile(path.join(output, 'metrics.json'),
    JSON.stringify(metrics, null, 2) + '\n')
  await browser.close()
}
