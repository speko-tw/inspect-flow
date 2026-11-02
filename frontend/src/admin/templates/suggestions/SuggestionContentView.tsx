import { displayTitle, standardText, type SuggestionContent } from './content'

/**
 * 唯讀呈現一版建議內容（TPL-R30、TPL-R32）：項目、項次、標準、實測
 * 欄位定義與照片需求。`idPrefix` 讓比較頁能用穩定項次識別跳轉到同一
 * 項次（TPL-AC36）；新增或刪除的缺側跳到項目內容本身。
 */
export function SuggestionContentView({
  content,
  idPrefix,
}: {
  content: SuggestionContent
  idPrefix?: string
}) {
  return (
    <div className="suggestion-content">
      <div id={idPrefix ? `${idPrefix}-item` : undefined} tabIndex={-1}>
        <h4>{displayTitle(content.title)}</h4>
        <p>{content.instruction.trim() || '未填寫檢查說明'}</p>
      </div>
      {content.inspection_points.map((point, index) => (
        <section
          className="suggestion-point"
          id={idPrefix ? `${idPrefix}-point-${point.logical_id}` : undefined}
          key={point.logical_id}
          tabIndex={idPrefix ? -1 : undefined}
        >
          <h5>
            項次 {index + 1}：{point.title.trim() || '（未填標題）'}
          </h5>
          <p>{point.instruction.trim() || '未填寫項次說明'}</p>
          <dl>
            <dt>檢查標準</dt>
            <dd>{standardText(point)}</dd>
          </dl>
          <div>
            <strong>實測欄位定義</strong>
            {point.measurement_fields.length > 0 ? (
              <ul>
                {[...point.measurement_fields]
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((field) => (
                    <li key={field.logical_id}>
                      {field.name.trim() || '（未填名稱）'}：
                      {field.field_type === 'number'
                        ? `數字（${field.unit?.trim() || '單位見標準'}）`
                        : '文字'}
                      {point.numeric_standard?.measurement_field_logical_id ===
                        field.logical_id && '，用於標準判定'}
                    </li>
                  ))}
              </ul>
            ) : (
              <p>沒有實測欄位</p>
            )}
            <p>
              必填照片：至少 {point.evidence_requirements[0]?.min_count ?? 0}{' '}
              張
            </p>
          </div>
        </section>
      ))}
    </div>
  )
}
