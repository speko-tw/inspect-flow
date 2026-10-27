import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { useCurrentUser } from '../../auth/useCurrentUser'
import { BackLink } from '../../layout/BackLink'
import { canAccessRoute, ROUTES } from '../../routes'
import {
  UnsavedLeaveBox,
  useUnsavedNavigationGuard,
} from '../../ui/navigation'
import ProjectDeniedPage from '../projectHome/ProjectDeniedPage'
import { hasDuplicateCodeWarning, type Project } from './api'
import { ProjectCreationForm } from './ProjectCreationForm'

/** ADM-R54：管理者與可開案成員共用的獨立新增頁。 */
export default function ProjectCreatePage() {
  const { user } = useCurrentUser()
  const navigate = useNavigate()
  const [dirty, setDirty] = useState(false)
  const active = useRef(true)
  const guard = useUnsavedNavigationGuard(dirty)
  const returnTo = '/projects'

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  if (!canAccessRoute(user, ROUTES.projectNew)) {
    return <ProjectDeniedPage />
  }

  function cancel() {
    navigate(returnTo)
  }

  function created(project: Project) {
    if (!active.current) return
    const state = {
      projectNotice: `已建立專案「${project.name}」`,
      ...(hasDuplicateCodeWarning(project)
        ? { duplicateProjectCode: project.project_code }
        : {}),
    }
    guard.allowNavigation(() =>
      navigate(`/projects/${project.id}`, { replace: true, state }),
    )
  }

  return (
    <section aria-label="新增專案">
      <UnsavedLeaveBox guard={guard} />
      <BackLink to={returnTo}>返回專案清單</BackLink>
      <ProjectCreationForm
        isAdmin={user.is_admin}
        onCancel={cancel}
        onCreated={created}
        onDirtyChange={setDirty}
      />
    </section>
  )
}
