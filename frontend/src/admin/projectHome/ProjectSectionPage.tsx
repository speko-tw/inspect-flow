import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'

import { ManagementApiError, managementErrorMessage } from '../api'
import ProjectItemLinks from '../projectItems/ProjectItemLinks'
import ProjectDetailPage from '../projects/ProjectDetailPage'
import ProjectSectionShell, {
  type ProjectSection,
} from './ProjectSectionShell'
import { getWorkflowSummary } from './api'
import { canViewIndoorSections } from './permissions'
import ProjectDeniedPage from './ProjectDeniedPage'

const TITLES: Record<Exclude<ProjectSection, 'home'>, string> = {
  members: '成員',
  'inspection-items': '查核項目',
  zones: '分區',
  planning: '計畫與任務',
  progress: '進度',
}

export default function ProjectSectionPage({
  section,
}: {
  section: Exclude<ProjectSection, 'home'>
}) {
  const { projectId = '' } = useParams()
  const [project, setProject] = useState<{
    project_code: string
    name: string
  } | null>(null)
  const [canViewIndoor, setCanViewIndoor] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    let active = true
    getWorkflowSummary(projectId)
      .then((summary) => {
        if (active) {
          setCanViewIndoor(canViewIndoorSections(summary))
          setProject({
            project_code: summary.project.project_code,
            name: summary.project.name,
          })
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setDenied(
            caught instanceof ManagementApiError && caught.status === 403,
          )
          setError(managementErrorMessage(caught))
        }
      })
    return () => {
      active = false
    }
  }, [projectId])

  if (canViewIndoor === false) return <Navigate replace to="/field" />
  if (denied) return <ProjectDeniedPage />

  let content = <p>正在確認專案權限…</p>
  if (canViewIndoor) {
    if (section === 'members') {
      content = <ProjectDetailPage />
    } else if (section === 'inspection-items') {
      content = <ProjectItemLinks projectId={projectId} />
    } else {
      content = (
        <section aria-labelledby="project-section-heading">
          <h2 id="project-section-heading">{TITLES[section]}</h2>
          <p>此區段內容會在後續任務提供。</p>
          <Link to={`/admin/projects/${projectId}`}>返回專案首頁</Link>
        </section>
      )
    }
  }

  return (
    <ProjectSectionShell
      activeSection={section}
      project={project}
      projectId={projectId}
    >
      {error ? <p role="alert">{error}</p> : content}
    </ProjectSectionShell>
  )
}
