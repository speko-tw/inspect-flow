import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router'

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

export type ProjectSection = (typeof SECTIONS)[number]['id']

export default function ProjectSectionShell({
  project,
  projectId,
  activeSection,
  children,
}: {
  project: { project_code: string; name: string } | null
  projectId: string
  activeSection: ProjectSection
  children: ReactNode
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const base = `/admin/projects/${projectId}`

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [])

  const navigation = (
    <nav aria-label="專案區段" className="project-section-nav">
      {SECTIONS.map((section) => (
        <NavLink
          aria-current={activeSection === section.id ? 'page' : undefined}
          key={section.id}
          onClick={() => setMenuOpen(false)}
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
        <p>
          <Link to="/admin/projects">回專案清單</Link>
        </p>
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
        <main className="project-section-content">{children}</main>
      </div>
    </div>
  )
}
