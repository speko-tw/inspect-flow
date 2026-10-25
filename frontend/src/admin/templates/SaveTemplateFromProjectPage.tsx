import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { canManageTemplateLibrary } from '../../auth/landing'
import { useCurrentUser } from '../../auth/useCurrentUser'
import AccessDeniedPage from '../../components/layout/AccessDeniedPage'
import { BackButton } from '../../layout/BackLink'
import {
  listProjectItems,
  type ProjectItemListData,
} from '../projectItems/api'
import {
  listAllProjects,
  saveProjectItemAsTemplate,
  templateErrorMessage,
  type ProjectSummary,
} from '../projects/projectTemplatesApi'
import {
  listTemplateCategories,
  listTemplateSystems,
  type TemplateCategory,
  type TemplateSystem,
} from './api'
import { TemplateLibraryNav } from './TemplateLibraryNav'
import './SaveTemplateFromProjectPage.css'

type Selection = { type: 'category' | 'system' | 'item'; id: string }
type ErrorStep = 'projects' | 'items' | 'target' | 'save'

/**
 * 依 TPL-R23／AC31 讓範本管理員複製專案查核項目到範本庫。
 * 僅限 `template.manage`；非成員可讀取並複製，不可寫入專案。
 */
export default function SaveTemplateFromProjectPage() {
  const { user } = useCurrentUser()
  const navigate = useNavigate()
  const canManage = canManageTemplateLibrary(user)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [query, setQuery] = useState('')
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [projectItems, setProjectItems] = useState<ProjectItemListData[]>([])
  const [source, setSource] = useState<ProjectItemListData | null>(null)
  const [categories, setCategories] = useState<TemplateCategory[]>([])
  const [systems, setSystems] = useState<TemplateSystem[]>([])
  const [selected, setSelected] = useState<Selection | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loadedCategories, setLoadedCategories] = useState<Set<string>>(
    new Set(),
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [errorStep, setErrorStep] = useState<ErrorStep>('projects')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const projectItemsRequest = useRef(0)
  const errorRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    return () => {
      projectItemsRequest.current += 1
    }
  }, [])

  useEffect(() => {
    const alert = errorRef.current
    if (!error || !alert) return
    const block =
      alert.getBoundingClientRect().height > window.innerHeight * 0.8
        ? 'start'
        : 'nearest'
    // #734 T7：將錯誤帶到觸發步驟附近，避免頁首提示離儲存操作太遠。
    alert.scrollIntoView?.({ block })
    alert.focus({ preventScroll: true })
  }, [error, errorStep])

  function setStepError(step: ErrorStep, message: string) {
    setErrorStep(step)
    setError(message)
  }

  function stepError(step: ErrorStep) {
    if (!error || errorStep !== step) return null
    return (
      <p ref={errorRef} role="alert" tabIndex={-1}>
        {error}
      </p>
    )
  }

  useEffect(() => {
    if (!canManage) return
    let active = true
    Promise.all([listAllProjects(), listTemplateCategories()])
      .then(([projectRows, categoryRows]) => {
        if (!active) return
        setProjects(projectRows)
        setCategories(categoryRows)
      })
      .catch((caught: unknown) => {
        if (active) {
          setErrorStep('projects')
          setError(templateErrorMessage(caught))
        }
      })
    return () => {
      active = false
    }
  }, [canManage])

  async function chooseProject(next: ProjectSummary) {
    if (busy) return
    const requestId = ++projectItemsRequest.current
    setProject(next)
    setProjectItems([])
    setSource(null)
    setSelected(null)
    setError('')
    setLoading(true)
    try {
      const rows = await listProjectItems(next.id)
      if (requestId === projectItemsRequest.current) setProjectItems(rows)
    } catch (caught) {
      if (requestId === projectItemsRequest.current) {
        setStepError('items', templateErrorMessage(caught))
      }
    } finally {
      if (requestId === projectItemsRequest.current) setLoading(false)
    }
  }

  function chooseSource(item: ProjectItemListData) {
    if (busy) return
    setSource(item)
    setName(item.title)
    setSelected(null)
    setError('')
  }

  async function chooseNode(next: Selection) {
    if (busy) return
    setSelected(next)
    setError('')
    if (next.type === 'category') {
      try {
        const rows = await listTemplateSystems(next.id)
        setSystems((current) => [
          ...current.filter((row) => row.category_id !== next.id),
          ...rows,
        ])
        setLoadedCategories((current) => new Set(current).add(next.id))
      } catch (caught) {
        setStepError('target', templateErrorMessage(caught))
      }
    }
  }

  async function submit() {
    if (!project || !source || selected?.type !== 'system' || busy) return
    setBusy(true)
    setError('')
    try {
      const saved = await saveProjectItemAsTemplate(
        project.id,
        source.id,
        selected.id,
        name,
      )
      const system = systems.find((row) => row.id === selected.id)
      const category = categories.find((row) => row.id === system?.category_id)
      navigate('/templates', {
        state: {
          savedTemplateId: saved.id,
          savedCategoryId: category?.id,
          savedSystemId: system?.id,
          savedTemplateTitle: name.trim(),
          savedTemplatePath: `${category?.name ?? '範本庫'} / ${
            system?.name ?? '目標系統'
          }`,
        },
      })
    } catch (caught) {
      setStepError('save', templateErrorMessage(caught, name.trim()))
    } finally {
      setBusy(false)
    }
  }

  if (!canManage) return <AccessDeniedPage />

  const filteredProjects = projects.filter((row) =>
    `${row.project_code} ${row.name}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  )
  const saveAllowed = Boolean(
    source && selected?.type === 'system' && name.trim(),
  )
  const currentStep = !project ? 1 : !source ? 2 : 3

  return (
    <section
      aria-labelledby="save-template-heading"
      className="save-template-page"
    >
      <BackButton onClick={() => navigate('/templates')}>
        返回範本管理
      </BackButton>
      <header>
        <h1 id="save-template-heading">從專案存為範本</h1>
        <p role="status">步驟 {currentStep}／3</p>
        <p>選擇專案、查核項目與範本庫位置。</p>
      </header>
      <ol className="save-template-steps">
        <li>
          <h2>選擇專案</h2>
          {stepError('projects')}
          <label htmlFor="save-template-project-search">搜尋專案</label>
          <input
            id="save-template-project-search"
            onChange={(event) => setQuery(event.target.value)}
            value={query}
          />
          <ul>
            {filteredProjects.map((row) => (
              <li key={row.id}>
                <button
                  aria-pressed={project?.id === row.id}
                  disabled={busy}
                  onClick={() => void chooseProject(row)}
                  type="button"
                >
                  {row.project_code} · {row.name}
                </button>
              </li>
            ))}
          </ul>
        </li>
        {project && (
          <li>
            <h2>選擇查核項目</h2>
            {stepError('items')}
            {loading ? <p role="status">載入中…</p> : null}
            {!loading && (
              <ul>
                {projectItems.map((item) => (
                  <li key={item.id}>
                    <button
                      aria-pressed={source?.id === item.id}
                      disabled={busy}
                      onClick={() => void chooseSource(item)}
                      type="button"
                    >
                      {item.title}（{item.inspection_points.length}{' '}
                      個查核項次； 來源範本：{item.source_template_name}）
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )}
        {source && (
          <li>
            <h2>選擇範本庫位置</h2>
            <div className="save-template-target">
              {stepError('target')}
              <div aria-disabled={busy} inert={busy}>
                <TemplateLibraryNav
                  categories={categories}
                  systems={systems}
                  items={[]}
                  loadedSystemIds={new Set()}
                  loadedCategoryIds={loadedCategories}
                  selected={selected}
                  expanded={expanded}
                  onSelect={(next) => void chooseNode(next)}
                  onToggle={(id) =>
                    setExpanded((current) => {
                      const next = new Set(current)
                      if (next.has(id)) next.delete(id)
                      else next.add(id)
                      return next
                    })
                  }
                  onAddCategory={() => undefined}
                  readOnly
                  mobile={false}
                  mode="select"
                  selectSystemOnly
                />
              </div>
              <div>
                <label htmlFor="save-template-name">範本名稱</label>
                <input
                  disabled={busy}
                  id="save-template-name"
                  onChange={(event) => {
                    setName(event.target.value)
                    setError('')
                  }}
                  value={name}
                />
                <p>
                  來源：{project?.name} / {source.title}
                </p>
                <button
                  className="btn-primary"
                  disabled={!saveAllowed || busy}
                  onClick={() => void submit()}
                  type="button"
                >
                  {busy ? '儲存中…' : '存入這個系統'}
                </button>
                {stepError('save')}
              </div>
            </div>
          </li>
        )}
      </ol>
    </section>
  )
}
