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
// 逐身分的導覽預期：依 frontend/src/routes.ts 與 seed 實際權限推得，
// 由真實畫面核對「連結集合」與「管理 ▾」是否與角色相符。
const expectedNavigation = {
  admin: {
    links: ['總覽', '任務', '專案', '範本'],
    management: ['帳號', '公司', '角色', '紀錄'],
  },
  'demo-manager': { links: ['總覽'] },
  'demo-office': { links: ['專案'] },
  'demo-field-a': { links: ['任務', '專案'] },
  'demo-field-b': { links: ['任務', '專案'] },
  'demo-template-manager': { links: ['範本'] },
  'demo-template-delegate': { links: ['帳號'] },
  'demo-consultant': { links: ['專案'] },
  'demo-no-access': { links: [] },
}
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

async function assertAllDenied(pathnames) {
  for (const pathname of pathnames) await assertDenied(pathname)
}

async function assertApiStatus(pathname, expected, method = 'GET', body) {
  const response = await api(pathname, method, body)
  assert.equal(
    response.status,
    expected,
    `${method} ${pathname} 應回 ${expected}，實際 ${response.status}`,
  )
}

// 以管理者身分的使用者清單查帳號 id；找不到時回傳 undefined。
async function userIdOf(username) {
  const users = await api('/users?limit=100')
  assert.equal(users.status, 200)
  return users.data.items.find((user) => user.username === username)?.id
}

async function readNavigation() {
  const nav = page.locator('nav.app-header-nav')
  await nav.waitFor({ state: 'attached' })
  const links = await nav.locator(':scope > a').allInnerTexts()
  return {
    links: links.map((text) => text.trim()),
    hasManagement:
      (await nav.locator('.app-header-management-trigger').count()) > 0,
  }
}

// 導覽可能在存取摘要載入後才補齊，因此輪詢到集合穩定或逾時。
async function assertNavigation(username) {
  const expected = expectedNavigation[username]
  const wantsMenu = expected.management !== undefined
  const deadline = Date.now() + 10000
  let actual = await readNavigation()
  while (
    Date.now() < deadline &&
    (JSON.stringify(actual.links) !== JSON.stringify(expected.links) ||
      actual.hasManagement !== wantsMenu)
  ) {
    await page.waitForTimeout(200)
    actual = await readNavigation()
  }
  assert.deepEqual(actual.links, expected.links, `${username} 導覽連結`)
  assert.equal(actual.hasManagement, wantsMenu, `${username} 管理 ▾`)
  if (!wantsMenu) return
  await page.getByRole('button', { name: '管理 ▾' }).click()
  assert.deepEqual(
    await page.locator('#app-header-management-menu a').allInnerTexts(),
    expected.management,
    `${username} 管理選單項目`,
  )
  await page.keyboard.press('Escape')
}

