#!/usr/bin/env node
// @ts-check
// 拆包檢查（SKL-AC03）。定義「造訪 /field 會載入的 chunk」：
// 所有 HTML 入口 chunk（isEntry）加上 Field chunk，一律沿
// imports 走。動態依賴以模組為單位：查每個模組在
// dynamicImportsByModule 的紀錄，importer 是路由分割點
// `src/App.tsx` 的邊不追（那是 lazy() 按需載入的路由，
// 不算 Field 載入範圍），其他模組的動態 import 都追到
// 目標所屬的 chunk。可達 chunk 含 Admin 模組就算違規。

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const FIELD_ENTRY = 'src/field/FieldPage.tsx'
const ADMIN_ENTRY = 'src/admin/AdminPage.tsx'
const ADMIN_PREFIX = 'src/admin/'
const ROUTER_MODULE = 'src/App.tsx'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(scriptDir, '..')
const distDir = path.join(frontendRoot, 'dist')
const manifestPath = path.join(distDir, '.vite', 'manifest.json')
const chunkModulesPath = path.join(distDir, '.vite', 'chunk-modules.json')

/**
 * @typedef {{
 *   fileName: string
 *   isEntry: boolean
 *   isDynamicEntry: boolean
 *   facadeModuleId: string | null
 *   imports: string[]
 *   dynamicImports: string[]
 *   moduleIds: string[]
 * }} ChunkInfo
 */

/**
 * @typedef {{
 *   chunks: ChunkInfo[]
 *   dynamicImportsByModule: Record<string, string[]>
 *   modulesWithoutInfo: string[]
 * }} ChunkModulesReport
 */

/**
 * @typedef {{ file: string, src?: string }} ManifestEntry
 */

/**
 * @param {string} label
 * @param {string} filePath
 * @returns {Promise<unknown>}
 */
async function readJsonOrExit(label, filePath) {
  /** @type {string} */
  let text
  try {
    text = await readFile(filePath, 'utf8')
  } catch {
    console.error(`找不到${label}：${filePath}`)
    console.error('請先執行 `npm run build`。')
    process.exit(1)
  }

  try {
    return JSON.parse(text)
  } catch {
    console.error(`${label} 不是合法的 JSON：${filePath}`)
    process.exit(1)
  }
}

/**
 * @param {unknown} value
 * @returns {value is ChunkModulesReport}
 */
function isChunkModulesReport(value) {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const record = /** @type {Record<string, unknown>} */ (value)
  return (
    Array.isArray(record.chunks) &&
    typeof record.dynamicImportsByModule === 'object' &&
    record.dynamicImportsByModule !== null &&
    Array.isArray(record.modulesWithoutInfo)
  )
}

