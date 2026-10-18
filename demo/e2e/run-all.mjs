import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const tests = [
  'walkthrough.mjs',
  'field-acceptance.mjs',
]

for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(here, test)], {
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
