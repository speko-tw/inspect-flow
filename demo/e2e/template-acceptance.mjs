import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
  await page.getByText('你沒有使用這個頁面的權限', {
    exact: true,
  }).waitFor()
  await page.getByRole('link', { name: '回到我的首頁' }).waitFor()
  assert.equal(
    await page.getByRole('link', { name: '回到我的首頁' }).getAttribute('href'),
    '/projects',
  )
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

  // IP-AC23～26：真 API 保留草稿，UI 停用、過濾與恢復，兩種外觀留證。
  await signIn('admin', 'DemoAdmin2026')
  const itemBase = `/projects/${result.projects.B}/inspection-items`
  const activationItems = await api(itemBase)
  assert.equal(activationItems.status, 200)
  const activationItem = activationItems.data.items.find(
    (item) => item.title === '接地電阻量測',
  )
  assert.ok(activationItem, 'fixture must contain the item applied above')
  // 測試產物跟隨隔離工作目錄，交付時再複製到指定位置。
  const shots = path.join(work, 'screenshots', 'project-items')
  await mkdir(shots, { recursive: true })
  const planningShots = path.join(work, 'screenshots', 'planning')
  await mkdir(planningShots, { recursive: true })
  const activationZones = await api(`/projects/${result.projects.B}/zones`)
  assert.equal(activationZones.status, 200)
  assert.ok(activationZones.data.items.length > 0)
  const activationZoneId = activationZones.data.items[0].id
  const originalAppearance = (await api('/auth/me')).data.appearance
  assert.equal(
    (await api('/auth/me', 'PATCH', { appearance: 'system' })).status,
    200,
  )
  for (const [width, scheme] of [
    [1280, 'light'],
    [360, 'dark'],
  ]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.emulateMedia({ colorScheme: scheme })
    assert.equal(
      (await api('/auth/me', 'PATCH', { appearance: scheme })).status,
      200,
    )
    const planName = `停用選單驗收 ${width}`
    const plan = await api(
      `/projects/${result.projects.B}/inspection-plans`,
      'POST',
      {
        name: planName,
      },
    )
    assert.equal(plan.status, 201)
    const draft = await api(
      `/inspection-plans/${plan.data.id}/tasks`,
      'POST',
      {
        name: `保留停用項目 ${width}`,
        item_ids: [activationItem.id],
        zone_id: activationZoneId,
      },
    )
    assert.equal(draft.status, 201, JSON.stringify(draft.data))
    const taskPath = `/inspection-tasks/${draft.data.id}`
    const beforeActivation = await api(taskPath)
    await page.goto(`${base}${itemBase}`)
    await page.waitForFunction(
      (theme) => document.documentElement.dataset.theme === theme,
      scheme,
    )
    const itemRow = page.locator('.project-item-list > li').filter({
      has: page.getByRole('link', {
        name: `修改「${activationItem.title}」`,
        exact: true,
      }),
    })
    await itemRow
      .getByRole('button', { name: `刪除「${activationItem.title}」` })
      .click()
    const blocked = itemRow.getByRole('group', { name: '無法刪除查核項目' })
    await blocked.getByRole('button', { name: '停用這個項目' }).waitFor()
    await page.screenshot({
      path: path.join(shots, `${width}-${scheme}-panel.png`),
      fullPage: true,
    })
    await blocked.getByRole('button', { name: '停用這個項目' }).click()
    const confirmation = itemRow.getByRole('group', { name: '停用查核項目' })
    await confirmation.getByText(/既有任務與查核紀錄不受影響/).waitFor()
    await page.screenshot({
      path: path.join(shots, `${width}-${scheme}-confirm.png`),
      fullPage: true,
    })
    const deactivation = page.waitForResponse((r) =>
      r.url().endsWith(':deactivate'),
    )
    await confirmation.getByRole('button', { name: '確認停用' }).click()
    assert.equal((await deactivation).status(), 200)
    const summary = page.getByText('已停用（1）', { exact: true })
    await summary.waitFor()
    assert.equal(
      await page
        .getByRole('link', {
          name: `修改「${activationItem.title}」`,
          exact: true,
        })
        .count(),
      0,
    )
    await summary.click()
    await page
      .getByRole('button', { name: `恢復「${activationItem.title}」` })
      .waitFor()
    await page.screenshot({
      path: path.join(shots, `${width}-${scheme}-inactive.png`),
      fullPage: true,
    })
    assert.deepEqual((await api(taskPath)).data, beforeActivation.data)
    await page.goto(`${base}${itemBase}/${activationItem.id}`)
    await page
      .getByText('此查核項目已停用，請先在已停用清單恢復。', { exact: true })
      .waitFor()
    assert.equal(
      await page.getByRole('button', { name: '儲存變更' }).isDisabled(),
      true,
    )
    const rejectedNew = await api(
      `/inspection-plans/${plan.data.id}/tasks`,
      'POST',
      {
        name: '不可新增停用選項',
        item_ids: [activationItem.id],
        zone_id: activationZoneId,
      },
    )
    assert.equal(rejectedNew.status, 409)
    if (width === 360) {
      await page.getByRole('button', {
        name: /切換專案頁面/,
      }).click()
    }
    await page.getByRole('link', { name: '計畫與任務', exact: true }).click()
    const activationPlanButton = page
      .locator('.plan-list')
      .getByRole('link', { name: new RegExp(planName) })
    await activationPlanButton.waitFor()
    const activationPlanLabel = await activationPlanButton.innerText()
    assert.equal(
      activationPlanLabel.replace(/\s/g, ''),
      `${planName}（草稿）`.replace(/\s/g, ''),
    )
    process.stdout.write(JSON.stringify({ activationPlanLabel }) + '\n')
    // IP-AC27～29：沿站內入口走過六種獨立頁，以真 Chrome 留證。
    const planningShot = async (name) => {
      await page.getByText('載入中…', { exact: true }).waitFor({
        state: 'hidden',
      })
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      )
      await page.screenshot({
        path: path.join(planningShots, `${width}-${scheme}-${name}.png`),
        fullPage: true,
      })
    }
    await planningShot('plan-list')
    await page.getByRole('link', { name: '建立計畫', exact: true }).click()
    await page.getByLabel('計畫名稱', { exact: false }).waitFor()
    await planningShot('plan-new')
    await page
      .getByLabel('計畫名稱', { exact: false })
      .fill(`獨立頁計畫 ${width}`)
    await page.getByRole('button', { name: '建立計畫', exact: true }).click()
    await page
      .getByRole('heading', {
        name: `獨立頁計畫 ${width}`,
        exact: true,
      })
      .waitFor()
    await page.getByText('已建立計畫，接著新增任務。').waitFor()
    await page.waitForFunction(() => history.state?.usr == null)
    await page.reload()
    assert.equal(await page.getByText('已建立計畫，接著新增任務。').count(), 0)
    await page.goBack()
    await activationPlanButton.waitFor()
    await activationPlanButton.click()
    await page.getByRole('heading', { name: planName, exact: true }).waitFor()
    const taskRow = page.getByRole('link', {
      name: `保留停用項目 ${width}`,
      exact: true,
    })
    assert.ok((await taskRow.boundingBox()).height >= 44)
    await planningShot('plan-detail')
    await page.getByRole('button', { name: '＋ 新增任務' }).click()
    await page.getByRole('button', { name: '建立草稿任務' }).waitFor()
    await planningShot('task-new')
    const taskForm = page.locator('[data-error-context="task"]')
    assert.equal(
      await taskForm.locator(`input[value="${activationItem.id}"]`).count(),
      0,
    )
    await taskForm.getByRole('button', { name: '取消', exact: true }).click()
    await page
      .getByRole('link', { name: `保留停用項目 ${width}`, exact: true })
      .click()
    await page.getByRole('button', { name: '修改地點', exact: true }).waitFor()
    await planningShot('task-detail')
    const draftArticle = page.locator('article').filter({
      has: page.getByRole('heading', {
        name: new RegExp(`保留停用項目 ${width}`),
      }),
    })
    await draftArticle.getByRole('button', { name: '修改查核項目' }).click()
    const retainedInput = page
      .locator('[data-error-context="items"]')
      .locator(`input[value="${activationItem.id}"]`)
    assert.equal(await retainedInput.isChecked(), true)
    await planningShot('task-edit-items')
    await page.reload()
    assert.equal(await retainedInput.isChecked(), true)
    await page
      .locator('form')
      .getByRole('button', { name: '取消', exact: true })
      .click()
    await page.getByRole('button', { name: '修改地點', exact: true }).click()
    const locationForm = page.locator('[data-error-context="location"]')
    await locationForm.getByLabel('補充地點').waitFor()
    await planningShot('task-edit')
    await locationForm.getByLabel('補充地點').fill(`北側 ${width}`)
    await locationForm.getByRole('button', { name: '儲存地點' }).click()
    await page.getByText('已更新任務地點。', { exact: true }).waitFor()
    assert.equal((await api(taskPath)).data.location_text, `北側 ${width}`)
    await page
      .getByRole('button', { name: '修改建議指派', exact: true })
      .click()
    await page.locator('[data-error-context="assignee"]').waitFor()
    await planningShot('task-edit-assignee')
    await page
      .locator('form')
      .getByRole('button', { name: '取消', exact: true })
      .click()

    assert.equal((await api(`${taskPath}:dispatch`, 'POST')).status, 200)
    if (width === 1280) {
      const planningBase = `/projects/${result.projects.B}/planning`
      const pagePath = `${planningBase}/${plan.data.id}`
      const taskPage = `${pagePath}/tasks/${draft.data.id}`
      await page.goto(`${base}${taskPage}`)
      await page.getByText('任務已派出，不能更換查核項目').waitFor()
      await planningShot('task-dispatched')
      assert.equal(
        (await api(`/inspection-plans/${plan.data.id}:archive`, 'POST'))
          .status,
        200,
      )
      await page.goto(`${base}${pagePath}`)
      await page
        .getByText('計畫已封存。取消封存後才能新增、修改或派出任務。')
        .waitFor()
      await planningShot('plan-archived')
      assert.equal(
        (await api(`/inspection-plans/${plan.data.id}:unarchive`, 'POST'))
          .status,
        200,
      )
      let failDetail = true
      const detailApi = `**/api/v1/inspection-plans/${plan.data.id}`
      await page.route(detailApi, async (route) => {
        if (failDetail && route.request().method() === 'GET') {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'unavailable' } }),
          })
        } else await route.continue()
      })
      await page.goto(`${base}${taskPage}`)
      await page.getByRole('alert').waitFor()
      await page.getByRole('button', { name: '重新載入' }).waitFor()
      await planningShot('load-error')
      failDetail = false
      await page.getByRole('button', { name: '重新載入' }).click()
      await page
        .getByRole('heading', {
          name: new RegExp(`保留停用項目 ${width}`),
          level: 2,
        })
        .waitFor()
      await page.unroute(detailApi)
    }

    await page.goto(`${base}${itemBase}`)
    await page.getByText('已停用（1）', { exact: true }).click()
    await page
      .getByRole('button', { name: `恢復「${activationItem.title}」` })
      .click()
    const reactivation = page.waitForResponse((r) =>
      r.url().endsWith(':activate'),
    )
    await page.getByRole('button', { name: '確認恢復' }).click()
    assert.equal((await reactivation).status(), 200)
    await page
      .getByRole('link', {
        name: `修改「${activationItem.title}」`,
        exact: true,
      })
      .waitFor()
    assert.equal(
      await page.getByText('已停用（1）', { exact: true }).count(),
      0,
    )
    await page.screenshot({
      path: path.join(shots, `${width}-${scheme}-restored.png`),
      fullPage: true,
    })
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    )
  }
  assert.equal(
    (await api('/auth/me', 'PATCH', { appearance: originalAppearance }))
      .status,
    200,
  )

  process.stdout.write(JSON.stringify({
    result: 'PASS',
    activation: 'filtering, draft dispatch and restoration verified',
    browser: 'Google Chrome via Playwright',
    wholeSystem: 'two items applied from the demo-office project route',
    singleItem: 'bound numeric field and unit applied from the UI',
    duplicate: 'real API returned 409 without partial writes',
    saveConflict: 'real API conflict visible in the Admin UI',
    external: 'library readable; template write and project apply denied',
    noTemplateModule: 'template library API returned 403',
  }, null, 2) + '\n')
} catch (error) {
  await writeFile(
    path.join(work, '717-browser-failure.txt'),
    await page.locator('body').innerText(),
  )
  await page.screenshot({
    path: path.join(work, '717-browser-failure.png'), fullPage: true,
  })
  throw error
} finally {
  await browser.close()
}
