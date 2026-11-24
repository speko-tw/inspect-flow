// 照片走查的斷言帳本、像素比對與故障注入輔助。
//
// 為什麼獨立成檔：T10 的 AC35～AC39 需要「讀回真 API／下載檔」與
// 「畫面像素」兩種證據；集中在這裡才能讓每個斷言都有 AC 編號，並讓
// 負向控制（EVIDENCE_FAULT）能指名失敗在哪一條斷言。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

/** 計算位元組的 SHA-256，與後端保存的 sha256 同一算法。 */
export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * 斷言帳本：每條斷言帶 AC 編號，成功與失敗都記錄，失敗訊息以
 * `[ACxx]` 開頭，方便負向控制確認「死在預期的那一條」。
 */
export function createLedger() {
  const rows = []
  function record(ac, name, ok, detail) {
    rows.push({ ac, name, ok, ...(detail === undefined ? {} : { detail }) })
  }
  return {
    rows,
    equal(ac, name, actual, expected) {
      try {
        assert.deepStrictEqual(actual, expected)
      } catch (error) {
        record(ac, name, false, { actual, expected })
        throw new Error(`[${ac}] ${name}: ${error.message}`)
      }
      record(ac, name, true)
    },
    // 像素差異必須集中在指定角落；失敗時把完整差異量一併記下方便判讀。
    corner(ac, name, diff, expected) {
      const actual = cornerOf(diff)
      if (actual !== expected) {
        record(ac, name, false, { diff, expected })
        throw new Error(
          `[${ac}] ${name}: expected ${expected}, got ${actual}; ` +
            JSON.stringify(diff),
        )
      }
      record(ac, name, true, { diff })
    },
    ok(ac, name, condition, detail) {
      if (!condition) {
        record(ac, name, false, detail)
        throw new Error(
          `[${ac}] ${name} failed: ${JSON.stringify(detail ?? null)}`,
        )
      }
      record(ac, name, true)
    },
  }
}

/** 等兩個動畫影格再多等一下，讓 ResizeObserver 與畫布重繪完成。 */
export async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      }),
  )
  await page.waitForTimeout(150)
}

/** 把畫布目前像素存進頁面的具名快照。 */
export async function snapCanvas(page, name, selector) {
  await page.evaluate(
    ([key, css]) => {
      const canvas = document.querySelector(css)
      const data = canvas
        .getContext('2d')
        .getImageData(0, 0, canvas.width, canvas.height)
      window.__px ??= {}
      window.__px[key] = {
        width: canvas.width,
        height: canvas.height,
        data: data.data,
      }
    },
    [name, selector],
  )
}

/** 載入圖片（同源網址或位元組）並存成具名快照；回傳實際尺寸。 */
export async function loadPixels(page, name, source) {
  return page.evaluate(
    async ([key, input]) => {
      const response = await fetch(
        input.url ?? `data:image/jpeg;base64,${input.base64}`,
        { credentials: 'same-origin' },
      )
      const bitmap = await createImageBitmap(await response.blob())
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(bitmap, 0, 0)
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
      window.__px ??= {}
      window.__px[key] = {
        width: canvas.width,
        height: canvas.height,
        data: data.data,
      }
      return { width: canvas.width, height: canvas.height }
    },
    [
      name,
      source.buffer
        ? { base64: source.buffer.toString('base64') }
        : { url: source.url },
    ],
  )
}

/**
 * 比兩張快照：回傳差異像素總數與落在四個象限的數量。
 * 差異門檻取三通道差總和，避開 JPEG 二次壓縮的細微雜訊。
 */
export async function diffPixels(page, left, right) {
  return page.evaluate(
    ([a, b]) => {
      const one = window.__px[a]
      const two = window.__px[b]
      if (one.width !== two.width || one.height !== two.height) {
        return {
          sameSize: false,
          left: [one.width, one.height],
          right: [two.width, two.height],
        }
      }
      const quadrants = {
        top_left: 0,
        top_right: 0,
        bottom_left: 0,
        bottom_right: 0,
      }
      let count = 0
      for (let y = 0; y < one.height; y += 1) {
        for (let x = 0; x < one.width; x += 1) {
          const i = (y * one.width + x) * 4
          const delta =
            Math.abs(one.data[i] - two.data[i]) +
            Math.abs(one.data[i + 1] - two.data[i + 1]) +
            Math.abs(one.data[i + 2] - two.data[i + 2])
          if (delta <= 90) continue
          count += 1
          const vertical = y < one.height / 2 ? 'top' : 'bottom'
          const horizontal = x < one.width / 2 ? 'left' : 'right'
          quadrants[`${vertical}_${horizontal}`] += 1
        }
      }
      return { sameSize: true, count, quadrants }
    },
    [left, right],
  )
}

