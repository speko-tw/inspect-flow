// 非系統管理者的專案清單（ADM-R24）：唯讀成員也能看專案首頁。

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useNavigate } from 'react-router'

import { managementErrorMessage } from '../api'
import { listMyProjects, type MyProject } from './api'
import { ProjectCreationForm } from './ProjectCreationForm'

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; projects: MyProject[] }

/** 依 TPL-R23、FUI-R12 組合專案範本套用的正式路徑。 */
function projectTemplatePath(projectId: string): string {
  return `/admin/projects/${projectId}/inspection-items/templates`
}

/**
 * 顯示帳號可進入的專案清單。
 * 入口依 ADM-R23、ADM-R24 判定。
 */
export default function MyProjectsPage({
  canCreateProject = false,
}: {
  canCreateProject?: boolean
}) {
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [creating, setCreating] = useState(false)
  const [formSession, setFormSession] = useState(0)
  const formSessionRef = useRef(0)

  useEffect(() => {
    let active = true
    listMyProjects()
      .then((items) => {
        if (active) {
          setState({ kind: 'ready', projects: items })
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setState({ kind: 'error', message: managementErrorMessage(caught) })
        }
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  function cancelCreation() {
    formSessionRef.current += 1
    setFormSession(formSessionRef.current)
    setCreating(false)
  }

  if (creating) {
    return (
      <ProjectCreationForm
        isAdmin={false}
        formSession={formSession}
        onCancel={cancelCreation}
        onCreated={(project, submittedSession) => {
          if (submittedSession !== formSessionRef.current) {
            listMyProjects().then(
              (projects) => setState({ kind: 'ready', projects }),
              (caught: unknown) =>
                setState({
                  kind: 'error',
                  message: managementErrorMessage(caught),
                }),
            )
            return
          }
          navigate(`/admin/projects/${project.id}`, {
            state: project.warnings.some(
              (warning) => warning.code === 'project_code.duplicate',
            )
              ? { duplicateProjectCode: project.project_code }
              : null,
          })
        }}
      />
    )
  }

  return (
    <section aria-labelledby="my-projects-heading">
      <h1 id="my-projects-heading">我的專案</h1>
      <p>你參與的專案會列在這裡。</p>
      {canCreateProject && (
        <button
          className="btn-primary"
          onClick={() => {
            formSessionRef.current += 1
            setFormSession(formSessionRef.current)
            setCreating(true)
          }}
          type="button"
        >
          新增專案
        </button>
      )}
      {state.kind === 'loading' && <p role="status">載入專案中…</p>}
      {state.kind === 'error' && (
        <div>
          <p role="alert">{state.message}</p>
          <button
            onClick={() => {
              setState({ kind: 'loading' })
              setReloadKey((key) => key + 1)
            }}
            type="button"
          >
            重新載入
          </button>
        </div>
      )}
      {state.kind === 'ready' && state.projects.length === 0 && (
        <p>
          {canCreateProject
            ? '你還沒有參與的專案，可新增專案。'
            : '目前沒有可檢視的專案。請聯絡系統管理者，將你加入專案。'}
        </p>
      )}
      {state.kind === 'ready' && state.projects.length > 0 && (
        <div className="project-workspace-grid">
          {state.projects.map((project) => {
            const templatePath = projectTemplatePath(project.id)
            return (
              <article className="project-workspace-card" key={project.id}>
                <p className="project-code">{project.project_code}</p>
                <h2>{project.name}</h2>
                <p>{project.site_location}</p>
                {project.role_names.length > 0 && (
                  <p>我的角色：{project.role_names.join('、')}</p>
                )}
                <Link
                  className="btn btn-primary"
                  to={`/admin/projects/${project.id}`}
                >
                  開啟專案
                </Link>
                {project.can_apply_templates && (
                  <Link className="btn" to={templatePath}>
                    套用範本
                  </Link>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
