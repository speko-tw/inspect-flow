import fs from 'node:fs'
import { isIPv4 } from 'node:net'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

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

/**
 * 開發伺服器的 HTTPS 設定（#169）。Safari 在 http://localhost
 * 不送 `__Host-` 前綴的 Secure Cookie，要在 Safari／iPhone 驗收
 * 登入就得用 HTTPS。憑證用 mkcert 等工具在本機產生，不進版控：
 *
 * - INSPECTFLOW_DEV_HTTPS_CERT、INSPECTFLOW_DEV_HTTPS_KEY：憑證與
 *   私鑰的檔案路徑，兩個都設才啟用 HTTPS；都不設就維持 HTTP。
 * - INSPECTFLOW_DEV_HOST：開發伺服器綁定的 IPv4 網卡位址；與
 *   CIDR 限制允許來源；HOST 限制綁定網卡。
 *   兩者只在 HTTPS 模式接受；未設定時只綁本機。
 *
 * 不用 VITE_ 前綴，這些值才不會被 Vite 帶進前端程式。
 */
function parseIpv4Cidr(cidr: string): {
  network: number
  mask: number
} {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d|[12]\d|3[0-2])$/.exec(cidr)
  if (!match || !isIPv4(match[1])) {
    throw new Error(
      'INSPECTFLOW_DEV_ALLOWED_CIDR 必須是 IPv4 CIDR，' +
        '例如 192.168.1.0/24',
    )
  }
  const prefix = Number(match[2])
  if (prefix < 1) {
    throw new Error('INSPECTFLOW_DEV_ALLOWED_CIDR 不可使用 /0')
  }
  const network =
    match[1]
      .split('.')
      .reduce((value, octet) => (value << 8) | Number(octet), 0) >>> 0
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  return { network: (network & mask) >>> 0, mask }
}

export function isIpv4InCidr(address: string, cidr: string): boolean {
  const normalized = normalizeIpv4Address(address)
  if (!normalized) {
    return false
  }
  const { network, mask } = parseIpv4Cidr(cidr)
  const value =
    normalized
      .split('.')
      .reduce((result, octet) => (result << 8) | Number(octet), 0) >>> 0
  return (value & mask) >>> 0 === network
}

function normalizeIpv4Address(address: string): string | undefined {
  if (isIPv4(address)) {
    return address
  }
  const mapped = /^(?:::ffff:)(.+)$/i.exec(address)
  if (!mapped) {
    return undefined
  }
  if (isIPv4(mapped[1])) {
    return mapped[1]
  }
  const hex = /^([\da-f]{1,4}):([\da-f]{1,4})$/i.exec(mapped[1])
  if (!hex) {
    return undefined
  }
  const high = Number.parseInt(hex[1], 16)
  const low = Number.parseInt(hex[2], 16)
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
}

function isAllowedHost(hostHeader: string | undefined, host: string): boolean {
  if (!hostHeader) {
    return false
  }
  try {
    return new URL(`http://${hostHeader}`).hostname === host
  } catch {
    return false
  }
}

function isAllowedConnection(
  address: string | undefined,
  hostHeader: string | undefined,
  cidr: string,
  host: string,
): boolean {
  return isIpv4InCidr(address || '', cidr) && isAllowedHost(hostHeader, host)
}

function rejectUpgrade(socket: NodeJS.WritableStream): void {
  socket.end(
    'HTTP/1.1 403 Forbidden\r\n' +
      'Connection: close\r\n' +
      'Content-Length: 0\r\n\r\n',
  )
}

export function createLanAccessPlugin(cidr: string, host: string): Plugin {
  parseIpv4Cidr(cidr)
  return {
    name: 'inspectflow-lan-access-guard',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const address = request.socket.remoteAddress || ''
        if (!isAllowedConnection(address, request.headers.host, cidr, host)) {
          response.statusCode = 403
          response.end('LAN source or Host is not allowed')
          return
        }
        next()
      })
      server.httpServer?.prependListener('upgrade', (request, socket) => {
        if (
          isAllowedConnection(
            socket.remoteAddress,
            request.headers.host,
            cidr,
            host,
          )
        ) {
          return
        }
        delete request.headers['sec-websocket-protocol']
        rejectUpgrade(socket)
      })
    },
  }
}