try {
  for (const [username, password, landing] of accounts) {
    await signIn(username, password, landing)
    assert.equal(new URL(page.url()).pathname, landing)
    await page.locator('.app-header-account').waitFor()
    await assertNavigation(username)
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
  await assertAllDenied(['/accounts', '/companies', '/roles', '/logs'])
  await assertApiStatus('/users', 403)
  await assertApiStatus('/audit-logs', 403)

  await signIn('demo-office', 'DemoOffice2026', '/projects')
  await page.getByRole('link', { name: '專案', exact: true }).click()
  const officeProject = page.locator('article').filter({
    hasText: '示範廠擴建機電工程',
  })
  await officeProject.getByRole('link', { name: '開啟專案' }).waitFor()
  await officeProject.getByRole('link', { name: '套用範本' }).waitFor()
  await assertAllDenied(['/accounts', '/companies', '/roles', '/logs'])
  for (const pathname of ['/users', '/companies', '/roles', '/audit-logs']) {
    await assertApiStatus(pathname, 403)
  }

  await signIn('demo-field-a', 'DemoFieldA2026', '/tasks')
  await page.getByRole('heading', { name: '我的任務' }).waitFor()
  await page.getByText('大樓機房排水檢查').waitFor()
  await page.goto(`${base}/templates`)
  await page.getByRole('heading', { name: '無權限' }).waitFor()
  assert.equal((await api('/template-categories')).status, 403)
  await assertDenied('/accounts')
  await assertApiStatus('/users', 403)

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
  await page.getByRole('link', { name: '新增帳號' }).waitFor({
    state: 'detached',
  })
  assert.equal(
    await page.getByRole('link', { name: '張立衡', exact: true }).count(),
    0,
  )
  await page.getByRole('link', { name: '陳柏勳', exact: true }).click()
  await page.getByText('只能開通受委派範圍內的權限').waitFor()
  assert.equal(
    await page.getByRole('link', { name: '範本', exact: true }).count(),
    0,
  )
  assert.equal(await page.getByRole('link', { name: '新增帳號' }).count(), 0)
  await assertDenied('/templates')
  await assertAllDenied(['/companies', '/roles', '/logs'])
  assert.equal((await api('/template-categories')).status, 403)
  await assertApiStatus('/users', 403, 'POST', {
    username: 'demo-denied-by-delegate',
    email: 'demo-denied-by-delegate@example.test',
    name_zh: '不應建立',
  })

  // 外部帳號不能被開通管理範本庫：畫面只列外部可用的功能。
  await page.goto(`${base}/accounts`)
  await page.getByRole('link', { name: '黃子晴', exact: true }).click()
  await page.getByText('只能開通受委派範圍內的權限').waitFor()
  await page.getByLabel('使用範本功能').waitFor()
  assert.equal(await page.getByText('管理範本庫').count(), 0)
  assert.equal(await page.getByLabel('管理範本庫').count(), 0)

  // 內部帳號：委派者按「開通」，成功通知與 API 回讀都要看到 template.use。
  await page.goto(`${base}/accounts`)
  await page.getByRole('link', { name: '陳柏勳', exact: true }).click()
  await page.getByLabel('管理範本庫').waitFor()
  await page.getByLabel('使用範本功能').check()
  const grantResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().endsWith('/module-permissions/template.use'),
  )
  await page.getByRole('button', { name: '開通' }).click()
  assert.ok([200, 204].includes((await grantResponse).status()))
  await page.getByText('已為陳柏勳開通使用範本功能。').waitFor()
  await signIn('admin', 'DemoAdmin2026', '/overview')
  const fieldBId = await userIdOf('demo-field-b')
  try {
    const granted = await api(`/users/${fieldBId}/module-permissions`)
    assert.equal(granted.status, 200)
    assert.ok(granted.data.permission_codes.includes('template.use'))
  } finally {
    // 還原：撤銷剛開通的權限，避免影響之後的帳號狀態。
    await api(`/users/${fieldBId}/module-permissions/template.use`, 'DELETE')
  }
  const restored = await api(`/users/${fieldBId}/module-permissions`)
  assert.ok(!restored.data.permission_codes.includes('template.use'))
  assert.equal(await userIdOf('demo-denied-by-delegate'), undefined)

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
    await page.locator('article').filter({
      hasText: /DEMO-A|示範大樓機電工程/,
    }).count(),
    0,
  )
  await assertAllDenied(['/accounts', '/overview'])
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
  await assertAllDenied(['/overview', '/accounts'])

  await signIn('admin', 'DemoAdmin2026', '/overview')
  await page.getByRole('button', { name: '管理 ▾' }).click()
  await page.getByRole('link', { name: '帳號', exact: true }).click()
  await page.getByRole('link', { name: '新增帳號' }).click()
  await page.waitForURL((url) => url.pathname === '/accounts/new')
  await page.reload()
  await page.getByRole('heading', { level: 1, name: '新增帳號' }).waitFor()
  // #713：第一步缺欄位時停在原地並在欄位旁說明。
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByText('請填寫帳號名稱。').first().waitFor()
  assert.ok(await page.getByText('步驟 1／4：帳號資料').isVisible())
  await page.getByLabel('帳號名稱', { exact: true }).fill(
    'demo-role-check',
  )
  await page.getByLabel('姓名', { exact: true }).fill('林以安')
  await page.getByLabel('電子郵件', { exact: true }).fill(
    'demo-role-check@example.test',
  )
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('radio', { name: /現場查核/ }).check()
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByLabel('加入專案（可略過）').selectOption({
    label: '示範廠擴建機電工程',
  })
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '建立帳號' }).click()
  await page.getByRole('heading', {
    name: '林以安', level: 1, exact: true,
  }).waitFor()
  await page.getByRole('status').filter({ hasText: '已新增林以安的帳號' }).waitFor()
  assert.match(new URL(page.url()).pathname, /^\/accounts\/[0-9a-f-]+$/)
  const temporaryPassword = await page
    .getByLabel('臨時密碼', { exact: true }).textContent()
  assert.match(temporaryPassword, /^[0-9]{20}$/)
  assert.ok(temporaryPassword.length >= 12)
  const restrictedRole = await api('/roles', 'POST', {
    name: '示範僅查閱專案角色',
    permission_codes: ['project.read', 'inspection_task.read'],
  })
  assert.equal(restrictedRole.status, 201)
  const createdUsers = await api('/users')
  const createdUser = createdUsers.data.items.find(
    (user) => user.username === 'demo-role-check',
  )
  assert.ok(createdUser)
  // 精靈選「現場查核」並加入專案，建立時就該拿到可查看任務的角色。
  const created = await api(
    `/users/${createdUser.id}/effective-access` +
      `?project_id=${result.projects.B}`,
  )
  assert.equal(created.status, 200)
  assert.equal(
    created.data.diagnostics.find((item) => item.action === 'task_list')
      .allowed,
    true,
  )
  assert.ok(
    created.data.project_roles.some((role) => role.name === '現場工程師'),
  )
  const restrictedMembership = await api(
    `/projects/${result.projects.B}/members/${createdUser.id}/roles`,
    'PUT',
    { role_ids: [restrictedRole.data.id] },
  )
  assert.equal(restrictedMembership.status, 200)
  const manageableRole = await api('/roles', 'POST', {
    name: '示範成員管理角色',
    permission_codes: [
      'project.read',
      'inspection_task.read',
      'project_member.manage',
    ],
  })
  assert.equal(manageableRole.status, 201)
  await page.getByRole('link', { name: '返回帳號清單' }).click()
  await page.getByRole('heading', {
    name: '臨時密碼抄下了嗎？',
  }).waitFor()
  const temporaryPasswordOutputs = page.getByLabel('臨時密碼', { exact: true })
  assert.equal(await temporaryPasswordOutputs.count(), 1)
  await page.getByRole('button', { name: '留在此頁' }).click()
  await page.getByRole('heading', {
    name: '臨時密碼抄下了嗎？', exact: true,
  }).waitFor({ state: 'hidden' })
  await page.getByRole('heading', {
    name: '林以安', level: 1, exact: true,
  }).waitFor()
  await page.getByRole('status').filter({ hasText: '已新增林以安的帳號' }).waitFor()
  assert.match(new URL(page.url()).pathname, /^\/accounts\/[0-9a-f-]+$/)
  assert.ok(
    await temporaryPasswordOutputs.evaluateAll(
      (elements, expectedPassword) =>
        elements.every(
          (element) => element.textContent === expectedPassword,
        ),
      temporaryPassword,
    ),
    '選擇留在此頁後仍應顯示原臨時密碼',
  )
  assert.ok(
    (await page.locator('body').textContent()).includes(temporaryPassword),
    '離頁前同一查法確實找得到連續密碼',
  )
  await page.getByRole('link', { name: '返回帳號清單' }).click()
  await page.getByRole('heading', {
    name: '臨時密碼抄下了嗎？',
  }).waitFor()
  await page.getByRole('button', { name: '離開此頁' }).click()
  await page.getByRole('link', { name: '林以安', exact: true }).click()
  await page.getByRole('heading', {
    name: '能做什麼',
  }).waitFor()
  // 離開完成頁後，能力摘要不得再顯示臨時密碼。
  assert.ok(
    !(await page.locator('body').textContent()).includes(temporaryPassword),
  )
  await page.getByRole('combobox').nth(0).selectOption('members')
  const projectSelector = page.getByRole('combobox').nth(1)
  await projectSelector.focus()
  await page.getByRole('option', {
    name: '示範廠擴建機電工程', exact: true,
  }).waitFor({state: 'attached'})
  await projectSelector.selectOption({
    label: '示範廠擴建機電工程',
  })
  const diagnosticResponse = page.waitForResponse(
    (response) => response.url().includes('/effective-access'),
  )
  await page.getByRole('button', { name: '檢查', exact: true }).click()
  const diagnostic = await (await diagnosticResponse).json()
  assert.equal(
    diagnostic.diagnostics.find(
      (item) => item.action === 'manage_project_members',
    ).allowed,
    false,
  )
  assert.equal(
    diagnostic.diagnostics.find((item) => item.action === 'task_list').allowed,
    true,
  )
  const participation = page.locator('li').filter({
    hasText: '示範廠擴建機電工程',
  })
  await participation.filter({ hasText: '示範僅查閱專案角色' }).waitFor()
  assert.equal(
    await participation.filter({ hasText: '現場工程師' }).count(),
    0,
  )
  const roleRepairResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().endsWith('/roles'),
  )
  await page
    .getByRole('radio', { name: /示範成員管理角色/ })
    .check()
  await page.getByRole('button', { name: '指派所選角色' }).click()
  assert.equal((await roleRepairResponse).status(), 200)
  const repaired = await api(
    `/users/${createdUser.id}/effective-access` +
      `?project_id=${result.projects.B}`,
  )
  assert.equal(repaired.status, 200)
  assert.equal(
    repaired.data.diagnostics.find(
      (item) => item.action === 'manage_project_members',
    )
      .allowed,
    true,
  )
  assert.equal(
    repaired.data.diagnostics.find((item) => item.action === 'task_list')
      .allowed,
    true,
  )
  assert.ok(
    repaired.data.project_roles.some(
      (role) => role.name === '示範成員管理角色',
    ),
  )
  // #708：補上角色後，「參與專案與角色」清單要立即顯示新角色。
  await participation.filter({ hasText: '示範成員管理角色' }).waitFor()

  await page.screenshot({
    path: path.join(demo, 'screenshots/09-admin-role-diagnostic.png'),
    fullPage: true,
  })
  process.stdout.write(JSON.stringify({
    result: 'PASS',
    browser: 'Google Chrome via Playwright',
    accounts: accounts.map(([username, , landing]) => ({ username, landing })),
    navigation: 'link sets and the management menu verified per account',
    denied: 'direct URLs show the denied page; management APIs return 403',
    delegate: 'external account hides library management; grant verified',
    roleRepair: 'admin created a field account and repaired its role',
    temporaryPassword: 'shown once, gone after leaving the screen',
    runtimeUrls: [
      '/tasks', '/projects', '/overview', '/templates', '/accounts',
      '/settings',
    ],
  }, null, 2) + '\n')
} finally {
  await browser.close()
}
