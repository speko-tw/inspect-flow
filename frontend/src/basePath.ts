/** DPL-R09：讀取伺服器注入的前綴，使同一個 image 可掛在子路徑。 */
export function getBasePath(): string {
  return (
    document.querySelector<HTMLMetaElement>(
      'meta[name="inspectflow-base-path"]',
    )?.content ?? ''
  )
}

/** DPL-R09：同源請求跟隨部署前綴，不依目前深層網址推算。 */
export function withBasePath(path: string): string {
  return `${getBasePath()}${path}`
}
