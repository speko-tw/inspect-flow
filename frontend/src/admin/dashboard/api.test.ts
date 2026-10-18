import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  canOpenDashboard,
  getDashboardSummary,
  getDashboardTask,
  hasGlobalDashboardAccess,
  listAllDashboardProjects,
  listDashboardEngineers,
  listDashboardProjects,
  listDashboardTasks,
} from './api'

describe('dashboard API client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the global summary without deriving its values', async () => {
    const summary = {
      pending_count: 4,
      in_progress_count: 2,
      completed_count: 3,
      completion_rate: 0.6,
    }
    const fetchMock = vi.fn(async () => Response.json(summary))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getDashboardSummary()).resolves.toEqual(summary)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/dashboard/summary',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('requests a project summary within the selected scope', async () => {
    const summary = {
      pending_count: 1,
      in_progress_count: 0,
      completed_count: 2,
      completion_rate: 1,
    }
    const fetchMock = vi.fn(async () => Response.json(summary))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getDashboardSummary('project-1')).resolves.toEqual(summary)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/dashboard/summary?project_id=project-1',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('preserves API project metrics and sends search and cursor', async () => {
    const page = {
      items: [
        {
          project_id: 'project-1',
          name: '東區工程',
          pending_count: 2,
          in_progress_count: 1,
          completed_count: 3,
          completion_denominator_count: 6,
          completion_rate: 0.5,
        },
      ],
      next_cursor: 'next-page',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input
      return Response.json(page)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      listDashboardProjects({
        q: ' 東區 ',
        cursor: 'cursor / 2',
        limit: 7,
      }),
    ).resolves.toEqual(page)

    const [url] = fetchMock.mock.calls[0]
    const query = new URL(String(url), 'http://localhost').searchParams
    expect(String(url)).toContain('/api/v1/admin/dashboard/projects?')
    expect(query.get('q')).toBe('東區')
    expect(query.get('cursor')).toBe('cursor / 2')
    expect(query.get('limit')).toBe('7')
  })

  it('reads the task allowlist with cursor pagination', async () => {
    const page = {
      items: [
        {
          task_id: 'task-1',
          status: 'IN_PROGRESS',
          location: { zone_name: 'A 區', location_text: '二樓' },
          suggested_assignee: {
            user_id: 'user-1',
            name_zh: '陳工程師',
          },
        },
      ],
      next_cursor: 'next',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input
      return Response.json(page)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      listDashboardTasks('project-1', { cursor: 'next / 1', limit: 7 }),
    ).resolves.toEqual(page)

    const [url] = fetchMock.mock.calls[0]
    const parsed = new URL(String(url), 'http://localhost')
    expect(parsed.pathname).toBe(
      '/api/v1/admin/dashboard/projects/project-1/tasks',
    )
    expect(parsed.searchParams.get('cursor')).toBe('next / 1')
    expect(parsed.searchParams.get('limit')).toBe('7')
  })

  it('reads task detail from the scoped dashboard endpoint', async () => {
    const task = {
      task_id: 'task-1',
      status: 'PENDING',
      location: { zone_name: null, location_text: '屋頂' },
      suggested_assignee: null,
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input
      return Response.json(task)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getDashboardTask('project-1', 'task-1')).resolves.toEqual(
      task,
    )
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/api/v1/admin/dashboard/projects/project-1/tasks/task-1',
    )
  })

  it('uses the API page size when no options are supplied', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input
      return Response.json({ items: [], next_cursor: null })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(listDashboardProjects()).resolves.toEqual({
      items: [],
      next_cursor: null,
    })

    expect(String(fetchMock.mock.calls[0][0])).toContain('limit=50')
  })

  it('keeps engineer assignment counts and project scope', async () => {
    const page = {
      items: [
        {
          user_id: 'user-1',
          username: 'engineer-1',
          name_zh: '陳工程師',
          assigned_pending_count: 1,
          assigned_in_progress_count: 2,
          started_in_progress_count: 3,
          completed_by_count: 4,
        },
      ],
      next_cursor: 'next',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input
      return Response.json(page)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      listDashboardEngineers({
        projectId: 'project-1',
        q: ' 陳 ',
        cursor: 'cursor / 2',
        limit: 7,
      }),
    ).resolves.toEqual(page)

    const [url] = fetchMock.mock.calls[0]
    const query = new URL(String(url), 'http://localhost').searchParams
    expect(query.get('project_id')).toBe('project-1')
    expect(query.get('q')).toBe('陳')
    expect(query.get('cursor')).toBe('cursor / 2')
    expect(query.get('limit')).toBe('7')
  })

  it('collects visible project options across cursor pages', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      return url.searchParams.has('cursor')
        ? Response.json({ items: [], next_cursor: null })
        : Response.json({
            items: [
              {
                project_id: 'project-1',
                name: '東區工程',
                pending_count: 0,
                in_progress_count: 0,
                completed_count: 0,
                completion_denominator_count: 0,
                completion_rate: 0,
              },
            ],
            next_cursor: 'next',
          })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(listAllDashboardProjects()).resolves.toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('allows global progress permission without inspection.use', async () => {
    expect(
      hasGlobalDashboardAccess({
        is_admin: false,
        module_permissions: ['all_project_progress.read'],
      }),
    ).toBe(true)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      canOpenDashboard({
        is_admin: false,
        module_permissions: ['all_project_progress.read'],
      }),
    ).resolves.toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('probes project-scoped access using the backend list', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input
      return Response.json({
        items: [{ project_id: 'project-1', name: '東區工程' }],
        next_cursor: null,
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      canOpenDashboard({ is_admin: false, module_permissions: [] }),
    ).resolves.toBe(true)
    expect(String(fetchMock.mock.calls[0][0])).toContain('limit=1')
  })
})
