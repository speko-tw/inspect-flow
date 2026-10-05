import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import {
  getSystemTemplates,
  listTemplateCategories,
  listTemplateSystems,
  type TemplateCategory,
  type TemplateItem,
  type TemplateSystem,
} from '../admin/templates/api'
import { TemplateLibraryNav } from '../admin/templates/TemplateLibraryNav'
import { fetchMyProjects } from './api'
import {
  applyTemplate,
  listAllProjects,
  listProjectInspectionItems,
  ProjectTemplatesApiError,
  saveProjectItemAsTemplate,
  templateErrorMessage,
  type ProjectInspectionItem,
  type ProjectSummary,
} from './projectTemplatesApi'

type Selection = { type: 'category' | 'system' | 'item'; id: string }

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('zh-TW')
}

function forbidden(error: unknown): boolean {
  return error instanceof ProjectTemplatesApiError
    ? error.status === 403
    : typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        error.status === 403
}

function numericStandardText(
  standard: TemplateItem['inspection_points'][number]['numeric_standard'],
): string | null {
  if (!standard) return null
  const unit = standard.unit ? ` ${standard.unit}` : ''
  if (standard.condition === 'range') {
    return standard.range_form === 'interval'
      ? `${standard.lower_bound ?? ''}～${standard.upper_bound ?? ''}${unit}`
      : `${standard.value ?? ''} ± ${standard.tolerance ?? ''}${unit}`
  }
  const operator =
    standard.condition === '<=' ? '≤' : standard.condition === '>=' ? '≥' : '='
  return `${operator} ${standard.value ?? ''}${unit}`
}

function pointEvidenceText(
  point: TemplateItem['inspection_points'][number],
): string[] {
  return point.evidence_requirements.map((requirement) => {
    const kind = requirement.evidence_type === 'photo' ? '照片' : '佐證'
    return requirement.required === false || requirement.min_count === 0
      ? `${kind}：可選`
      : `${kind}：至少 ${requirement.min_count} 張`
  })
}

