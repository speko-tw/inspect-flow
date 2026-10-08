import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router'

import { BackLink } from '../../layout/BackLink'

const SECTIONS = [
  { id: 'home', label: '專案首頁', suffix: '' },
  { id: 'members', label: '成員', suffix: '/members' },
  {
    id: 'inspection-items',
    label: '查核項目',
    suffix: '/inspection-items',
  },
  { id: 'zones', label: '分區', suffix: '/zones' },
  { id: 'planning', label: '計畫與任務', suffix: '/planning' },
  { id: 'progress', label: '進度', suffix: '/progress' },
]

// 分區與進度目前只是佔位頁（正式內容見 #451、#452），v0.3.0 先從導覽
// 隱藏；分區管理實際在「計畫與任務」頁裡。
const HIDDEN_SECTIONS: ReadonlySet<string> = new Set(['zones', 'progress'])

const SECTION_PERMISSIONS: Record<ProjectSection, string[]> = {
  home: [],
  members: ['project_member.manage'],
  'inspection-items': ['project_inspection_item.edit'],
  zones: ['project_zone.read', 'project_zone.manage'],
  planning: ['inspection_plan.read'],
  progress: ['inspection_task.read', 'inspection_task.inspect'],
}

export type ProjectSection = (typeof SECTIONS)[number]['id']

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
  const base = `/admin/projects/${projectId}`
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
          !HIDDEN_SECTIONS.has(section.id) &&
          (section.id === 'home' ||
            SECTION_PERMISSIONS[section.id].some((permission) =>
              viewerPermissions.includes(permission),
            )),
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
          to={`${base}${section.suffix}`}
        >
          {section.label}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="project-home-layout">
      <header className="project-home-header">
        <BackLink to="/admin/projects">回專案清單</BackLink>
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
