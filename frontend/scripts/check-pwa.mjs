import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const dist = path.resolve('dist')
const html = await readFile(path.join(dist, 'index.html'), 'utf8')
const manifestLink = /<link\s+rel="manifest"\s+href="([^"]+)"/i.exec(html)
const iconLink = /<link\s+rel="apple-touch-icon"\s+href="([^"]+)"/i.exec(html)

assert.match(html, /<meta\s+name="viewport"[^>]*>/i)
assert.match(html, /<meta\s+name="theme-color"[^>]*>/i)
assert.match(
  html,
  /<meta\s+name="apple-mobile-web-app-capable"\s+content="yes"/i,
)
assert.ok(manifestLink, 'built HTML must link a web app manifest')
assert.ok(iconLink, 'built HTML must link an Apple touch icon')

const manifestPath = path.join(dist, manifestLink[1].replace(/^\//, ''))
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
assert.equal(manifest.start_url, '/field/')
assert.equal(manifest.display, 'standalone')
assert.ok(manifest.name)
assert.ok(manifest.theme_color)
assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2)

for (const icon of manifest.icons) {
  const filePath = path.join(dist, icon.src.replace(/^\//, ''))
  const image = await readFile(filePath)
  assert.equal(image.toString('hex', 0, 8), '89504e470d0a1a0a')
  const width = image.readUInt32BE(16)
  const height = image.readUInt32BE(20)
  assert.equal(icon.sizes, `${width}x${height}`)
}

const appleIconPath = path.join(dist, iconLink[1].replace(/^\//, ''))
const appleIcon = await readFile(appleIconPath)
assert.equal(appleIcon.toString('hex', 0, 8), '89504e470d0a1a0a')
assert.equal(appleIcon.readUInt32BE(16), 180)
assert.equal(appleIcon.readUInt32BE(20), 180)
assert.equal(appleIcon[25], 2, 'Apple touch icon must be opaque RGB')

/** @param {string} directory @returns {Promise<string[]>} */
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)))
    } else {
      files.push(fullPath)
    }
  }
  return files
}

const files = await walk(dist)
for (const file of files.filter((entry) => entry.endsWith('.js'))) {
  const bundle = await readFile(file, 'utf8')
  assert.doesNotMatch(
    bundle,
    /navigator\s*\.\s*serviceWorker\s*\.\s*register\s*\(/,
    'build must not register a service worker',
  )
}

console.log('PWA build artifact checks passed')