async function main() {
  const manifestRaw = await readJsonOrExit('build manifest', manifestPath)
  const chunkModulesRaw = await readJsonOrExit(
    'chunk 模組清單',
    chunkModulesPath,
  )

  const manifest = /** @type {Record<string, ManifestEntry>} */ (manifestRaw)

  if (!isChunkModulesReport(chunkModulesRaw)) {
    console.error(`chunk 模組清單格式不符：${chunkModulesPath}`)
    console.error('缺少模組層級欄位，請重新 `npm run build`。')
    process.exit(1)
    return
  }

  const { chunks: chunkList, dynamicImportsByModule } = chunkModulesRaw

  const fieldEntry = manifest[FIELD_ENTRY]
  if (!fieldEntry) {
    console.error(`manifest 找不到 Field 入口：${FIELD_ENTRY}`)
    process.exit(1)
    return
  }

  const adminEntry = manifest[ADMIN_ENTRY]
  if (!adminEntry) {
    console.error(`manifest 找不到 Admin 入口：${ADMIN_ENTRY}`)
    process.exit(1)
    return
  }

  const chunksByFile = new Map(
    chunkList.map((chunk) => [chunk.fileName, chunk]),
  )

  const fieldChunk = chunksByFile.get(fieldEntry.file)
  if (!fieldChunk) {
    console.error(`找不到 Field chunk：${fieldEntry.file}`)
    process.exit(1)
    return
  }

  if (!chunksByFile.has(adminEntry.file)) {
    console.error(`找不到 Admin chunk：${adminEntry.file}`)
    process.exit(1)
    return
  }

  const htmlEntryChunks = chunkList.filter((chunk) => chunk.isEntry)
  if (htmlEntryChunks.length === 0) {
    console.error('找不到任何 HTML 入口 chunk（isEntry）。')
    process.exit(1)
    return
  }

  /** @type {Map<string, ChunkInfo>} */
  const moduleToChunk = new Map()
  for (const chunk of chunkList) {
    for (const moduleId of chunk.moduleIds) {
      moduleToChunk.set(moduleId, chunk)
    }
  }

  if (!moduleToChunk.has(ROUTER_MODULE)) {
    console.error(`找不到路由分割點模組：${ROUTER_MODULE}`)
    process.exit(1)
    return
  }

  /** @type {Set<string>} */
  const visited = new Set()
  /** @type {ChunkInfo[]} */
  const queue = []

  /** @param {ChunkInfo} chunk */
  function enqueue(chunk) {
    if (visited.has(chunk.fileName)) {
      return
    }
    visited.add(chunk.fileName)
    queue.push(chunk)
  }

  enqueue(fieldChunk)
  for (const chunk of htmlEntryChunks) {
    enqueue(chunk)
  }

  /** @type {Set<string>} */
  const violationKeys = new Set()
  /** @type {{ chunk: string, moduleId: string }[]} */
  const violations = []

  /**
   * @param {string} chunkFileName
   * @param {string} moduleId
   */
  function recordViolation(chunkFileName, moduleId) {
    const key = `${chunkFileName}::${moduleId}`
    if (violationKeys.has(key)) {
      return
    }
    violationKeys.add(key)
    violations.push({ chunk: chunkFileName, moduleId })
  }

  let totalModules = 0

  while (queue.length > 0) {
    const chunk = /** @type {ChunkInfo} */ (queue.shift())

    totalModules += chunk.moduleIds.length
    for (const moduleId of chunk.moduleIds) {
      if (moduleId.startsWith(ADMIN_PREFIX)) {
        recordViolation(chunk.fileName, moduleId)
      }
    }

    for (const fileName of chunk.imports) {
      const nextChunk = chunksByFile.get(fileName)
      if (!nextChunk) {
        console.error(
          `chunk 的 imports 指向不存在的 chunk：` +
            `${fileName}（來自 ${chunk.fileName}）`,
        )
        process.exit(1)
        return
      }
      enqueue(nextChunk)
    }

    for (const moduleId of chunk.moduleIds) {
      if (moduleId === ROUTER_MODULE) {
        continue
      }
      const targets = dynamicImportsByModule[moduleId]
      if (targets === undefined) {
        continue
      }
      for (const target of targets) {
        const targetChunk = moduleToChunk.get(target)
        if (!targetChunk) {
          console.error(
            `動態 import 目標找不到所屬 chunk：` +
              `${target}（來自 ${moduleId}）`,
          )
          process.exit(1)
          return
        }
        if (target.startsWith(ADMIN_PREFIX)) {
          recordViolation(targetChunk.fileName, target)
        }
        enqueue(targetChunk)
      }
    }
  }

  if (violations.length > 0) {
    console.error('造訪 /field 會載入的 chunk 含有 Admin 模組：')
    for (const violation of violations) {
      console.error(`  - ${violation.chunk} <- ${violation.moduleId}`)
    }
    process.exit(1)
    return
  }

  console.log(
    `拆包檢查通過：檢查了 ${visited.size} 個 chunk、` +
      `${totalModules} 個模組，未見 Admin 模組。`,
  )
}

await main()
