import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router'

import { getWorkflowSummary, type WorkflowSummary } from './api'

// Project home and its first destination share one response during the short
// route transition. A summary must not become a long-lived permission cache.
const MAX_AGE_MS = 30_000

interface CachedSummary {
  projectId: string
  promise: Promise<WorkflowSummary>
  settledAt: number | null
}

interface WorkflowSummaryContextValue {
  loadHomeSummary: (projectId: string) => Promise<WorkflowSummary>
  loadSectionSummary: (projectId: string) => Promise<WorkflowSummary>
}

const WorkflowSummaryContext =
  createContext<WorkflowSummaryContextValue | null>(null)

function routeProjectId(pathname: string): string | null {
  const match = pathname.match(/^\/admin\/projects\/([^/]+)/)
  return match?.[1] ?? null
}

export function WorkflowSummaryProvider({
  children,
}: {
  children: ReactNode
}) {
  const location = useLocation()
  const activeProjectId = routeProjectId(location.pathname)
  return (
    <WorkflowSummaryCache key={activeProjectId}>
      {children}
    </WorkflowSummaryCache>
  )
}

function WorkflowSummaryCache({ children }: { children: ReactNode }) {
  const cache = useRef<CachedSummary | null>(null)

  const loadHomeSummary = useCallback((projectId: string) => {
    const existing = cache.current
    if (existing?.projectId === projectId && existing.settledAt === null) {
      return existing.promise
    }

    const entry: CachedSummary = {
      projectId,
      promise: getWorkflowSummary(projectId),
      settledAt: null,
    }
    cache.current = entry
    void entry.promise.then(
      () => {
        entry.settledAt = Date.now()
      },
      () => {
        if (cache.current === entry) cache.current = null
      },
    )
    return entry.promise
  }, [])

  const loadSectionSummary = useCallback((projectId: string) => {
    const existing = cache.current
    if (existing?.projectId === projectId) {
      cache.current = null
      if (
        existing.settledAt === null ||
        Date.now() - existing.settledAt <= MAX_AGE_MS
      ) {
        return existing.promise
      }
    }
    // StrictMode may rerun this effect in development after the first call
    // consumed the one-time entry, so that second effect issues a new request.
    return getWorkflowSummary(projectId)
  }, [])

  const value = useMemo(
    () => ({ loadHomeSummary, loadSectionSummary }),
    [loadHomeSummary, loadSectionSummary],
  )

  return (
    <WorkflowSummaryContext.Provider value={value}>
      {children}
    </WorkflowSummaryContext.Provider>
  )
}

export function useWorkflowSummary() {
  const value = useContext(WorkflowSummaryContext)
  if (value === null) {
    throw new Error('useWorkflowSummary 必須在 WorkflowSummaryProvider 內使用')
  }
  return value
}
