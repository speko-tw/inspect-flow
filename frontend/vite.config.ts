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
 * modules were bundled into it. The Vite manifest only records each
 * chunk's entry `src`, not the other modules merged into it, so a
 * split-boundary check based on the manifest alone cannot see a module
 * that got pulled into a shared chunk. This file fills that gap.
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
      const chunks = []
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') {
          continue
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
        source: JSON.stringify(chunks, null, 2),
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
