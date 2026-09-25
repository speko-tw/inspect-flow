#!/usr/bin/env node
// @ts-check
// 拆包檢查（SKL-AC03）。定義「造訪 /field 會載入的 chunk」：
// 所有 HTML 入口 chunk（isEntry）加上 Field chunk，一律沿
// imports 走，也沿 dynamicImports 走；唯一例外是含
// `src/App.tsx`（路由分割點）的 chunk 發出的 dynamicImports
// 不追：那是 lazy() 按需載入的路由，不算 Field 載入範圍。
// 可達 chunk 只要含 Admin 模組就算違規。

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
 * @param {ChunkInfo} chunk
 * @returns {boolean}
 */
function isRouterChunk(chunk) {
  return chunk.moduleIds.includes(ROUTER_MODULE)
}

async function main() {
  const manifestRaw = await readJsonOrExit('build manifest', manifestPath)
  const chunkModulesRaw = await readJsonOrExit(
    'chunk 模組清單',
    chunkModulesPath,
  )

  const manifest = /** @type {Record<string, ManifestEntry>} */ (manifestRaw)
  const chunkList = /** @type {ChunkInfo[]} */ (chunkModulesRaw)

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

  if (!chunkList.some(isRouterChunk)) {
    console.error(`找不到路由分割點 chunk：${ROUTER_MODULE}`)
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

  /** @type {{ chunk: string, moduleId: string }[]} */
  const violations = []
  let totalModules = 0

  while (queue.length > 0) {
    const chunk = /** @type {ChunkInfo} */ (queue.shift())

    totalModules += chunk.moduleIds.length
    for (const moduleId of chunk.moduleIds) {
      if (moduleId.startsWith(ADMIN_PREFIX)) {
        violations.push({ chunk: chunk.fileName, moduleId })
      }
    }

    const nextFileNames = isRouterChunk(chunk)
      ? chunk.imports
      : [...chunk.imports, ...chunk.dynamicImports]

    for (const fileName of nextFileNames) {
      const nextChunk = chunksByFile.get(fileName)
      if (!nextChunk) {
        continue
      }
      enqueue(nextChunk)
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
