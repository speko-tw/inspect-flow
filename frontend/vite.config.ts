import path from 'node:path'

import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig, type Plugin } from 'vitest/config'

/**
 * Strips the leading virtual-module marker (`\0`) that Rollup/Rolldown
 * prepends to synthetic module ids, then converts the id to a path
 * relative to `root` using forward slashes.
 */
function toRelativeModuleId(id: string, root: string): string {
  const stripped = id.startsWith('\0') ? id.slice(1) : id
  return path.relative(root, stripped).split(path.sep).join('/')
}

/**
 * Emits `dist/.vite/chunk-modules.json`: for every output chunk, which
 * modules were bundled into it, plus a module-level dynamic-import
 * graph (`dynamicImportsByModule`). The Vite manifest only records
 * each chunk's entry `src`, not the other modules merged into it, and
 * a chunk-level dynamic-import list is too coarse to tell which
 * *module* inside a shared chunk issued a given `import()` — so a
 * split-boundary check needs per-module data to avoid both false
 * positives and false negatives. This file provides that.
 *
 * A project-source module (its id resolves under `<root>/src/`) is
 * the only kind of module that could plausibly `import()` an Admin
 * module, so its `dynamicallyImportedIds` must be available — if
 * `getModuleInfo` can't provide it, that's treated as a hard build
 * failure rather than silently assumed to have no dynamic imports.
 * Any other module (dependencies, Rolldown-injected runtime helpers)
 * cannot reference project source, so a missing `ModuleInfo` for one
 * of those is recorded in `modulesWithoutInfo` and treated as having
 * no dynamic imports.
 */
function chunkModulesReportPlugin(): Plugin {
  let root = process.cwd()

  return {
    name: 'chunk-modules-report',
    apply: 'build',
    configResolved(resolvedConfig) {
      root = resolvedConfig.root
    },
    generateBundle(_options, bundle) {
      const dynamicImportsByModule: Record<string, string[]> = {}
      const modulesWithoutInfo: string[] = []
      const seenModules = new Set<string>()

      const chunks = []
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') {
          continue
        }

        for (const rawId of item.moduleIds) {
          if (seenModules.has(rawId)) {
            continue
          }
          seenModules.add(rawId)

          const relId = toRelativeModuleId(rawId, root)
          const isProjectSource = relId.startsWith('src/')
          const info = this.getModuleInfo(rawId)

          if (
            isProjectSource &&
            (info === null || !Array.isArray(info.dynamicallyImportedIds))
          ) {
            this.error('取不到動態 import 資訊：' + relId)
          }

          if (info !== null && Array.isArray(info.dynamicallyImportedIds)) {
            dynamicImportsByModule[relId] = info.dynamicallyImportedIds.map(
              (id) => toRelativeModuleId(id, root),
            )
          } else {
            modulesWithoutInfo.push(relId)
          }
        }

        chunks.push({
          fileName: item.fileName,
          isEntry: item.isEntry,
          isDynamicEntry: item.isDynamicEntry,
          facadeModuleId: item.facadeModuleId
            ? toRelativeModuleId(item.facadeModuleId, root)
            : null,
          imports: item.imports,
          dynamicImports: item.dynamicImports,
          moduleIds: item.moduleIds.map((id: string) =>
            toRelativeModuleId(id, root),
          ),
        })
      }

      this.emitFile({
        type: 'asset',
        fileName: '.vite/chunk-modules.json',
        source: JSON.stringify(
          { chunks, dynamicImportsByModule, modulesWithoutInfo },
          null,
          2,
        ),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 開發用的後端位址。預設 http://localhost:8000（後端目前的預設
  // port，見 docs/specs/authentication/plan.md 風險段）；可用
  // VITE_BACKEND_URL 覆寫，不需改這個檔案就能切換到不同的後端。
  const env = loadEnv(mode, process.cwd(), '')
  const backendUrl = env.VITE_BACKEND_URL || 'http://localhost:8000'

  return {
    plugins: [react(), chunkModulesReportPlugin()],
    build: {
      manifest: true,
    },
    server: {
      proxy: {
        // 讓前端以同一個 origin 呼叫後端 API，開發環境不需要
        // CORS；同時符合 AUT-R30：Cookie 由瀏覽器依同源規則
        // 自動處理，前端不需另外設定。
        '/api': {
          target: backendUrl,
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/setupTests.ts'],
    },
  }
})