export function resolveDevHttps(env: Record<string, string>): {
  https?: { cert: Buffer; key: Buffer }
  host?: string
  allowedHosts?: string[]
  lanAccessPlugin?: Plugin
} {
  const certPath = env.INSPECTFLOW_DEV_HTTPS_CERT
  const keyPath = env.INSPECTFLOW_DEV_HTTPS_KEY
  const host = env.INSPECTFLOW_DEV_HOST
  const allowedCidr = env.INSPECTFLOW_DEV_ALLOWED_CIDR

  if (allowedCidr && !host) {
    throw new Error(
      '設定 INSPECTFLOW_DEV_ALLOWED_CIDR 時，' +
        '必須同時設定 INSPECTFLOW_DEV_HOST',
    )
  }
  if (host && !allowedCidr) {
    throw new Error(
      '設定 INSPECTFLOW_DEV_HOST 時，' +
        '必須同時設定 INSPECTFLOW_DEV_ALLOWED_CIDR',
    )
  }
  if (
    host &&
    (!isIPv4(host) || host === '0.0.0.0' || host.startsWith('127.'))
  ) {
    throw new Error(
      'INSPECTFLOW_DEV_HOST 必須是指定的非 loopback IPv4 網卡位址',
    )
  }
  if (allowedCidr) {
    parseIpv4Cidr(allowedCidr)
  }

  if (!certPath && !keyPath) {
    if (host || allowedCidr) {
      throw new Error(
        'INSPECTFLOW_DEV_HOST 與 INSPECTFLOW_DEV_ALLOWED_CIDR ' +
          '只能在 HTTPS 模式使用，' +
          '請同時設定 INSPECTFLOW_DEV_HTTPS_CERT 與 ' +
          'INSPECTFLOW_DEV_HTTPS_KEY',
      )
    }
    return {}
  }
  if (!certPath || !keyPath) {
    throw new Error(
      'INSPECTFLOW_DEV_HTTPS_CERT 與 INSPECTFLOW_DEV_HTTPS_KEY ' +
        '必須同時設定',
    )
  }

  return {
    https: {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    },
    host: host || undefined,
    allowedHosts: host ? [host] : undefined,
    lanAccessPlugin:
      host && allowedCidr
        ? createLanAccessPlugin(allowedCidr, host)
        : undefined,
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode, command, isPreview }) => {
  // 開發用的後端位址。預設 http://localhost:8000（後端目前的預設
  // port，見 docs/specs/authentication/plan.md 風險段）；可用
  // VITE_BACKEND_URL 覆寫，不需改這個檔案就能切換到不同的後端。
  const env = loadEnv(mode, process.cwd(), '')
  const backendUrl = env.VITE_BACKEND_URL || 'http://localhost:8000'
  const repoRoot = path.resolve(process.cwd(), '..')
  let version = env.INSPECTFLOW_VERSION
  if (!version) {
    const versionPath = path.join(repoRoot, 'VERSION')
    try {
      version = fs.readFileSync(versionPath, 'utf8').trim()
    } catch (error) {
      throw new Error(`Unable to read release version from ${versionPath}`, {
        cause: error,
      })
    }
    if (!version) {
      throw new Error(`Release version is empty in ${versionPath}`)
    }
  }
  let commit = env.INSPECTFLOW_COMMIT || ''
  if (!commit) {
    try {
      commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch {
      commit = ''
    }
  }
  // 只有開發伺服器（vite serve）才讀憑證；build、preview 與 vitest
  // 不受影響（preview 的 command 也是 serve，要另外排除）。
  const isDevServer = command === 'serve' && !isPreview && mode !== 'test'
  const devHttps = isDevServer ? resolveDevHttps(env) : {}
  const { lanAccessPlugin, ...devServerOptions } = devHttps

  return {
    define: {
      __INSPECTFLOW_VERSION__: JSON.stringify(version),
      __INSPECTFLOW_COMMIT__: JSON.stringify(commit),
    },
    plugins: [
      react(),
      chunkModulesReportPlugin(),
      ...(lanAccessPlugin ? [lanAccessPlugin] : []),
    ],
    build: {
      manifest: true,
    },
    server: {
      ...devServerOptions,
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
