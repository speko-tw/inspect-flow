import path from 'node:path'

import react from '@vitejs/plugin-react'
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
export default defineConfig({
  plugins: [react(), chunkModulesReportPlugin()],
  build: {
    manifest: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
  },
})
