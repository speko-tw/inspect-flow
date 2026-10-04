import { describe, expect, it } from 'vitest'

import {
  createLanAccessPlugin,
  isIpv4InCidr,
  resolveDevHttps,
} from './vite.config'

type Request = {
  socket: { remoteAddress?: string }
  headers?: Record<string, string>
}
type Response = { statusCode: number; end: (body: string) => void }
type Middleware = (
  request: Request,
  response: Response,
  next: () => void,
) => void

function getLanMiddleware(cidr: string): Middleware {
  const plugin = createLanAccessPlugin(cidr, '192.168.1.20')
  let middleware: Middleware | undefined
  plugin.configureServer?.({
    middlewares: {
      use(handler: Middleware) {
        middleware = handler
        return this
      },
    },
  } as never)
  if (!middleware) {
    throw new Error('LAN access middleware was not registered')
  }
  return middleware
}

describe('LAN development server access', () => {
  it('allows requests from the configured IPv4 subnet', () => {
    const middleware = getLanMiddleware('192.168.1.0/24')
    const response: Response = {
      statusCode: 200,
      end: () => undefined,
    }
    let nextCalled = false

    middleware(
      {
        socket: { remoteAddress: '192.168.1.42' },
        headers: { host: '192.168.1.20:5173' },
      },
      response,
      () => {
        nextCalled = true
      },
    )

    expect(nextCalled).toBe(true)
    expect(response.statusCode).toBe(200)
  })

  it('returns 403 for requests outside the configured subnet', () => {
    const middleware = getLanMiddleware('192.168.1.0/24')
    let body = ''
    const response: Response = {
      statusCode: 200,
      end: (value) => {
        body = value
      },
    }
    let nextCalled = false

    middleware(
      {
        socket: { remoteAddress: '192.168.2.42' },
        headers: { host: '192.168.1.20:5173' },
      },
      response,
      () => {
        nextCalled = true
      },
    )

    expect(response.statusCode).toBe(403)
    expect(body).toBe('LAN source or Host is not allowed')
    expect(nextCalled).toBe(false)
  })

  it('uses the socket address and ignores a spoofed forwarding header', () => {
    const middleware = getLanMiddleware('192.168.1.0/24')
    const response: Response = {
      statusCode: 200,
      end: () => undefined,
    }

    middleware(
      {
        socket: { remoteAddress: '192.168.2.42' },
        headers: {
          host: '192.168.1.20:5173',
          'x-forwarded-for': '192.168.1.42',
        },
      },
      response,
      () => undefined,
    )

    expect(response.statusCode).toBe(403)
  })

  it('rejects a network that would allow every IPv4 source', () => {
    expect(() => createLanAccessPlugin('0.0.0.0/0', '192.168.1.20')).toThrow(
      '/0',
    )
    expect(isIpv4InCidr('192.168.1.42', '192.168.1.0/24')).toBe(true)
    expect(isIpv4InCidr('192.168.2.42', '192.168.1.0/24')).toBe(false)
    expect(isIpv4InCidr('::ffff:192.168.1.42', '192.168.1.0/24')).toBe(true)
    expect(isIpv4InCidr('::ffff:c0a8:012a', '192.168.1.0/24')).toBe(true)
    expect(isIpv4InCidr('2001:db8::1', '192.168.1.0/24')).toBe(false)
  })

  it('requires both the interface and source subnet when LAN is enabled', () => {
    expect(() =>
      resolveDevHttps({ INSPECTFLOW_DEV_HOST: '192.168.1.20' }),
    ).toThrow('INSPECTFLOW_DEV_ALLOWED_CIDR')
    expect(() =>
      resolveDevHttps({ INSPECTFLOW_DEV_ALLOWED_CIDR: '192.168.1.0/24' }),
    ).toThrow('INSPECTFLOW_DEV_HOST')
    expect(() =>
      resolveDevHttps({
        INSPECTFLOW_DEV_HOST: '0.0.0.0',
        INSPECTFLOW_DEV_ALLOWED_CIDR: '192.168.1.0/24',
      }),
    ).toThrow('網卡位址')
  })

  it('binds to and allows only the configured interface Host', () => {
    const config = resolveDevHttps({
      INSPECTFLOW_DEV_HTTPS_CERT: 'package.json',
      INSPECTFLOW_DEV_HTTPS_KEY: 'package.json',
      INSPECTFLOW_DEV_HOST: '192.168.1.20',
      INSPECTFLOW_DEV_ALLOWED_CIDR: '192.168.1.0/24',
    })

    expect(config.host).toBe('192.168.1.20')
    expect(config.allowedHosts).toEqual(['192.168.1.20'])
  })
})
