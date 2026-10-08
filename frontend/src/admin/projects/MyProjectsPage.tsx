// 非系統管理者的專案清單（#480）：列出「我所在的專案」，只含我有
// 內業權限的專案，版面沿用管理者專案清單的卡片，但沒有新增、編輯
// 與搜尋，也不顯示其他系統管理功能。資料來自既有的
// `GET /me/projects`，由後端的 `has_office_access` 標出內業專案。

import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { managementErrorMessage } from '../api'
import { listMyProjects, type MyProject } from './api'

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; projects: MyProject[] }

export default function MyProjectsPage() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    listMyProjects()
      .then((items) => {
        if (active) {
          setState({
            kind: 'ready',
            projects: items.filter((item) => item.has_office_access),
          })
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

  return (
    <section aria-labelledby="my-projects-heading">
      <h1 id="my-projects-heading">我的專案</h1>
      <p>你參與、且有內業權限的專案。</p>
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
        <p>目前沒有可管理的專案。請聯絡系統管理者，將你加入專案並指派角色。</p>
      )}
      {state.kind === 'ready' && state.projects.length > 0 && (
        <div className="project-workspace-grid">
          {state.projects.map((project) => (
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
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
