import type { TemplateCategory, TemplateItem, TemplateSystem } from './api'

type Selection = { type: 'category' | 'system' | 'item'; id: string }

export function TemplateLibraryNav({
  categories,
  systems,
  items,
  loadedSystemIds,
  loadedCategoryIds,
  selected,
  expanded,
  onSelect,
  onToggle,
  onAddCategory,
  readOnly,
  mobile,
  mode,
  selectSystemOnly = false,
}: {
  categories: TemplateCategory[]
  systems: TemplateSystem[]
  items: TemplateItem[]
  loadedSystemIds: Set<string>
  loadedCategoryIds: Set<string>
  selected: Selection | null
  expanded: Set<string>
  onSelect: (selection: Selection) => void
  onToggle: (id: string) => void
  onAddCategory: () => void
  readOnly: boolean
  mobile: boolean
  mode: 'manage' | 'select'
  selectSystemOnly?: boolean
}) {
  return (
    <aside className="tpl-nav" aria-label="範本庫導覽">
      <div className="tpl-nav-heading">
        <h2>範本庫</h2>
        {categories.length > 0 && !readOnly && mode === 'manage' && (
          <button onClick={onAddCategory} type="button">
            新增工程類別
          </button>
        )}
      </div>
      {categories.length === 0 ? (
        <div className="tpl-empty">
          <p>還沒有工程類別。</p>
          {!readOnly && mode === 'manage' && (
            <button onClick={onAddCategory} type="button">
              新增工程類別
            </button>
          )}
        </div>
      ) : (
        <ul className="tpl-tree">
          {categories.map((category) => {
            const categoryOpen = expanded.has(category.id)
            // 已載入就以實際資料為準；還沒載入用列表回應帶的數量。
            // 兩者都沒有就不顯示。
            const systemCount = loadedCategoryIds.has(category.id)
              ? systems.filter((row) => row.category_id === category.id).length
              : category.system_count
            return (
              <li key={category.id}>
                <button
                  aria-label={category.name}
                  aria-current={
                    selected?.type === 'category' &&
                    selected.id === category.id
                      ? 'true'
                      : undefined
                  }
                  aria-expanded={categoryOpen}
                  className="tpl-tree-row"
                  onClick={() => {
                    onToggle(category.id)
                    onSelect({ type: 'category', id: category.id })
                  }}
                  type="button"
                >
                  <span aria-hidden="true">{categoryOpen ? '▾' : '▸'}</span>
                  <span>{category.name}</span>
                  {systemCount !== undefined && (
                    <span aria-hidden="true" className="tpl-tree-count">
                      {systemCount} 個系統
                    </span>
                  )}
                </button>
                {categoryOpen && (
                  <ul>
                    {systems.map((system) => {
                      if (system.category_id !== category.id) return null
                      const systemOpen = expanded.has(system.id)
                      const itemCount = loadedSystemIds.has(system.id)
                        ? items.filter((item) => item.system_id === system.id)
                            .length
                        : system.item_count
                      return (
                        <li key={system.id}>
                          <button
                            aria-label={system.name}
                            aria-current={
                              selected?.type === 'system' &&
                              selected.id === system.id
                                ? 'true'
                                : undefined
                            }
                            aria-expanded={
                              selectSystemOnly ? undefined : systemOpen
                            }
                            className="tpl-tree-row"
                            onClick={() => {
                              if (!selectSystemOnly) onToggle(system.id)
                              onSelect({ type: 'system', id: system.id })
                            }}
                            type="button"
                          >
                            <span aria-hidden="true">
                              {selectSystemOnly ? '•' : systemOpen ? '▾' : '▸'}
                            </span>
                            <span>{system.name}</span>
                            {itemCount !== undefined && (
                              <span
                                aria-hidden="true"
                                className="tpl-tree-count"
                              >
                                {itemCount} 個查核項目
                              </span>
                            )}
                          </button>
                          {!selectSystemOnly && systemOpen && (
                            <ul>
                              {items
                                .filter((item) => item.system_id === system.id)
                                .map((item) => (
                                  <li key={item.id ?? item.title}>
                                    <button
                                      aria-label={
                                        item.title || '未命名查核項目'
                                      }
                                      aria-current={
                                        selected?.type === 'item' &&
                                        selected.id === item.id
                                          ? 'true'
                                          : undefined
                                      }
                                      className="tpl-tree-row tpl-item-row"
                                      onClick={() =>
                                        item.id &&
                                        onSelect({ type: 'item', id: item.id })
                                      }
                                      type="button"
                                    >
                                      <span aria-hidden="true">•</span>
                                      <span>
                                        {item.title || '未命名查核項目'}
                                      </span>
                                      {mobile && (
                                        <span
                                          aria-hidden="true"
                                          className="tpl-item-open"
                                        >
                                          開啟詳情
                                        </span>
                                      )}
                                    </button>
                                  </li>
                                ))}
                              {loadedSystemIds.has(system.id) &&
                                items.filter(
                                  (item) => item.system_id === system.id,
                                ).length === 0 && (
                                  <li className="tpl-tree-empty">
                                    還沒有查核項目
                                  </li>
                                )}
                              {!loadedSystemIds.has(system.id) && (
                                <li className="tpl-tree-empty">載入中…</li>
                              )}
                            </ul>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {mobile && <p className="tpl-mobile-hint">點選「開啟詳情」查看內容</p>}
    </aside>
  )
}
