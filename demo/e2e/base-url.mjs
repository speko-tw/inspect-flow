// 示範 e2e 的網址守門：只接受本機位址。
//
// 為什麼：e2e 會用 README 公開的示範密碼登入並寫入資料；DEMO_BASE_URL
// 若誤指到非本機環境，就會對別人的系統寫入示範帳號與資料。

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** 回傳 DEMO_BASE_URL（預設 localhost:18311）；非本機位址直接拒絕。 */
export function demoBaseUrl(
  value = process.env.DEMO_BASE_URL,
  fallback = 'http://localhost:18311',
) {
  const base = value ?? fallback
  let host
  try {
    host = new URL(base).hostname
  } catch {
    throw new Error(`DEMO_BASE_URL is not a valid URL: ${base}`)
  }
  if (!LOOPBACK.has(host)) {
    throw new Error(
      `DEMO_BASE_URL must be a loopback address (127.0.0.1, localhost, ` +
        `::1), got: ${base}`,
    )
  }
  return base
}
