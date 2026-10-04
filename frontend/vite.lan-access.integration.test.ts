// @vitest-environment node

import http from 'node:http'
import net from 'node:net'

import { createServer } from 'vite'
import { describe, expect, it } from 'vitest'

import { createLanAccessPlugin } from './vite.config'

function httpStatus(
  address: string,
  port: number,
  hostHeader: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        hostname: address,
        port,
        path: '/',
        headers: { host: hostHeader },
      },
      (response) => {
        response.resume()
        resolve(response.statusCode || 0)
      },
    )
    request.on('error', reject)
  })
}

function websocketStatus(
  address: string,
  port: number,
  hostHeader: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: address, port })
    let response = ''
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error('WebSocket handshake timed out'))
    }, 5000)

    socket.once('connect', () => {
      socket.write(
        `GET / HTTP/1.1\r\n` +
          `Host: ${hostHeader}\r\n` +
          'Connection: Upgrade\r\n' +
          'Upgrade: websocket\r\n' +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
          'Sec-WebSocket-Version: 13\r\n' +
          'Sec-WebSocket-Protocol: vite-hmr\r\n\r\n',
      )
    })
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8')
      if (response.includes('\r\n\r\n')) {
        clearTimeout(timeout)
        const status = response.split('\r\n', 1)[0]
        socket.destroy()
        resolve(status)
      }
    })
    socket.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
}

describe('Vite LAN HTTP and WebSocket access integration', () => {
  it('allows the configured peer and rejects other peers and Host values', async () => {
    const server = await createServer({
      configFile: false,
      root: process.cwd(),
      logLevel: 'silent',
      plugins: [createLanAccessPlugin('127.0.0.1/32', '127.0.0.1')],
      optimizeDeps: { noDiscovery: true, include: [] },
      server: {
        host: '::',
        port: 0,
        strictPort: true,
        allowedHosts: ['127.0.0.1'],
      },
    })

    try {
      await server.listen()
      const httpServer = server.httpServer
      const address = httpServer?.address()
      if (!address || typeof address === 'string') {
        throw new Error('Vite did not expose a TCP address')
      }
      const { port } = address
      const allowedHost = `127.0.0.1:${port}`
      const deniedHost = `127.0.0.2:${port}`

      expect(await httpStatus('127.0.0.1', port, allowedHost)).toBe(200)
      expect(await httpStatus('::1', port, allowedHost)).toBe(403)
      expect(await httpStatus('127.0.0.1', port, deniedHost)).toBe(403)

      expect(await websocketStatus('127.0.0.1', port, allowedHost)).toMatch(
        /^HTTP\/1\.1 101 /,
      )
      expect(await websocketStatus('::1', port, allowedHost)).toMatch(
        /^HTTP\/1\.1 403 /,
      )
      expect(await websocketStatus('127.0.0.1', port, deniedHost)).toMatch(
        /^HTTP\/1\.1 403 /,
      )
    } finally {
      await server.close()
    }
  }, 20000)
})
