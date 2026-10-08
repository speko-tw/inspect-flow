import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import {
  getSystemTemplates,
  listTemplateCategories,
  listTemplateSystems,
  type TemplateCategory,
  type TemplateItem,
  type TemplateSystem,
} from '../admin/templates/api'
import { useCurrentUser } from '../auth/useCurrentUser'
import { numericSummary } from '../admin/templates/templateEditorUtils'
import { TemplateLibraryNav } from '../admin/templates/TemplateLibraryNav'
import { isForbidden } from '../http'
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
  const { user } = useCurrentUser()
  const navigate = useNavigate()
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [categories, setCategories] = useState<TemplateCategory[]>([])
  const [systems, setSystems] = useState<TemplateSystem[]>([])
  const [templatesBySystem, setTemplatesBySystem] = useState<
    Record<string, TemplateItem[]>
  >({})
  const [selected, setSelected] = useState<Selection | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loadedCategories, setLoadedCategories] = useState<Set<string>>(
    new Set(),
  )
  const [loadedSystems, setLoadedSystems] = useState<Set<string>>(new Set())
  const [projectItems, setProjectItems] = useState<ProjectInspectionItem[]>([])
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
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 40rem)').matches,
  )
  const [error, setError] = useState('')
  const [applyErrorCode, setApplyErrorCode] = useState('')
  const [saveErrorCode, setSaveErrorCode] = useState('')
  const conflictActionRef = useRef<HTMLButtonElement>(null)
  const saveConflictActionRef = useRef<HTMLButtonElement>(null)
  const cancelConfirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width: 40rem)')
    const update = () => setIsMobile(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    if (applyConfirm) cancelConfirmRef.current?.focus()
  }, [applyConfirm])

  const applyConflict =
    applyErrorCode === 'project_inspection_item.duplicate_name'
  const saveConflict = saveErrorCode === 'template.name_conflict'

  useEffect(() => {
    if (applyConflict) conflictActionRef.current?.focus()
  }, [applyConflict])

  useEffect(() => {
    if (saveConflict) saveConflictActionRef.current?.focus()
  }, [saveConflict])

  useEffect(() => {
    let active = true
    async function loadProject() {
      // TPL-R09: only Admin or a template manager may save as a template.
      // The server computes it (`has_template_access`); the page never
      // guesses, and `GET /projects` is 403 for everyone else.
      const canManage = user.has_template_access === true
      setSaveAllowed(canManage)
      try {
        // Members read their own projects instead of falling back after
        // a 403 from `GET /projects`.
        const projects = canManage
          ? await listAllProjects()
          : await fetchMyProjects()
        if (active) {
          const found = projects.find((item) => item.id === projectId)
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
      } finally {
        if (active) setProjectLoading(false)
      }
    }
    void loadProject()
    return () => {
      active = false
    }
  }, [projectId, user.has_template_access])

  useEffect(() => {
    let active = true
    listTemplateCategories()
      .then((rows) => {
        if (active) setCategories(rows)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(templateErrorMessage(caught))
        if (isForbidden(caught)) {
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
        if (isForbidden(caught)) setItemsDenied(true)
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
    setApplyErrorCode('')
    setSaveError('')
    setSaveErrorCode('')
    setNotice('')
    setApplyConfirm(false)
    if (next.type === 'category') {
      try {
        const rows = await listTemplateSystems(next.id)
        setSystems((current) => [
          ...current.filter((item) => item.category_id !== next.id),
          ...rows,
        ])
        setLoadedCategories((current) => new Set(current).add(next.id))
      } catch (caught) {
        setError(templateErrorMessage(caught))
        if (isForbidden(caught)) setReadOnly(true)
      }
    } else if (next.type === 'system') {
      setSelected(next)
      try {
        const result = await getSystemTemplates(next.id)
        setTemplatesBySystem((current) => ({
          ...current,
          [next.id]: result.items,
        }))
        setLoadedSystems((current) => new Set(current).add(next.id))
      } catch (caught) {
        setError(templateErrorMessage(caught))
        if (isForbidden(caught)) setReadOnly(true)
      }
    } else setSelected(next)
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
            Object.values(templatesBySystem)
              .flat()
              .find((template) => template.id === selected.id)?.system_id,
        )
      : selected?.type === 'system'
        ? systems.find((item) => item.id === selected.id)
        : undefined
  const selectedCategory = selectedSystem
    ? categories.find((item) => item.id === selectedSystem.category_id)
    : selected?.type === 'category'
      ? categories.find((item) => item.id === selected.id)
      : undefined
  const templates = selectedSystem
    ? (templatesBySystem[selectedSystem.id] ?? [])
    : []
  const mode = selected?.type === 'system' ? 'system' : 'item'
  const selectedTemplates =
    selected?.type === 'item'
      ? templates.filter((item) => item.id === selected.id)
      : mode === 'system'
        ? templates
        : []
  const hasSelection = Boolean(
    selectedSystem &&
    selectedTemplates.length > 0 &&
    (mode === 'system' || selected?.type === 'item'),
  )
  const isSaveMode = saveSource !== null
  const allTemplates = Object.values(templatesBySystem).flat()

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
        setApplyError('這個系統沒有查核項目。')
        return
      }
      navigate(`/admin/projects/${projectId}`, {
        state: {
          notice: `已新增 ${result.length} 個項目到「${project?.name ?? '專案'}」。`,
          highlightedItemIds: result.map((item) => item.id),
        },
      })
    } catch (caught) {
      setApplyError(templateErrorMessage(caught))
      setApplyErrorCode(
        caught instanceof ProjectTemplatesApiError && caught.status === 409
          ? (caught.code ?? '')
          : '',
      )
      if (isForbidden(caught)) setReadOnly(true)
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
    setSaveErrorCode('')
    setApplyError('')
    setApplyErrorCode('')
    setNotice('')
    setMobilePane('list')
  }

  // 存為範本後重新載入目標系統的範本，範本樹的項目數才會跟著更新。
  // 重新載入失敗時，存檔已成功、系統多了一筆：用存檔前已載入的項目數
  // （沒有就用列表帶回的 item_count）加 1 當數量，不顯示存檔前的舊數字；
  // 兩者都沒有就隱藏數字。下次選取該系統會重新載入並以實際資料為準。
  async function refreshSystemTemplates(systemId: string) {
    try {
      const result = await getSystemTemplates(systemId)
      setTemplatesBySystem((current) => ({
        ...current,
        [systemId]: result.items,
      }))
    } catch {
      const known =
        templatesBySystem[systemId]?.length ??
        systems.find((system) => system.id === systemId)?.item_count
      setSystems((current) =>
        current.map((system) =>
          system.id === systemId
            ? {
                ...system,
                item_count: known === undefined ? undefined : known + 1,
              }
            : system,
        ),
      )
      setLoadedSystems((current) => {
        const next = new Set(current)
        next.delete(systemId)
        return next
      })
    }
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
      await refreshSystemTemplates(selected.id)
      const destination = systems.find((system) => system.id === selected.id)
      const category = categories.find(
        (item) => item.id === destination?.category_id,
      )
      const categoryName = category?.name ?? '範本庫'
      const systemName = destination?.name ?? '目標系統'
      setNotice(
        `已將「${saveSource.title}」存入「${categoryName} / ${systemName}」。`,
      )
      setSaveSource(null)
      setSelected(null)
    } catch (caught) {
      setSaveError(templateErrorMessage(caught, saveSource.title))
      setSaveErrorCode(
        caught instanceof ProjectTemplatesApiError && caught.status === 409
          ? (caught.code ?? '')
          : '',
      )
      if (isForbidden(caught)) setSaveDenied(true)
    } finally {
      setBusy(false)
    }
  }

  const nav = (
    <TemplateLibraryNav
      categories={categories}
      expanded={expanded}
      items={allTemplates}
      loadedCategoryIds={loadedCategories}
      loadedSystemIds={loadedSystems}
      mobile={isMobile}
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
          <p className="notice-info" role="status">
            {readDenied
              ? '範本讀取權限不足，無法載入其他內容。'
              : '目前只能瀏覽範本。'}
          </p>
        )}
        {itemsDenied && (
          <p className="notice-info" role="status">
            目前只能瀏覽專案查核項目。
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {notice && (
          <>
            <p className="notice-success" role="status">
              {notice}
            </p>
            {!isSaveMode && (
              <button
                onClick={() => navigate(`/admin/projects/${projectId}`)}
                type="button"
              >
                返回專案
              </button>
            )}
          </>
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
                      {saveAllowed &&
                        !readDenied &&
                        !saveDenied &&
                        !itemsDenied && (
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
                {!selectedSystem && (
                  <>
                    <p>先選工程類別，再選要存入的系統。</p>
                    {isMobile && selectedCategory && (
                      <ul className="tpl-category-systems">
                        {systems
                          .filter(
                            (system) =>
                              system.category_id === selectedCategory.id,
                          )
                          .map((system) => (
                            <li key={system.id}>
                              <button
                                onClick={() =>
                                  void selectNode({
                                    type: 'system',
                                    id: system.id,
                                  })
                                }
                                type="button"
                              >
                                {system.name}
                              </button>
                            </li>
                          ))}
                      </ul>
                    )}
                  </>
                )}
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
                  <div className="notice-error" role="alert">
                    <p>{saveError}</p>
                    <button
                      ref={saveConflictActionRef}
                      disabled={busy}
                      onClick={() => {
                        setSaveError('')
                        setSaveErrorCode('')
                        setSelected(null)
                        setMobilePane('list')
                      }}
                      type="button"
                    >
                      改選系統
                    </button>
                  </div>
                )}
                {saveDenied && (
                  <p className="notice-info" role="status">
                    目前只能瀏覽查核項目。
                  </p>
                )}
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
                    {isMobile && (
                      <ul className="tpl-category-systems">
                        {systems
                          .filter(
                            (system) =>
                              system.category_id === selectedCategory.id,
                          )
                          .map((system) => (
                            <li key={system.id}>
                              <button
                                onClick={() =>
                                  void selectNode({
                                    type: 'system',
                                    id: system.id,
                                  })
                                }
                                type="button"
                              >
                                {system.name}
                              </button>
                            </li>
                          ))}
                      </ul>
                    )}
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
                            setSelected({
                              type: 'system',
                              id: selectedSystem.id,
                            })
                            setApplyError('')
                            setApplyErrorCode('')
                            setApplyConfirm(false)
                          }}
                          type="radio"
                        />
                        整個系統（{templates.length} 個項目）
                      </label>
                      {templates.map((item) => (
                        <label key={item.id}>
                          <input
                            checked={
                              mode === 'item' && selected?.id === item.id
                            }
                            name="apply-target"
                            onChange={() => {
                              setSelected({ type: 'item', id: item.id ?? '' })
                              setApplyError('')
                              setApplyErrorCode('')
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
                                      {numericSummary(point)}
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
                    {templates.length === 0 &&
                      loadedSystems.has(selectedSystem.id) && (
                        <p className="notice-info" role="status">
                          這個系統沒有查核項目。
                        </p>
                      )}
                    {applyError && (
                      <div className="notice-error" role="alert">
                        <p>{applyError}</p>
                        {applyConflict ? (
                          <div className="tpl-actions">
                            <button
                              ref={conflictActionRef}
                              onClick={() => {
                                setSelected(null)
                                setApplyError('')
                                setApplyErrorCode('')
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
                          套用後可在查核項目修改內容，目前無法刪除。
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
                            ref={cancelConfirmRef}
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