/**
 * 差異必須落在同一個上下半部（至少 95%），且左右較多的一側就是角落所在。
 * 標示可能橫跨超過半寬，所以左右只要求多數，上下才嚴格；像素太少視為雜訊。
 */
export function cornerOf(diff) {
  if (!diff.sameSize || diff.count < 400) return null
  const {
    top_left: tl,
    top_right: tr,
    bottom_left: bl,
    bottom_right: br,
  } = diff.quadrants
  const top = tl + tr
  const bottom = bl + br
  const vertical = top >= bottom ? 'top' : 'bottom'
  if (Math.max(top, bottom) / diff.count < 0.95) return null
  const left = vertical === 'top' ? tl : bl
  const right = vertical === 'top' ? tr : br
  if (left === right) return null
  return `${vertical}_${left > right ? 'left' : 'right'}`
}

/** 內業版輸出尺寸：後端固定的四捨五入規則（FEV-AC37），獨立重算。 */
export function expectedOfficeSize(field, edit) {
  const swap = edit.rotation === 90 || edit.rotation === 270
  const width = swap ? field.height : field.width
  const height = swap ? field.width : field.height
  if (!edit.crop) return { width, height }
  const round = (value) => Math.floor(value + 0.5)
  const { x, y, width: cw, height: ch } = edit.crop
  return {
    width: round((x + cw) * width) - round(x * width),
    height: round((y + ch) * height) - round(y * height),
  }
}

/**
 * 依 EVIDENCE_FAULT 改寫送往真後端的請求，模擬「產品壞掉」。
 * 負向控制預期走查在對應斷言失敗；沒設定時完全不介入。
 */
export async function installFault(page, fault) {
  if (!fault) return
  const rewriteBody = (route, replace) => {
    const raw = route.request().postDataBuffer()
    // latin1 讀寫可逐位元保留 JPEG 內容，只替換文字欄位。
    const text = raw.toString('latin1')
    const next = replace(text)
    if (next === text) throw new Error(`fault ${fault} did not match`)
    return route.continue({ postData: Buffer.from(next, 'latin1') })
  }
  if (fault === 'upload-corner' || fault === 'upload-source') {
    await page.route('**/api/v1/inspection-tasks/*/photos', (route) => {
      const request = route.request()
      if (request.method() !== 'POST') return route.continue()
      const text = request.postDataBuffer().toString('latin1')
      const wanted =
        fault === 'upload-corner'
          ? text.includes('"corner":"top_right"')
          : text.includes('\r\n\r\nlibrary\r\n')
      if (!wanted) return route.continue()
      return rewriteBody(route, (body) =>
        fault === 'upload-corner'
          ? body.replace('"corner":"top_right"', '"corner":"bottom_left"')
          : body.replace('\r\n\r\nlibrary\r\n', '\r\n\r\ncamera\r\n'),
      )
    })
  }
  const officeFaults = {
    'office-straighten': (body) =>
      body.replace('"straighten":5', '"straighten":0'),
    'office-layer-off': (body) =>
      body.replace('"enabled":false', '"enabled":true'),
    'office-override': (body) =>
      body.replace(
        /"inspection_location":"[^"]*"/,
        '"inspection_location":""',
      ),
  }
  if (officeFaults[fault]) {
    await page.route('**/office-version', (route) => {
      const request = route.request()
      if (request.method() !== 'PUT') return route.continue()
      const text = request.postDataBuffer().toString('latin1')
      const next = officeFaults[fault](text)
      if (next === text) return route.continue()
      return route.continue({ postData: Buffer.from(next, 'latin1') })
    })
  }
}
