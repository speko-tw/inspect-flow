import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const demo = path.resolve(here, '..')
const base = process.env.DEMO_BASE_URL ?? 'http://localhost:18311'
const work = process.env.DEMO_WORK_DIR ?? '/private/tmp/inspectflow-demo-e2e'
const result = JSON.parse(
  await readFile(path.join(work, 'seed-result.json'), 'utf8'),
)
const accounts = [
  ['admin', 'DemoAdmin2026', '/overview'],
  ['demo-manager', 'DemoManager2026', '/overview'],
  ['demo-office', 'DemoOffice2026', '/projects'],
  ['demo-field-a', 'DemoFieldA2026', '/tasks'],
  ['demo-field-b', 'DemoFieldB2026', '/tasks'],
  ['demo-template-manager', 'DemoTemplate2026', '/templates'],
  ['demo-template-delegate', 'DemoDelegate2026', '/accounts'],
  ['demo-consultant', 'DemoConsultant2026', '/projects'],
  ['demo-no-access', 'DemoNoAccess2026', '/settings'],
]
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.setDefaultTimeout(15000)

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

async function signIn(username, password, landing) {
  await page.context().clearCookies()
  await page.goto(base)
  await page.getByLabel('帳號名稱或 Email').fill(username)
  await page.getByLabel('密碼').fill(password)
  await page.getByRole('button', { name: '登入' }).click()
  await page.waitForURL((url) => url.pathname === landing)
}

async function assertDenied(pathname, heading = '無權限') {
  await page.goto(`${base}${pathname}`)
  await page.getByRole('heading', { name: heading }).waitFor()
}

