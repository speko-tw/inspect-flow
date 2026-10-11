import type { HttpFieldError } from '../http'

export interface FieldErrorBinding {
  path: string
  key: string
}

export interface MappedFieldErrors {
  errors: Record<string, string>
  unmatched: HttpFieldError[]
}

/** Match server pointers only to explicit, locally generated form bindings. */
export function mapFieldErrors(
  fields: readonly HttpFieldError[],
  bindings: readonly FieldErrorBinding[],
): MappedFieldErrors {
  const keyByPath = new Map<string, string>()
  for (const binding of bindings) {
    if (binding.key && !keyByPath.has(binding.path)) {
      keyByPath.set(binding.path, binding.key)
    }
  }

  const firstCodeByKey = new Map<string, string>()
  const matchedPaths = new Set<string>()
  for (const field of fields) {
    if (!isJsonPointer(field.path)) continue
    const key = keyByPath.get(field.path)
    if (!key) continue
    if (!firstCodeByKey.has(key)) firstCodeByKey.set(key, field.code)
    matchedPaths.add(field.path)
  }

  const errors: Record<string, string> = {}
  for (const binding of bindings) {
    const code = firstCodeByKey.get(binding.key)
    if (code && !(binding.key in errors)) errors[binding.key] = code
  }

  return {
    errors,
    unmatched: fields.filter(
      (field) => !matchedPaths.has(field.path) || !isJsonPointer(field.path),
    ),
  }
}

function isJsonPointer(path: string): boolean {
  return path === '' || (path.startsWith('/') && !/(?:~(?![01]))/.test(path))
}