export default function ProjectTemplatesPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [categories, setCategories] = useState<TemplateCategory[]>([])
  const [systems, setSystems] = useState<TemplateSystem[]>([])
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [selected, setSelected] = useState<Selection | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loadedCategories, setLoadedCategories] = useState<Set<string>>(
    new Set(),
  )
  const [loadedSystems, setLoadedSystems] = useState<Set<string>>(new Set())
  const [projectItems, setProjectItems] = useState<ProjectInspectionItem[]>([])
  const [mode, setMode] = useState<'item' | 'system'>('item')
  const [templateId, setTemplateId] = useState('')
  const [saveSource, setSaveSource] = useState<ProjectInspectionItem | null>(
    null,
  )
  const [applyConfirm, setApplyConfirm] = useState(false)
  const [applyError, setApplyError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [projectLoading, setProjectLoading] = useState(true)
  const [itemsLoading, setItemsLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [readDenied, setReadDenied] = useState(false)
  const [itemsDenied, setItemsDenied] = useState(false)
  const [saveAllowed, setSaveAllowed] = useState(false)
  const [saveDenied, setSaveDenied] = useState(false)
  const [mobilePane, setMobilePane] = useState<'list' | 'detail'>('list')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function loadProject() {
      try {
        const projects = await listAllProjects()
        if (!active) return
        setProject(projects.find((item) => item.id === projectId) ?? null)
        setSaveAllowed(true)
      } catch {
        try {
          const projects = await fetchMyProjects()
          if (active) {
            const found = projects.find((item) => item.id === projectId)
            if (found) setSaveAllowed(true)
            setProject(
              found
                ? {
                    id: found.id,
                    project_code: found.project_code,
                    name: found.name,
                  }
                : null,
            )
          }
        } catch {
          if (active) setProject(null)
        }
      } finally {
        if (active) setProjectLoading(false)
      }
    }
    void loadProject()
    return () => {
      active = false
    }
  }, [projectId])

  useEffect(() => {
    let active = true
    listTemplateCategories()
      .then((rows) => {
        if (active) setCategories(rows)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(templateErrorMessage(caught))
        if (forbidden(caught)) {
          setReadOnly(true)
          setReadDenied(true)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    listProjectInspectionItems(projectId)
      .then((items) => {
        if (active) setProjectItems(items)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(templateErrorMessage(caught))
        if (forbidden(caught)) setItemsDenied(true)
      })
      .finally(() => {
        if (active) setItemsLoading(false)
      })
    return () => {
      active = false
    }
  }, [projectId])

  async function selectNode(next: Selection) {
    setSelected(next)
    setMobilePane('detail')
    setApplyError('')
    setSaveError('')
    setNotice('')
    setApplyConfirm(false)
    if (next.type === 'category') {
      try {
        const rows = await listTemplateSystems(next.id)
        setLoadedCategories((current) => new Set(current).add(next.id))
        setSystems((current) => [
          ...current.filter((item) => item.category_id !== next.id),
          ...rows,
        ])
      } catch (caught) {
        setError(templateErrorMessage(caught))
        if (forbidden(caught)) setReadOnly(true)
      }
    } else if (next.type === 'system') {
      setTemplates([])
      try {
        const result = await getSystemTemplates(next.id)
        setTemplates(result.items)
        setLoadedSystems((current) => new Set(current).add(next.id))
      } catch (caught) {
        setError(templateErrorMessage(caught))
        if (forbidden(caught)) setReadOnly(true)
      }
    } else {
      setMode('item')
      setTemplateId(next.id)
    }
  }

  function toggleNode(id: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedSystem =
    selected?.type === 'item'
      ? systems.find(
          (item) =>
            item.id ===
            templates.find((template) => template.id === selected.id)
              ?.system_id,
        )
      : selected?.type === 'system'
        ? systems.find((item) => item.id === selected.id)
        : undefined
  const selectedCategory = selectedSystem
    ? categories.find((item) => item.id === selectedSystem.category_id)
    : selected?.type === 'category'
      ? categories.find((item) => item.id === selected.id)
      : undefined
  const selectedTemplate = templates.find((item) => item.id === templateId)
  const selectedTemplates =
    selected?.type === 'item'
      ? templates.filter((item) => item.id === selected.id)
      : mode === 'system'
        ? templates
        : selectedTemplate
          ? [selectedTemplate]
          : []
  const hasSelection = Boolean(
    selectedSystem &&
    selectedTemplates.length > 0 &&
    (mode === 'system' || selected?.type === 'item'),
  )
  const isSaveMode = saveSource !== null

  async function submitApply() {
    if (!selectedSystem || !hasSelection || busy || itemsDenied || readOnly) {
      return
    }
    setBusy(true)
    setApplyError('')
    try {
      const result = await applyTemplate(
        projectId,
        mode === 'system'
          ? { system_id: selectedSystem.id }
          : { template_id: selectedTemplates[0].id ?? '' },
      )
      if (result.length === 0) {
        setApplyError('這個系統沒有項目')
        return
      }
      navigate(`/admin/projects/${projectId}`, {
        state: {
          notice: `已新增 ${result.length} 個項目到「${project?.name ?? '專案'}」。`,
        },
      })
    } catch (caught) {
      setApplyError(templateErrorMessage(caught))
      if (forbidden(caught)) setReadOnly(true)
    } finally {
      setBusy(false)
      setApplyConfirm(false)
    }
  }

  function startSave(item: ProjectInspectionItem) {
    setSaveSource(item)
    setSelected(null)
    setExpanded(new Set())
    setSaveError('')
    setApplyError('')
    setNotice('')
    setMobilePane('list')
  }

  async function submitSave() {
    if (!saveSource || selected?.type !== 'system' || busy || saveDenied) {
      return
    }
    setBusy(true)
    setSaveError('')
    setNotice('')
    try {
      await saveProjectItemAsTemplate(projectId, saveSource.id, selected.id)
      setNotice('已存為範本。')
      setSaveSource(null)
      setSelected(null)
      setTemplates([])
    } catch (caught) {
      setSaveError(templateErrorMessage(caught, saveSource.title))
      if (forbidden(caught)) setSaveDenied(true)
    } finally {
      setBusy(false)
    }
  }

  const nav = (
    <TemplateLibraryNav
      categories={categories}
      expanded={expanded}
      items={templates}
      loadedCategoryIds={loadedCategories}
      loadedSystemIds={loadedSystems}
      mobile={true}
      mode="select"
      onAddCategory={() => undefined}
      onSelect={(value) => void selectNode(value)}
      onToggle={toggleNode}
      readOnly={readOnly}
      selectSystemOnly={isSaveMode}
      selected={selected}
      systems={systems}
    />
  )

  return (
    <div className="app-shell">
      <main className="tpl-page">
        <Link
          className="tpl-return-project"
          to={`/admin/projects/${projectId}`}
        >
          返回專案
        </Link>
        <p className="tpl-crumb">
          {project?.project_code && <>{project.project_code} </>}
          {project?.name ?? (projectLoading ? '載入專案…' : '找不到專案')}
        </p>
        {project && (
          <h1>
            {isSaveMode
              ? `將「${saveSource?.title ?? ''}」存為範本`
              : '套用範本到專案'}
          </h1>
        )}
        {readOnly && (
          <p role="status">
            {readDenied
              ? '範本讀取權限不足，無法載入其他內容。'
              : '目前只能瀏覽範本。'}
          </p>
        )}
        {itemsDenied && <p role="status">目前只能瀏覽專案查核項目。</p>}
        {error && <p role="alert">{error}</p>}
        {notice && (
          <p className="tpl-notice tpl-notice-ok" role="status">
            {notice}
          </p>
        )}
        <div className="tpl-layout" data-pane={mobilePane}>
          <div className="tpl-list-pane">
            {nav}
            {!isSaveMode && (
              <section className="tpl-nav tpl-project-items">
                <h2>專案查核項目</h2>
                {itemsLoading && <p>載入中…</p>}
                {!itemsLoading && projectItems.length === 0 && (
                  <p>目前沒有查核項目。</p>
                )}
                <ul>
                  {projectItems.map((item) => (
                    <li key={item.id}>
                      <strong>{item.title}</strong>
                      <span>來源：{item.source_template_name}</span>
                      <time dateTime={item.applied_at}>
                        {formatTime(item.applied_at)}
                      </time>
                      {saveAllowed && !saveDenied && !itemsDenied && (
                        <button
                          disabled={busy}
                          onClick={() => startSave(item)}
                          type="button"
                        >
                          存為範本
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          <section aria-label="範本操作" className="tpl-detail-pane">
            <button
              className="tpl-mobile-back"
              onClick={() => setMobilePane('list')}
              type="button"
            >
              返回選擇
            </button>
            {loading && <p>載入範本庫…</p>}
            {!loading && categories.length === 0 && !error && (
              <p>範本庫還沒有工程類別，請先到範本管理新增。</p>
            )}
            {isSaveMode ? (
              <>
                <h2>選擇目標系統</h2>
                {!selectedSystem && <p>先選工程類別，再選要存入的系統。</p>}
                {selectedSystem && selectedCategory && (
                  <div className="tpl-card">
                    <p>
                      <strong>存入位置</strong>
                    </p>
                    <p>
                      範本庫 / {selectedCategory.name} / {selectedSystem.name}
                    </p>
                    <p>
                      將新增「{saveSource?.title}
                      」，保留原項目的查核項次與標準。
                    </p>
                    <button
                      disabled={!saveAllowed || saveDenied || busy}
                      onClick={() => void submitSave()}
                      type="button"
                    >
                      {busy ? '儲存中…' : '存入這個系統'}
                    </button>
                  </div>
                )}
                {saveError && (
                  <div className="tpl-notice tpl-notice-error" role="alert">
                    <p>{saveError}</p>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setSaveError('')
                        setSelected(null)
                        setMobilePane('list')
                      }}
                      type="button"
                    >
                      改選系統
                    </button>
                  </div>
                )}
                {saveDenied && <p role="status">目前只能瀏覽查核項目。</p>}
              </>
            ) : (
              <>
                {!selected && (
                  <>
                    <h2>選擇範本</h2>
                    <p>展開工程類別與系統，再選擇要套用的範本。</p>
                  </>
                )}
                {selectedCategory && !selectedSystem && (
                  <>
                    <h2>{selectedCategory.name}</h2>
                    <p>請選這個類別底下的一個系統。</p>
                  </>
                )}
                {selectedSystem && (
                  <>
                    <p className="tpl-crumb">
                      {selectedCategory?.name} / {selectedSystem.name}
                    </p>
                    <h2>套用範本：{selectedSystem.name}</h2>
                    <fieldset>
                      <legend>要套用什麼</legend>
                      <label>
                        <input
                          checked={mode === 'system'}
                          name="apply-target"
                          onChange={() => {
                            setMode('system')
                            setApplyError('')
                            setApplyConfirm(false)
                          }}
                          type="radio"
                        />
                        整個系統（{templates.length} 個項目）
                      </label>
                      {templates.map((item) => (
                        <label key={item.id}>
                          <input
                            checked={mode === 'item' && templateId === item.id}
                            name="apply-target"
                            onChange={() => {
                              setMode('item')
                              setTemplateId(item.id ?? '')
                              setSelected({ type: 'item', id: item.id ?? '' })
                              setApplyError('')
                              setApplyConfirm(false)
                            }}
                            type="radio"
                          />
                          單一項目：{item.title}
                        </label>
                      ))}
                    </fieldset>
                    {selectedTemplates.length > 0 && (
                      <>
                        <h3>將新增 {selectedTemplates.length} 個項目</h3>
                        <ul className="tpl-preview-list">
                          {selectedTemplates.map((item) => (
                            <li key={item.id}>
                              <strong>{item.title}</strong>
                              <p>{item.instruction}</p>
                              {item.inspection_points.map((point) => (
                                <div key={point.sequence}>
                                  <strong>
                                    項次 {point.sequence} {point.title}
                                  </strong>
                                  {point.instruction && (
                                    <p>{point.instruction}</p>
                                  )}
                                  {point.numeric_standard && (
                                    <p>
                                      數值標準：{point.title}{' '}
                                      {numericStandardText(
                                        point.numeric_standard,
                                      )}
                                    </p>
                                  )}
                                  {point.text_standard && (
                                    <p>文字標準：{point.text_standard.text}</p>
                                  )}
                                  {pointEvidenceText(point).map((summary) => (
                                    <p key={summary}>{summary}</p>
                                  ))}
                                </div>
                              ))}
                            </li>
                          ))}
                        </ul>
                        <p className="tpl-hint">
                          之後修改範本不會更新已套用的項目。套用後是專案自己的副本。
                        </p>
                      </>
                    )}
                    {applyError && (
                      <div
                        className="tpl-notice tpl-notice-error"
                        role="alert"
                      >
                        <p>{applyError}</p>
                        {applyError.startsWith('已套用過') ? (
                          <div className="tpl-actions">
                            <button
                              onClick={() => {
                                setSelected(null)
                                setTemplateId('')
                                setApplyError('')
                                setMobilePane('list')
                              }}
                              type="button"
                            >
                              改選其他範本
                            </button>
                            <button
                              onClick={() =>
                                navigate(`/admin/projects/${projectId}`)
                              }
                              type="button"
                            >
                              返回專案
                            </button>
                          </div>
                        ) : null}
                      </div>
                    )}
                    {applyConfirm ? (
                      <div
                        aria-labelledby="apply-confirm-title"
                        className="tpl-card"
                        role="alertdialog"
                      >
                        <p id="apply-confirm-title">
                          一次新增 {selectedTemplates.length} 個項目到專案？
                          目前專案項目無法刪除或改名。
                        </p>
                        <div className="tpl-actions">
                          <button
                            disabled={busy}
                            onClick={() => void submitApply()}
                            type="button"
                          >
                            確定套用
                          </button>
                          <button
                            onClick={() => setApplyConfirm(false)}
                            type="button"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        disabled={
                          !hasSelection || busy || readOnly || itemsDenied
                        }
                        onClick={() => {
                          if (mode === 'system' && templates.length > 1) {
                            setApplyConfirm(true)
                          } else {
                            void submitApply()
                          }
                        }}
                        type="button"
                      >
                        {busy ? '套用中…' : '套用至專案'}
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
