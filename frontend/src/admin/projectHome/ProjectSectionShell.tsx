import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router'

import { BackLink } from '../../layout/BackLink'
import { ROUTES } from '../../routes'
import { PAGE_TITLES } from '../../terms'

const SECTIONS = [
  { id: 'home', label: PAGE_TITLES.projectHome, route: ROUTES.projectHome },
  {
    id: 'members',
    label: PAGE_TITLES.projectMembers,
    route: ROUTES.projectMembers,
  },
  {
    id: 'inspection-items',
    label: PAGE_TITLES.projectItems,
    route: ROUTES.projectItems,
  },
  {
    id: 'zones',
    label: PAGE_TITLES.projectZones,
    route: ROUTES.projectZones,
  },
  {
    id: 'planning',
    label: PAGE_TITLES.projectPlanning,
    route: ROUTES.projectPlanning,
  },
  {
    id: 'progress',
    label: PAGE_TITLES.projectProgress,
    route: ROUTES.projectProgress,
  },
]

const SECTION_PERMISSIONS: Record<ProjectSection, string[]> = {
  home: [],
  members: ['project_member.manage'],
  // The list endpoint allows every project member to read applied items.
  // Editing and template application remain separately permission-gated.
  'inspection-items': [],
  // 導覽只認 project_zone.read，是 GET /projects/{id}/zones 讀取權限的子集，
  // 所以導覽可見的人一定讀得到列表。inspection_plan.read 只為了顯示計畫用
  // 的分區名稱，不單獨開出分區區段；只有 manage 沒有 read 者不顯示入口
  // （ADM-R17；維持既有 API 契約）。
  zones: ['project_zone.read'],
  planning: ['inspection_plan.read'],
  progress: ['inspection_task.read'],
}

/** 依 ADM-R17 限定專案首頁與正式區段的路由識別字。 */
export type ProjectSection = (typeof SECTIONS)[number]['id']

/**
 * 依 ADM-R17 篩選專案區段入口並提供共用頁面外殼。
 * 無對應讀取權限的入口不顯示；實際存取仍由區段 API 驗證。
 */
export default function ProjectSectionShell({
  project,
  projectId,
  activeSection,
  viewerPermissions,
  children,
}: {
  project: { project_code: string; name: string } | null
  projectId: string
  activeSection: ProjectSection
  viewerPermissions: string[]
  children: ReactNode
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const routeState = location.state as { highlightedItemIds?: unknown } | null
  const highlightedItemIds = Array.isArray(routeState?.highlightedItemIds)
    ? routeState.highlightedItemIds.filter(
        (id): id is string => typeof id === 'string',
      )
    : []

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [])

  const navigation = (
    <nav aria-label="專案區段" className="project-section-nav">
      {SECTIONS.filter(
        (section) =>
          SECTION_PERMISSIONS[section.id].length === 0 ||
          SECTION_PERMISSIONS[section.id].some((permission) =>
            viewerPermissions.includes(permission),
          ),
      ).map((section) => (
        <NavLink
          aria-current={activeSection === section.id ? 'page' : undefined}
          end={section.id === 'home'}
          key={section.id}
          onClick={() => setMenuOpen(false)}
          state={
            section.id === 'inspection-items' && highlightedItemIds.length > 0
              ? { highlightedItemIds }
              : undefined
          }
          to={section.route.path.replace(':projectId', projectId)}
        >
          {section.label}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="project-home-layout">
      <header className="project-home-header">
        <BackLink to={ROUTES.adminProjects.path}>返回專案清單</BackLink>
        <h1>
          {project ? `${project.project_code}｜${project.name}` : '專案'}
        </h1>
      </header>
      <button
        aria-expanded={menuOpen}
        aria-controls="project-mobile-sections"
        className="project-section-menu-button"
        onClick={() => setMenuOpen((open) => !open)}
        type="button"
      >
        {menuOpen ? '關閉區段選單' : '區段選單'}
      </button>
      <div className="project-home-body">
        <aside className="project-section-sidebar">{navigation}</aside>
        <div
          className="project-section-drawer"
          hidden={!menuOpen}
          id="project-mobile-sections"
        >
          {navigation}
        </div>
        <div className="project-section-content">{children}</div>
      </div>
    </div>
  )
}