try {
  for (const [username, password, landing] of accounts) {
    await signIn(username, password, landing)
    assert.equal(new URL(page.url()).pathname, landing)
    await page.locator('.app-header-account').waitFor()
  }

  await signIn('demo-manager', 'DemoManager2026', '/overview')
  await page.getByRole('heading', { name: '專案進度總覽' }).waitFor()
  await page.getByRole('button', {
    name: '示範廠擴建機電工程',
  }).click()
  await page.waitForURL(
    `${base}/overview/projects/${result.projects.B}/tasks`,
  )
  await page.getByRole('link', {
    name: /示範廠 D 棟設備間/,
  }).click()
  await page.getByRole('heading', {
    name: '示範廠擴建機電工程',
  }).waitFor()
  await page.getByRole('heading', {
    name: '示範廠 D 棟設備間',
  }).waitFor()
  await assertDenied('/accounts')
  assert.equal((await api('/users')).status, 403)

  await signIn('demo-office', 'DemoOffice2026', '/projects')
  await page.getByRole('link', { name: '專案', exact: true }).click()
  const officeProject = page.locator('article').filter({
    hasText: '示範廠擴建機電工程',
  })
  await officeProject.getByRole('link', { name: '開啟專案' }).waitFor()
  await officeProject.getByRole('link', { name: '套用範本' }).waitFor()

  await signIn('demo-field-a', 'DemoFieldA2026', '/tasks')
  await page.getByRole('heading', { name: '我的任務' }).waitFor()
  await page.getByText('大樓機房排水檢查').waitFor()
  await page.goto(`${base}/templates`)
  await page.getByRole('heading', { name: '無權限' }).waitFor()
  assert.equal((await api('/template-categories')).status, 403)

  await signIn('demo-field-b', 'DemoFieldB2026', '/tasks')
  await page.getByText('茶水間給水試壓').waitFor()
  await assertDenied('/accounts')
  assert.equal((await api('/users')).status, 403)

  await signIn('demo-template-manager', 'DemoTemplate2026', '/templates')
  await page.getByRole('heading', { name: '查核範本' }).waitFor()
  await page.getByRole('link', { name: '範本', exact: true }).waitFor()
  await page.goto(`${base}/projects`)
  await page.waitForURL((url) => url.pathname === '/templates')
  assert.equal((await api('/users')).status, 403)

  await signIn('demo-template-delegate', 'DemoDelegate2026', '/accounts')
  await page.getByRole('button', { name: '張立衡', exact: true }).click()
  await page.getByText('只能開通受委派範圍內的權限').waitFor()
  assert.equal(
    await page.getByRole('link', { name: '範本', exact: true }).count(),
    0,
  )
  await assertDenied('/templates')
  assert.equal((await api('/template-categories')).status, 403)

  await signIn('demo-consultant', 'DemoConsultant2026', '/projects')
  await page.getByRole('link', { name: '專案', exact: true }).click()
  const consultantProject = page.locator('article').filter({
    hasText: '示範廠擴建機電工程',
  })
  await consultantProject.getByRole('link', { name: '開啟專案' }).waitFor()
  await consultantProject.getByRole('link', { name: '套用範本' }).waitFor({
    state: 'detached',
  })
  assert.equal(
    (await api(
      `/projects/${result.projects.B}/inspection-items:apply-template`,
      'POST',
      { system_id: 'not-used' },
    )).status,
    403,
  )

  await signIn('demo-no-access', 'DemoNoAccess2026', '/settings')
  await page.getByText(
    '尚未開通任何功能，請洽系統管理者',
  ).waitFor()
  assert.equal((await api('/admin/dashboard/summary')).status, 403)
  await assertDenied('/overview')

  await signIn('admin', 'DemoAdmin2026', '/overview')
  await page.getByRole('button', { name: '管理 ▾' }).click()
  await page.getByRole('link', { name: '帳號', exact: true }).click()
  await page.getByRole('button', { name: '新增帳號' }).click()
  await page.getByLabel('帳號名稱', { exact: true }).fill(
    'demo-k3-role-check',
  )
  await page.getByLabel('姓名', { exact: true }).fill('林以安')
  await page.getByLabel('電子郵件', { exact: true }).fill(
    'demo-k3-role-check@example.test',
  )
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('radio', { name: /內業規劃/ }).check()
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByLabel('加入專案（可略過）').selectOption({
    label: '示範廠擴建機電工程',
  })
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '建立帳號' }).click()
  await page.getByRole('heading', { name: '帳號已建立' }).waitFor()
  const temporaryPassword = await page.getByLabel('臨時密碼').innerText()
  assert.ok(temporaryPassword.length >= 12)
  const restrictedRole = await api('/roles', 'POST', {
    name: 'K3 查核權限不足',
    permission_codes: ['project.read'],
  })
  assert.equal(restrictedRole.status, 201)
  const createdUsers = await api('/users')
  const createdUser = createdUsers.data.items.find(
    (user) => user.username === 'demo-k3-role-check',
  )
  assert.ok(createdUser)
  const restrictedMembership = await api(
    `/projects/${result.projects.B}/members/${createdUser.id}/roles`,
    'PUT',
    { role_ids: [restrictedRole.data.id] },
  )
  assert.equal(restrictedMembership.status, 200)
  await page.getByRole('button', {
    name: '查看這個帳號的能力',
  }).click()
  await page.getByRole('heading', {
    name: '能做什麼',
  }).waitFor()
  await page.getByRole('combobox').nth(0).selectOption('task-list')
  await page.getByRole('combobox').nth(1).selectOption({
    label: '示範廠擴建機電工程',
  })
  const diagnosticResponse = page.waitForResponse(
    (response) => response.url().includes('/effective-access'),
  )
  await page.getByRole('button', { name: '檢查', exact: true }).click()
  const diagnostic = await (await diagnosticResponse).json()
  assert.equal(
    diagnostic.diagnostics.find((item) => item.action === 'task_list').allowed,
    false,
  )
  const roleRepairResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().endsWith('/roles'),
  )
  await page.getByRole('button', {
    name: '補上「現場工程師」角色',
  }).click()
  assert.equal((await roleRepairResponse).status(), 200)
  const repaired = await api(
    `/users/${createdUser.id}/effective-access` +
      `?project_id=${result.projects.B}`,
  )
  assert.equal(repaired.status, 200)
  assert.equal(
    repaired.data.diagnostics.find((item) => item.action === 'task_list')
      .allowed,
    true,
  )
  assert.ok(
    repaired.data.project_roles.some(
      (role) => role.name === '現場工程師',
    ),
  )
  assert.ok(
    createdUsers.data.items.some(
      (user) => user.username === 'demo-k3-role-check',
    ),
  )

  await page.screenshot({
    path: path.join(demo, 'screenshots/09-admin-role-diagnostic.png'),
    fullPage: true,
  })
  process.stdout.write(JSON.stringify({
    result: 'PASS',
    browser: 'Google Chrome via Playwright',
    accounts: accounts.map(([username, , landing]) => ({ username, landing })),
    roleRepair: 'admin created an account and repaired a missing project role',
    runtimeUrls: [
      '/tasks', '/projects', '/overview', '/templates', '/accounts',
      '/settings',
    ],
  }, null, 2) + '\n')
} finally {
  await browser.close()
}
