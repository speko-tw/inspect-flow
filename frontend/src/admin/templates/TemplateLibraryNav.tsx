import type { TemplateCategory, TemplateItem, TemplateSystem } from './api'

type Selection = { type: 'category' | 'system' | 'item'; id: string }

export function TemplateLibraryNav({
  categories,
  systems,
  items,
  selected,
  expanded,
  onSelect,
  onToggle,
  onAddCategory,
  readOnly,
  mobile,
  mode,
}: {
  categories: TemplateCategory[]
  systems: TemplateSystem[]
  items: TemplateItem[]
  selected: Selection | null
  expanded: Set<string>
  onSelect: (selection: Selection) => void
  onToggle: (id: string) => void
  onAddCategory: () => void
  readOnly: boolean
  mobile: boolean
  mode: 'manage' | 'select'
}) {
  return (
    <aside className="tpl-nav" aria-label="範本庫導覽">
      <div className="tpl-nav-heading">
        <h2>範本庫</h2>
        {!readOnly && mode === 'manage' && (
          <button onClick={onAddCategory} type="button">
            新增工程類別
          </button>
        )}
      </div>
      {categories.length === 0 ? (
        <div className="tpl-empty">
          <h3>還沒有工程類別</h3>
          <p>新增一個類別，開始整理查核項目。</p>
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
            return (
              <li key={category.id}>
                <button
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
                </button>
                {categoryOpen && (
                  <ul>
                    {systems.map((system) => {
                      if (system.category_id !== category.id) return null
                      const systemOpen = expanded.has(system.id)
                      return (
                        <li key={system.id}>
                          <button
                            aria-current={
                              selected?.type === 'system' &&
                              selected.id === system.id
                                ? 'true'
                                : undefined
                            }
                            aria-expanded={systemOpen}
                            className="tpl-tree-row"
                            onClick={() => {
                              onToggle(system.id)
                              onSelect({ type: 'system', id: system.id })
                            }}
                            type="button"
                          >
                            <span aria-hidden="true">
                              {systemOpen ? '▾' : '▸'}
                            </span>
                            <span>{system.name}</span>
                          </button>
                          {systemOpen && (
                            <ul>
                              {items
                                .filter((item) => item.system_id === system.id)
                                .map((item) => (
                                  <li key={item.id ?? item.title}>
                                    <button
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
                                    </button>
                                  </li>
                                ))}
                              {items.filter(
                                (item) => item.system_id === system.id,
                              ).length === 0 && (
                                <li className="tpl-tree-empty">
                                  還沒有查核項目
                                </li>
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
      {mobile && <p className="tpl-mobile-hint">選取項目以開啟詳情</p>}
    </aside>
  )
}
