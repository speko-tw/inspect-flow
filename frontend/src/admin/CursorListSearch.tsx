import type { FormEvent } from 'react'

import { Form, FormSubmitButton } from '../ui/Form'

/** 管理清單共用搜尋表單，保留原生表單送出與鍵盤操作。 */
export function CursorListSearch({
  label,
  query,
  onQueryChange,
  onSearch,
  disabled,
}: {
  label: string
  query: string
  onQueryChange: (value: string) => void
  onSearch: (event: FormEvent<HTMLFormElement>) => void
  disabled: boolean
}) {
  return (
    <Form onSubmit={onSearch}>
      <label>
        {label}
        <input
          onChange={(event) => onQueryChange(event.target.value)}
          value={query}
        />
      </label>
      <FormSubmitButton disabled={disabled}>搜尋</FormSubmitButton>
    </Form>
  )
}
