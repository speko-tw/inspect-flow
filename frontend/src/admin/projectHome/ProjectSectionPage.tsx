import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useParams } from 'react-router'

import { landingPath } from '../../auth/landing'
import { useCurrentUser } from '../../auth/useCurrentUser'
import { isForbidden, isNotFound } from '../../http'
import { managementErrorMessage } from '../api'
import { ProjectNotFound } from '../../RouteNotFound'
import ProjectItemLinks from '../projectItems/ProjectItemLinks'
import ProjectZonesPage from '../planning/ProjectZonesPage'
import ProjectDetailPage from '../projects/ProjectDetailPage'
import ProjectSectionShell, {
  type ProjectSection,
} from './ProjectSectionShell'
import { useWorkflowSummary } from './WorkflowSummaryProvider'
import { canViewIndoorSections } from './permissions'
import ProjectDeniedPage from './ProjectDeniedPage'

const TITLES: Record<Exclude<ProjectSection, 'home'>, string> = {
  members: '成員',
  'inspection-items': '查核項目',
  zones: '分區',
  planning: '計畫與任務',
  progress: '進度',
}

/** 依專案權限載入正式區段內容，並提供共用導覽外殼（ADM-R17）。 */
export default function ProjectSectionPage({
  section,
  children,
}: {
  section: Exclude<ProjectSection, 'home'>
  children?: ReactNode | ((viewerPermissions: string[]) => ReactNode)
}) {
  const { projectId = '' } = useParams()
  const { user } = useCurrentUser()
  const { loadSectionSummary } = useWorkflowSummary()
  const [result, setResult] = useState<{
    projectId: string
    project: { project_code: string; name: string }
    viewerPermissions: string[]
    canViewIndoor: boolean
    error?: string
    denied?: boolean
    notFound?: boolean
  } | null>(null)

  useEffect(() => {
    let active = true
    loadSectionSummary(projectId)
      .then((summary) => {
        if (active) {
          setResult({
            projectId,
            canViewIndoor: canViewIndoorSections(summary),
            viewerPermissions: summary.viewer_permission_codes,
            project: {
              project_code: summary.project.project_code,
              name: summary.project.name,
            },
          })
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setResult({
            projectId,
            canViewIndoor: false,
            project: { project_code: '', name: '' },
            viewerPermissions: [],
            denied: isForbidden(caught),
            notFound: isNotFound(caught),
            error: managementErrorMessage(caught),
          })
        }
      })
    return () => {
      active = false
    }
  }, [loadSectionSummary, projectId, section])

  const currentResult = result?.projectId === projectId ? result : null
  if (
    currentResult &&
    !currentResult.canViewIndoor &&
    currentResult.error === undefined
  ) {
    return <Navigate replace to={landingPath(user)} />
  }
  if (currentResult?.error) {
    if (currentResult.denied) return <ProjectDeniedPage />
    if (currentResult.notFound) return <ProjectNotFound />
    return <p role="alert">{currentResult.error}</p>
  }
  if (!currentResult) {
    return <p role="status">正在確認專案權限…</p>
  }

  const childContent =
    typeof children === 'function'
      ? children(currentResult.viewerPermissions)
      : children
  let content = childContent ?? <p>正在確認專案權限…</p>
  if (!children && currentResult.canViewIndoor) {
    if (section === 'members') {
      content = <ProjectDetailPage />
    } else if (section === 'inspection-items') {
      content = (
        <ProjectItemLinks
          projectId={projectId}
          viewerPermissions={currentResult.viewerPermissions}
        />
      )
    } else if (section === 'zones') {
      // 分區是正式專案區段；由專屬頁管理，避免和計畫頁重複提供 CRUD。
      content = (
        <ProjectZonesPage
          viewerPermissions={currentResult.viewerPermissions}
        />
      )
    } else {
      content = (
        <section aria-labelledby="project-section-heading">
          <h2 id="project-section-heading">{TITLES[section]}</h2>
          <p>此區段內容會在後續任務提供。</p>
        </section>
      )
    }
  }

  return (
    <ProjectSectionShell
      activeSection={section}
      project={currentResult.project}
      projectId={projectId}
      viewerPermissions={currentResult.viewerPermissions}
    >
      {content}
    </ProjectSectionShell>
  )
}
