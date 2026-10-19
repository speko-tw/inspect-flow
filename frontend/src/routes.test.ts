import { describe, expect, it } from 'vitest'

import { ROUTES } from './routes'

describe('product route metadata', () => {
  it('declares a path, page title, and permission for every route', () => {
    for (const [name, route] of Object.entries(ROUTES)) {
      expect(route.path, name).toBeTruthy()
      expect(route.title, name).toBeTruthy()
      expect(route.permission, name).toBeTruthy()
    }
  })
})
