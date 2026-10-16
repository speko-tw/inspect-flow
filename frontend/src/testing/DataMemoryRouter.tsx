import { createContext, useContext, useState, type ReactNode } from 'react'
import {
  createMemoryRouter,
  RouterProvider,
  type InitialEntry,
} from 'react-router'

const RouterChildren = createContext<ReactNode>(null)

function RoutedChildren() {
  return useContext(RouterChildren)
}

/** 用記憶體 Data Router 測試需要 blocker 的頁面。 */
export function DataMemoryRouter({
  children,
  initialEntries = ['/'],
  initialIndex,
}: {
  children: ReactNode
  initialEntries?: InitialEntry[]
  initialIndex?: number
}) {
  const [router] = useState(() =>
    createMemoryRouter([{ path: '*', element: <RoutedChildren /> }], {
      initialEntries,
      initialIndex,
    }),
  )
  return (
    <RouterChildren.Provider value={children}>
      <RouterProvider router={router} />
    </RouterChildren.Provider>
  )
}
